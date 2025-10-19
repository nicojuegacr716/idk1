from __future__ import annotations

import hashlib
from typing import Dict, Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import User

from .admin_settings import AdminSettings
from .models import Permission, Role, RolePermission, ServiceStatus, UserRole

DEFAULT_PERMISSIONS: Dict[str, str] = {
    "user:create": "Create new users",
    "user:read": "Read user profiles",
    "user:update": "Update user profiles",
    "user:delete": "Delete user profiles",
    "user:assign-role": "Assign roles to users",
    "user:coins:update": "Adjust user coin balances",
    "token:create": "Create admin tokens",
    "token:read": "Read admin tokens",
    "token:revoke": "Revoke admin tokens",
    "worker:read": "View registered workers",
    "worker:register": "Register new workers",
    "worker:update": "Update worker configuration",
    "worker:disable": "Disable worker",
    "vps_product:create": "Create VPS products",
    "vps_product:read": "Read VPS products",
    "vps_product:update": "Update VPS products",
    "vps_product:delete": "Archive VPS products",
    "role:create": "Create roles",
    "role:read": "Read roles",
    "role:update": "Update roles",
    "role:delete": "Delete roles",
    "role:set-perms": "Modify role permissions",
    "sys:status:read": "Read system status",
    "sys:db:read": "Read database diagnostics",
    "settings:ads:read": "Read ads settings",
    "settings:ads:update": "Update ads settings",
    "kyaro:prompt:read": "Read Kyaro system prompt",
    "kyaro:prompt:update": "Update Kyaro system prompt",
    "support:threads:read": "View support inbox",
    "support:threads:reply": "Respond to support threads",
    "notification:read": "Read platform announcements",
    "notification:create": "Publish platform announcements",
    "notification:update": "Edit platform announcements",
    "notification:delete": "Delete platform announcements",
    "asset:upload": "Upload asset images",
}

ROLE_PERMISSION_MAP: Dict[str, Iterable[str]] = {
    "admin": list(DEFAULT_PERMISSIONS.keys()),
    "moderator": [
        "user:read",
        "user:update",
        "user:assign-role",
        "sys:status:read",
        "support:threads:read",
        "support:threads:reply",
        "notification:read",
        "notification:update",
    ],
    "user": [],
}

ROLE_DESCRIPTIONS = {
    "admin": "Full administrative access",
    "moderator": "Moderation capabilities",
    "user": "Default authenticated user",
}


BOOTSTRAP_SERVICE = "admin_bootstrap"


def _get_or_create_permission(db: Session, code: str, description: str) -> Permission:
    permission = db.scalar(select(Permission).where(Permission.code == code))
    if permission:
        if permission.description != description:
            permission.description = description
            db.add(permission)
        return permission
    permission = Permission(code=code, description=description)
    db.add(permission)
    db.flush()
    return permission


def _get_or_create_role(db: Session, name: str, description: str) -> Role:
    role = db.scalar(select(Role).where(Role.name == name))
    if role:
        if role.description != description:
            role.description = description
            db.add(role)
        return role
    role = Role(name=name, description=description)
    db.add(role)
    db.flush()
    return role

def create_test_data(db: Session):
    # Create test product
    from app.models import VpsProduct
    from uuid import uuid4

    # Create test product
    product = VpsProduct(
        id=uuid4(),
        name="Test VPS",
        description="Test VPS for worker",
        price_coins=100,
        is_active=True,
    )
    db.add(product)
    
    # Create test user with discord ID
    user = User(
        id=uuid4(),
        discord_id="123456789",
        email="test@example.com",
        username="test_user",
        coins=1000,
    )
    db.add(user)
    
    db.commit()
    
    print(f"Created test product ID: {product.id}")
    print(f"Created test user ID: {user.id}")
    
    return user, product


def _sync_role_permissions(db: Session, role: Role, permission_codes: Iterable[str]) -> None:
    existing = {
        perm.code: perm.id
        for perm in db.execute(
            select(Permission).join(RolePermission, Permission.id == RolePermission.permission_id).where(
                RolePermission.role_id == role.id
            )
        ).scalars()
    }
    desired = set(permission_codes)

    for code, perm_id in existing.items():
        if code not in desired:
            db.execute(
                delete(RolePermission).where(
                    RolePermission.role_id == role.id,
                    RolePermission.permission_id == perm_id,
                )
            )

    for code in desired:
        perm = db.scalar(select(Permission).where(Permission.code == code))
        if not perm:
            continue
        if code in existing:
            continue
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))


def _ensure_bootstrap_record(db: Session, settings: AdminSettings) -> None:
    record = db.scalar(select(ServiceStatus).where(ServiceStatus.service_name == BOOTSTRAP_SERVICE))
    if record is None:
        record = ServiceStatus(service_name=BOOTSTRAP_SERVICE, status="pending", meta_json={})
        db.add(record)
        db.flush()
    meta = dict(record.meta_json or {})
    if settings.default_password:
        secret_hash = hashlib.sha256(settings.default_password.encode("utf-8")).hexdigest()
        stored_hash = meta.get("secret_hash")
        if stored_hash != secret_hash and not meta.get("consumed"):
            meta["secret_hash"] = secret_hash
            meta["consumed"] = False
            record.status = "ready"
            record.meta_json = meta
            db.add(record)
    else:
        if not meta.get("consumed"):
            record.status = "pending"
            record.meta_json = meta
            db.add(record)


def seed_defaults(db: Session, settings: AdminSettings) -> None:
    for code, description in DEFAULT_PERMISSIONS.items():
        _get_or_create_permission(db, code, description)
    db.flush()

    role_objects: dict[str, Role] = {}
    for role_name, description in ROLE_DESCRIPTIONS.items():
        role_objects[role_name] = _get_or_create_role(db, role_name, description)

    db.flush()

    for role_name, codes in ROLE_PERMISSION_MAP.items():
        role = role_objects[role_name]
        _sync_role_permissions(db, role, codes)

    _ensure_bootstrap_record(db, settings)
    db.commit()


def grant_role_to_user(db: Session, user: User, role_name: str) -> None:
    role = db.scalar(select(Role).where(Role.name == role_name))
    if not role:
        return
    is_admin_role = role_name.lower() == "admin"
    exists = db.scalar(
        select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == role.id)
    )
    if exists:
        if is_admin_role and hasattr(user, "has_admin") and not getattr(user, "has_admin", False):
            user.has_admin = True
            db.add(user)
            db.commit()
        return
    db.add(UserRole(user_id=user.id, role_id=role.id))
    if is_admin_role and hasattr(user, "has_admin") and not getattr(user, "has_admin", False):
        user.has_admin = True
        db.add(user)
    db.commit()


def bootstrap_secret_valid(db: Session, secret: str) -> bool:
    record = db.scalar(select(ServiceStatus).where(ServiceStatus.service_name == BOOTSTRAP_SERVICE))
    if not record or not record.meta_json:
        return False
    meta = record.meta_json
    if meta.get("consumed"):
        return False
    stored_hash = meta.get("secret_hash")
    if not stored_hash:
        return False
    provided_hash = hashlib.sha256(secret.encode("utf-8")).hexdigest()
    return provided_hash == stored_hash


def mark_bootstrap_consumed(db: Session) -> None:
    record = db.scalar(select(ServiceStatus).where(ServiceStatus.service_name == BOOTSTRAP_SERVICE))
    if not record:
        return
    meta = dict(record.meta_json or {})
    meta["consumed"] = True
    record.status = "consumed"
    record.meta_json = meta
    db.add(record)
    db.commit()


