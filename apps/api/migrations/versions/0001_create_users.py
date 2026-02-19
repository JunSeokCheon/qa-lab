"""create users table and seed dev users

Revision ID: 0001_create_users
Revises:
Create Date: 2026-02-19 18:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0001_create_users"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.execute(
        sa.text(
            """
            INSERT INTO users (email, password_hash, role)
            VALUES
              ('admin@example.com', :admin_hash, 'admin'),
              ('user@example.com', :user_hash, 'user')
            ON CONFLICT (email) DO NOTHING
            """
        ).bindparams(
            admin_hash="$2b$12$ksAeOZ8QIYHSaN.f8Kfg8OF7fPkxBVkzEpg9OhJPqWpvtdHT64DOO",
            user_hash="$2b$12$lT.1jS4SCpqYB2z61ze3d.wNVF.jHcoEfcFMyiY1PGzbdDc72Su/a",
        )
    )


def downgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
