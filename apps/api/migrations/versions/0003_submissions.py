"""create submissions and grades tables

Revision ID: 0003_submissions
Revises: 0002_problem_bank
Create Date: 2026-02-19 20:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0003_submissions"
down_revision: Union[str, Sequence[str], None] = "0002_problem_bank"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "problem_version_id",
            sa.Integer(),
            sa.ForeignKey("problem_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="QUEUED"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('QUEUED','RUNNING','GRADED','FAILED')", name="ck_submissions_status"),
    )
    op.create_index("ix_submissions_user_id", "submissions", ["user_id"], unique=False)
    op.create_index("ix_submissions_problem_version_id", "submissions", ["problem_version_id"], unique=False)

    op.create_table(
        "grades",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("max_score", sa.Integer(), nullable=False),
        sa.Column("feedback_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_unique_constraint("uq_grades_submission_id", "grades", ["submission_id"])
    op.create_index("ix_grades_submission_id", "grades", ["submission_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_grades_submission_id", table_name="grades")
    op.drop_constraint("uq_grades_submission_id", "grades", type_="unique")
    op.drop_table("grades")

    op.drop_index("ix_submissions_problem_version_id", table_name="submissions")
    op.drop_index("ix_submissions_user_id", table_name="submissions")
    op.drop_table("submissions")
