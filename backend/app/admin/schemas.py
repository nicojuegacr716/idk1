from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, Field


class PermissionDTO(BaseModel):
    id: UUID
    code: str
    description: str | None = None


class CsrfTokenResponse(BaseModel):
    token: str


class AssetUploadResponse(BaseModel):
    code: str
    url: str
    content_type: str


class RoleSummary(BaseModel):
    id: UUID
    name: str


class RoleDTO(RoleSummary):
    description: str | None = None
    created_at: datetime
    updated_at: datetime
    permissions: list[PermissionDTO] = Field(default_factory=list)


class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class RolePermissionsUpdate(BaseModel):
    permission_codes: list[str]


class UserSummary(BaseModel):
    id: UUID
    username: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None


class AdminUser(UserSummary):
    discord_id: str
    phone_number: str | None = None
    coins: int
    roles: list[RoleSummary] = Field(default_factory=list)
    has_admin: bool = False


class AdminUserListItem(BaseModel):
    id: UUID
    username: str
    email_masked: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    coins: int
    discord_id_suffix: str | None = None
    roles: list[RoleSummary] = Field(default_factory=list)


class UserCreate(BaseModel):
    discord_id: str
    username: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    phone_number: str | None = None


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    phone_number: Optional[str] = None


class UserListResponse(BaseModel):
    items: list[AdminUserListItem]
    total: int
    page: int
    page_size: int


class AssignRolesRequest(BaseModel):
    role_ids: list[UUID]


class AdminAuditLogEntry(BaseModel):
    id: UUID
    actor_user_id: UUID | None
    action: str
    target_type: str
    target_id: str | None
    diff_json: dict | None
    ip: str | None
    ua: str | None
    created_at: datetime


class StatusHealthResponse(BaseModel):
    api_up: bool
    version: str | None
    build_time: str | None


class StatusDepsResponse(BaseModel):
    db_ping_ms: float | None
    redis_ping_ms: float | None
    disk_free_mb: float | None
    cpu_percent: float | None
    memory_percent: float | None


class DbStatusSlowQuery(BaseModel):
    query: str
    duration_ms: float


class StatusDbResponse(BaseModel):
    version: str | None
    active_connections: int | None
    slow_queries: list[DbStatusSlowQuery]
    last_migration: str | None


class UserQueryParams(BaseModel):
    q: str | None = None
    page: int = 1
    page_size: int = 25
    role: UUID | None = None

    @property
    def offset(self) -> int:
        return max(self.page - 1, 0) * self.page_size

class AdminTokenCreateRequest(BaseModel):
    label: str
    token_plain: str = Field(min_length=1)


class AdminTokenListItem(BaseModel):
    id: UUID
    label: str
    token_prefix: str
    masked_token: str
    created_at: datetime
    revoked_at: datetime | None = None


class AdminTokenCreateResponse(BaseModel):
    id: UUID
    label: str
    token_prefix: str
    token_plain: str
    created_at: datetime


class UserCoinsUpdateRequest(BaseModel):
    op: Literal["add", "sub", "set"]
    amount: int = Field(gt=0)
    reason: str | None = None



class WorkerRegisterRequest(BaseModel):
    name: str | None = None
    base_url: AnyHttpUrl
    max_sessions: int = Field(default=3, ge=1)


class WorkerUpdateRequest(BaseModel):
    name: str | None = None
    base_url: AnyHttpUrl | None = None
    status: Literal["active", "disabled"] | None = None
    max_sessions: int | None = Field(default=None, ge=1)


class WorkerListItem(BaseModel):
    id: UUID
    name: str | None
    base_url: AnyHttpUrl
    status: Literal["active", "disabled"]
    max_sessions: int
    active_sessions: int
    created_at: datetime
    updated_at: datetime
    actions: list[str] = Field(default_factory=list)


class WorkerEndpoints(BaseModel):
    health: AnyHttpUrl
    login: AnyHttpUrl
    create_vm: AnyHttpUrl
    stop_template: AnyHttpUrl
    log_template: AnyHttpUrl


class WorkerDetail(WorkerListItem):
    endpoints: WorkerEndpoints


class WorkerHealthResponse(BaseModel):
    ok: bool
    latency_ms: float | None = None
    payload: dict | None = None

class VpsProductCreateRequest(BaseModel):
    name: str
    description: str | None = None
    price_coins: int = Field(ge=0)
    is_active: bool = True
    provision_action: int = Field(default=1, ge=1)
    worker_ids: list[UUID] = Field(default_factory=list)


class VpsProductUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    price_coins: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    provision_action: int | None = Field(default=None, ge=1)
    worker_ids: list[UUID] | None = None


class VpsProductDTO(BaseModel):
    id: UUID
    name: str
    description: str | None
    price_coins: int
    provision_action: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    workers: list[WorkerListItem] = Field(default_factory=list)

class AdsSettingsUpdateRequest(BaseModel):
    enabled: bool


class AdsSettingsResponse(BaseModel):
    enabled: bool


class KyaroPromptResponse(BaseModel):
    prompt: str
    version: int | None = None
    updated_at: datetime | None = None
    updated_by: UUID | None = None


class KyaroPromptUpdateRequest(BaseModel):
    prompt: str = Field(min_length=1)


class SupportAttachmentInput(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    label: str | None = Field(default=None, max_length=120)
    kind: Literal["link", "image", "file"] | None = None


class SupportAttachmentDTO(BaseModel):
    url: str
    label: str | None = None
    kind: Literal["link", "image", "file"] | None = None


class SupportMessageDTO(BaseModel):
    id: UUID
    sender: Literal["user", "ai", "admin"]
    content: str | None = None
    role: str | None = None
    meta: dict | None = None
    attachments: list[SupportAttachmentDTO] = Field(default_factory=list)
    created_at: datetime


class SupportThreadSummary(BaseModel):
    id: UUID
    user_id: UUID | None = None
    source: Literal["ai", "human"]
    status: Literal["open", "pending", "resolved", "closed"]
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None = None


class SupportThreadDetail(SupportThreadSummary):
    messages: list[SupportMessageDTO] = Field(default_factory=list)


class SupportReplyRequest(BaseModel):
    message: str = Field(min_length=1)
    status: Literal["open", "pending", "resolved", "closed"] | None = None
    attachments: list[SupportAttachmentInput] | None = None


class AnnouncementAttachment(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    url: str = Field(min_length=1, max_length=500)


class AnnouncementSummary(BaseModel):
    id: UUID
    slug: str
    title: str
    excerpt: str | None = None
    hero_image_url: str | None = None
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None


class AnnouncementDetail(AnnouncementSummary):
    content: str
    attachments: list[AnnouncementAttachment] = Field(default_factory=list)


class AnnouncementCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    slug: str | None = Field(default=None, min_length=3, max_length=191)
    excerpt: str | None = None
    content: str = Field(min_length=1)
    hero_image_url: str | None = None
    attachments: list[AnnouncementAttachment] = Field(default_factory=list)


class AnnouncementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    slug: str | None = Field(default=None, min_length=3, max_length=191)
    excerpt: str | None = None
    content: str | None = Field(default=None, min_length=1)
    hero_image_url: str | None = None
    attachments: list[AnnouncementAttachment] | None = None

