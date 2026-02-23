"""add exam timer, result sharing, and attempt tracking

Revision ID: 0019_exam_timer_results
Revises: 0018_admin_audit_guard
Create Date: 2026-02-23 22:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0019_exam_timer_results"
down_revision: Union[str, Sequence[str], None] = "0018_admin_audit_guard"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "exams" in table_names:
        columns = {column["name"] for column in inspector.get_columns("exams")}
        if "duration_minutes" not in columns:
            op.add_column("exams", sa.Column("duration_minutes", sa.Integer(), nullable=True))
        if "results_published" not in columns:
            op.add_column(
                "exams",
                sa.Column("results_published", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            )
        if "results_published_at" not in columns:
            op.add_column("exams", sa.Column("results_published_at", sa.DateTime(timezone=True), nullable=True))

    if "exam_attempts" not in table_names:
        op.create_table(
            "exam_attempts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("exam_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("exam_id", "user_id", name="uq_exam_attempts_exam_user"),
        )
        op.create_index("ix_exam_attempts_id", "exam_attempts", ["id"], unique=False)
        op.create_index("ix_exam_attempts_exam_id", "exam_attempts", ["exam_id"], unique=False)
        op.create_index("ix_exam_attempts_user_id", "exam_attempts", ["user_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "exam_attempts" in table_names:
        indexes = {index["name"] for index in inspector.get_indexes("exam_attempts")}
        if "ix_exam_attempts_user_id" in indexes:
            op.drop_index("ix_exam_attempts_user_id", table_name="exam_attempts")
        if "ix_exam_attempts_exam_id" in indexes:
            op.drop_index("ix_exam_attempts_exam_id", table_name="exam_attempts")
        if "ix_exam_attempts_id" in indexes:
            op.drop_index("ix_exam_attempts_id", table_name="exam_attempts")
        op.drop_table("exam_attempts")

    if "exams" in table_names:
        columns = {column["name"] for column in inspector.get_columns("exams")}
        if "results_published_at" in columns:
            op.drop_column("exams", "results_published_at")
        if "results_published" in columns:
            op.drop_column("exams", "results_published")
        if "duration_minutes" in columns:
            op.drop_column("exams", "duration_minutes")
