from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import HTTPException, Request, status

from app.settings import get_settings


def compute_csrf_token(session_token: str, path: str) -> str:
    settings = get_settings()
    raw = f"{session_token}:{path}"
    return hashlib.sha256(f"{settings.secret_key}:{raw}".encode("utf-8")).hexdigest()


def enforce_csrf(request: Request) -> str | None:
    if request.method in {"GET", "OPTIONS", "HEAD"}:
        return None
    settings = get_settings()
    session_token = request.cookies.get(settings.session_cookie_name, "")
    if not session_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing session for CSRF validation.")
    provided = request.headers.get("X-CSRF-Token") or request.headers.get("X-Csrf-Token")
    expected = compute_csrf_token(session_token, request.url.path)
    if not provided or provided != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token.")
    request.state.csrf_token = provided
    return provided


def enforce_signed_request(request: Request, csrf_token: str | None) -> None:
    if request.method in {"GET", "OPTIONS", "HEAD"}:
        return
    if not csrf_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing verified CSRF token.")
    timestamp_header = request.headers.get("X-Request-Timestamp")
    signature_header = request.headers.get("X-Request-Signature")
    if not timestamp_header or not signature_header:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing request signature headers.")
    try:
        timestamp_ms = int(timestamp_header)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid request timestamp.") from exc
    now_ms = int(time.time() * 1000)
    # Reject replays older than 60 seconds
    if abs(now_ms - timestamp_ms) > 60_000:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stale request timestamp.")
    expected = hashlib.sha256(f"{csrf_token}:{timestamp_header}".encode("utf-8")).hexdigest()
    if not hmac.compare_digest(signature_header, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid request signature.")
