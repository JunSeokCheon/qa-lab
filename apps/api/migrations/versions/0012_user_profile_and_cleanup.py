"""add user profile fields and purge legacy category exams

Revision ID: 0012_user_profile_and_cleanup
Revises: 0011_exam_forms
Create Date: 2026-02-20 15:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0012_user_profile_and_cleanup"
down_revision: Union[str, Sequence[str], None] = "0011_exam_forms"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_LEGACY_SLUGS = (
    "python",
    "preprocessing",
    "visualization",
    "statistics",
    "machine-learning",
)

_LEGACY_NAMES = (
    "python",
    "preprocessing",
    "visualization",
    "statistics",
    "machine learning",
    "파이썬",
    "전처리",
    "시각화",
    "통계",
    "머신러닝",
)


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("track_name", sa.String(length=100), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE users
            SET display_name = CASE
                WHEN role = 'admin' THEN '관리자'
                ELSE COALESCE(NULLIF(username, ''), '학습자')
            END
            WHERE display_name IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE users
            SET track_name = CASE
                WHEN role = 'admin' THEN '운영'
                ELSE '미지정'
            END
            WHERE track_name IS NULL
            """
        )
    )

    op.alter_column("users", "display_name", existing_type=sa.String(length=100), nullable=False)
    op.alter_column("users", "track_name", existing_type=sa.String(length=100), nullable=False)

    op.execute(
        sa.text(
            """
            DELETE FROM exams
            WHERE folder_id IN (
                SELECT id
                FROM problem_folders
                WHERE slug IN :legacy_slugs OR lower(name) IN :legacy_names
            )
            """
        ).bindparams(
            sa.bindparam("legacy_slugs", value=_LEGACY_SLUGS, expanding=True),
            sa.bindparam("legacy_names", value=_LEGACY_NAMES, expanding=True),
        )
    )

    op.execute(
        sa.text(
            """
            DELETE FROM exams
            WHERE exam_kind IN ('quiz', 'assessment')
              AND (
                lower(title) LIKE '%python%'
                OR title LIKE '%파이썬%'
                OR title LIKE '%전처리%'
                OR title LIKE '%시각화%'
                OR title LIKE '%통계%'
                OR title LIKE '%머신러닝%'
              )
            """
        )
    )

    op.execute(
        sa.text(
            """
            DELETE FROM problems
            WHERE folder_id IN (
                SELECT id
                FROM problem_folders
                WHERE slug IN :legacy_slugs OR lower(name) IN :legacy_names
            )
            """
        ).bindparams(
            sa.bindparam("legacy_slugs", value=_LEGACY_SLUGS, expanding=True),
            sa.bindparam("legacy_names", value=_LEGACY_NAMES, expanding=True),
        )
    )

    op.execute(
        sa.text(
            """
            DELETE FROM problem_folders
            WHERE slug IN :legacy_slugs OR lower(name) IN :legacy_names
            """
        ).bindparams(
            sa.bindparam("legacy_slugs", value=_LEGACY_SLUGS, expanding=True),
            sa.bindparam("legacy_names", value=_LEGACY_NAMES, expanding=True),
        )
    )


def downgrade() -> None:
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

    op.drop_column("users", "track_name")
    op.drop_column("users", "display_name")
