"""add exam target track

Revision ID: 0016_exam_target_track
Revises: 0015_exam_correct_choice
Create Date: 2026-02-20 20:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0016_exam_target_track"
down_revision: Union[str, Sequence[str], None] = "0015_exam_correct_choice"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("exams")}
    indexes = {index["name"] for index in inspector.get_indexes("exams")}

    if "target_track_name" not in columns:
        op.add_column("exams", sa.Column("target_track_name", sa.String(length=100), nullable=True))
    if "ix_exams_target_track_name" not in indexes:
        op.create_index("ix_exams_target_track_name", "exams", ["target_track_name"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("exams")}
    indexes = {index["name"] for index in inspector.get_indexes("exams")}

    if "ix_exams_target_track_name" in indexes:
        op.drop_index("ix_exams_target_track_name", table_name="exams")
    if "target_track_name" in columns:
        op.drop_column("exams", "target_track_name")
