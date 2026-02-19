"""create grade_runs table for grading execution history

Revision ID: 0005_grade_runs
Revises: 0004_problem_version_bundle
Create Date: 2026-02-19 21:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0005_grade_runs"
down_revision: Union[str, Sequence[str], None] = "0004_problem_version_bundle"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "grade_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "submission_id",
            sa.Integer(),
            sa.ForeignKey("submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("grader_image_tag", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("feedback_json", sa.JSON(), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=False),
        sa.Column("logs", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_grade_runs_submission_id", "grade_runs", ["submission_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_grade_runs_submission_id", table_name="grade_runs")
    op.drop_table("grade_runs")
