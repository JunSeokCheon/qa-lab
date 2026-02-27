"""add exam attempt draft answer columns

Revision ID: 0025_exam_attempt_draft_answers
Revises: 0024_exam_multi_choice_multi
Create Date: 2026-02-27 20:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0025_exam_attempt_draft_answers"
down_revision: Union[str, Sequence[str], None] = "0024_exam_multi_choice_multi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_attempts" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exam_attempts")}
    if "draft_answers_json" not in columns:
        op.add_column("exam_attempts", sa.Column("draft_answers_json", sa.JSON(), nullable=True))
    if "draft_saved_at" not in columns:
        op.add_column("exam_attempts", sa.Column("draft_saved_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_attempts" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exam_attempts")}
    if "draft_saved_at" in columns:
        op.drop_column("exam_attempts", "draft_saved_at")
    if "draft_answers_json" in columns:
        op.drop_column("exam_attempts", "draft_answers_json")
