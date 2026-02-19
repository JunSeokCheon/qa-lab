"""create users table and seed dev users

Revision ID: 0001_create_users
Revises:
Create Date: 2026-02-19 18:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import bcrypt


# revision identifiers, used by Alembic.
revision: str = "0001_create_users"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    admin_hash = bcrypt.hashpw(b"admin1234", bcrypt.gensalt()).decode("utf-8")
    user_hash = bcrypt.hashpw(b"user1234", bcrypt.gensalt()).decode("utf-8")

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
            admin_hash=admin_hash,
            user_hash=user_hash,
        )
    )


def downgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
