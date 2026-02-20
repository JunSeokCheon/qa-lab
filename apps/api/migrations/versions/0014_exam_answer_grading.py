"""add exam answer grading fields

Revision ID: 0014_exam_answer_grading
Revises: 0013_exam_resources
Create Date: 2026-02-20 17:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0014_exam_answer_grading"
down_revision: Union[str, Sequence[str], None] = "0013_exam_resources"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("exam_answers", sa.Column("grading_status", sa.String(length=20), nullable=True))
    op.add_column("exam_answers", sa.Column("grading_score", sa.Integer(), nullable=True))
    op.add_column("exam_answers", sa.Column("grading_max_score", sa.Integer(), nullable=True))
    op.add_column("exam_answers", sa.Column("grading_feedback_json", sa.JSON(), nullable=True))
    op.add_column("exam_answers", sa.Column("grading_logs", sa.Text(), nullable=True))
    op.add_column("exam_answers", sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("exam_answers", "graded_at")
    op.drop_column("exam_answers", "grading_logs")
    op.drop_column("exam_answers", "grading_feedback_json")
    op.drop_column("exam_answers", "grading_max_score")
    op.drop_column("exam_answers", "grading_score")
    op.drop_column("exam_answers", "grading_status")
