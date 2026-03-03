"""add track catalog table

Revision ID: 0027_track_catalog
Revises: 0026_exam_performance_bands
Create Date: 2026-03-03 15:00:00.000000
"""

import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0027_track_catalog"
down_revision: Union[str, Sequence[str], None] = "0026_exam_performance_bands"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT_TRACK_NAMES: tuple[str, ...] = ("데이터 분석 11기", "QAQC 4기")
_TRACK_HEX_ESCAPE_RE = re.compile(r"\\(?:u)?([0-9A-Fa-f]{4})")


def _normalize_track_name(raw_name: str | None) -> str | None:
    if raw_name is None:
        return None
    name = _TRACK_HEX_ESCAPE_RE.sub(
        lambda match: chr(int(match.group(1), 16)),
        str(raw_name).strip(),
    ).strip()
    if not name:
        return None
    if len(name) > 100:
        return name[:100].strip() or None
    return name


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "tracks" not in table_names:
        op.create_table(
            "tracks",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
        op.create_index("ix_tracks_id", "tracks", ["id"], unique=False)

    track_names: dict[str, str] = {}

    def add_track_name(raw_name: str | None) -> None:
        normalized = _normalize_track_name(raw_name)
        if not normalized:
            return
        key = normalized.casefold()
        if key not in track_names:
            track_names[key] = normalized

    for track_name in _DEFAULT_TRACK_NAMES:
        add_track_name(track_name)

    if "users" in table_names:
        user_rows = bind.execute(sa.text("SELECT DISTINCT track_name FROM users")).fetchall()
        for (track_name,) in user_rows:
            add_track_name(track_name)

    if "exams" in table_names:
        exam_rows = bind.execute(
            sa.text("SELECT DISTINCT target_track_name FROM exams WHERE target_track_name IS NOT NULL")
        ).fetchall()
        for (track_name,) in exam_rows:
            add_track_name(track_name)

    existing_rows = bind.execute(sa.text("SELECT name FROM tracks")).fetchall()
    for (track_name,) in existing_rows:
        add_track_name(track_name)

    for track_name in sorted(track_names.values(), key=lambda value: value.casefold()):
        bind.execute(
            sa.text("INSERT INTO tracks (name) VALUES (:name) ON CONFLICT (name) DO NOTHING"),
            {"name": track_name},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "tracks" not in table_names:
        return

    indexes = {index["name"] for index in inspector.get_indexes("tracks")}
    if "ix_tracks_id" in indexes:
        op.drop_index("ix_tracks_id", table_name="tracks")
    op.drop_table("tracks")
