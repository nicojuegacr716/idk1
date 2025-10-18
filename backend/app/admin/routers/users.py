from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs
from pydantic import ValidationError
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.deps import get_db
from app.models import User
from app.security.payload import decrypt_payload

from ..audit import AuditContext
from ..deps import require_perm
from ..schemas import (
    AdminUser,
    UserCoinsUpdateRequest,
    UserCreate,
    UserListResponse,
    UserQueryParams,
    UserUpdate,
)
from ..services import users as user_service


router = APIRouter(tags=["admin-users"])


def _audit_context(request: Request, actor: User) -> AuditContext:
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    return AuditContext(actor_user_id=actor.id, ip=client_host, ua=user_agent)


def _validated_secret(request: Request) -> str:
    token = getattr(request.state, "csrf_token", None)
    if not token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing CSRF context.")
    return token


async def _read_secure_payload(request: Request) -> dict[str, Any]:
    content_type = (request.headers.get("content-type") or "").lower()
    encryption = (request.headers.get("X-Payload-Encrypted") or "").lower()
    if encryption:
        if encryption != "aes-gcm":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported payload encryption scheme.",
            )
        raw = await request.json()
        if not isinstance(raw, dict) or "data" not in raw:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Encrypted payload missing data field.")
        secret = _validated_secret(request)
        try:
            decrypted = decrypt_payload(str(raw["data"]), secret)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to decrypt payload.") from exc
        if not isinstance(decrypted, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decrypted payload is invalid.")
        return decrypted
    if "application/json" in content_type:
        parsed = await request.json()
        if parsed is None:
            return {}
        if isinstance(parsed, dict):
            return parsed
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="JSON body must be an object.")
    try:
        form = await request.form()
    except TypeError:
        raw_body = await request.body()
        if not raw_body:
            return {}
        try:
            decoded = raw_body.decode("utf-8")
        except UnicodeDecodeError:
            decoded = raw_body.decode("latin-1")
        parsed = parse_qs(decoded, keep_blank_values=True)
        data = {key: values[0] if len(values) == 1 else values for key, values in parsed.items()}
        return data
    data: dict[str, Any] = {}
    for key in form.keys():
        values = form.getlist(key)
        if len(values) == 1:
            data[key] = values[0]
        else:
            data[key] = values
    return data


async def _parse_user_update(request: Request) -> UserUpdate:
    data = await _read_secure_payload(request)
    return UserUpdate(**{k: v for k, v in data.items() if v is not None})


async def _parse_role_payload(request: Request) -> list[UUID]:
    payload = await _read_secure_payload(request)
    raw_values = payload.get("role_ids", [])
    if isinstance(raw_values, str):
        values = [raw_values]
    elif isinstance(raw_values, (list, tuple)):
        values = raw_values
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role_ids must be a list.")
    role_ids: list[UUID] = []
    for value in values:
        try:
            role_ids.append(UUID(str(value)))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid role id: {value}")
    return role_ids


@router.post("/users", response_model=AdminUser, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: Request,
    actor: User = Depends(require_perm("user:create")),
    db: Session = Depends(get_db),
) -> AdminUser:
    data = await _read_secure_payload(request)
    try:
        payload = UserCreate(**data)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user payload.") from exc
    context = _audit_context(request, actor)
    return user_service.create_user(db, payload, context)


@router.get("/users", response_model=UserListResponse)
async def list_users(
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    role: UUID | None = Query(None),
    _: User = Depends(require_perm("user:read")),
    db: Session = Depends(get_db),
) -> UserListResponse:
    params = UserQueryParams(q=q, page=page, page_size=page_size, role=role)
    return user_service.list_users(db, params)


@router.get("/users/self", response_model=AdminUser)
async def get_current_admin_user(
    actor: User = Depends(require_perm("user:read")),
    db: Session = Depends(get_db),
) -> AdminUser:
    return user_service.get_user(db, actor.id)


@router.get("/users/{user_id}", response_model=AdminUser)
async def get_user(
    user_id: UUID,
    _: User = Depends(require_perm("user:read")),
    db: Session = Depends(get_db),
) -> AdminUser:
    return user_service.get_user(db, user_id)


@router.patch("/users/{user_id}", response_model=AdminUser)
async def update_user(
    request: Request,
    user_id: UUID,
    actor: User = Depends(require_perm("user:update")),
    db: Session = Depends(get_db),
) -> AdminUser:
    payload = await _parse_user_update(request)
    context = _audit_context(request, actor)
    return user_service.update_user(db, user_id, payload, context)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, response_model=None)
async def delete_user(
    request: Request,
    user_id: UUID,
    actor: User = Depends(require_perm("user:delete")),
    db: Session = Depends(get_db),
) -> None:
    context = _audit_context(request, actor)
    user_service.delete_user(db, user_id, context)


@router.post("/users/{user_id}/roles", response_model=AdminUser)
async def assign_roles(
    request: Request,
    user_id: UUID,
    actor: User = Depends(require_perm("user:assign-role")),
    db: Session = Depends(get_db),
) -> AdminUser:
    role_ids = await _parse_role_payload(request)
    context = _audit_context(request, actor)
    return user_service.add_roles_to_user(db, user_id, role_ids, context)


@router.delete("/users/{user_id}/roles", response_model=AdminUser)
async def remove_roles(
    request: Request,
    user_id: UUID,
    actor: User = Depends(require_perm("user:assign-role")),
    db: Session = Depends(get_db),
) -> AdminUser:
    role_ids = await _parse_role_payload(request)
    context = _audit_context(request, actor)
    return user_service.remove_roles_from_user(db, user_id, role_ids, context)

@router.patch("/users/{user_id}/coins", response_model=AdminUser)
async def update_user_coins_endpoint(
    request: Request,
    user_id: UUID,
    actor: User = Depends(require_perm("user:coins:update")),
    db: Session = Depends(get_db),
) -> AdminUser:
    data = await _read_secure_payload(request)
    try:
        payload = UserCoinsUpdateRequest(**data)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid coin payload.") from exc
    context = _audit_context(request, actor)
    return user_service.update_user_coins(
        db,
        user_id,
        operation=payload.op,
        amount=payload.amount,
        reason=payload.reason,
        context=context,
    )
