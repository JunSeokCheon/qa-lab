"""add exam question correct choice index

Revision ID: 0015_exam_correct_choice
Revises: 0014_exam_answer_grading
Create Date: 2026-02-20 18:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0015_exam_correct_choice"
down_revision: Union[str, Sequence[str], None] = "0014_exam_answer_grading"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "correct_choice_index" not in columns:
        op.add_column("exam_questions", sa.Column("correct_choice_index", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "correct_choice_index" in columns:
        op.drop_column("exam_questions", "correct_choice_index")
