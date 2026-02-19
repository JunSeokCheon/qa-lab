"""add admin audit logs table

Revision ID: 0007_admin_audit_logs
Revises: 0006_password_reset_tokens
Create Date: 2026-02-20 01:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0007_admin_audit_logs"
down_revision: Union[str, Sequence[str], None] = "0006_password_reset_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("resource_type", sa.String(length=100), nullable=False),
        sa.Column("resource_id", sa.String(length=255), nullable=True),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("client_ip", sa.String(length=100), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_admin_audit_logs_actor_user_id", "admin_audit_logs", ["actor_user_id"], unique=False)
    op.create_index("ix_admin_audit_logs_created_at", "admin_audit_logs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_admin_audit_logs_created_at", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_actor_user_id", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")
