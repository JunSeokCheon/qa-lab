"""add optional exam performance band thresholds

Revision ID: 0026_exam_performance_bands
Revises: 0025_exam_attempt_draft_answers
Create Date: 2026-02-27 22:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0026_exam_performance_bands"
down_revision: Union[str, Sequence[str], None] = "0025_exam_attempt_draft_answers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "performance_high_min_correct" not in columns:
        op.add_column("exams", sa.Column("performance_high_min_correct", sa.Integer(), nullable=True))
    if "performance_mid_min_correct" not in columns:
        op.add_column("exams", sa.Column("performance_mid_min_correct", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "performance_mid_min_correct" in columns:
        op.drop_column("exams", "performance_mid_min_correct")
    if "performance_high_min_correct" in columns:
        op.drop_column("exams", "performance_high_min_correct")
