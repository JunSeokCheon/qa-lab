"""add domain foundations for version status, rubric history, mastery snapshots

Revision ID: 0008_domain_foundations
Revises: 0007_admin_audit_logs
Create Date: 2026-02-20 02:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0008_domain_foundations"
down_revision: Union[str, Sequence[str], None] = "0007_admin_audit_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "problem_versions",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
    )
    op.add_column(
        "problem_versions",
        sa.Column("rubric_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("problem_versions", "status", server_default=None)
    op.alter_column("problem_versions", "rubric_version", server_default=None)

    op.add_column("submissions", sa.Column("bundle_key_snapshot", sa.String(length=500), nullable=True))
    op.add_column("submissions", sa.Column("bundle_sha256_snapshot", sa.String(length=64), nullable=True))
    op.add_column("submissions", sa.Column("rubric_version_snapshot", sa.Integer(), nullable=True))

    op.create_table(
        "rubric_histories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "problem_version_id",
            sa.Integer(),
            sa.ForeignKey("problem_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rubric_version", sa.Integer(), nullable=False),
        sa.Column("rubric_sha256", sa.String(length=64), nullable=False),
        sa.Column("rubric_yaml", sa.Text(), nullable=False),
        sa.Column("bundle_key", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("problem_version_id", "rubric_version", name="uq_rubric_histories_version"),
    )
    op.create_index("ix_rubric_histories_problem_version_id", "rubric_histories", ["problem_version_id"], unique=False)

    op.create_table(
        "mastery_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mastery", sa.Float(), nullable=False),
        sa.Column("earned_points", sa.Float(), nullable=False),
        sa.Column("possible_points", sa.Float(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_mastery_snapshots_user_id", "mastery_snapshots", ["user_id"], unique=False)
    op.create_index("ix_mastery_snapshots_skill_id", "mastery_snapshots", ["skill_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_mastery_snapshots_skill_id", table_name="mastery_snapshots")
    op.drop_index("ix_mastery_snapshots_user_id", table_name="mastery_snapshots")
    op.drop_table("mastery_snapshots")

    op.drop_index("ix_rubric_histories_problem_version_id", table_name="rubric_histories")
    op.drop_table("rubric_histories")

    op.drop_column("submissions", "rubric_version_snapshot")
    op.drop_column("submissions", "bundle_sha256_snapshot")
    op.drop_column("submissions", "bundle_key_snapshot")

    op.drop_column("problem_versions", "rubric_version")
    op.drop_column("problem_versions", "status")
