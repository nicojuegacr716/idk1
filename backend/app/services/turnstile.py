from __future__ import annotations

import logging
from typing import Iterable

import httpx
from fastapi import HTTPException, Request, status

from app.settings import get_settings

logger = logging.getLogger(__name__)


async def verify_turnstile_token(
    *,
    request: Request,
    token: str | None,
    action: str,
    remote_ip: str | None = None,
) -> None:
    """Validate a Cloudflare Turnstile token for the given action."""
    settings = get_settings()
    if not settings.turnstile_site_key or not settings.turnstile_secret_key:
        if settings.allow_missing_turnstile:
            logger.warning("Turnstile verification skipped: missing configuration.")
            return
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="turnstile_not_configured")

    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="turnstile_required")

    ip_address = remote_ip or request.client.host if request.client else None
    payload = {
        "secret": settings.turnstile_secret_key,
        "response": token,
    }
    if ip_address:
        payload["remoteip"] = ip_address

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data=payload,
            )
    except httpx.HTTPError as exc:
        logger.exception("Failed to contact Cloudflare Turnstile verification endpoint.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="turnstile_unreachable") from exc

    try:
        data = response.json()
    except ValueError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="turnstile_invalid_response") from exc

    success = bool(data.get("success"))
    score = data.get("score")
    result_action = data.get("action")
    error_codes: Iterable[str] = data.get("error-codes") or []

    if not success:
        logger.warning("Turnstile verification failed: success=false, errors=%s", list(error_codes))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="turnstile_failed")

    if result_action and result_action != action:
        logger.warning("Turnstile verification action mismatch: expected=%s, got=%s", action, result_action)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="turnstile_failed")

    if isinstance(score, (int, float)) and score < settings.turnstile_min_score:
        logger.warning("Turnstile score below threshold: score=%s, min=%s", score, settings.turnstile_min_score)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="turnstile_failed")
