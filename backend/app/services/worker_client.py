from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urljoin

import httpx
from fastapi import HTTPException, status

from app.models import Worker
from app.settings import get_settings


class WorkerClient:
    def __init__(self, base_url: str | None = None, *, verify: bool | None = None) -> None:
        if verify is None:
            verify = get_settings().worker_verify_tls
        timeout = httpx.Timeout(600.0, connect=30.0)
        verify_value = verify if verify is not None else get_settings().worker_verify_tls
        self._client = httpx.AsyncClient(timeout=timeout, verify=verify_value)
        self._base_url = base_url.rstrip("/") if base_url else None
        self._verify = verify_value

    async def aclose(self) -> None:
        await self._client.aclose()

    def _base(self, worker: Worker | None = None) -> str:
        base_url = getattr(self, "_base_url", None)
        if base_url:
            return base_url
        if not worker:
            raise ValueError("Either base_url or worker must be provided")
        return worker.base_url.rstrip("/")

    @staticmethod
    def _extract_route(log_url: str) -> str:
        raw = (log_url or "").strip()
        if not raw:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Worker did not return a log url",
            )
        if raw.startswith("/log/"):
            route = raw.split("/log/", 1)[1]
        else:
            route = raw.rsplit("/", 1)[-1]
        route = route.strip()
        if not route:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Worker log url is invalid",
            )
        return route

    @staticmethod
    def _normalize_log_url(base: str, log_url: str) -> str:
        cleaned_base = base.rstrip("/")
        raw = (log_url or "").strip()
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw
        if raw.startswith("/"):
            return f"{cleaned_base}{raw}"
        return f"{cleaned_base}/{raw.lstrip('/')}"

    async def create_vm(self, *, action: int, worker: Worker | None = None) -> tuple[str, str]:
        """Create a VM on the specified worker.

        Returns a tuple of (route, log_url) where route is the worker route identifier
        and log_url is an absolute URL that can be proxied by the backend.
        """
        if action not in (1, 2, 3):
            raise ValueError("action must be one of 1, 2, or 3")

        base = self._base(worker)
        url = urljoin(base + "/", "vm-loso")
        payload = {"action": action}
        attempt = 0
        max_attempts = 3
        while True:
            response = await self._client.post(url, json=payload)
            if response.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
                break
            attempt += 1
            if attempt >= max_attempts:
                break
            await asyncio.sleep(1.5 * attempt)

        if response.status_code >= 400:
            detail: str | None = None
            try:
                error_payload = response.json()
                if isinstance(error_payload, dict):
                    raw_detail = (
                        error_payload.get("detail")
                        or error_payload.get("error")
                        or error_payload.get("message")
                    )
                    if isinstance(raw_detail, str):
                        detail = raw_detail.strip() or None
            except ValueError:
                if response.text:
                    detail = response.text.strip()

            if response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=detail or "Worker is busy, please retry shortly.",
                )

            if response.status_code == status.HTTP_400_BAD_REQUEST:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=detail or "Worker rejected the request"
                )

            if response.status_code == status.HTTP_401_UNAUTHORIZED:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=detail or "Worker authentication failed",
                )

            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=detail or "Worker creation failed",
            )

        data = response.json()
        if not isinstance(data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Worker returned unexpected payload",
            )
        log_url = data.get("logUrl") or data.get("log_url")
        if not isinstance(log_url, str):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Worker did not return a valid log url",
            )
        route = self._extract_route(log_url)
        normalized_log_url = self._normalize_log_url(base, log_url)
        return route, normalized_log_url

    async def stop_vm(self, *, route: str, worker: Worker | None = None) -> dict[str, Any]:
        """Stop a VM on the worker using the new API."""
        base = self._base(worker)
        url = urljoin(base + "/", f"stop/{route}")
        response = await self._client.post(url)

        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Worker stop failed",
            ) from exc

        payload = response.json()
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Worker stop returned invalid payload",
            )
        return payload

    async def fetch_log(self, *, route: str, worker: Worker | None = None) -> str:
        """Fetch VM log from the worker using the new API."""
        base = self._base(worker)
        url = urljoin(base + "/", f"log/{route}")
        response = await self._client.get(url)

        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Unable to fetch worker log",
            ) from exc

        return response.text

    async def add_worker_token(self, *, email: str, password: str, worker: Worker | None = None) -> bool:
        """Add worker token by logging into NVIDIA system."""
        base = self._base(worker)
        url = urljoin(base + "/", "yud-ranyisi")
        payload = {"email": email, "password": password}

        response = await self._client.post(url, json=payload)
        print("Worker responded:", response.status_code, response.text)
        if response.status_code == status.HTTP_200_OK:
            try:
                data = response.json()
            except Exception:
                text = response.text.strip().lower()
                if text == "true":
                    return True
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="invalid_worker_response")
            if data is True:
                return True
            if isinstance(data, str) and data.strip().lower() == "true":
                return True
            if isinstance(data, dict) and data.get("success") is True:
                return True

            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"unexpected_worker_response: {data}")

        # Parse structured error payloads from worker for better messaging
        raw_error: str | None = None
        payload_error: str | None = None
        try:
            parsed = response.json()
            if isinstance(parsed, dict):
                payload_error = (
                    str(parsed.get("error"))
                    or str(parsed.get("message"))
                    or str(parsed.get("detail"))
                )
        except Exception:
            raw_error = response.text.strip() or None
        error_detail = payload_error or raw_error

        if response.status_code == status.HTTP_409_CONFLICT:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error_detail or "duplicate_mail")
        if response.status_code == status.HTTP_400_BAD_REQUEST:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_detail or "invalid_worker_request")
        if response.status_code == status.HTTP_401_UNAUTHORIZED:
            # Worker uses 401 for business rejections such as email verification requirements.
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_detail or "worker_auth_required")
        if response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error_detail or "worker_rate_limited")

        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error_detail or f"worker_unreachable_or_failed: {exc}",
            ) from exc

        return False

    async def add_worker_token_direct(self, *, token: str, slot: int, mail: str, worker: Worker | None = None) -> bool:
        """Upsert worker token directly to worker via /trummoendpoint with shared key."""
        base = self._base(worker)
        url = urljoin(base + "/", "trummoendpoint")
        payload = {"token": token, "slot": int(slot), "mail": mail, "key": "thuonghaioccho"}
        response = await self._client.post(url, json=payload)
        if response.status_code == status.HTTP_200_OK:
            try:
                data = response.json()
                if isinstance(data, dict) and data.get("success") is True:
                    return True
            except Exception:
                pass
        if response.status_code == status.HTTP_409_CONFLICT:
            raise HTTPException(status_code=409, detail="duplicate_token")
        if response.status_code == status.HTTP_401_UNAUTHORIZED:
            raise HTTPException(status_code=502, detail="worker_key_invalid")
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"worker_unreachable_or_failed: {str(exc)}") from exc
        return False


    async def token_left(self, *, worker: Worker | None = None) -> int:
        """Query how many token slots are left on the worker."""
        base = self._base(worker)
        url = urljoin(base + "/", "tokenleft")
        timeout = httpx.Timeout(10.0, connect=5.0)
        verify = getattr(self, "_verify", get_settings().worker_verify_tls)
        
        worker_name = worker.name if worker else "default"
        
        async with httpx.AsyncClient(timeout=timeout, verify=verify) as client:
            try:
                response = await client.get(url)
                response.raise_for_status()
                try:
                    payload: Any = response.json()
                    total = int((payload or {}).get("totalSlots", 0))
                    print(f"[DEBUG] Worker '{worker_name}' token_left: {total} (URL: {url})")
                    return total
                except Exception as json_error:
                    print(f"[DEBUG] Worker '{worker_name}' JSON parse error: {json_error}, response: {response.text}")
                    return -1
            except httpx.TimeoutException as timeout_error:
                print(f"[DEBUG] Worker '{worker_name}' timeout error: {timeout_error} (URL: {url})")
                return -1
            except httpx.ConnectError as connect_error:
                print(f"[DEBUG] Worker '{worker_name}' connection error: {connect_error} (URL: {url})")
                return -1
            except httpx.HTTPStatusError as http_error:
                print(f"[DEBUG] Worker '{worker_name}' HTTP error: {http_error.response.status_code} - {http_error.response.text} (URL: {url})")
                return -1
            except httpx.HTTPError as http_error:
                print(f"[DEBUG] Worker '{worker_name}' HTTP error: {http_error} (URL: {url})")
                # If the worker is unreachable or the endpoint errors, fall back to
                # "unknown" so callers can decide whether to block. We return -1
                # to signal unknown, and only an explicit 0 should block usage.
                return -1

    async def health(self, *, worker: Worker | None = None) -> dict[str, Any]:
        """Check worker health endpoint."""
        base = self._base(worker)
        url = urljoin(base + "/", "health")
        response = await self._client.get(url)

        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Worker health check failed",
            ) from exc

        try:
            data = response.json()
            if isinstance(data, dict):
                return data
        except ValueError:
            pass
        return {"status": response.text}


__all__ = ["WorkerClient"]
