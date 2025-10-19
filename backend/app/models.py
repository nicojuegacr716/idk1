import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.mutable import MutableDict, MutableList
from sqlalchemy.orm import relationship

from app.admin import models as admin_models

from .db import Base

Permission = admin_models.Permission
Role = admin_models.Role
RolePermission = admin_models.RolePermission
UserRole = admin_models.UserRole
ServiceStatus = admin_models.ServiceStatus


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("discord_id", name="uq_users_discord_id"),
        Index("ix_users_email", "email"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    discord_id = Column(String(64), nullable=False, index=True)
    email = Column(String(320), nullable=True)
    username = Column(String(100), nullable=False)
    display_name = Column(String(100), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    phone_number = Column(String(50), nullable=True)
    coins = Column(Integer, nullable=False, server_default="0", default=0)
    has_admin = Column(Boolean, nullable=False, server_default=text("0"), default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    admin_tokens = relationship(
        "AdminToken", back_populates="creator", passive_deletes=True
    )
    vps_sessions = relationship(
        "VpsSession", back_populates="user", passive_deletes=True
    )
    support_threads = relationship(
        "SupportThread", back_populates="user", passive_deletes=True
    )
    ads_claims = relationship(
        "AdsClaim", back_populates="user", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"User(id={self.id}, discord_id={self.discord_id})"


class AdminToken(Base):
    __tablename__ = "admin_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    label = Column(String(128), nullable=False)
    token_ciphertext = Column(Text, nullable=False)
    token_prefix = Column(String(4), nullable=False)
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    creator = relationship("User", back_populates="admin_tokens")


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (UniqueConstraint("code", name="uq_assets_code"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(16), nullable=False)
    stored_path = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=True)
    content_type = Column(String(128), nullable=False)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


vps_product_workers = Table(
    "vps_product_workers",
    Base.metadata,
    Column("product_id", UUID(as_uuid=True), ForeignKey("vps_products.id", ondelete="CASCADE"), primary_key=True),
    Column("worker_id", UUID(as_uuid=True), ForeignKey("workers.id", ondelete="CASCADE"), primary_key=True),
)


class Worker(Base):
    __tablename__ = "workers"
    __table_args__ = (
        CheckConstraint(
            "status in ('active','disabled')",
            name="ck_workers_status",
        ),
        Index("ix_workers_name", "name"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(128), nullable=True)
    base_url = Column(Text, nullable=False)
    status = Column(String(16), nullable=False, server_default="active")
    max_sessions = Column(Integer, nullable=False, server_default="3", default=3)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    sessions = relationship("VpsSession", back_populates="worker", passive_deletes=True)
    products = relationship(
        "VpsProduct",
        secondary=vps_product_workers,
        back_populates="workers",
    )


class VpsProduct(Base):
    __tablename__ = "vps_products"
    __table_args__ = (
        Index("ix_vps_products_is_active", "is_active"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    price_coins = Column(Integer, nullable=False)
    provision_action = Column(Integer, nullable=False, server_default="1", default=1)
    is_active = Column(Boolean, nullable=False, server_default="true", default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    sessions = relationship("VpsSession", back_populates="product", passive_deletes=True)
    workers = relationship("Worker", secondary=vps_product_workers, back_populates="products")


class VpsSession(Base):
    __tablename__ = "vps_sessions"
    __table_args__ = (
        CheckConstraint(
            "status in ('pending','provisioning','ready','failed','expired','deleted')",
            name="ck_vps_sessions_status",
        ),
        Index("ix_vps_sessions_user_id", "user_id"),
        Index("ix_vps_sessions_product_id", "product_id"),
        Index("ix_vps_sessions_worker_id", "worker_id"),
        Index("ix_vps_sessions_created_at", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    product_id = Column(
        UUID(as_uuid=True), ForeignKey("vps_products.id", ondelete="SET NULL"), nullable=True
    )
    worker_id = Column(UUID(as_uuid=True), ForeignKey("workers.id", ondelete="SET NULL"), nullable=True)
    session_token = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, server_default="pending")
    checklist = Column(
        MutableList.as_mutable(JSONB), nullable=False, server_default=text("'[]'")
    )
    rdp_host = Column(String(255), nullable=True)
    rdp_port = Column(Integer, nullable=True)
    rdp_user = Column(String(128), nullable=True)
    rdp_password = Column(String(128), nullable=True)
    worker_route = Column(String(128), nullable=True)
    log_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    expires_at = Column(DateTime(timezone=True), nullable=True)

    idempotency_key = Column(String(128), nullable=True, index=True)

    user = relationship("User", back_populates="vps_sessions")
    product = relationship("VpsProduct", back_populates="sessions")
    worker = relationship("Worker", back_populates="sessions")

    def get_worker_logs(self) -> str | None:
        """Get logs from worker if available"""
        if not self.worker or not self.worker_route:
            return None
        return f"{self.worker.base_url}/log/{self.worker_route}"

    def update_from_worker_result(self, result: dict) -> None:
        """Update session from worker result"""
        self.status = result.get("status", self.status)
        self.rdp_host = result.get("rdp_host")
        self.rdp_port = result.get("rdp_port")
        self.rdp_user = result.get("rdp_user")
        self.rdp_password = result.get("rdp_password")
        if result.get("log_url"):
            self.log_url = result["log_url"]


class AdsClaim(Base):
    __tablename__ = "ads_claims"
    __table_args__ = (
        CheckConstraint("provider in ('adsense','monetag')", name="ck_ads_claims_provider"),
        Index("ix_ads_claims_user_id", "user_id"),
        Index("ix_ads_claims_claimed_at", "claimed_at"),
        UniqueConstraint("nonce", name="uq_ads_claims_nonce"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    provider = Column(String(32), nullable=False)
    nonce = Column(String(128), nullable=False)
    value_coins = Column(Integer, nullable=False)
    claimed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    meta = Column(MutableDict.as_mutable(JSONB), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user = relationship("User", back_populates="ads_claims")


class SupportThread(Base):
    __tablename__ = "support_threads"
    __table_args__ = (
        CheckConstraint("source in ('ai','human')", name="ck_support_threads_source"),
        CheckConstraint(
            "status in ('open','pending','resolved','closed')",
            name="ck_support_threads_status",
        ),
        Index("ix_support_threads_user_id", "user_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    source = Column(String(16), nullable=False)
    status = Column(String(16), nullable=False, server_default="open")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user = relationship("User", back_populates="support_threads")
    messages = relationship(
        "SupportMessage", back_populates="thread", cascade="all, delete-orphan"
    )


class SupportMessage(Base):
    __tablename__ = "support_messages"
    __table_args__ = (
        CheckConstraint(
            "sender in ('user','ai','admin')",
            name="ck_support_messages_sender",
        ),
        Index("ix_support_messages_thread_id", "thread_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(
        UUID(as_uuid=True), ForeignKey("support_threads.id", ondelete="CASCADE"), nullable=False
    )
    sender = Column(String(16), nullable=False)
    content = Column(Text, nullable=True)
    role = Column(String(32), nullable=True)
    meta = Column(MutableDict.as_mutable(JSONB), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    thread = relationship("SupportThread", back_populates="messages")


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(191), primary_key=True)
    value = Column(MutableDict.as_mutable(JSONB), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Announcement(Base):
    __tablename__ = "announcements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(200), nullable=False)
    slug = Column(String(191), nullable=False, unique=True)
    message = Column(Text, nullable=False)
    excerpt = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    hero_image_url = Column(String(500), nullable=True)
    attachments = Column(
        MutableList.as_mutable(JSONB), nullable=False, server_default=text("'[]'")
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
