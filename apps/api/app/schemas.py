from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: int
    email: EmailStr
    role: str
    created_at: datetime


class SkillCreate(BaseModel):
    name: str
    description: str | None = None


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class SkillResponse(BaseModel):
    id: int
    name: str
    description: str | None = None


class ProblemCreate(BaseModel):
    title: str


class ProblemResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime


class ProblemVersionSkillInput(BaseModel):
    skill_id: int
    weight: int


class ProblemVersionCreate(BaseModel):
    type: str
    difficulty: str
    max_score: int
    statement_md: str
    skills: list[ProblemVersionSkillInput] = []


class ProblemVersionSkillResponse(BaseModel):
    skill_id: int
    skill_name: str
    weight: int


class ProblemVersionSummary(BaseModel):
    id: int
    version: int
    type: str
    difficulty: str
    max_score: int
    bundle_key: str | None = None
    created_at: datetime


class ProblemVersionDetail(ProblemVersionSummary):
    statement_md: str
    bundle_sha256: str | None = None
    bundle_size: int | None = None
    skills: list[ProblemVersionSkillResponse]


class ProblemListItem(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime
    latest_version: ProblemVersionSummary | None = None


class ProblemDetail(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime
    latest_version: ProblemVersionDetail | None = None


class SubmissionCreate(BaseModel):
    problem_version_id: int
    code_text: str


class RunPublicRequest(BaseModel):
    code_text: str
    problem_version: int | None = None


class PublicFeedback(BaseModel):
    passed: int
    total: int
    failed_cases: list[dict[str, str]]


class RunPublicSummary(BaseModel):
    problem_version: int
    docker_exit_code: int
    duration_ms: int
    stdout: str
    stderr: str


class RunPublicResponse(BaseModel):
    status: str
    summary: RunPublicSummary
    public_feedback: PublicFeedback


class GradeResponse(BaseModel):
    id: int
    submission_id: int
    score: int
    max_score: int
    feedback_json: dict[str, Any]
    created_at: datetime


class GradeRunResponse(BaseModel):
    id: int
    submission_id: int
    grader_image_tag: str
    started_at: datetime
    finished_at: datetime
    score: int | None = None
    feedback_json: dict[str, Any] | None = None
    exit_code: int
    logs: str | None = None
    created_at: datetime


class SubmissionResponse(BaseModel):
    id: int
    user_id: int
    problem_version_id: int
    code_text: str
    status: str
    created_at: datetime
    grade: GradeResponse | None = None


class AdminSubmissionDetailResponse(SubmissionResponse):
    grade_runs: list[GradeRunResponse]


class RegradeResponse(BaseModel):
    status: str
    submission_id: int
    message: str


class ProgressSkillItem(BaseModel):
    skill_id: int
    skill_name: str
    earned_points: float
    possible_points: float
    mastery: float


class ProgressRecentSubmission(BaseModel):
    submission_id: int
    problem_id: int
    problem_title: str
    problem_version: int
    status: str
    created_at: datetime
    score: int | None = None
    max_score: int | None = None


class MeProgressResponse(BaseModel):
    skills: list[ProgressSkillItem]
    recent_submissions: list[ProgressRecentSubmission]


class BundleUploadResponse(BaseModel):
    problem_version_id: int
    bundle_key: str
    bundle_sha256: str
    bundle_size: int
