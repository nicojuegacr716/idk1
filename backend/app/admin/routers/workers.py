from __future__ import annotations

from uuid import UUID

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.admin.audit import AuditContext, record_audit
from app.admin.deps import require_perm
from app.admin.schemas import (
    WorkerDetail,
    WorkerEndpoints,
    WorkerHealthResponse,
    WorkerListItem,
    WorkerRestartResponse,
    WorkerTokenUpsertRequest,
    WorkerRegisterRequest,
    WorkerUpdateRequest,
)
from app.deps import get_db
from app.models import User, Worker
from app.services.worker_registry import WorkerRegistryService
from app.services.worker_client import WorkerClient
from app.services.vps import VpsService


router = APIRouter(tags=["admin-workers"])


def _audit_context(request: Request, actor: User) -> AuditContext:
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    return AuditContext(actor_user_id=actor.id, ip=client_host, ua=user_agent)


def _dto(worker: Worker) -> WorkerListItem:
    active_sessions = getattr(worker, "_active_sessions", 0)
    actions = ["detail", "health", "edit"]
    actions.append("disable" if worker.status == "active" else "enable")
    actions.extend(["restart", "delete"])
    return WorkerListItem(
        id=worker.id,
        name=worker.name,
        base_url=worker.base_url,
        status=worker.status,
        max_sessions=worker.max_sessions,
        active_sessions=active_sessions,
        created_at=worker.created_at,
        updated_at=worker.updated_at,
        actions=actions,
    )


def _endpoints(worker: Worker) -> WorkerEndpoints:
    base = worker.base_url.rstrip("/")
    return WorkerEndpoints(
        health=f"{base}/health",
        login=f"{base}/yud-ranyisi",
        create_vm=f"{base}/vm-loso",
        stop_template=f"{base}/stop/{{route}}",
        log_template=f"{base}/log/{{route}}",
        tokenleft=f"{base}/tokenleft",
    )


@router.get("/workers", response_model=list[WorkerListItem])
async def list_workers(
    _: User = Depends(require_perm("worker:read")),
    db: Session = Depends(get_db),
) -> list[WorkerListItem]:
    service = WorkerRegistryService(db)
    return [_dto(worker) for worker in service.list_workers()]


@router.post("/workers/register", response_model=WorkerListItem, status_code=status.HTTP_201_CREATED)
async def register_worker(
    request: Request,
    payload: WorkerRegisterRequest,
    actor: User = Depends(require_perm("worker:register")),
    db: Session = Depends(get_db),
) -> WorkerListItem:
    service = WorkerRegistryService(db)
    context = _audit_context(request, actor)
    worker = service.register_worker(
        name=payload.name,
        base_url=str(payload.base_url),
        max_sessions=payload.max_sessions,
        context=context,
    )
    return _dto(worker)


@router.patch("/workers/{worker_id}", response_model=WorkerListItem)
async def update_worker(
    request: Request,
    worker_id: UUID,
    payload: WorkerUpdateRequest,
    actor: User = Depends(require_perm("worker:update")),
    db: Session = Depends(get_db),
) -> WorkerListItem:
    service = WorkerRegistryService(db)
    context = _audit_context(request, actor)
    worker = service.update_worker(
        worker_id,
        name=payload.name,
        base_url=str(payload.base_url) if payload.base_url else None,
        status=payload.status,
        max_sessions=payload.max_sessions,
        context=context,
    )
    return _dto(worker)


@router.post("/workers/{worker_id}/disable", response_model=WorkerListItem)
async def disable_worker(
    request: Request,
    worker_id: UUID,
    actor: User = Depends(require_perm("worker:disable")),
    db: Session = Depends(get_db),
) -> WorkerListItem:
    service = WorkerRegistryService(db)
    context = _audit_context(request, actor)
    worker = service.update_worker(worker_id, status="disabled", context=context)
    return _dto(worker)


@router.post("/workers/{worker_id}/enable", response_model=WorkerListItem)
async def enable_worker(
    request: Request,
    worker_id: UUID,
    actor: User = Depends(require_perm("worker:update")),
    db: Session = Depends(get_db),
) -> WorkerListItem:
    service = WorkerRegistryService(db)
    context = _audit_context(request, actor)
    worker = service.update_worker(worker_id, status="active", context=context)
    return _dto(worker)


@router.delete("/workers/{worker_id}", response_class=Response)
async def remove_worker(
    request: Request,
    worker_id: UUID,
    actor: User = Depends(require_perm("worker:delete")),
    db: Session = Depends(get_db),
) -> None:
    service = WorkerRegistryService(db)
    context = _audit_context(request, actor)
    # Ensure no active sessions; if any lingering sessions with non-active status, force mark deleted
    active_sessions = service.list_active_sessions(worker_id)
    if active_sessions:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Worker still has active sessions.")
    service.delete_worker(worker_id, context=context)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workers/{worker_id}/tokens")
async def request_worker_token(
    worker_id: UUID,
    payload: WorkerTokenUpsertRequest,
    actor: User = Depends(require_perm("worker:update")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    service = WorkerRegistryService(db)
    _ = actor  # permission check ensures actor is present
    worker = service.get_worker(worker_id)

    client = WorkerClient()
    try:
        success = await client.add_worker_token_direct(worker=worker, token=payload.token, slot=payload.slot, mail=str(payload.mail))
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Worker token request failed: {exc}",
        ) from exc
    finally:
        await client.aclose()

    if not success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Worker did not confirm token creation",
        )
    # audit (mask token)
    masked = f"{payload.token[:6]}...{payload.token[-4:]}" if len(payload.token) > 10 else "***"
    context = _audit_context(request, actor)
    try:
        record_audit(
            db,
            context=context,
            action="worker.token.upsert",
            target_type="worker",
            target_id=str(worker.id),
            before=None,
            after={"mail": str(payload.mail), "slot": payload.slot, "token_mask": masked},
        )
        db.commit()
    except Exception:
        pass

    return {"success": True}


@router.get("/workers/{worker_id}", response_model=WorkerDetail)
async def get_worker_detail(
    worker_id: UUID,
    _: User = Depends(require_perm("worker:read")),
    db: Session = Depends(get_db),
) -> WorkerDetail:
    service = WorkerRegistryService(db)
    worker = service.get_worker(worker_id)
    item = _dto(worker)
    return WorkerDetail(
        **item.model_dump(),
        endpoints=_endpoints(worker),
    )


@router.post("/workers/{worker_id}/health", response_model=WorkerHealthResponse)
async def check_worker_health(
    worker_id: UUID,
    _: User = Depends(require_perm("worker:read")),
    db: Session = Depends(get_db),
) -> WorkerHealthResponse:
    service = WorkerRegistryService(db)
    worker = service.get_worker(worker_id)

    client = WorkerClient()
    start = time.perf_counter()
    try:
        payload = await client.health(worker=worker)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Worker health check failed: {exc}",
        ) from exc
    finally:
        await client.aclose()

    latency_ms = (time.perf_counter() - start) * 1000.0
    return WorkerHealthResponse(
        ok=True,
        latency_ms=latency_ms,
        payload=payload,
    )


@router.post("/workers/{worker_id}/restart", response_model=WorkerRestartResponse)
async def restart_worker_sessions(
    request: Request,
    worker_id: UUID,
    actor: User = Depends(require_perm("worker:restart")),
    db: Session = Depends(get_db),
) -> WorkerRestartResponse:
    service = WorkerRegistryService(db)
    context = _audit_context(request, actor)
    worker = service.get_worker(worker_id)
    active_sessions = service.list_active_sessions(worker_id)
    terminated = 0

    if active_sessions:
        vps_service = VpsService(db)
        client = WorkerClient()
        try:
            for session in active_sessions:
                await vps_service.stop_session(session, client)
                terminated += 1
        finally:
            await client.aclose()

    # Touch worker to record restart timestamp.
    worker_for_update = service.get_worker(worker_id)
    worker_for_update.updated_at = datetime.now(timezone.utc)
    db.add(worker_for_update)
    db.commit()

    worker_after = service.get_worker(worker_id)
    after_active = getattr(worker_after, "_active_sessions", 0)
    record_audit(
        db,
        context=context,
        action="worker.restart",
        target_type="worker",
        target_id=str(worker_after.id),
        before={"active_sessions": len(active_sessions)},
        after={"active_sessions": after_active, "terminated_sessions": terminated},
    )
    db.commit()
    return WorkerRestartResponse(worker=_dto(worker_after), terminated_sessions=terminated)
