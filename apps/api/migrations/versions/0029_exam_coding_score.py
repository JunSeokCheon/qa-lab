"""add coding score weight to exams

Revision ID: 0029_exam_coding_score
Revises: 0028_exam_scoring_weights
Create Date: 2026-03-04 18:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0029_exam_coding_score"
down_revision: Union[str, Sequence[str], None] = "0028_exam_scoring_weights"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "coding_score" not in columns:
        op.add_column(
            "exams",
            sa.Column(
                "coding_score",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("3"),
            ),
        )

    # Keep existing exam intent by inheriting the subjective score weight for coding.
    bind.execute(sa.text("UPDATE exams SET coding_score = subjective_score WHERE subjective_score IS NOT NULL"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exams" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exams")}
    if "coding_score" in columns:
        op.drop_column("exams", "coding_score")
