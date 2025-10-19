from __future__ import annotations

import hmac
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.admin.admin_settings import get_admin_settings
from app.admin.models import Role, UserRole
from app.admin.schemas import AdminUser
from app.admin.seed import grant_role_to_user
from app.admin.services import users as user_service
from app.models import User


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
    <p>Provide the recovery password for this environment. The currently signed-in account will be restored automatically.</p>
    <form id="restore-form">
      <label for="password">Recovery password</label>
      <input id="password" name="password" type="password" placeholder="Enter recovery password" required>

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

        if (!password) {
          errorEl.textContent = "Password is required.";
          return;
        }

        const payload = { password: password };

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


def _ensure_has_admin_flag(db: Session, user: User) -> None:
    if not hasattr(type(user), "has_admin"):
        return
    if getattr(user, "has_admin", None):
        return
    has_admin_role = bool(
        db.scalar(
            select(func.count())
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .where(UserRole.user_id == user.id, Role.name == "admin")
        )
    )
    if not has_admin_role:
        return
    setattr(user, "has_admin", True)
    db.add(user)
    db.commit()
    db.refresh(user)


def restore_admin(payload: AdminRestoreRequest, db: Session, current_user: User | None = None) -> AdminUser:
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
    elif current_user:
        user = db.get(User, current_user.id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found. Provide an identifier or sign in before retrying.",
        )

    grant_role_to_user(db, user, "admin")
    _ensure_has_admin_flag(db, user)
    return user_service.get_user(db, user.id)
