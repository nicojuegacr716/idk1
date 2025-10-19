from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.admin.recovery import AdminRestoreRequest, RESTORE_ADMIN_FORM_HTML, restore_admin
from app.admin.schemas import AdminUser
from app.deps import get_current_user, get_db
from app.models import User

router = APIRouter(prefix="/api/v1", tags=["restore-admin"])


@router.get("/restore-admin", include_in_schema=False, response_class=HTMLResponse)
async def render_restore_admin_form() -> HTMLResponse:
    return HTMLResponse(content=RESTORE_ADMIN_FORM_HTML)


@router.post("/restore-admin", response_model=AdminUser)
async def restore_admin_access(
    payload: AdminRestoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminUser:
    return restore_admin(payload, db, current_user=current_user)
