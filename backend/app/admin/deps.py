from __future__ import annotations

import time
from collections import defaultdict, deque
from hashlib import sha256
from typing import Callable, Deque, Dict, Set
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.settings import get_settings

from .admin_settings import AdminSettings, get_admin_settings
from .cache import PermissionCache, get_permission_cache
from .models import Permission, RolePermission, UserRole
from .security import enforce_csrf, enforce_signed_request


class RateLimiter:
    def __init__(self, requests: int, window_seconds: int) -> None:
        self.requests = requests
        self.window_seconds = window_seconds
        self.hits: Dict[str, Deque[float]] = defaultdict(deque)
        self.blocked_until: Dict[str, float] = {}
        self.offences: Dict[str, int] = defaultdict(int)

    def check(self, key: str) -> None:
        now = time.time()
        blocked_at = self.blocked_until.get(key)
        if blocked_at and blocked_at > now:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit lockout in effect. Please retry later.",
            )

        window_start = now - self.window_seconds
        queue = self.hits[key]
        while queue and queue[0] < window_start:
            queue.popleft()
        if len(queue) >= self.requests:
            self.offences[key] += 1
            backoff_seconds = min(self.window_seconds * (2 ** min(self.offences[key], 4)), 900)
            self.blocked_until[key] = now + backoff_seconds
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please retry later.",
            )
        if self.offences[key]:
            # Slowly decay offence counter for sustained compliant behaviour.
            self.offences[key] = max(self.offences[key] - 1, 0)
        queue.append(now)


_rate_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    global _rate_limiter
    settings = get_admin_settings()
    if _rate_limiter is None:
        _rate_limiter = RateLimiter(
            requests=settings.rate_limit.requests,
            window_seconds=settings.rate_limit.window_seconds,
        )
    return _rate_limiter


def rate_limit_dependency(request: Request) -> None:
    settings = get_settings()
    session_token = request.cookies.get(settings.session_cookie_name, "")
    session_hash = sha256(session_token.encode("utf-8")).hexdigest() if session_token else "anon"
    host = request.client.host if request.client else "anonymous"
    key = f"{session_hash}:{host}"
    get_rate_limiter().check(key)


def _fetch_permissions(db: Session, user_id: UUID) -> Set[str]:
    stmt = (
        select(Permission.code)
        .join(RolePermission, Permission.id == RolePermission.permission_id)
        .join(UserRole, RolePermission.role_id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
    )
    rows = db.execute(stmt).all()
    return {row[0] for row in rows}


def _resolve_permissions(db: Session, cache: PermissionCache, user_id: UUID) -> Set[str]:
    cached = cache.get(user_id)
    if cached is not None:
        return cached
    values = _fetch_permissions(db, user_id)
    cache.set(user_id, values)
    return values


def require_admin_user(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    cache: PermissionCache = Depends(get_permission_cache),
    _: None = Depends(rate_limit_dependency),
) -> User:
    if not db.in_transaction():
        current_user = db.merge(current_user)
    settings: AdminSettings = get_admin_settings()
    if not settings.enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin module disabled.")
    permissions = _resolve_permissions(db, cache, current_user.id)
    if not permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Missing admin permissions."
        )
    return current_user


def require_perm(code: str) -> Callable[[User], User]:
    def dependency(
        request: Request,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
        cache: PermissionCache = Depends(get_permission_cache),
        _: None = Depends(rate_limit_dependency),
    ) -> User:
        settings: AdminSettings = get_admin_settings()
        if not settings.enabled:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin module disabled.")

        permissions = _resolve_permissions(db, cache, current_user.id)
        if code not in permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {code}",
            )
        csrf_token = enforce_csrf(request)
        enforce_signed_request(request, csrf_token)
        request.state.admin_actor_id = str(current_user.id)
        return current_user

    return dependency


def invalidate_permission_cache_for_user(user_id: UUID) -> None:
    get_permission_cache().invalidate(user_id)


def invalidate_permission_cache_for_role(db: Session, role_id: UUID) -> None:
    stmt = select(UserRole.user_id).where(UserRole.role_id == role_id)
    rows = db.execute(stmt).all()
    cache = get_permission_cache()
    for row in rows:
        cache.invalidate(row[0])


async def get_optional_current_user(
    request: Request, db: Session = Depends(get_db)
) -> User | None:
    try:
        return await get_current_user(request, db)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            return None
        raise
