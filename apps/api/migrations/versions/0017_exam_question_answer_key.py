"""add exam question answer key text

Revision ID: 0017_exam_question_answer_key
Revises: 0016_exam_target_track
Create Date: 2026-02-22 11:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0017_exam_question_answer_key"
down_revision: Union[str, Sequence[str], None] = "0016_exam_target_track"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "answer_key_text" not in columns:
        op.add_column("exam_questions", sa.Column("answer_key_text", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "answer_key_text" in columns:
        op.drop_column("exam_questions", "answer_key_text")
