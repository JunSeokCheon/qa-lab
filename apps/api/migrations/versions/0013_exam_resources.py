"""add exam resources table

Revision ID: 0013_exam_resources
Revises: 0012_user_profile_and_cleanup
Create Date: 2026-02-20 16:50:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0013_exam_resources"
down_revision: Union[str, Sequence[str], None] = "0012_user_profile_and_cleanup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "exam_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("exam_id", sa.Integer(), sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("stored_name", sa.String(length=120), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_exam_resources_id", "exam_resources", ["id"], unique=False)
    op.create_index("ix_exam_resources_exam_id", "exam_resources", ["exam_id"], unique=False)
    op.create_index("ix_exam_resources_stored_name", "exam_resources", ["stored_name"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_exam_resources_stored_name", table_name="exam_resources")
    op.drop_index("ix_exam_resources_exam_id", table_name="exam_resources")
    op.drop_index("ix_exam_resources_id", table_name="exam_resources")
    op.drop_table("exam_resources")
