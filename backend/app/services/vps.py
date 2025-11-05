from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LedgerEntry, User, VpsProduct, VpsSession, Worker
from app.services.event_bus import SessionEventBus
from app.services.wallet import WalletService
from app.services.worker_client import WorkerClient
from app.services.worker_selector import WorkerSelector

CHECKLIST_TEMPLATE: List[Dict[str, object]] = []
AUTO_TERMINATE_STATUSES: tuple[str, ...] = ("pending", "provisioning", "ready")
UNREACHABLE_REFUND_COINS = 15
IP_PATTERN = re.compile(
    r"\bIP:\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3}(?::[0-9]{1,5})?)",
    re.IGNORECASE,
)
logger = logging.getLogger(__name__)


class VpsService:
    def __init__(self, db: Session, event_bus: SessionEventBus | None = None) -> None:
        self.db = db
        self.event_bus = event_bus

    def list_products(self, *, active_only: bool) -> List[VpsProduct]:
        stmt = select(VpsProduct).order_by(VpsProduct.created_at.desc())
        if active_only:
            stmt = stmt.where(VpsProduct.is_active.is_(True))
        return list(self.db.scalars(stmt))

    def _load_product(self, product_id: UUID) -> VpsProduct:
        product = self.db.get(VpsProduct, product_id)
        if not product or not product.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product unavailable")
        return product

    def _find_idempotent(self, user_id: UUID, key: str) -> VpsSession | None:
        stmt = (
            select(VpsSession)
            .where(VpsSession.user_id == user_id)
            .where(VpsSession.idempotency_key == key)
        )
        return self.db.scalars(stmt).first()

    def list_sessions_for_user(self, user: User) -> List[VpsSession]:
        stmt = (
            select(VpsSession)
            .where(VpsSession.user_id == user.id)
            .order_by(VpsSession.created_at.desc())
        )
        sessions = list(self.db.scalars(stmt))
        filtered: List[VpsSession] = []
        for session in sessions:
            if session.status in {"deleted", "expired"}:
                continue
            filtered.append(session)
        return filtered

    def _initial_session(
        self,
        *,
        user: User,
        product: VpsProduct,
        worker: Worker,
        idempotency_key: str,
    ) -> Tuple[VpsSession, str]:
        now = datetime.now(timezone.utc)
        session_token = secrets.token_urlsafe(32)
        checklist = [{**item, "done": False, "ts": None} for item in CHECKLIST_TEMPLATE]
        session = VpsSession(
            user_id=user.id,
            product_id=product.id,
            worker_id=worker.id,
            session_token=session_token,
            status="pending",
            checklist=checklist,
            idempotency_key=idempotency_key,
            created_at=now,
            updated_at=now,
            expires_at=now + timedelta(hours=5),
        )
        return session, session_token

    async def _refund_session(
        self,
        session: VpsSession,
        wallet_service: WalletService,
        user: User,
        product: VpsProduct,
        reason: str,
    ) -> None:
        try:
            session.status = "failed"
            session.updated_at = datetime.now(timezone.utc)
            session.worker_route = None
            session.log_url = None
            wallet_service.adjust_balance(
                user,
                product.price_coins,
                entry_type="vps.refund",
                ref_id=session.id,
                meta={"reason": reason},
            )
            self.db.add(session)
            self.db.commit()
        except Exception as refund_exc:
            self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Unable to refund VPS purchase",
            ) from refund_exc
        if self.event_bus:
            await self.event_bus.publish(
                session.id,
                {
                    "event": "status.update",
                    "data": {"status": session.status},
                },
            )

    async def purchase_and_create(
        self,
        *,
        user: User,
        product_id: UUID,
        idempotency_key: str,
        worker_client: WorkerClient,
        callback_base: str,  # kept for backwards compatibility
        worker_action: int | None = None,
        worker_id: UUID | None = None,
    ) -> tuple[VpsSession, bool]:
        _ = callback_base  # placeholder – callbacks handled server-to-server
        key = idempotency_key.strip()
        if not key:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Idempotency-Key")

        existing = self._find_idempotent(user.id, key)
        if existing:
            return existing, False

        product = self._load_product(product_id)
        wallet_service = WalletService(self.db)
        balance_info = wallet_service.get_balance(user)
        if balance_info.balance < product.price_coins:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insufficient coin balance")

        selector = WorkerSelector(self.db)
        worker = selector.select_for_product(product.id)
        if not worker:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No worker available for product",
            )
        attempted_workers: set[UUID] = {worker.id}

        session, session_token = self._initial_session(
            user=user,
            product=product,
            worker=worker,
            idempotency_key=key,
        )

        try:
            self.db.add(session)
            self.db.flush()
            wallet_service.adjust_balance(
                user,
                -product.price_coins,
                entry_type="vps.purchase",
                ref_id=session.id,
                meta={"product_id": str(product.id)},
            )
            self.db.commit()
        except HTTPException:
            self.db.rollback()
            raise
        except Exception as exc:  # pragma: no cover - defensive
            self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Unable to create VPS session",
            ) from exc

        self.db.refresh(session)

        if self.event_bus:
            await self.event_bus.publish(
                session.id,
                {
                    "event": "checklist.update",
                    "data": {"items": session.checklist},
                },
            )
            await self.event_bus.publish(
                session.id,
                {
                    "event": "status.update",
                    "data": {"status": session.status},
                },
            )

        action_to_use = worker_action or product.provision_action

        MAX_WORKER_RETRIES = 3

        def _switch_worker() -> Worker | None:
            next_worker = selector.select_for_product(
                product.id, exclude=attempted_workers
            )
            if not next_worker:
                return None
            attempted_workers.add(next_worker.id)
            session.worker_id = next_worker.id
            session.updated_at = datetime.now(timezone.utc)
            self.db.add(session)
            self.db.commit()
            return next_worker

        attempt = 0
        while True:
            attempt += 1
            try:
                # Check token availability right before creating VM to avoid race conditions
                try:
                    tokens_left = await worker_client.token_left(worker=worker)
                except Exception:
                    # Worker unreachable, skip to next worker or refund
                    next_worker = selector.select_for_product(product.id, exclude=attempted_workers)
                    if next_worker:
                        attempted_workers.add(next_worker.id)
                        worker = next_worker
                        continue
                    else:
                        await self._refund_session(
                            session,
                            wallet_service,
                            user,
                            product,
                            "All workers unreachable",
                        )
                        raise HTTPException(
                            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="All workers unreachable",
                        )
                
                if tokens_left <= 0:
                    # Try to find another worker with tokens
                    next_worker = selector.select_for_product(product.id, exclude=attempted_workers)
                    if next_worker:
                        attempted_workers.add(next_worker.id)
                        worker = next_worker
                        session.worker_id = worker.id
                        session.updated_at = datetime.now(timezone.utc)
                        try:
                            self.db.add(session)
                            self.db.commit()
                            self.db.refresh(session)
                        except Exception:
                            self.db.rollback()
                        continue  # Retry with new worker
                    else:
                        # No more workers available, refund
                        await self._refund_session(
                            session,
                            wallet_service,
                            user,
                            product,
                            "No available tokens on any worker",
                        )
                        raise HTTPException(
                            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="No workers with available tokens",
                        )
                
                route, log_url = await worker_client.create_vm(worker=worker, action=action_to_use)
                break
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, str) else None
                if (
                    attempt < MAX_WORKER_RETRIES
                    and detail
                    and ("No available tokens" in detail or "Server busy" in detail)
                ):
                    next_worker = _switch_worker()
                    if next_worker:
                        # Check token availability on new worker before retrying
                        try:
                            tokens_left = await worker_client.token_left(worker=next_worker)
                            if tokens_left > 0:
                                worker = next_worker
                                session.worker_id = worker.id
                                session.updated_at = datetime.now(timezone.utc)
                                try:
                                    self.db.add(session)
                                    self.db.commit()
                                    self.db.refresh(session)
                                except Exception:
                                    self.db.rollback()
                                continue
                        except Exception:
                            pass  # Fall through to refund
                await self._refund_session(
                    session,
                    wallet_service,
                    user,
                    product,
                    detail or "worker_creation_failed",
                )
                raise
            except Exception as exc:  # pragma: no cover - defensive
                await self._refund_session(
                    session,
                    wallet_service,
                    user,
                    product,
                    "worker_unreachable",
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Worker unreachable: {exc}",
                ) from exc

        session.worker_route = route
        session.log_url = log_url
        session.status = "provisioning"
        session.checklist = [
            {
                "key": "worker_action",
                "label": str(action_to_use),
                "done": True,
                "ts": datetime.now(timezone.utc).isoformat(),
                "meta": {"worker_action": action_to_use},
            }
        ]
        session.updated_at = datetime.now(timezone.utc)
        try:
            self.db.add(session)
            self.db.commit()
        except Exception as exc:
            self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Unable to update VPS session",
            ) from exc
        self.db.refresh(session)

        if self.event_bus:
            await self.event_bus.publish(
                session.id,
                {
                    "event": "checklist.update",
                    "data": {"items": session.checklist},
                },
            )
            await self.event_bus.publish(
                session.id,
                {
                    "event": "status.update",
                    "data": {"status": session.status},
                },
            )
        return session, True

    def get_session_for_user(self, session_id: UUID, user: User) -> VpsSession:
        session = self.db.get(VpsSession, session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        self._ensure_not_expired(session)
        return session

    def _ensure_not_expired(self, session: VpsSession) -> None:
        if (
            session.expires_at
            and session.expires_at < datetime.now(timezone.utc)
            and session.status not in {"expired", "deleted"}
        ):
            session.status = "expired"
            session.updated_at = datetime.now(timezone.utc)
            self.db.add(session)
            self.db.commit()

    async def stop_session(self, session: VpsSession, worker_client: WorkerClient) -> None:
        stop_error: HTTPException | None = None
        if session.worker_id and session.worker_route:
            worker = self.db.get(Worker, session.worker_id)
            if worker:
                try:
                    await worker_client.stop_vm(worker=worker, route=session.worker_route)
                except HTTPException as exc:
                    stop_error = exc
                    logger.warning(
                        "Worker stop returned HTTP error for session %s (worker %s): %s",
                        session.id,
                        worker.id,
                        exc.detail,
                    )
                except Exception as exc:  # pragma: no cover - defensive
                    stop_error = HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="worker_stop_failed",
                    )
                    logger.warning("Worker stop failed for session %s: %s", session.id, exc)

        now = datetime.now(timezone.utc)
        session.status = "deleted"
        session.expires_at = now
        session.updated_at = now
        session.worker_route = None
        session.log_url = None
        session.rdp_host = None
        session.rdp_port = None
        session.rdp_user = None
        session.rdp_password = None
        self.db.add(session)
        self.db.commit()

        if self.event_bus:
            await self.event_bus.publish(
                session.id,
                {
                    "event": "status.update",
                    "data": {"status": session.status},
                },
            )

        if stop_error:
            logger.warning(
                "Session %s marked deleted despite worker stop failure: %s",
                session.id,
                stop_error.detail if isinstance(stop_error.detail, str) else stop_error.detail,
            )

    async def delete_session(self, session: VpsSession, worker_client: WorkerClient) -> None:
        await self.stop_session(session, worker_client)

    async def fetch_session_log(self, session: VpsSession, worker_client: WorkerClient) -> str:
        if not session.worker_id or not session.worker_route:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Log not available")
        worker = self.db.get(Worker, session.worker_id)
        if not worker:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
        try:
            log_text = await worker_client.fetch_log(worker=worker, route=session.worker_route)
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to fetch log") from exc
        await self._verify_remote_access(session=session, log_text=log_text, worker_client=worker_client)
        return log_text

    async def cleanup_expired_sessions(
        self,
        *,
        max_age: timedelta,
        worker_client: WorkerClient,
    ) -> int:
        cutoff = datetime.now(timezone.utc) - max_age
        stmt = (
            select(VpsSession)
            .where(VpsSession.created_at < cutoff)
            .where(VpsSession.status.in_(AUTO_TERMINATE_STATUSES))
        )
        sessions = list(self.db.scalars(stmt))
        cleaned = 0
        for session in sessions:
            try:
                await self.stop_session(session, worker_client)
                cleaned += 1
            except HTTPException as exc:
                logger.warning(
                    "Auto cleanup failed for session %s (HTTP %s): %s",
                    session.id,
                    exc.status_code,
                    exc.detail,
                )
                self.db.rollback()
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Auto cleanup failed for session %s: %s", session.id, exc)
                self.db.rollback()
        return cleaned

    async def _verify_remote_access(
        self,
        *,
        session: VpsSession,
        log_text: str,
        worker_client: WorkerClient,
    ) -> None:
        if session.status in {"deleted", "expired"}:
            return
        match = IP_PATTERN.search(log_text or "")
        if not match:
            return
        target = match.group(1).strip()
        if not target:
            return
        host = target
        port: str | None = None
        if ":" in target:
            host, port = target.rsplit(":", 1)
        host = host.strip("[]")
        port_int: int | None = None
        if port:
            try:
                port_int = int(port)
            except ValueError:
                port_int = None
            else:
                if not (1 <= port_int <= 65535):
                    port_int = None
        candidate_urls: list[str] = []
        if port_int:
            candidate_urls.append(f"http://{host}:{port_int}")
            candidate_urls.append(f"https://{host}:{port_int}")
        else:
            candidate_urls.append(f"http://{host}")
            candidate_urls.append(f"https://{host}")
        timeout = httpx.Timeout(5.0, connect=3.0, read=5.0, write=5.0)
        last_error: Exception | None = None
        last_status: int | None = None
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            for url in candidate_urls:
                try:
                    response = await client.post(url)
                except Exception as exc:  # pragma: no cover - network dependent
                    last_error = exc
                    continue
                if response.status_code < 400 and response.text.strip():
                    return
                last_status = response.status_code
                last_error = None
        await self.stop_session(session, worker_client)
        self._reward_unreachable_session(session)
        detail_msg = "unknown error"
        if last_error:
            detail_msg = str(last_error)
        elif last_status is not None:
            detail_msg = f"HTTP {last_status}"
        if last_error and last_status is None:
            client_detail = "Session terminated because the remote IP is unreachable"
        else:
            client_detail = "Session terminated because the remote IP did not respond with content"
        logger.warning(
            "Connectivity post-check failed for session %s (target %s): %s",
            session.id,
            target,
            detail_msg,
        )
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=client_detail,
        )

    def _reward_unreachable_session(self, session: VpsSession) -> None:
        if not session.user_id:
            return
        user = self.db.get(User, session.user_id)
        if not user:
            return
        existing = self.db.execute(
            select(LedgerEntry.id)
            .where(LedgerEntry.user_id == user.id)
            .where(LedgerEntry.ref_id == session.id)
            .where(LedgerEntry.type == "vps.auto_refund_unreachable")
        ).scalar_one_or_none()
        if existing:
            return
        wallet_service = WalletService(self.db)
        try:
            wallet_service.adjust_balance(
                user,
                UNREACHABLE_REFUND_COINS,
                entry_type="vps.auto_refund_unreachable",
                ref_id=session.id,
                meta={"source": "unreachable_ip_check"},
            )
            self.db.commit()
        except Exception as exc:  # pragma: no cover - defensive
            self.db.rollback()
            logger.warning(
                "Failed to credit unreachable refund for session %s: %s",
                session.id,
                exc,
            )


__all__ = ["VpsService", "CHECKLIST_TEMPLATE"]
