from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class UserProfile(BaseModel):
    id: UUID
    email: EmailStr | None
    username: str
    display_name: str | None
    avatar_url: str | None
    phone_number: str | None
    coins: int = 0
    roles: list[str] = []
    is_admin: bool = False
    has_admin: bool = False


class AssetUploadResponse(BaseModel):
    code: str
    url: str
    content_type: str


class HealthStatus(BaseModel):
    ok: bool
    database: bool


class UserProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    phone_number: str | None = Field(default=None, max_length=50)

    class Config:
        extra = "forbid"
