import os
import sys
import types
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.compiler import compiles


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return "TEXT"


@compiles(PGUUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):
    return "TEXT"


# Ensure environment is configured before importing application modules
os.environ.setdefault("DISCORD_CLIENT_ID", "123")
os.environ.setdefault("DISCORD_CLIENT_SECRET", "secret")
os.environ.setdefault("DISCORD_REDIRECT_URI", "https://example.com/callback")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///./test-admin.db")
os.environ.setdefault("BASE_URL", "https://example.com")
os.environ.setdefault("ADMIN_ENABLED", "true")
os.environ.setdefault("ADMIN_PREFIX", "/admin")
os.environ.setdefault("ADMIN_API_PREFIX", "/api/v1/admin")
os.environ.setdefault("ADMIN_DEFAULT_PASSWORD", "bootstrap-secret")

if "openai" not in sys.modules:
    class _DummyChatCompletions:
        async def create(self, *args, **kwargs):
            raise RuntimeError("AsyncOpenAI stub invoked in tests")

    class _DummyChat:
        completions = _DummyChatCompletions()

    class _DummyAsyncOpenAI:
        def __init__(self, *args, **kwargs):
            self.chat = _DummyChat()

    sys.modules["openai"] = types.SimpleNamespace(AsyncOpenAI=_DummyAsyncOpenAI)

from app.settings import get_settings
from app.admin.admin_settings import get_admin_settings
from app.admin.security import compute_csrf_token

get_settings.cache_clear()
get_admin_settings.cache_clear()

from app import db as db_module
from app.db import Base
import app.models  # noqa: F401
import app.admin.models  # noqa: F401
import app.admin as admin_package
import app.deps as deps_module
import app.main as main_module

main_module.run_db_migrations = lambda: None
main_app = main_module.app


@pytest.fixture()
def client_with_db(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}", future=True, connect_args={"check_same_thread": False}
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    db_module.engine = engine
    db_module.SessionLocal = TestingSessionLocal
    admin_package.SessionLocal = TestingSessionLocal
    deps_module.SessionLocal = TestingSessionLocal

    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    inspector = inspect(engine)
    assert inspector.has_table("users")
    assert inspector.has_table("permissions")

    with TestClient(main_app) as client:
        yield client, TestingSessionLocal

    Base.metadata.drop_all(engine)
    engine.dispose()


def _create_user(session_maker, **overrides):
    from app.models import User

    data = {
        "discord_id": overrides.get("discord_id", uuid4().hex),
        "email": overrides.get("email", f"{uuid4().hex[:8]}@example.com"),
        "username": overrides.get("username", f"user_{uuid4().hex[:6]}"),
        "display_name": overrides.get("display_name", "Test User"),
        "avatar_url": overrides.get("avatar_url", "https://example.com/avatar.png"),
        "phone_number": overrides.get("phone_number"),
    }
    with session_maker() as db:
        user = User(**data)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user


def _override_user(client: TestClient, user):
    from app.deps import get_current_user

    async def _current_user_override():
        return user

    client.app.dependency_overrides[get_current_user] = _current_user_override
    return get_current_user


def _set_session_cookie(client: TestClient, session_token: str) -> None:
    settings = get_settings()
    client.cookies.set(settings.session_cookie_name, session_token)


def _csrf_header(session_token: str, path: str) -> dict[str, str]:
    import hashlib
    import time

    from app.admin.security import compute_csrf_token

    token = compute_csrf_token(session_token, path)
    timestamp = str(int(time.time() * 1000))
    signature = hashlib.sha256(f"{token}:{timestamp}".encode("utf-8")).hexdigest()
    return {
        "X-CSRF-Token": token,
        "X-Request-Timestamp": timestamp,
        "X-Request-Signature": signature,
    }


def test_admin_permission_denied_for_non_privileged_user(client_with_db):
    client, SessionLocal = client_with_db
    user = _create_user(SessionLocal)
    override = _override_user(client, user)

    response = client.get("/api/v1/admin/users")
    assert response.status_code == 403

    client.app.dependency_overrides.pop(override, None)


def test_admin_user_lifecycle_and_audit_logs(client_with_db):
    client, SessionLocal = client_with_db
    from app.admin.models import AuditLog, Role
    from app.admin.seed import grant_role_to_user
    from app.models import User

    actor = _create_user(SessionLocal, username="admin_actor")
    with SessionLocal() as db:
        grant_role_to_user(db, actor, "admin")

    override = _override_user(client, actor)
    session_token = "admin-session"
    _set_session_cookie(client, session_token)

    create_path = "/api/v1/admin/users"
    create_payload = {
        "discord_id": uuid4().hex,
        "username": "managed_user",
        "email": "managed@example.com",
        "display_name": "Managed",
        "avatar_url": "https://example.com/managed.png",
        "phone_number": None,
    }
    create_headers = _csrf_header(session_token, create_path)
    response = client.post(create_path, json=create_payload, headers=create_headers)
    assert response.status_code == 201
    created_id = response.json()["id"]

    update_path = f"/api/v1/admin/users/{created_id}"
    update_headers = _csrf_header(session_token, update_path)
    response = client.patch(update_path, json={"display_name": "Managed Updated"}, headers=update_headers)
    assert response.status_code == 200
    assert response.json()["display_name"] == "Managed Updated"

    with SessionLocal() as db:
        mod_role = db.scalar(select(Role).where(Role.name == "moderator"))
        assert mod_role is not None
    assign_path = f"/api/v1/admin/users/{created_id}/roles"
    assign_headers = _csrf_header(session_token, assign_path)
    response = client.post(assign_path, json={"role_ids": [str(mod_role.id)]}, headers=assign_headers)
    assert response.status_code == 200

    delete_headers = _csrf_header(session_token, update_path)
    response = client.delete(update_path, headers=delete_headers)
    assert response.status_code == 204

    with SessionLocal() as db:
        assert db.get(User, UUID(created_id)) is None
        entries = (
            db.execute(
                select(AuditLog).where(AuditLog.target_id == created_id).order_by(AuditLog.created_at)
            )
            .scalars()
            .all()
        )
    actions = {entry.action for entry in entries}
    assert {"user.create", "user.update", "user.roles.set", "user.delete"} <= actions

    client.app.dependency_overrides.pop(override, None)


def test_admin_role_management_flow(client_with_db):
    client, SessionLocal = client_with_db
    from app.admin.models import Role, RolePermission
    from app.admin.seed import grant_role_to_user

    actor = _create_user(SessionLocal, username="role_admin")
    with SessionLocal() as db:
        grant_role_to_user(db, actor, "admin")

    override = _override_user(client, actor)
    session_token = "role-session"
    _set_session_cookie(client, session_token)

    role_name = f"qa-{uuid4().hex[:6]}"
    create_path = "/api/v1/admin/roles"
    create_headers = _csrf_header(session_token, create_path)
    response = client.post(create_path, json={"name": role_name, "description": "QA role"}, headers=create_headers)
    assert response.status_code == 201
    role_id = response.json()["id"]

    patch_path = f"/api/v1/admin/roles/{role_id}"
    patch_headers = _csrf_header(session_token, patch_path)
    response = client.patch(patch_path, json={"description": "Updated"}, headers=patch_headers)
    assert response.status_code == 200
    assert response.json()["description"] == "Updated"

    perms_path = f"/api/v1/admin/roles/{role_id}/perms"
    perms_headers = _csrf_header(session_token, perms_path)
    response = client.put(
        perms_path,
        json={"permission_codes": ["sys:status:read", "user:read"]},
        headers=perms_headers,
    )
    assert response.status_code == 200
    with SessionLocal() as db:
        stored_perms = (
            db.execute(
                select(RolePermission).where(RolePermission.role_id == UUID(role_id))
            )
            .scalars()
            .all()
        )
    assert len(stored_perms) == 2

    delete_headers = _csrf_header(session_token, patch_path)
    response = client.delete(patch_path, headers=delete_headers)
    assert response.status_code == 204
    with SessionLocal() as db:
        assert db.get(Role, UUID(role_id)) is None

    client.app.dependency_overrides.pop(override, None)


def test_admin_status_endpoints(client_with_db):
    client, SessionLocal = client_with_db
    from app.admin.seed import grant_role_to_user

    actor = _create_user(SessionLocal, username="status_admin")
    with SessionLocal() as db:
        grant_role_to_user(db, actor, "admin")

    override = _override_user(client, actor)

    health = client.get("/api/v1/admin/status/health")
    assert health.status_code == 200
    assert "api_up" in health.json()

    deps = client.get("/api/v1/admin/status/deps")
    assert deps.status_code == 200
    assert "db_ping_ms" in deps.json()

    db_status = client.get("/api/v1/admin/status/db")
    assert db_status.status_code == 200
    assert "last_migration" in db_status.json()

    client.app.dependency_overrides.pop(override, None)


def test_admin_csrf_token_endpoint(client_with_db):
    client, SessionLocal = client_with_db
    from app.admin.seed import grant_role_to_user

    actor = _create_user(SessionLocal, username="csrf_admin")
    with SessionLocal() as db:
        grant_role_to_user(db, actor, "admin")

    override = _override_user(client, actor)
    session_token = "csrf-session"
    _set_session_cookie(client, session_token)

    target_path = "/api/v1/admin/announcements"
    response = client.get("/api/v1/admin/csrf-token", params={"path": target_path})
    assert response.status_code == 200
    token_payload = response.json()
    assert token_payload["token"] == compute_csrf_token(session_token, target_path)

    client.app.dependency_overrides.pop(override, None)


def test_bootstrap_secret_flow(client_with_db):
    client, SessionLocal = client_with_db
    from app.admin.seed import bootstrap_secret_valid, mark_bootstrap_consumed

    with SessionLocal() as db:
        assert bootstrap_secret_valid(db, "bootstrap-secret")
        mark_bootstrap_consumed(db)
        assert not bootstrap_secret_valid(db, "bootstrap-secret")


def test_admin_role_detail_page(client_with_db):
    client, SessionLocal = client_with_db
    from app.admin.seed import grant_role_to_user

    actor = _create_user(SessionLocal, username="role_detail_admin")
    with SessionLocal() as db:
        grant_role_to_user(db, actor, "admin")

    override = _override_user(client, actor)
    session_token = "role-detail-session"
    _set_session_cookie(client, session_token)

    create_path = "/api/v1/admin/roles"
    create_headers = _csrf_header(session_token, create_path)
    response = client.post(create_path, json={"name": "detail-role", "description": "Role detail"}, headers=create_headers)
    assert response.status_code == 201
    role_id = response.json()["id"]

    resp = client.get(f"/admin/roles/{role_id}")
    assert resp.status_code == 200
    assert "Role detail" in resp.text

    perms_path = f"/api/v1/admin/roles/{role_id}/perms"
    perms_headers = _csrf_header(session_token, perms_path)
    response = client.put(
        perms_path,
        json={"permission_codes": ["user:read"], "new_permission_code": "custom:build"},
        headers=perms_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert any(perm["code"] == "custom:build" for perm in payload["permissions"])

    client.app.dependency_overrides.pop(override, None)
