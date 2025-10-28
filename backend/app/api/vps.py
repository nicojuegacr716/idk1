from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, StreamingResponse

from app.deps import (
    get_current_user,
    get_db,
    get_event_bus,
    get_worker_client,
)
from app.models import User, VpsSession
from app.services.vps import VpsService
from app.services.worker_selector import WorkerSelector
from app.services.turnstile import verify_turnstile_token
from app.settings import get_settings
from fastapi.responses import PlainTextResponse

from sqlalchemy.orm import Session

router = APIRouter(prefix="/vps", tags=["vps"])


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "0.0.0.0"


def _checklist_items(session: VpsSession) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for raw in session.checklist or []:
        item = {
            "key": raw.get("key"),
            "label": raw.get("label"),
            "done": bool(raw.get("done")),
            "ts": raw.get("ts"),
        }
        if raw.get("meta"):
            item["meta"] = raw.get("meta")
        items.append(item)
    return items


def _session_payload(session: VpsSession, *, include_stream: bool = False, request: Request | None = None) -> Dict[str, Any]:
    payload = {
        "id": str(session.id),
        "status": session.status,
        "checklist": _checklist_items(session),
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "expires_at": session.expires_at.isoformat() if session.expires_at else None,
        "product": None,
        "worker_id": str(session.worker_id) if session.worker_id else None,
        "has_log": bool(session.worker_route),
        "worker_route": session.worker_route,
        "log_url": session.log_url,
        "provision_action": None,
        "worker_action": None,
    }
    if session.product:
        payload["product"] = {
            "id": str(session.product.id),
            "name": session.product.name,
            "description": session.product.description,
            "price_coins": session.product.price_coins,
            "provision_action": session.product.provision_action,
        }
        payload["provision_action"] = session.product.provision_action
        payload["worker_action"] = session.product.provision_action
    elif session.product_id:
        payload["product"] = {"id": str(session.product_id)}
    if include_stream and request is not None:
        base_url = str(request.base_url).rstrip('/')
        payload["stream"] = f"{base_url}/vps/sessions/{session.id}/events"
    if payload["worker_action"] is None:
        for item in session.checklist or []:
            meta = item.get("meta") if isinstance(item, dict) else None
            if not isinstance(meta, dict):
                continue
            action_override = meta.get("worker_action")
            if action_override is not None:
                try:
                    payload["worker_action"] = int(action_override)
                except (TypeError, ValueError):
                    payload["worker_action"] = action_override
                break
    if session.status == "ready":
        payload["rdp"] = {
            "host": session.rdp_host,
            "port": session.rdp_port,
            "user": session.rdp_user,
            "password": session.rdp_password,
        }
    return payload


@router.get("/products", response_model=None)
async def list_products(
    active: bool = True,
    db: Session = Depends(get_db),
) -> JSONResponse:
    service = VpsService(db)
    products = service.list_products(active_only=active)
    data = [
        {
            "id": str(product.id),
            "name": product.name,
            "description": product.description,
            "price_coins": product.price_coins,
            "is_active": product.is_active,
            "provision_action": product.provision_action,
        }
        for product in products
    ]
    return JSONResponse(data)


@router.get("/availability")
async def check_availability(
    product_id: str | None = None,
    db: Session = Depends(get_db),
    worker_client=Depends(get_worker_client),
) -> JSONResponse:
    """Check if VPS creation is available for a product."""
    if product_id:
        try:
            from uuid import UUID
            product_uuid = UUID(str(product_id))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product_id")

        service = VpsService(db)
        product = service._load_product(product_uuid)

        selector = WorkerSelector(db)
        # Lấy tất cả worker cho sản phẩm thay vì chỉ một worker
        workers = selector.get_all_workers_for_product(product.id)
        if not workers:
            return JSONResponse({"available": False, "reason": "No worker available", "workers": []})

        available_workers = []
        total_tokens = 0
        for worker in workers:
            try:
                tokens_left = await worker_client.token_left(worker=worker)
                worker_available = tokens_left > 0
                if worker_available:
                    total_tokens += tokens_left
                available_workers.append({
                    "id": str(worker.id),
                    "name": worker.name,
                    "tokens_left": tokens_left,
                    "available": worker_available
                })
            except Exception:
                available_workers.append({
                    "id": str(worker.id),
                    "name": worker.name,
                    "tokens_left": -1,
                    "available": False,
                    "error": "Unable to check worker status"
                })

        # Kiểm tra xem có ít nhất một worker khả dụng không
        available = any(w["available"] for w in available_workers)
        return JSONResponse({
            "available": available,
            "workers": available_workers,
            "tokens_left": total_tokens,
            "reason": None if available else "No tokens available"
        })
    else:
        # Check general availability across all active products
        service = VpsService(db)
        products = service.list_products(active_only=True)

        if not products:
            return JSONResponse({"available": False, "reason": "No active products"})

        selector = WorkerSelector(db)
        available_products = []
        all_workers = []
        total_tokens = 0

        for product in products:
            workers = selector.get_all_workers_for_product(product.id)
            for worker in workers:
                if worker:
                    try:
                        tokens_left = await worker_client.token_left(worker=worker)
                        worker_available = tokens_left > 0
                        if worker_available:
                            total_tokens += tokens_left
                            if str(product.id) not in available_products:
                                available_products.append(str(product.id))
                        all_workers.append({
                            "id": str(worker.id),
                            "name": worker.name,
                            "product_id": str(product.id),
                            "tokens_left": tokens_left,
                            "available": worker_available
                        })
                    except Exception:
                        all_workers.append({
                            "id": str(worker.id),
                            "name": worker.name,
                            "product_id": str(product.id),
                            "tokens_left": -1,
                            "available": False,
                            "error": "Unable to check worker status"
                        })

        return JSONResponse({
            "available": len(available_products) > 0,
            "available_products": available_products,
            "workers": all_workers,
            "tokens_left": total_tokens,
            "reason": None if available_products else "No products available"
        })


@router.get("/sessions")
async def list_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JSONResponse:
    service = VpsService(db)
    sessions = service.list_sessions_for_user(user)
    payload = [_session_payload(session, include_stream=True, request=request) for session in sessions]
    return JSONResponse({"sessions": payload})


@router.post("/purchase-and-create", status_code=status.HTTP_202_ACCEPTED)
async def purchase_and_create(
    request: Request,
    payload: Dict[str, Any],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    event_bus=Depends(get_event_bus),
    worker_client=Depends(get_worker_client),
) -> JSONResponse:
    settings = get_settings()
    turnstile_token = payload.get("turnstile_token") or payload.get("turnstileToken")
    await verify_turnstile_token(
        request=request,
        token=turnstile_token,
        action="vps_create",
        remote_ip=_client_ip(request),
    )
    idempotency_key = request.headers.get("Idempotency-Key")
    if not idempotency_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Thiếu Idempotency-Key")
    product_id = payload.get("product_id")
    if not product_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Thiếu product_id")
    try:
        product_uuid = UUID(str(product_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="product_id không hợp lệ") from exc

    worker_action_value: int | None = None
    raw_action = payload.get("worker_action")
    if raw_action is not None:
        try:
            worker_action_value = int(raw_action)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="worker_action phải là số nguyên",
            ) from exc
    vm_type = str(payload.get("vm_type") or "").strip().lower()
    if worker_action_value is None and vm_type:
        mapping = {"linux": 1, "windows": 2, "win": 2, "dummy": 3, "test": 3}
        if vm_type not in mapping:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="vm_type không hợp lệ")
        worker_action_value = mapping[vm_type]
    if worker_action_value is not None and worker_action_value not in {1, 2, 3}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="worker_action không hợp lệ")

    # Allow specifying a specific worker_id
    worker_id = payload.get("worker_id")
    if worker_id:
        try:
            worker_uuid = UUID(str(worker_id))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="worker_id không hợp lệ") from exc
    else:
        worker_uuid = None

    service = VpsService(db, event_bus)
    callback_base = str(settings.base_url)
    session, created = await service.purchase_and_create(
        user=user,
        product_id=product_uuid,
        idempotency_key=idempotency_key,
        worker_client=worker_client,
        callback_base=callback_base,
        worker_action=worker_action_value,
        worker_id=worker_uuid,
    )
    data = {
        "session": _session_payload(session, include_stream=True, request=request),
    }
    status_code = status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK
    return JSONResponse(data, status_code=status_code)


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JSONResponse:
    service = VpsService(db)
    session = service.get_session_for_user(session_id, user)
    return JSONResponse(_session_payload(session))


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_session(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    worker_client=Depends(get_worker_client),
) -> Response:
    service = VpsService(db)
    session = service.get_session_for_user(session_id, user)
    await service.delete_session(session, worker_client)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/{session_id}/stop")
async def stop_session_endpoint(
    session_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    worker_client=Depends(get_worker_client),
) -> JSONResponse:
    service = VpsService(db)
    session = service.get_session_for_user(session_id, user)
    await service.stop_session(session, worker_client)
    return JSONResponse({"session": _session_payload(session, include_stream=True, request=request)})




@router.get("/sessions/{session_id}/log", response_class=PlainTextResponse)
async def get_session_log(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    worker_client=Depends(get_worker_client),
) -> PlainTextResponse:
    service = VpsService(db)
    session = service.get_session_for_user(session_id, user)
    log_text = await service.fetch_session_log(session, worker_client)
    return PlainTextResponse(log_text, status_code=status.HTTP_200_OK)

@router.get("/sessions/{session_id}/events")
async def stream_session_events(
    session_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    event_bus=Depends(get_event_bus),
) -> StreamingResponse:
    service = VpsService(db, event_bus)
    session = service.get_session_for_user(session_id, user)

    queue = await event_bus.subscribe(session.id)
    initial_events = [
        {"event": "status.update", "data": {"status": session.status}},
        {"event": "checklist.update", "data": {"items": _checklist_items(session)}},
    ]

    async def event_generator():
        try:
            for event in initial_events:
                yield _format_sse(event)
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield _format_sse(event)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            await event_bus.unsubscribe(session.id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def _format_sse(event: Dict[str, Any]) -> str:
    event_type = event.get("event", "message")
    data = event.get("data", {})
    payload = json.dumps(data, default=_json_default)
    return f"event: {event_type}\ndata: {payload}\n\n"


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value
