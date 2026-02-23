"""add per-submission result sharing flags

Revision ID: 0020_exam_submission_result_share
Revises: 0019_exam_timer_results
Create Date: 2026-02-23 23:50:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0020_exam_submission_result_share"
down_revision: Union[str, Sequence[str], None] = "0019_exam_timer_results"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_submissions" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exam_submissions")}
    if "results_published" not in columns:
        op.add_column(
            "exam_submissions",
            sa.Column("results_published", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if "results_published_at" not in columns:
        op.add_column(
            "exam_submissions",
            sa.Column("results_published_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_submissions" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exam_submissions")}
    if "results_published_at" in columns:
        op.drop_column("exam_submissions", "results_published_at")
    if "results_published" in columns:
        op.drop_column("exam_submissions", "results_published")
