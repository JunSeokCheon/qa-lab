from __future__ import annotations

from enum import StrEnum

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SubmissionStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    GRADED = "GRADED"
    FAILED = "FAILED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="user")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    submissions: Mapped[list["Submission"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class Problem(Base):
    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

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
    bundle_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bundle_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bundle_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    problem: Mapped["Problem"] = relationship(back_populates="versions")
    skill_weights: Mapped[list["ProblemVersionSkill"]] = relationship(
        back_populates="problem_version", cascade="all, delete-orphan"
    )
    submissions: Mapped[list["Submission"]] = relationship(back_populates="problem_version", cascade="all, delete-orphan")


class ProblemVersionSkill(Base):
    __tablename__ = "problem_version_skills"

    problem_version_id: Mapped[int] = mapped_column(
        ForeignKey("problem_versions.id", ondelete="CASCADE"), primary_key=True
    )
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True)
    weight: Mapped[int] = mapped_column(Integer, nullable=False)

    problem_version: Mapped["ProblemVersion"] = relationship(back_populates="skill_weights")
    skill: Mapped["Skill"] = relationship()


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    problem_version_id: Mapped[int] = mapped_column(
        ForeignKey("problem_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_text: Mapped[str] = mapped_column(Text, nullable=False)
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
