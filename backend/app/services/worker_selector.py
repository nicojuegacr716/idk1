from __future__ import annotations

import random
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Worker, VpsSession, vps_product_workers

ACTIVE_STATUSES = {"pending", "provisioning", "ready"}


class WorkerSelector:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _active_session_counts(self, worker_ids: list) -> dict:
        if not worker_ids:
            return {}
        stmt = (
            select(VpsSession.worker_id, func.count(VpsSession.id))
            .where(VpsSession.worker_id.in_(worker_ids))
            .where(VpsSession.status.in_(ACTIVE_STATUSES))
            .group_by(VpsSession.worker_id)
        )
        return {worker_id: count for worker_id, count in self.db.execute(stmt).all()}

    def select_for_product(self, product_id) -> Optional[Worker]:
        stmt = (
            select(Worker)
            .join(vps_product_workers, Worker.id == vps_product_workers.c.worker_id)
            .where(vps_product_workers.c.product_id == product_id)
            .where(Worker.status == "active")
            .order_by(Worker.created_at.desc())
        )
        workers = list(self.db.scalars(stmt))
        if not workers:
            fallback_stmt = (
                select(Worker)
                .where(Worker.status == "active")
                .order_by(Worker.created_at.desc())
            )
            workers = list(self.db.scalars(fallback_stmt))
            if not workers:
                return None

        counts = self._active_session_counts([worker.id for worker in workers])
        candidates: list[tuple[Worker, int]] = []

        for worker in workers:
            active = counts.get(worker.id, 0)
            max_sessions_raw = worker.max_sessions
            max_sessions = (
                float("inf")
                if max_sessions_raw is None or max_sessions_raw <= 0
                else max_sessions_raw
            )
            if active >= max_sessions:
                continue
            candidates.append((worker, active))

        if not candidates:
            # All workers appear at capacity; fall back to the least-loaded worker anyway.
            least_loaded_worker = min(workers, key=lambda worker: counts.get(worker.id, 0))
            return least_loaded_worker

        min_active = min(active for _, active in candidates)
        least_loaded = [worker for worker, active in candidates if active == min_active]
        return random.choice(least_loaded)


__all__ = ["WorkerSelector"]
