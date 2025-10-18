from __future__ import annotations

import hmac
from typing import Any
from urllib.parse import parse_qs
from pydantic import BaseModel, ValidationError, model_validator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_db
from app.models import User
from app.security.payload import decrypt_payload

from ..admin_settings import get_admin_settings
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
from ..seed import grant_role_to_user


router = APIRouter(tags=["admin-users"])

RESTORE_ADMIN_FORM_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Restore Admin Access</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 0;
      background: radial-gradient(circle at top, #1f2933, #111827);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f9fafb;
    }
    main {
      background: rgba(17, 24, 39, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 16px;
      padding: 32px;
      width: min(420px, 90vw);
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(12px);
    }
    h1 {
      margin-top: 0;
      font-size: 1.75rem;
      letter-spacing: 0.01em;
      text-align: center;
    }
    p {
      color: #e5e7eb;
      font-size: 0.95rem;
      line-height: 1.6;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.4);
      background: rgba(30, 41, 59, 0.8);
      color: inherit;
      margin-bottom: 18px;
      font-size: 1rem;
    }
    button {
      width: 100%;
      padding: 14px;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, #2563eb, #8b5cf6);
      color: #f9fafb;
      font-weight: 600;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 12px 24px rgba(37, 99, 235, 0.35);
    }
    .status {
      margin-top: 18px;
      font-weight: 600;
    }
    .error {
      color: #f87171;
    }
    pre {
      background: rgba(15, 23, 42, 0.8);
      border-radius: 12px;
      padding: 18px;
      overflow: auto;
      max-height: 260px;
      font-size: 0.85rem;
      border: 1px solid rgba(148, 163, 184, 0.25);
    }
  </style>
</head>
<body>
  <main>
    <h1>Restore Admin Access</h1>
    <p>Provide the recovery password and the user identifier. You must enter either a Discord ID or a User ID.</p>
    <form id="restore-form">
      <label for="password">Recovery password</label>
      <input id="password" name="password" type="password" placeholder="Enter recovery password" required>

      <label for="discord_id">Discord ID <small>(optional)</small></label>
      <input id="discord_id" name="discord_id" type="text" placeholder="Discord user ID">

      <label for="user_id">User ID <small>(optional)</small></label>
      <input id="user_id" name="user_id" type="text" placeholder="UUID from database">

      <button type="submit">Restore admin role</button>
    </form>
    <p id="status" class="status" role="status"></p>
    <p id="error" class="status error" role="alert"></p>
    <pre id="details" hidden></pre>
  </main>
  <script>
    (function () {
      const form = document.getElementById("restore-form");
      const statusEl = document.getElementById("status");
      const errorEl = document.getElementById("error");
      const detailsEl = document.getElementById("details");
      if (!form) {
        return;
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        statusEl.textContent = "";
        errorEl.textContent = "";
        detailsEl.textContent = "";
        detailsEl.hidden = true;

        const formData = new FormData(form);
        const password = (formData.get("password") || "").toString().trim();
        const discordId = (formData.get("discord_id") || "").toString().trim();
        const userId = (formData.get("user_id") || "").toString().trim();

        if (!password) {
          errorEl.textContent = "Password is required.";
          return;
        }
        if (!discordId && !userId) {
          errorEl.textContent = "Please provide either a Discord ID or a User ID.";
          return;
        }

        const payload = { password: password };
        if (discordId) {
          payload.discord_id = discordId;
        }
        if (userId) {
          payload.user_id = userId;
        }

        statusEl.textContent = "Submitting request...";

        try {
          const response = await fetch(window.location.pathname, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const raw = await response.text();
          let data = raw;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          if (!response.ok) {
            let message = "Request failed.";
            if (data && typeof data === "object") {
              if (Array.isArray(data.detail)) {
                message = data.detail.map((item) => item.msg || item).join(", ");
              } else if (data.detail) {
                message = data.detail;
              }
            } else if (typeof data === "string" && data) {
              message = data;
            }
            throw new Error(message);
          }

          let summary = "selected user";
          if (data && typeof data === "object") {
            summary = data.display_name || data.username || data.id || summary;
          }
          statusEl.textContent = "Admin role restored for " + summary + ".";
          if (data && typeof data === "object") {
            detailsEl.textContent = JSON.stringify(data, null, 2);
          } else {
            detailsEl.textContent = raw || "";
          }
          detailsEl.hidden = false;
        } catch (error) {
          statusEl.textContent = "";
          errorEl.textContent = error.message || "Unexpected error occurred.";
        }
      });
    })();
  </script>
</body>
</html>
"""


class AdminRestoreRequest(BaseModel):
    password: str
    user_id: UUID | None = None
    discord_id: str | None = None

    @model_validator(mode="after")
    def ensure_target(self):
        if not self.user_id and not self.discord_id:
            raise ValueError("Either user_id or discord_id must be provided.")
        return self


def _audit_context(request: Request, actor: User) -> AuditContext:
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    return AuditContext(actor_user_id=actor.id, ip=client_host, ua=user_agent)


def _validated_secret(request: Request) -> str:
    token = getattr(request.state, "csrf_token", None)
    if not token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing CSRF context.")
    return token


@router.get("/restore-admin", include_in_schema=False, response_class=HTMLResponse)
async def render_restore_admin_form() -> HTMLResponse:
    return HTMLResponse(content=RESTORE_ADMIN_FORM_HTML)


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


@router.post("/restore-admin", response_model=AdminUser)
async def restore_admin_role(payload: AdminRestoreRequest, db: Session = Depends(get_db)) -> AdminUser:
    settings = get_admin_settings()
    expected = settings.default_password or ""
    if not expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin recovery is disabled.")
    if not hmac.compare_digest(payload.password, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid recovery password.")

    user: User | None = None
    if payload.user_id:
        user = db.get(User, payload.user_id)
    elif payload.discord_id:
        user = db.scalar(select(User).where(User.discord_id == payload.discord_id))

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    grant_role_to_user(db, user, "admin")
    return user_service.get_user(db, user.id)


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
