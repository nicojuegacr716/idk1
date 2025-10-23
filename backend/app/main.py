from __future__ import annotations

import logging
from pathlib import Path
from typing import Final

from alembic import command
from alembic.config import Config
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
try:
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
except ImportError:  # pragma: no cover - optional dependency
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4"

    def generate_latest():
        return b""

from . import utils
from .admin import init_admin
from .auth import DiscordOAuthClient
from .deps import get_current_user, get_db
from .models import Asset, User
from .schemas import HealthStatus, UserProfile, UserProfileUpdate
from .settings import get_settings


from app.admin.seed import grant_role_to_user
from app.api import ads as ads_router
from app.api import announcements as announcements_router
from app.api import restore_admin as restore_admin_router
from app.api import support as support_router
from app.api import vps as vps_router
from app.services.ads import AdsNonceManager, AdsService
from app.services.event_bus import SessionEventBus
from app.services.support_event_bus import SupportEventBus
from app.services.kyaro import KyaroAssistant
from app.services.wallet import WalletService
from app.services.worker_client import WorkerClient
from app.admin.models import Role, UserRole
from app.admin.services import assets as asset_service

settings = get_settings()
logger = logging.getLogger("uvicorn.error")
app = FastAPI(title="Discord Login App")

try:  # pragma: no cover - optional dependency
    import redis  # type: ignore
except ImportError:  # pragma: no cover
    redis = None

_ALLOWED_METHODS_HEADER = "GET,POST,PUT,PATCH,DELETE,OPTIONS"

if settings.allowed_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info("CORS enabled for origins: %s", settings.allowed_origins_list)
else:
    logger.warning("CORS middleware disabled; no allowed origins configured.")


def _append_vary_header(response: Response, value: str) -> None:
    existing = response.headers.get("Vary")
    if not existing:
        response.headers["Vary"] = value
        return
    values = {item.strip() for item in existing.split(",") if item.strip()}
    if value not in values:
        response.headers["Vary"] = f"{existing}, {value}"


def _first_explicit_origin(origins: list[str]) -> str | None:
    for candidate in origins:
        if candidate and candidate != "*":
            return candidate
    return None


def _apply_cors_headers(request: Request, response: Response) -> Response:
    allowed_origins = settings.allowed_origins_list
    if not allowed_origins:
        return response

    origin = request.headers.get("origin")
    allow_all = "*" in allowed_origins

    if allow_all:
        if origin:
            response.headers.setdefault("Access-Control-Allow-Origin", origin)
        else:
            response.headers.setdefault("Access-Control-Allow-Origin", "*")
    elif origin and origin in allowed_origins:
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
    else:
        fallback = _first_explicit_origin(allowed_origins)
        if fallback:
            response.headers.setdefault("Access-Control-Allow-Origin", fallback)

    header_value = response.headers.get("Access-Control-Allow-Origin")
    if header_value and header_value != "*":
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        _append_vary_header(response, "Origin")
    elif header_value == "*":
        if "Access-Control-Allow-Credentials" in response.headers:
            del response.headers["Access-Control-Allow-Credentials"]

    return response


@app.middleware("http")
async def ensure_cors_headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception as exc:  # ensure CORS headers even on errors
        response = await _handle_exception_with_cors(request, exc)
    return _apply_cors_headers(request, response)


def _preflight_headers(request: Request) -> tuple[dict[str, str], bool]:
    allowed_origins = settings.allowed_origins_list
    origin = request.headers.get("origin")
    allow_all = "*" in allowed_origins
    origin_allowed = allow_all or (origin and origin in allowed_origins)

    headers: dict[str, str] = {
        "Access-Control-Allow-Methods": request.headers.get("access-control-request-method", _ALLOWED_METHODS_HEADER),
        "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers", "*"),
        "Access-Control-Max-Age": "600",
    }
    should_vary = False
    if origin_allowed:
        headers["Access-Control-Allow-Origin"] = "*" if allow_all else origin  # type: ignore[arg-type]
        if not allow_all:
            headers["Access-Control-Allow-Credentials"] = "true"
            should_vary = True
    else:
        fallback = _first_explicit_origin(allowed_origins)
        if fallback:
            headers["Access-Control-Allow-Origin"] = fallback
            headers["Access-Control-Allow-Credentials"] = "true"
            should_vary = True
    return headers, should_vary


async def _handle_exception_with_cors(request: Request, exc: Exception) -> Response:
    if isinstance(exc, HTTPException):
        response = await http_exception_handler(request, exc)
        return _apply_cors_headers(request, response)
    if isinstance(exc, RequestValidationError):
        response = await request_validation_exception_handler(request, exc)
        return _apply_cors_headers(request, response)

    logger.exception("Unhandled application error", exc_info=exc)
    response = Response(
        content='{"detail":"Internal Server Error"}',
        media_type="application/json",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
    return _apply_cors_headers(request, response)


oauth_client = DiscordOAuthClient(settings=settings)
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent / "templates"))
BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = BASE_DIR / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_ROOT_DIR = (BASE_DIR / "root-be").resolve()
PUBLIC_ROOT_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_PUBLIC_EXTENSIONS: Final[set[str]] = {
    ".txt",
    ".json",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".css",
    ".js",
    ".pdf",
    ".csv",
    ".xml",
}


def run_db_migrations() -> None:
    cfg_path = BASE_DIR / "alembic.ini"
    if not cfg_path.exists():
        raise RuntimeError("alembic.ini not found; cannot run migrations.")
    config = Config(str(cfg_path))
    config.set_main_option("script_location", str(BASE_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(config, "head")


def _init_redis():
    if not settings.redis_url or redis is None:
        return None
    try:
        client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        client.ping()
        logger.info("Connected to Redis at %s", settings.redis_url)
        return client
    except Exception:  # pragma: no cover - best effort
        logger.exception("Unable to connect to Redis; continuing without Redis-backed features.")
        return None


@app.on_event("startup")
def on_startup() -> None:
    run_db_migrations()
    init_admin(app)
    app.state.event_bus = SessionEventBus()
    app.state.support_bus = SupportEventBus()
    app.state.worker_client = WorkerClient()
    app.state.redis = _init_redis()
    nonce_ttl = max(settings.reward_min_interval * 4, 600)
    app.state.ads_nonce_manager = AdsNonceManager(ttl_seconds=nonce_ttl, redis_client=getattr(app.state, "redis", None))
    app.state.kyaro_assistant = KyaroAssistant()

app.include_router(restore_admin_router.router)
app.include_router(vps_router.router)
app.include_router(ads_router.router)
app.include_router(support_router.router)
app.include_router(announcements_router.router)


@app.options("/{path:path}", include_in_schema=False)
async def cors_preflight(path: str, request: Request) -> Response:
    headers, vary_origin = _preflight_headers(request)
    response = Response(status_code=status.HTTP_204_NO_CONTENT, headers=headers)
    if vary_origin:
        _append_vary_header(response, "Origin")
    return response

@app.get("/", include_in_schema=False)
async def index(request: Request) -> Response:
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/health", response_model=HealthStatus)
async def healthcheck(db: Session = Depends(get_db)) -> HealthStatus:
    db_status = False
    try:
        db.execute(text("SELECT 1"))
        db_status = True
    except Exception:  # pragma: no cover - best effort
        db_status = False
    return HealthStatus(ok=True, database=db_status)


@app.get("/health/config", include_in_schema=False)
async def health_config() -> dict[str, object]:
    return {
        "allowed_origins": settings.allowed_origins_list,
        "allow_credentials": bool(settings.allowed_origins_list),
    }


@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint() -> Response:
    payload = generate_latest()
    return Response(content=payload, media_type=CONTENT_TYPE_LATEST)


@app.get("/wallet")
async def wallet_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    wallet_service = WalletService(db)
    balance = wallet_service.get_balance(current_user).balance
    return {"balance": balance}


@app.get("/policy")
async def public_policy(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    nonce_manager = getattr(request.app.state, "ads_nonce_manager", None)
    if nonce_manager is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Ads service unavailable")
    service = AdsService(
        db,
        nonce_manager,
        redis_client=getattr(request.app.state, "redis", None),
        settings=settings,
    )
    effective_cap = service._get_effective_daily_cap()  # noqa: SLF001 - public exposure
    return {
        "rewardPerView": settings.reward_amount,
        "requiredDuration": settings.required_duration,
        "minInterval": settings.reward_min_interval,
        "perDay": settings.rewards_per_day,
        "perDevice": settings.rewards_per_device,
        "effectivePerDay": effective_cap,
        "priceFloor": settings.price_floor,
        "placements": settings.allowed_placements,
    }


@app.get("/auth/discord/login", status_code=status.HTTP_302_FOUND)
async def discord_login() -> Response:
    state_value = utils.generate_state_value()
    state_token = utils.sign_state(settings.secret_key, state_value)
    authorize_url = oauth_client.build_authorize_url(state_value)
    response = RedirectResponse(url=authorize_url, status_code=status.HTTP_302_FOUND)
    utils.set_cookie(
        response,
        name=utils.STATE_COOKIE_NAME,
        value=state_token,
        secure=settings.cookie_secure,
        max_age=utils.STATE_MAX_AGE_SECONDS,
    )
    return response


@app.get("/auth/discord/callback", status_code=status.HTTP_303_SEE_OTHER)
async def discord_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    if not code or not state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing authorization parameters.")
    actual_redirect_uri = str(request.url.replace(query="", fragment=""))
    expected_redirect_uri = str(settings.discord_redirect_uri)
    if actual_redirect_uri != expected_redirect_uri:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Redirect URI mismatch.")
    state_cookie = request.cookies.get(utils.STATE_COOKIE_NAME)
    if not state_cookie:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing state cookie.")
    try:
        stored_state = utils.verify_state(settings.secret_key, state_cookie)
    except Exception as exc:  # pragma: no cover - defensive
        if utils.is_bad_signature(exc):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid state token.") from exc
        raise
    if stored_state != state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="State verification failed.")

    access_token = await oauth_client.exchange_code_for_token(code)
    profile_data = await oauth_client.fetch_current_user(access_token)

    discord_id = profile_data["discord_id"]
    stmt = select(User).where(User.discord_id == discord_id)
    existing = db.execute(stmt).scalar_one_or_none()
    if existing is None:
        user = User(
            discord_id=discord_id,
            email=profile_data.get("email"),
            username=profile_data.get("username") or f"discord-{discord_id}",
            display_name=profile_data.get("display_name"),
            avatar_url=profile_data.get("avatar_url"),
            phone_number=None,
        )
        db.add(user)
    else:
        user = existing
        user.email = profile_data.get("email")
        user.username = profile_data.get("username") or user.username
        user.display_name = profile_data.get("display_name")
        user.avatar_url = profile_data.get("avatar_url")
        user.phone_number = None  # Discord OAuth never exposes phone numbers.

    db.commit()
    db.refresh(user)

    # ensure base roles exist for authenticated user
    def _ensure_roles() -> None:
        # guarantee every authenticated account has the "user" role
        grant_role_to_user(db, user, "user")

        # if no admin exists yet, grant admin to this user
        admin_exists = db.scalar(
            select(func.count())
            .select_from(UserRole)
            .join(Role, UserRole.role_id == Role.id)
            .where(Role.name == "admin")
        )
        if not admin_exists:
            grant_role_to_user(db, user, "admin")

    _ensure_roles()

    session_token = utils.sign_session(settings.secret_key, {"user_id": str(user.id)})
    redirect_target = settings.frontend_redirect_target
    response = RedirectResponse(url=redirect_target, status_code=status.HTTP_303_SEE_OTHER)
    utils.clear_cookie(response, name=utils.STATE_COOKIE_NAME)
    utils.set_cookie(
        response,
        name=settings.session_cookie_name,
        value=session_token,
        secure=settings.cookie_secure,
        max_age=utils.SESSION_MAX_AGE_SECONDS,
    )
    return response


def _build_user_profile(db: Session, current_user: User) -> UserProfile:
    wallet_service = WalletService(db)
    balance = wallet_service.get_balance(current_user).balance
    role_names = db.scalars(
        select(Role.name)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == current_user.id)
    ).all()
    roles = list(role_names)
    has_admin_attr = bool(getattr(current_user, "has_admin", False))
    has_admin_role = any(name.lower() == "admin" for name in roles)
    if has_admin_role and not has_admin_attr:
        try:
            current_user.has_admin = True
            db.add(current_user)
            db.commit()
            db.refresh(current_user)
        except Exception:  # pragma: no cover - defensive fallback
            db.rollback()
        has_admin_attr = True
    if has_admin_attr and not has_admin_role:
        roles.append("admin")
        has_admin_role = True
    is_admin = has_admin_attr or has_admin_role
    has_admin = is_admin
    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        phone_number=current_user.phone_number,
        coins=balance,
        roles=roles,
        is_admin=is_admin,
        has_admin=has_admin,
    )


@app.get("/me", response_model=UserProfile)
async def read_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfile:
    return _build_user_profile(db, current_user)


@app.patch("/me", response_model=UserProfile)
async def update_me(
    payload: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfile:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return _build_user_profile(db, current_user)

    changed = False
    if "display_name" in data:
        value = (data["display_name"] or "").strip()
        current_user.display_name = value or None
        changed = True
    if "phone_number" in data:
        value = (data["phone_number"] or "").strip()
        current_user.phone_number = value or None
        changed = True

    if changed:
        db.add(current_user)
        db.commit()
        db.refresh(current_user)

    return _build_user_profile(db, current_user)


@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException) -> Response:
    response = await http_exception_handler(request, exc)
    return _apply_cors_headers(request, response)


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError) -> Response:
    response = await request_validation_exception_handler(request, exc)
    return _apply_cors_headers(request, response)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> Response:
    logger.exception("Unhandled application error", exc_info=exc)
    response = Response(
        content='{"detail":"Internal Server Error"}',
        media_type="application/json",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
    return _apply_cors_headers(request, response)


@app.get("/assets/{code}", include_in_schema=False)
async def serve_asset(code: str, db: Session = Depends(get_db)) -> FileResponse:
    asset = asset_service.get_asset_by_code(db, code)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")
    file_path = ASSETS_DIR / asset.stored_path
    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")
    return FileResponse(
        path=file_path,
        media_type=asset.content_type,
        filename=asset.original_filename or asset.stored_path,
    )


@app.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout() -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    utils.clear_cookie(response, name=settings.session_cookie_name)
    return response

@app.get("/baitho2z2", status_code=418)
def thocho2z2tuoilon():
    BAITHO1 = """Trời cao biển rộng, ít nhân tài
Lại sinh ra kẻ, tưởng mình oai
Một tay mò Git, đi bú source
Một tay trộm máy, tưởng ngon zai
Code thì lỏng lẻo, dựa A.I
Năm dòng thêm mười, chú giải dài.
Tự khoe oai hùng, tưởng mình siêu,
Gặp kẻ ra tay, nguồn hóa diều.

- Author: Ducknodevis -
- 10/04/2025 -
- CI/CD Complete! -
"""
    return Response(content=BAITHO1, media_type="text/plain; charset=utf-8")

def _resolve_public_file(requested_path: str) -> Path:
    sanitized = (requested_path or "").strip().lstrip("/")
    if not sanitized:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    candidate = (PUBLIC_ROOT_DIR / sanitized).resolve()
    if not candidate.is_file() or PUBLIC_ROOT_DIR not in candidate.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    extension = candidate.suffix.lower()
    if extension not in ALLOWED_PUBLIC_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="File type not allowed")
    return candidate


@app.get("/root-be/{requested_path:path}", include_in_schema=False)
async def serve_public_file(requested_path: str) -> FileResponse:
    file_path = _resolve_public_file(requested_path)
    return FileResponse(
        path=file_path,
        filename=file_path.name,
        headers={"Cache-Control": "public, max-age=300"},
    )

@app.on_event("shutdown")
async def on_shutdown() -> None:
    client = getattr(app.state, "worker_client", None)
    if client is not None:
        await client.aclose()
    redis_client = getattr(app.state, "redis", None)
    if redis_client is not None:
        try:
            redis_client.close()
        except AttributeError:  # pragma: no cover - older redis client
            try:
                redis_client.connection_pool.disconnect()
            except Exception:  # pragma: no cover
                pass
