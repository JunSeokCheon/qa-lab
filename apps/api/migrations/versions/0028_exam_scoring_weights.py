"""add per-exam scoring weights for objective/subjective questions

Revision ID: 0028_exam_scoring_weights
Revises: 0027_track_catalog
Create Date: 2026-03-04 15:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0028_exam_scoring_weights"
down_revision: Union[str, Sequence[str], None] = "0027_track_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "multiple_choice_score" not in columns:
        op.add_column(
            "exams",
            sa.Column(
                "multiple_choice_score",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )
    if "subjective_score" not in columns:
        op.add_column(
            "exams",
            sa.Column(
                "subjective_score",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("3"),
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "subjective_score" in columns:
        op.drop_column("exams", "subjective_score")
    if "multiple_choice_score" in columns:
        op.drop_column("exams", "multiple_choice_score")
