"""add exam starts_at scheduling field

Revision ID: 0021_exam_start_schedule
Revises: 0020_exam_submission_share
Create Date: 2026-02-24 17:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0021_exam_start_schedule"
down_revision: Union[str, Sequence[str], None] = "0020_exam_submission_share"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "starts_at" not in columns:
        op.add_column("exams", sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "starts_at" in columns:
        op.drop_column("exams", "starts_at")
