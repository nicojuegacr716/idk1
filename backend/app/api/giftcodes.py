from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import User
from app.services.giftcodes import GiftCodeService
from app.services.turnstile import verify_turnstile_token


class GiftCodeRedeemRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    turnstile_token: str | None = Field(None, alias="turnstileToken")


class GiftCodeRedeemResponse(BaseModel):
    ok: bool
    message: str
    added: int
    balance: int
    gift_title: str
    code: str
    remaining: int


router = APIRouter(prefix="/giftcodes", tags=["giftcodes"])


@router.post("/redeem", response_model=GiftCodeRedeemResponse, status_code=status.HTTP_200_OK)
async def redeem_gift_code(
    payload: GiftCodeRedeemRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GiftCodeRedeemResponse:
    await verify_turnstile_token(
        request=request,
        token=payload.turnstile_token,
        action="giftcode_redeem",
    )
    service = GiftCodeService(db)
    redemption, gift_code = service.redeem_code(user=user, code=payload.code)
    remaining = max(gift_code.total_uses - gift_code.redeemed_count, 0)
    wallet_balance = service.wallet.get_balance(user)
    return GiftCodeRedeemResponse(
        ok=True,
        message="Doi ma thanh cong.",
        added=redemption.reward_amount,
        balance=wallet_balance.balance,
        gift_title=gift_code.title,
        code=gift_code.code,
        remaining=remaining,
    )
