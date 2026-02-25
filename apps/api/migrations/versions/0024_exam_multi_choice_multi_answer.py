"""add multi-answer columns for objective exam questions

Revision ID: 0024_exam_multi_choice_multi
Revises: 0023_exam_question_image_list
Create Date: 2026-02-25 10:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0024_exam_multi_choice_multi"
down_revision: Union[str, Sequence[str], None] = "0023_exam_question_image_list"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "exam_questions" in table_names:
        question_columns = {column["name"] for column in inspector.get_columns("exam_questions")}
        if "correct_choice_indexes_json" not in question_columns:
            op.add_column("exam_questions", sa.Column("correct_choice_indexes_json", sa.JSON(), nullable=True))

    if "exam_answers" in table_names:
        answer_columns = {column["name"] for column in inspector.get_columns("exam_answers")}
        if "selected_choice_indexes_json" not in answer_columns:
            op.add_column("exam_answers", sa.Column("selected_choice_indexes_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "exam_answers" in table_names:
        answer_columns = {column["name"] for column in inspector.get_columns("exam_answers")}
        if "selected_choice_indexes_json" in answer_columns:
            op.drop_column("exam_answers", "selected_choice_indexes_json")

    if "exam_questions" in table_names:
        question_columns = {column["name"] for column in inspector.get_columns("exam_questions")}
        if "correct_choice_indexes_json" in question_columns:
            op.drop_column("exam_questions", "correct_choice_indexes_json")
