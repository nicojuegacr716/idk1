from __future__ import annotations

from typing import Iterable, Sequence
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, distinct, func, or_, select
from sqlalchemy.orm import Session

from app.models import User

from ..audit import AuditContext, record_audit
from ..deps import invalidate_permission_cache_for_user
from ..models import Role, UserRole
from ..schemas import (
    AdminUser,
    AdminUserListItem,
    RoleSummary,
    UserCreate,
    UserListResponse,
    UserQueryParams,
    UserUpdate,
)


def _mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if not local:
        return f"*@{domain}"
    if len(local) == 1:
        masked_local = "*"
    elif len(local) == 2:
        masked_local = f"{local[0]}*"
    else:
        masked_local = f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}"
    return f"{masked_local}@{domain}"


def _map_user(user: User, roles: Sequence[RoleSummary]) -> AdminUser:
    return AdminUser(
        id=user.id,
        discord_id=user.discord_id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        phone_number=user.phone_number,
        coins=user.coins or 0,
        roles=list(roles),
    )


def _map_user_safe(user: User, roles: Sequence[RoleSummary]) -> AdminUserListItem:
    return AdminUserListItem(
        id=user.id,
        username=user.username,
        email_masked=_mask_email(user.email),
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        coins=user.coins or 0,
        discord_id_suffix=user.discord_id[-4:] if user.discord_id else None,
        roles=list(roles),
    )


def _roles_for_users(db: Session, user_ids: Iterable[UUID]) -> dict[UUID, list[RoleSummary]]:
    user_ids = list(user_ids)
    if not user_ids:
        return {}
    stmt = (
        select(UserRole.user_id, Role.id, Role.name)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id.in_(user_ids))
    )
    mapping: dict[UUID, list[RoleSummary]] = {}
    for user_id, role_id, role_name in db.execute(stmt):
        mapping.setdefault(user_id, []).append(RoleSummary(id=role_id, name=role_name))
    return mapping


def _current_role_ids(db: Session, user_id: UUID) -> set[UUID]:
    stmt = select(UserRole.role_id).where(UserRole.user_id == user_id)
    return set(db.scalars(stmt).all())


def list_users(db: Session, params: UserQueryParams) -> UserListResponse:
    filters = []
    join_user_roles = False
    if params.q:
        ilike_value = f"%{params.q.strip()}%"
        filters.append(or_(User.username.ilike(ilike_value), User.email.ilike(ilike_value)))
    if params.role:
        join_user_roles = True
        filters.append(UserRole.role_id == params.role)

    if join_user_roles:
        base = select(distinct(User.id)).join(UserRole, UserRole.user_id == User.id)
    else:
        base = select(distinct(User.id))
    if filters:
        base = base.where(*filters)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    query = select(User)
    if join_user_roles:
        query = query.join(UserRole, UserRole.user_id == User.id)
    if filters:
        query = query.where(*filters)
    query = query.order_by(User.created_at.desc()).offset(params.offset).limit(params.page_size)

    users = list(db.scalars(query))
    role_map = _roles_for_users(db, [user.id for user in users])
    items = [_map_user_safe(user, role_map.get(user.id, [])) for user in users]
    return UserListResponse(items=items, total=total, page=params.page, page_size=params.page_size)


def get_user(db: Session, user_id: UUID) -> AdminUser:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    role_map = _roles_for_users(db, [user.id])
    return _map_user(user, role_map.get(user.id, []))


def create_user(db: Session, payload: UserCreate, context: AuditContext) -> AdminUser:
    user = User(
        discord_id=payload.discord_id,
        username=payload.username,
        email=payload.email,
        display_name=payload.display_name,
        avatar_url=payload.avatar_url,
        phone_number=payload.phone_number,
    )
    db.add(user)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create user.") from exc
    db.refresh(user)
    record_audit(
        db,
        context=context,
        action="user.create",
        target_type="user",
        target_id=str(user.id),
        before=None,
        after={
            "discord_id": user.discord_id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
        },
    )
    db.commit()
    return get_user(db, user.id)


def update_user(db: Session, user_id: UUID, payload: UserUpdate, context: AuditContext) -> AdminUser:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    before = {
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "phone_number": user.phone_number,
    }
    if payload.username is not None:
        user.username = payload.username
    if payload.email is not None:
        user.email = payload.email
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    if payload.phone_number is not None:
        user.phone_number = payload.phone_number

    db.add(user)
    db.commit()
    db.refresh(user)

    after = {
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "phone_number": user.phone_number,
    }
    record_audit(
        db,
        context=context,
        action="user.update",
        target_type="user",
        target_id=str(user.id),
        before=before,
        after=after,
    )
    db.commit()
    return get_user(db, user.id)


def delete_user(db: Session, user_id: UUID, context: AuditContext) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    before = {
        "discord_id": user.discord_id,
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name,
    }
    db.delete(user)
    db.commit()
    record_audit(
        db,
        context=context,
        action="user.delete",
        target_type="user",
        target_id=str(user_id),
        before=before,
        after=None,
    )
    db.commit()


def set_user_roles(db: Session, user_id: UUID, role_ids: Iterable[UUID], context: AuditContext) -> AdminUser:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    before_roles = _roles_for_users(db, [user_id]).get(user_id, [])
    role_ids_set = {UUID(str(role_id)) for role_id in role_ids}
    if role_ids_set:
        existing_roles = set(
            db.scalars(select(Role.id).where(Role.id.in_(role_ids_set))).all()
        )
        missing = role_ids_set - existing_roles
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role ids: {', '.join(str(val) for val in missing)}",
            )

    db.execute(delete(UserRole).where(UserRole.user_id == user_id))
    for rid in role_ids_set:
        db.add(UserRole(user_id=user_id, role_id=rid))
    db.commit()

    after_roles = _roles_for_users(db, [user_id]).get(user_id, [])
    record_audit(
        db,
        context=context,
        action="user.roles.set",
        target_type="user",
        target_id=str(user_id),
        before={"roles": [role.name for role in before_roles]},
        after={"roles": [role.name for role in after_roles]},
    )
    db.commit()
    invalidate_permission_cache_for_user(user_id)
    return get_user(db, user_id)


def add_roles_to_user(db: Session, user_id: UUID, role_ids: Iterable[UUID], context: AuditContext) -> AdminUser:
    current = _current_role_ids(db, user_id)
    updated = current | {UUID(str(role_id)) for role_id in role_ids}
    return set_user_roles(db, user_id, updated, context)


def remove_roles_from_user(db: Session, user_id: UUID, role_ids: Iterable[UUID], context: AuditContext) -> AdminUser:
    current = _current_role_ids(db, user_id)
    updated = current - {UUID(str(role_id)) for role_id in role_ids}
    return set_user_roles(db, user_id, updated, context)

def update_user_coins(
    db: Session,
    user_id: UUID,
    *,
    operation: str,
    amount: int,
    reason: str | None,
    context: AuditContext,
) -> AdminUser:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if amount <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Amount must be positive.")
    before_balance = user.coins or 0
    if operation == "add":
        new_balance = before_balance + amount
    elif operation == "sub":
        new_balance = before_balance - amount
    elif operation == "set":
        new_balance = amount
    else:  # pragma: no cover - validated earlier
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported operation.")
    if new_balance < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Coin balance cannot be negative.",
        )
    user.coins = new_balance
    db.add(user)
    db.commit()
    db.refresh(user)
    record_audit(
        db,
        context=context,
        action="user.coins.update",
        target_type="user",
        target_id=str(user.id),
        before={"coins": before_balance, "reason": None},
        after={"coins": user.coins, "reason": reason},
    )
    db.commit()
    return get_user(db, user.id)

