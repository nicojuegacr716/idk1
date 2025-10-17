from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import utils
from .admin import init_admin
from .auth import DiscordOAuthClient
from .deps import get_current_user, get_db
from .models import User
from .schemas import HealthStatus, UserProfile
from .settings import get_settings

from sqlalchemy import func, select

from app.admin.seed import grant_role_to_user
from app.api import ads as ads_router
from app.api import announcements as announcements_router
from app.api import profile as profile_router
from app.api import support as support_router
from app.api import vps as vps_router
from app.services.ads import AdsNonceManager
from app.services.event_bus import SessionEventBus
from app.services.support_event_bus import SupportEventBus
from app.services.kyaro import KyaroAssistant
from app.services.worker_client import WorkerClient
from app.admin.models import Role, UserRole

settings = get_settings()
app = FastAPI(title="Discord Login App")

if settings.allowed_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

oauth_client = DiscordOAuthClient(settings=settings)
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent / "templates"))
BASE_DIR = Path(__file__).resolve().parent.parent


def run_db_migrations() -> None:
    cfg_path = BASE_DIR / "alembic.ini"
    if not cfg_path.exists():
        raise RuntimeError("alembic.ini not found; cannot run migrations.")
    config = Config(str(cfg_path))
    config.set_main_option("script_location", str(BASE_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(config, "head")


@app.on_event("startup")
def on_startup() -> None:
    run_db_migrations()
    init_admin(app)
    app.state.event_bus = SessionEventBus()
    app.state.support_bus = SupportEventBus()
    app.state.worker_client = WorkerClient()
    app.state.ads_nonce_manager = AdsNonceManager()
    app.state.kyaro_assistant = KyaroAssistant()

app.include_router(vps_router.router)
app.include_router(ads_router.router)
app.include_router(support_router.router)
app.include_router(announcements_router.router)
app.include_router(profile_router.router)

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


@app.get("/me", response_model=UserProfile)
async def read_me(current_user: User = Depends(get_current_user)) -> UserProfile:
    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        phone_number=None,
        coins=current_user.coins or 0,
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

@app.on_event("shutdown")
async def on_shutdown() -> None:
    client = getattr(app.state, "worker_client", None)
    if client is not None:
        await client.aclose()


