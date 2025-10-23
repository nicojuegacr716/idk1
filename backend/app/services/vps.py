from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, VpsProduct, VpsSession, Worker
from app.services.event_bus import SessionEventBus
from app.services.wallet import WalletService
from app.services.worker_client import WorkerClient
from app.services.worker_selector import WorkerSelector

CHECKLIST_TEMPLATE: List[Dict[str, object]] = []


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
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        filtered: List[VpsSession] = []
        for session in sessions:
            if session.status == "deleted":
                reference_ts = session.updated_at or session.created_at
                if reference_ts and reference_ts < cutoff:
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
            expires_at=now + timedelta(days=30),
        )
        return session, session_token

    async def purchase_and_create(
        self,
        *,
        user: User,
        product_id: UUID,
        idempotency_key: str,
        worker_client: WorkerClient,
        callback_base: str,  # kept for backwards compatibility
        worker_action: int | None = None,
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

        # Check token availability on chosen worker before any deduction.
        # Only block when an explicit 0 is reported. Unknown (-1) or positive continues.
        tokens_left = await worker_client.token_left(worker=worker)
        if tokens_left == 0:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Worker has no available tokens",
            )

        session, session_token = self._initial_session(
            user=user,
            product=product,
            worker=worker,
            idempotency_key=key,
        )

        transaction_ctx = self.db.begin_nested() if self.db.in_transaction() else self.db.begin()
        try:
            with transaction_ctx:
                self.db.add(session)
                self.db.flush()
                wallet_service.adjust_balance(
                    user,
                    -product.price_coins,
                    entry_type="vps.purchase",
                    ref_id=session.id,
                    meta={"product_id": str(product.id)},
                )
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - defensive
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
        try:
            route, log_url = await worker_client.create_vm(worker=worker, action=action_to_use)
        except HTTPException:
            # bubble HTTP errors directly to client
            raise
        except Exception as exc:  # pragma: no cover - defensive
            transaction_ctx = self.db.begin_nested() if self.db.in_transaction() else self.db.begin()
            with transaction_ctx:
                session.status = "failed"
                session.updated_at = datetime.now(timezone.utc)
                wallet_service.adjust_balance(
                    user,
                    product.price_coins,
                    entry_type="vps.refund",
                    ref_id=session.id,
                    meta={"reason": "worker_unreachable"},
                )
                self.db.add(session)
            if self.event_bus:
                await self.event_bus.publish(
                    session.id,
                    {
                        "event": "status.update",
                        "data": {"status": session.status},
                    },
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
        transaction_ctx = self.db.begin_nested() if self.db.in_transaction() else self.db.begin()
        with transaction_ctx:
            self.db.add(session)
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
        if session.worker_id and session.worker_route:
            worker = self.db.get(Worker, session.worker_id)
            if worker:
                try:
                    await worker_client.stop_vm(worker=worker, route=session.worker_route)
                except HTTPException:
                    raise
                except Exception as exc:  # pragma: no cover - defensive
                    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Worker stop failed") from exc

        session.status = "deleted"
        session.expires_at = datetime.now(timezone.utc)
        session.updated_at = datetime.now(timezone.utc)
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

    async def delete_session(self, session: VpsSession, worker_client: WorkerClient) -> None:
        await self.stop_session(session, worker_client)

    async def fetch_session_log(self, session: VpsSession, worker_client: WorkerClient) -> str:
        if not session.worker_id or not session.worker_route:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Log not available")
        worker = self.db.get(Worker, session.worker_id)
        if not worker:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
        try:
            return await worker_client.fetch_log(worker=worker, route=session.worker_route)
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to fetch log") from exc


__all__ = ["VpsService", "CHECKLIST_TEMPLATE"]
