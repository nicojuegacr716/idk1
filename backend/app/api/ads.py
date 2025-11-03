from __future__ import annotations

from typing import Any, Dict
from uuid import UUID
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.deps import get_ads_nonce_manager, get_current_user, get_db
from app.models import User
from app.services.ads import AdsService, PrepareContext, AdsNonceManager, compute_device_hash
from app.services.turnstile import verify_turnstile_token
from app.services.wallet import WalletService
from app.settings import get_settings
from app.services.worker_client import WorkerClient
from app.services.worker_registry import WorkerRegistryService
from app.models import Worker

router = APIRouter(prefix="/ads", tags=["ads"])


class PrepareRequest(BaseModel):
    placement: str = Field(..., max_length=32)
    provider: str | None = Field(None, alias="provider")
    turnstile_token: str | None = Field(None, alias="turnstileToken")
    client_nonce: str = Field(..., alias="clientNonce", max_length=64)
    timestamp: str = Field(..., max_length=32)
    signature: str = Field(..., max_length=256)
    hints: Dict[str, str] | None = None


class RegisterTokenRequest(BaseModel):
    email: str
    password: str
    confirm: bool = Field(default=False)
    turnstile_token: str | None = Field(None, alias="turnstileToken")
    worker_id: UUID | None = Field(None, alias="workerId")


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "0.0.0.0"


def _referer_path(request: Request) -> str:
    referer = request.headers.get("referer")
    if not referer:
        return ""
    try:
        parsed = urlparse(referer)
    except ValueError:
        return ""
    return parsed.path or ""


def _asn(request: Request) -> str | None:
    return request.headers.get("x-asn") or request.headers.get("cf-asn")


def _collect_hints(request: Request, payload: PrepareRequest) -> Dict[str, str]:
    hints: Dict[str, str] = {}
    header_keys = [
        "sec-ch-ua",
        "sec-ch-ua-platform",
        "sec-ch-ua-platform-version",
        "sec-ch-ua-mobile",
        "sec-ch-ua-arch",
        "sec-ch-ua-bitness",
    ]
    for key in header_keys:
        value = request.headers.get(key)
        if value:
            hints[key] = value
    if payload.hints:
        for key, value in payload.hints.items():
            if value:
                hints[key] = value
    return hints



def _ensure_strong_password(password: str) -> None:
    if not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="password_requirements")
    has_upper = any(char.isupper() for char in password)
    has_lower = any(char.islower() for char in password)
    has_digit = any(char.isdigit() for char in password)
    has_special = any(not char.isalnum() for char in password)
    if not (has_upper and has_lower and has_digit and has_special):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="password_requirements")


def _ads_service(request: Request, db: Session, nonce_manager: AdsNonceManager) -> AdsService:
    redis_client = getattr(request.app.state, "redis", None)
    return AdsService(db, nonce_manager, redis_client=redis_client, settings=get_settings())


@router.post("/prepare")
async def prepare_ads(
    payload: PrepareRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    nonce_manager: AdsNonceManager = Depends(get_ads_nonce_manager),
) -> JSONResponse:
    settings = get_settings()
    ip = _client_ip(request)
    user_agent = request.headers.get("user-agent", "")
    hints = _collect_hints(request, payload)
    device_hash = compute_device_hash(
        secret=settings.secret_key,
        ip_address=ip,
        user_agent=user_agent,
        client_hints=hints,
    )
    provider_value = (payload.provider or settings.default_provider or "monetag").strip().lower()
    ctx = PrepareContext(
        placement=payload.placement,
        device_hash=device_hash,
        client_nonce=payload.client_nonce,
        timestamp=payload.timestamp,
        signature=payload.signature,
        turnstile_token=payload.turnstile_token,
        ip=ip,
        user_agent=user_agent,
        client_hints=hints,
        referer_path=_referer_path(request),
        asn=_asn(request),
        provider=provider_value,
    )
    service = _ads_service(request, db, nonce_manager)
    try:
        result = service.prepare(user, ctx)
    except HTTPException as exc:
        raise exc
    except Exception as exc:  # pragma: no cover - defensive logging
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to prepare ads") from exc
    data = dict(result)
    data.setdefault("provider", provider_value)
    data["deviceHash"] = device_hash
    return JSONResponse(data)


class MonetagCompleteRequest(BaseModel):
    nonce: str = Field(..., max_length=128)
    ticket: str = Field(..., max_length=512)
    duration_sec: int = Field(..., alias="durationSec", ge=0)
    device_hash: str = Field(..., alias="deviceHash", max_length=256)
    provider: str | None = Field(None, alias="provider")


@router.api_route("/ssv", methods=["GET", "POST"])
async def ssv_callback(
    request: Request,
    db: Session = Depends(get_db),
    nonce_manager: AdsNonceManager = Depends(get_ads_nonce_manager),
) -> JSONResponse:
    payload = await _extract_payload(request)
    service = _ads_service(request, db, nonce_manager)
    response = service.handle_ssv(payload, ip=_client_ip(request))
    return JSONResponse(response)


@router.post("/complete")
async def complete_ads(
    payload: MonetagCompleteRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    nonce_manager: AdsNonceManager = Depends(get_ads_nonce_manager),
) -> JSONResponse:
    provider = (payload.provider or "monetag").strip().lower()
    if provider != "monetag":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported provider")
    service = _ads_service(request, db, nonce_manager)
    try:
        result = service.complete_monetag(
            user,
            nonce=payload.nonce,
            ticket=payload.ticket,
            duration_sec=payload.duration_sec,
            device_hash=payload.device_hash,
        )
    except HTTPException as exc:
        raise exc
    except Exception as exc:  # pragma: no cover - defensive logging
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to complete ads") from exc
    return JSONResponse(result)


@router.get("/wallet")
async def get_wallet_balance(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, int]:
    wallet_service = WalletService(db)
    balance = wallet_service.get_balance(user)
    return {"balance": balance.balance}


@router.get("/workers/available")
async def get_available_workers(
    db: Session = Depends(get_db),
) -> Dict[str, list]:
    registry = WorkerRegistryService(db)
    workers: list[Worker] = registry.list_workers()
    candidates = [w for w in workers if w.status == "active"]
    
    if not candidates:
        return {"workers": []}
    
    client = WorkerClient()
    result = []
    
    try:
        for worker in candidates:
            try:
                tokens_left = await client.token_left(worker=worker)
                result.append({
                    "id": str(worker.id),
                    "name": worker.name,
                    "tokens_left": tokens_left,
                    "available": tokens_left > -1
                })
            except HTTPException:
                # Nếu không thể lấy thông tin token, vẫn hiển thị worker nhưng đánh dấu là không khả dụng
                result.append({
                    "id": str(worker.id),
                    "name": worker.name,
                    "tokens_left": -1,
                    "available": False
                })
    finally:
        await client.aclose()
    
    return {"workers": result}


@router.post("/register-token")
async def register_worker_token_for_coin(
    payload: RegisterTokenRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, object]:
    if not payload.confirm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="confirmation_required")
    _ensure_strong_password(payload.password)
    await verify_turnstile_token(
        request=request,
        token=payload.turnstile_token,
        action="register_worker",
        remote_ip=_client_ip(request),
    )
    registry = WorkerRegistryService(db)
    workers: list[Worker] = registry.list_workers()
    candidates = [w for w in workers if w.status == "active"]
    if not candidates:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="no_worker_available")
    
    # Chọn worker
    chosen: Worker | None = None
    client = WorkerClient()
    try:
        if payload.worker_id:
            chosen = next((w for w in candidates if w.id == payload.worker_id), None)
            if not chosen:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="worker_not_found")
        else:
            # Nếu không có worker_id, chọn worker theo cách cũ
            worker_slots: list[tuple[Worker, int]] = []
            for worker in candidates:
                try:
                    total = await client.token_left(worker=worker)
                except HTTPException:
                    total = -1
                worker_slots.append((worker, total))

            available = [(w, t) for w, t in worker_slots if t > -1]
            unknown = [(w, t) for w, t in worker_slots if t == -1]

            if available:
                chosen = min(available, key=lambda x: x[1])[0]
            elif unknown:
                chosen = unknown[0][0]
            else:
                chosen = candidates[0]

        success = await client.add_worker_token(
            worker=chosen,
            email=payload.email,
            password=payload.password,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_409_CONFLICT:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="duplicate_mail") from exc
        if exc.status_code in {
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        }:
            raise exc
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="worker_error") from exc
    finally:
        await client.aclose()
    if not success:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="worker_rejected")
    wallet = WalletService(db)
    try:
        balance_info = wallet.adjust_balance(
            user,
            20,
            entry_type="earn.reg_account",
            ref_id=None,
            meta={"worker_id": str(chosen.id)},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"ok": True, "added": 20, "balance": balance_info.balance}

@router.get("/policy")
async def get_ads_policy(
    request: Request,
    db: Session = Depends(get_db),
    nonce_manager: AdsNonceManager = Depends(get_ads_nonce_manager),
) -> Dict[str, Any]:
    settings = get_settings()
    service = _ads_service(request, db, nonce_manager)
    effective_cap = service._get_effective_daily_cap()  # noqa: SLF001 - intentional use
    providers = {
        "monetag": {
            "enabled": settings.enable_monetag,
            "zoneId": settings.monetag_zone_id,
            "scriptUrl": settings.monetag_script_url,
        },
        "gma": {
            "enabled": settings.enable_gma,
            "adTagBase": settings.ad_tag_base,
            "priceFloor": settings.price_floor,
        },
    }
    return {
        "rewardPerView": settings.reward_amount,
        "requiredDuration": settings.required_duration,
        "minInterval": settings.reward_min_interval,
        "perDay": settings.rewards_per_day,
        "perDevice": settings.rewards_per_device,
        "effectivePerDay": effective_cap,
        "priceFloor": settings.price_floor,
        "placements": settings.allowed_placements,
        "defaultProvider": settings.default_provider,
        "providers": providers,
    }


async def _extract_payload(request: Request) -> Dict[str, Any]:
    if request.method == "GET":
        return dict(request.query_params)
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        if isinstance(body, dict):
            return body
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload")
    form = await request.form()
    return {key: value for key, value in form.items()}
