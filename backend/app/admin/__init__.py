from __future__ import annotations

from fastapi import APIRouter, FastAPI

from app.db import SessionLocal

from .admin_settings import get_admin_settings
from .routers import csrf as csrf_router
from .routers import roles as roles_router
from .routers import settings as settings_router
from .routers import status as status_router
from .routers import tokens as tokens_router
from .routers import users as users_router
from .routers import vps_products as vps_products_router
from .routers import workers as workers_router
from .routers import support as support_router
from .routers import announcements as announcements_router
from .seed import seed_defaults


def _ensure_seed_data() -> None:
    settings = get_admin_settings()
    with SessionLocal() as db:
        seed_defaults(db, settings)


def init_admin(app: FastAPI) -> None:
    settings = get_admin_settings()
    if not settings.enabled:
        return

    _ensure_seed_data()

    api_router = APIRouter(prefix=settings.api_prefix)
    api_router.include_router(users_router.router)
    api_router.include_router(roles_router.router)
    api_router.include_router(tokens_router.router)
    api_router.include_router(workers_router.router)
    api_router.include_router(vps_products_router.router)
    api_router.include_router(csrf_router.router)
    api_router.include_router(settings_router.router)
    api_router.include_router(status_router.router)
    api_router.include_router(support_router.router)
    api_router.include_router(announcements_router.router)

    app.include_router(api_router)
