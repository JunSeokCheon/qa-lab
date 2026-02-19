"""create problem bank tables

Revision ID: 0002_problem_bank
Revises: 0001_create_users
Create Date: 2026-02-19 19:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002_problem_bank"
down_revision: Union[str, Sequence[str], None] = "0001_create_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_index("ix_skills_name", "skills", ["name"], unique=True)

    op.create_table(
        "problems",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "problem_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("problem_id", sa.Integer(), sa.ForeignKey("problems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("difficulty", sa.String(length=50), nullable=False),
        sa.Column("max_score", sa.Integer(), nullable=False),
        sa.Column("statement_md", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_problem_versions_problem_id", "problem_versions", ["problem_id"], unique=False)
    op.create_unique_constraint("uq_problem_versions_problem_id_version", "problem_versions", ["problem_id", "version"])

    op.create_table(
        "problem_version_skills",
        sa.Column(
            "problem_version_id",
            sa.Integer(),
            sa.ForeignKey("problem_versions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("weight", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("problem_version_skills")
    op.drop_constraint("uq_problem_versions_problem_id_version", "problem_versions", type_="unique")
    op.drop_index("ix_problem_versions_problem_id", table_name="problem_versions")
    op.drop_table("problem_versions")
    op.drop_table("problems")
    op.drop_index("ix_skills_name", table_name="skills")
    op.drop_table("skills")
