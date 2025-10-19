"""add has_admin flag to users"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

# revision identifiers, used by Alembic.
revision = "20251019_add_user_has_admin"
down_revision = "20251018_add_assets_table"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    columns = inspector.get_columns(table_name)
    return any(col["name"] == column_name for col in columns)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if not _has_column(inspector, "users", "has_admin"):
        op.add_column(
            "users",
            sa.Column("has_admin", sa.Boolean(), nullable=False, server_default=text("0")),
        )
        op.execute(
            """
            UPDATE users
            SET has_admin = 1
            WHERE id IN (
                SELECT ur.user_id
                FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                WHERE LOWER(r.name) = 'admin'
            )
            """
        )
        op.alter_column("users", "has_admin", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if _has_column(inspector, "users", "has_admin"):
        op.drop_column("users", "has_admin")
