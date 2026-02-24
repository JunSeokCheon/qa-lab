"""add exam question image resource id list column

Revision ID: 0023_exam_question_image_list
Revises: 0022_exam_question_image_ref
Create Date: 2026-02-24 23:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0023_exam_question_image_list"
down_revision: Union[str, Sequence[str], None] = "0022_exam_question_image_ref"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_questions" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "image_resource_ids_json" not in columns:
        op.add_column("exam_questions", sa.Column("image_resource_ids_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_questions" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "image_resource_ids_json" in columns:
        op.drop_column("exam_questions", "image_resource_ids_json")
