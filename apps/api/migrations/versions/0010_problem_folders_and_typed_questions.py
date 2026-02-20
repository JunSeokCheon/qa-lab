"""add problem folders and typed question metadata

Revision ID: 0010_problem_folders
Revises: 0009_username_auth
Create Date: 2026-02-20 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0010_problem_folders"
down_revision: Union[str, Sequence[str], None] = "0009_username_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "problem_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("problem_folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_problem_folders_slug", "problem_folders", ["slug"], unique=True)
    op.create_index("ix_problem_folders_parent_id", "problem_folders", ["parent_id"], unique=False)

    op.add_column(
        "problems",
        sa.Column("folder_id", sa.Integer(), sa.ForeignKey("problem_folders.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_problems_folder_id", "problems", ["folder_id"], unique=False)

    op.add_column("problem_versions", sa.Column("question_meta_json", sa.JSON(), nullable=True))

    op.execute(
        sa.text(
            """
            INSERT INTO problem_folders (name, slug, parent_id, sort_order)
            VALUES
              ('Python', 'python', NULL, 10),
              ('Preprocessing', 'preprocessing', NULL, 20),
              ('Visualization', 'visualization', NULL, 30),
              ('Statistics', 'statistics', NULL, 40),
              ('Machine Learning', 'machine-learning', NULL, 50)
            ON CONFLICT (slug) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_column("problem_versions", "question_meta_json")

    op.drop_index("ix_problems_folder_id", table_name="problems")
    op.drop_column("problems", "folder_id")

    op.drop_index("ix_problem_folders_parent_id", table_name="problem_folders")
    op.drop_index("ix_problem_folders_slug", table_name="problem_folders")
    op.drop_table("problem_folders")
