"""seed admin_test account and make admin audit logs immutable

Revision ID: 0018_admin_audit_guard
Revises: 0017_exam_question_answer_key
Create Date: 2026-02-23 15:20:00.000000
"""

from typing import Sequence, Union

import bcrypt
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0018_admin_audit_guard"
down_revision: Union[str, Sequence[str], None] = "0017_exam_question_answer_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _seed_admin_test_user() -> None:
    bind = op.get_bind()
    password_hash = bcrypt.hashpw(b"test1234", bcrypt.gensalt()).decode("utf-8")
    bind.execute(
        sa.text(
            """
            INSERT INTO users (username, display_name, track_name, password_hash, role)
            VALUES (:username, :display_name, :track_name, :password_hash, 'admin')
            ON CONFLICT (username)
            DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                role = 'admin',
                display_name = COALESCE(NULLIF(users.display_name, ''), EXCLUDED.display_name),
                track_name = COALESCE(NULLIF(users.track_name, ''), EXCLUDED.track_name)
            """
        ),
        {
            "username": "admin_test",
            "display_name": "관리자 테스트",
            "track_name": "운영",
            "password_hash": password_hash,
        },
    )


def _apply_admin_audit_immutable_trigger() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_admin_audit_logs_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'admin_audit_logs is append-only';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_admin_audit_logs_immutable ON admin_audit_logs;")
    op.execute(
        """
        CREATE TRIGGER trg_admin_audit_logs_immutable
        BEFORE UPDATE OR DELETE ON admin_audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_admin_audit_logs_mutation();
        """
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "users" in table_names:
        _seed_admin_test_user()

    if bind.dialect.name == "postgresql" and "admin_audit_logs" in table_names:
        _apply_admin_audit_immutable_trigger()


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if bind.dialect.name == "postgresql" and "admin_audit_logs" in table_names:
        op.execute("DROP TRIGGER IF EXISTS trg_admin_audit_logs_immutable ON admin_audit_logs;")
        op.execute("DROP FUNCTION IF EXISTS prevent_admin_audit_logs_mutation();")

    if "users" in table_names:
        bind.execute(sa.text("DELETE FROM users WHERE username = :username"), {"username": "admin_test"})
