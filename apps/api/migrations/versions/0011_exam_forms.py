"""add exam form tables

Revision ID: 0011_exam_forms
Revises: 0010_problem_folders
Create Date: 2026-02-20 14:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0011_exam_forms"
down_revision: Union[str, Sequence[str], None] = "0010_problem_folders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "exams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("folder_id", sa.Integer(), sa.ForeignKey("problem_folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("exam_kind", sa.String(length=30), nullable=False, server_default="quiz"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="published"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_exams_id", "exams", ["id"], unique=False)
    op.create_index("ix_exams_folder_id", "exams", ["folder_id"], unique=False)

    op.create_table(
        "exam_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("exam_id", sa.Integer(), sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("prompt_md", sa.Text(), nullable=False),
        sa.Column("choices_json", sa.JSON(), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("exam_id", "order_index", name="uq_exam_questions_exam_order"),
    )
    op.create_index("ix_exam_questions_id", "exam_questions", ["id"], unique=False)
    op.create_index("ix_exam_questions_exam_id", "exam_questions", ["exam_id"], unique=False)

    op.create_table(
        "exam_submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("exam_id", sa.Integer(), sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="SUBMITTED"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("exam_id", "user_id", name="uq_exam_submissions_exam_user"),
    )
    op.create_index("ix_exam_submissions_id", "exam_submissions", ["id"], unique=False)
    op.create_index("ix_exam_submissions_exam_id", "exam_submissions", ["exam_id"], unique=False)
    op.create_index("ix_exam_submissions_user_id", "exam_submissions", ["user_id"], unique=False)
    op.create_index("ix_exam_submissions_reviewed_by_user_id", "exam_submissions", ["reviewed_by_user_id"], unique=False)

    op.create_table(
        "exam_answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "exam_submission_id",
            sa.Integer(),
            sa.ForeignKey("exam_submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("exam_question_id", sa.Integer(), sa.ForeignKey("exam_questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=True),
        sa.Column("selected_choice_index", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("exam_submission_id", "exam_question_id", name="uq_exam_answers_submission_question"),
    )
    op.create_index("ix_exam_answers_id", "exam_answers", ["id"], unique=False)
    op.create_index("ix_exam_answers_exam_submission_id", "exam_answers", ["exam_submission_id"], unique=False)
    op.create_index("ix_exam_answers_exam_question_id", "exam_answers", ["exam_question_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_exam_answers_exam_question_id", table_name="exam_answers")
    op.drop_index("ix_exam_answers_exam_submission_id", table_name="exam_answers")
    op.drop_index("ix_exam_answers_id", table_name="exam_answers")
    op.drop_table("exam_answers")

    op.drop_index("ix_exam_submissions_reviewed_by_user_id", table_name="exam_submissions")
    op.drop_index("ix_exam_submissions_user_id", table_name="exam_submissions")
    op.drop_index("ix_exam_submissions_exam_id", table_name="exam_submissions")
    op.drop_index("ix_exam_submissions_id", table_name="exam_submissions")
    op.drop_table("exam_submissions")

    op.drop_index("ix_exam_questions_exam_id", table_name="exam_questions")
    op.drop_index("ix_exam_questions_id", table_name="exam_questions")
    op.drop_table("exam_questions")

    op.drop_index("ix_exams_folder_id", table_name="exams")
    op.drop_index("ix_exams_id", table_name="exams")
    op.drop_table("exams")
