"""add bundle metadata fields to problem_versions

Revision ID: 0004_problem_version_bundle
Revises: 0003_submissions
Create Date: 2026-02-19 21:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0004_problem_version_bundle"
down_revision: Union[str, Sequence[str], None] = "0003_submissions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("problem_versions", sa.Column("bundle_key", sa.String(length=500), nullable=True))
    op.add_column("problem_versions", sa.Column("bundle_sha256", sa.String(length=64), nullable=True))
    op.add_column("problem_versions", sa.Column("bundle_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("problem_versions", "bundle_size")
    op.drop_column("problem_versions", "bundle_sha256")
    op.drop_column("problem_versions", "bundle_key")
