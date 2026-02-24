"""add exam question image resource reference

Revision ID: 0022_exam_question_image_ref
Revises: 0021_exam_start_schedule
Create Date: 2026-02-24 21:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0022_exam_question_image_ref"
down_revision: Union[str, Sequence[str], None] = "0021_exam_start_schedule"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_questions" not in table_names or "exam_resources" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "image_resource_id" not in columns:
        op.add_column("exam_questions", sa.Column("image_resource_id", sa.Integer(), nullable=True))

    index_names = {index["name"] for index in inspector.get_indexes("exam_questions")}
    if "ix_exam_questions_image_resource_id" not in index_names:
        op.create_index("ix_exam_questions_image_resource_id", "exam_questions", ["image_resource_id"], unique=False)

    foreign_keys = inspector.get_foreign_keys("exam_questions")
    has_image_fk = any(
        fk.get("name") == "fk_exam_questions_image_resource_id_exam_resources"
        or (
            fk.get("referred_table") == "exam_resources"
            and fk.get("constrained_columns") == ["image_resource_id"]
        )
        for fk in foreign_keys
    )
    if not has_image_fk:
        op.create_foreign_key(
            "fk_exam_questions_image_resource_id_exam_resources",
            "exam_questions",
            "exam_resources",
            ["image_resource_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "exam_questions" not in table_names:
        return

    foreign_keys = inspector.get_foreign_keys("exam_questions")
    for fk in foreign_keys:
        if fk.get("name") == "fk_exam_questions_image_resource_id_exam_resources":
            op.drop_constraint("fk_exam_questions_image_resource_id_exam_resources", "exam_questions", type_="foreignkey")
            break
        if fk.get("referred_table") == "exam_resources" and fk.get("constrained_columns") == ["image_resource_id"]:
            if fk.get("name"):
                op.drop_constraint(fk["name"], "exam_questions", type_="foreignkey")
            break

    index_names = {index["name"] for index in inspector.get_indexes("exam_questions")}
    if "ix_exam_questions_image_resource_id" in index_names:
        op.drop_index("ix_exam_questions_image_resource_id", table_name="exam_questions")

    columns = {column["name"] for column in inspector.get_columns("exam_questions")}
    if "image_resource_id" in columns:
        op.drop_column("exam_questions", "image_resource_id")
