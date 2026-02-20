from __future__ import annotations

from enum import StrEnum

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SubmissionStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    GRADED = "GRADED"
    FAILED = "FAILED"


class ProblemVersionStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    track_name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="user")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    submissions: Mapped[list["Submission"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    exam_submissions: Mapped[list["ExamSubmission"]] = relationship(
        "ExamSubmission",
        foreign_keys="ExamSubmission.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProblemFolder(Base):
    __tablename__ = "problem_folders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("problem_folders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    parent: Mapped["ProblemFolder | None"] = relationship(
        "ProblemFolder",
        remote_side=[id],
        back_populates="children",
    )
    children: Mapped[list["ProblemFolder"]] = relationship(
        "ProblemFolder",
        back_populates="parent",
        cascade="all, delete-orphan",
    )
    problems: Mapped[list["Problem"]] = relationship(back_populates="folder")
    exams: Mapped[list["Exam"]] = relationship(back_populates="folder")


class Problem(Base):
    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("problem_folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    folder: Mapped["ProblemFolder | None"] = relationship(back_populates="problems")
    versions: Mapped[list["ProblemVersion"]] = relationship(back_populates="problem", cascade="all, delete-orphan")


class ProblemVersion(Base):
    __tablename__ = "problem_versions"
    __table_args__ = (UniqueConstraint("problem_id", "version", name="uq_problem_versions_problem_id_version"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(50), nullable=False)
    max_score: Mapped[int] = mapped_column(Integer, nullable=False)
    statement_md: Mapped[str] = mapped_column(Text, nullable=False)
    question_meta_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ProblemVersionStatus.DRAFT.value)
    rubric_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    bundle_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bundle_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bundle_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    problem: Mapped["Problem"] = relationship(back_populates="versions")
    skill_weights: Mapped[list["ProblemVersionSkill"]] = relationship(
        back_populates="problem_version", cascade="all, delete-orphan"
    )
    submissions: Mapped[list["Submission"]] = relationship(back_populates="problem_version", cascade="all, delete-orphan")
    rubric_history: Mapped[list["RubricHistory"]] = relationship(
        back_populates="problem_version", cascade="all, delete-orphan", order_by="RubricHistory.id.desc()"
    )


class ProblemVersionSkill(Base):
    __tablename__ = "problem_version_skills"

    problem_version_id: Mapped[int] = mapped_column(
        ForeignKey("problem_versions.id", ondelete="CASCADE"), primary_key=True
    )
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True)
    weight: Mapped[int] = mapped_column(Integer, nullable=False)

    problem_version: Mapped["ProblemVersion"] = relationship(back_populates="skill_weights")
    skill: Mapped["Skill"] = relationship()


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("problem_folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    exam_kind: Mapped[str] = mapped_column(String(30), nullable=False, default="quiz")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="published")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    folder: Mapped["ProblemFolder | None"] = relationship(back_populates="exams")
    questions: Mapped[list["ExamQuestion"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="ExamQuestion.order_index.asc()"
    )
    resources: Mapped[list["ExamResource"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="ExamResource.id.desc()"
    )
    submissions: Mapped[list["ExamSubmission"]] = relationship(back_populates="exam", cascade="all, delete-orphan")


class ExamQuestion(Base):
    __tablename__ = "exam_questions"
    __table_args__ = (UniqueConstraint("exam_id", "order_index", name="uq_exam_questions_exam_order"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    prompt_md: Mapped[str] = mapped_column(Text, nullable=False)
    choices_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    correct_choice_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    exam: Mapped["Exam"] = relationship(back_populates="questions")
    answers: Mapped[list["ExamAnswer"]] = relationship(back_populates="question")


class ExamResource(Base):
    __tablename__ = "exam_resources"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    exam: Mapped["Exam"] = relationship(back_populates="resources")


class ExamSubmission(Base):
    __tablename__ = "exam_submissions"
    __table_args__ = (UniqueConstraint("exam_id", "user_id", name="uq_exam_submissions_exam_user"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SUBMITTED")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reviewed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    exam: Mapped["Exam"] = relationship(back_populates="submissions")
    user: Mapped["User"] = relationship(foreign_keys=[user_id], back_populates="exam_submissions")
    reviewed_by: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by_user_id])
    answers: Mapped[list["ExamAnswer"]] = relationship(back_populates="submission", cascade="all, delete-orphan")


class ExamAnswer(Base):
    __tablename__ = "exam_answers"
    __table_args__ = (UniqueConstraint("exam_submission_id", "exam_question_id", name="uq_exam_answers_submission_question"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    exam_submission_id: Mapped[int] = mapped_column(
        ForeignKey("exam_submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exam_question_id: Mapped[int] = mapped_column(
        ForeignKey("exam_questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_choice_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grading_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    grading_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grading_max_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grading_feedback_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    grading_logs: Mapped[str | None] = mapped_column(Text, nullable=True)
    graded_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    submission: Mapped["ExamSubmission"] = relationship(back_populates="answers")
    question: Mapped["ExamQuestion"] = relationship(back_populates="answers")


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    problem_version_id: Mapped[int] = mapped_column(
        ForeignKey("problem_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_text: Mapped[str] = mapped_column(Text, nullable=False)
    bundle_key_snapshot: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bundle_sha256_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rubric_version_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=SubmissionStatus.QUEUED.value)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped["User"] = relationship(back_populates="submissions")
    problem_version: Mapped["ProblemVersion"] = relationship(back_populates="submissions")
    grade: Mapped["Grade | None"] = relationship(
        back_populates="submission", uselist=False, cascade="all, delete-orphan"
    )
    grade_runs: Mapped[list["GradeRun"]] = relationship(
        back_populates="submission", cascade="all, delete-orphan", order_by="GradeRun.id.desc()"
    )


class Grade(Base):
    __tablename__ = "grades"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    max_score: Mapped[int] = mapped_column(Integer, nullable=False)
    feedback_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    submission: Mapped["Submission"] = relationship(back_populates="grade")


class GradeRun(Base):
    __tablename__ = "grade_runs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    grader_image_tag: Mapped[str] = mapped_column(String(255), nullable=False)
    started_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    exit_code: Mapped[int] = mapped_column(Integer, nullable=False)
    logs: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    submission: Mapped["Submission"] = relationship(back_populates="grade_runs")


class RubricHistory(Base):
    __tablename__ = "rubric_histories"
    __table_args__ = (
        UniqueConstraint("problem_version_id", "rubric_version", name="uq_rubric_histories_version"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    problem_version_id: Mapped[int] = mapped_column(
        ForeignKey("problem_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rubric_version: Mapped[int] = mapped_column(Integer, nullable=False)
    rubric_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    rubric_yaml: Mapped[str] = mapped_column(Text, nullable=False)
    bundle_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    problem_version: Mapped["ProblemVersion"] = relationship(back_populates="rubric_history")


class MasterySnapshot(Base):
    __tablename__ = "mastery_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True)
    mastery: Mapped[float] = mapped_column(nullable=False)
    earned_points: Mapped[float] = mapped_column(nullable=False)
    possible_points: Mapped[float] = mapped_column(nullable=False)
    captured_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(100), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
