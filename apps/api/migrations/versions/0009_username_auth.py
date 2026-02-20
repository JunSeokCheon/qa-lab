"""switch auth identity from email to username

Revision ID: 0009_username_auth
Revises: 0008_domain_foundations
Create Date: 2026-02-20 09:25:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0009_username_auth"
down_revision: Union[str, Sequence[str], None] = "0008_domain_foundations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE users
            SET email = CASE
                WHEN email = 'admin@example.com' THEN 'admin'
                WHEN email = 'user@example.com' THEN 'user'
                ELSE email
            END
            """
        )
    )
    op.alter_column("users", "email", new_column_name="username", existing_type=sa.String(length=255))
    op.drop_index("ix_users_email", table_name="users")
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.alter_column("users", "username", new_column_name="email", existing_type=sa.String(length=255))
    op.drop_index("ix_users_username", table_name="users")
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.execute(
        sa.text(
            """
            UPDATE users
            SET email = CASE
                WHEN email = 'admin' THEN 'admin@example.com'
                WHEN email = 'user' THEN 'user@example.com'
                ELSE email
            END
            """
        )
    )
