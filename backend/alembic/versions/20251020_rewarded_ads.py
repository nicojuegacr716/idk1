"""introduce rewarded ads ledger infrastructure

Revision ID: 20251020_rewarded_ads
Revises: 20251012_announcements
Create Date: 2025-10-20 13:15:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20251020_rewarded_ads"
down_revision = "20251019_add_user_has_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.create_table(
        "wallets",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("balance", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.execute(
        """
        INSERT INTO wallets (user_id, balance)
        SELECT id, COALESCE(coins, 0)
        FROM users
        ON CONFLICT (user_id) DO NOTHING
        """
    )

    op.create_table(
        "ledger",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column("ref_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ledger_user_id_created_at", "ledger", ["user_id", "created_at"])

    op.create_table(
        "ad_rewards",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("network", sa.String(length=64), nullable=False),
        sa.Column("event_id", sa.String(length=191), nullable=False),
        sa.Column("nonce", sa.String(length=191), nullable=False),
        sa.Column("reward_amount", sa.Integer(), nullable=False),
        sa.Column("duration_sec", sa.Integer(), nullable=False),
        sa.Column("placement", sa.String(length=64), nullable=True),
        sa.Column("device_hash", sa.String(length=191), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ad_rewards_user_id_created_at", "ad_rewards", ["user_id", "created_at"])
    op.create_index("ix_ad_rewards_nonce", "ad_rewards", ["nonce"])
    op.create_unique_constraint("uq_ad_rewards_event_id", "ad_rewards", ["event_id"])

    op.create_table(
        "user_limits",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_hash", sa.String(length=191), nullable=False, server_default=sa.text("'__user__'")),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("rewards", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("device_rewards", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_reward_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bad_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "device_hash", "day", name="pk_user_limits"),
    )
    op.create_unique_constraint("uq_user_limits_scope", "user_limits", ["user_id", "device_hash", "day"])
    op.create_index("ix_user_limits_user_day", "user_limits", ["user_id", "day"])


def downgrade() -> None:
    op.drop_index("ix_user_limits_user_day", table_name="user_limits")
    op.drop_constraint("uq_user_limits_scope", "user_limits", type_="unique")
    op.drop_table("user_limits")

    op.drop_index("ix_ad_rewards_nonce", table_name="ad_rewards")
    op.drop_index("ix_ad_rewards_user_id_created_at", table_name="ad_rewards")
    op.drop_constraint("uq_ad_rewards_event_id", "ad_rewards", type_="unique")
    op.drop_table("ad_rewards")

    op.drop_index("ix_ledger_user_id_created_at", table_name="ledger")
    op.drop_table("ledger")

    op.drop_table("wallets")
