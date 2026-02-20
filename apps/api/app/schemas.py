from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: int
    username: str
    role: str
    created_at: datetime


class PasswordForgotRequest(BaseModel):
    username: str


class PasswordForgotResponse(BaseModel):
    message: str
    reset_token: str | None = None


class PasswordResetRequest(BaseModel):
    token: str
    new_password: str


class PasswordResetResponse(BaseModel):
    message: str


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


class ProblemFolderCreate(BaseModel):
    name: str
    slug: str | None = None
    parent_id: int | None = None
    sort_order: int = 0


class ProblemFolderResponse(BaseModel):
    id: int
    name: str
    slug: str
    parent_id: int | None = None
    sort_order: int
    path: str


class WatchdogRequeueResponse(BaseModel):
    status: str
    stale_seconds: int
    scanned_running: int
    requeued_count: int
    requeued_submission_ids: list[int]


class AdminAuditLogResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    action: str
    resource_type: str
    resource_id: str | None = None
    method: str
    path: str
    request_id: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    metadata_json: dict[str, Any] | None = None
    created_at: datetime


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
    rubric_version: int


class RubricHistoryResponse(BaseModel):
    id: int
    problem_version_id: int
    rubric_version: int
    rubric_sha256: str
    bundle_key: str | None = None
    created_at: datetime


class ProgressTrendPoint(BaseModel):
    captured_at: datetime
    mastery: float


class ProgressTrendItem(BaseModel):
    skill_id: int
    skill_name: str
    points: list[ProgressTrendPoint]


class ExamQuestionCreate(BaseModel):
    type: str
    prompt_md: str
    required: bool = True
    choices: list[str] | None = None


class ExamCreate(BaseModel):
    title: str
    description: str | None = None
    folder_id: int | None = None
    exam_kind: str = "quiz"
    status: str = "published"
    questions: list[ExamQuestionCreate]


class ExamQuestionSummary(BaseModel):
    id: int
    order_index: int
    type: str
    prompt_md: str
    required: bool
    choices: list[str] | None = None


class ExamSummary(BaseModel):
    id: int
    title: str
    description: str | None = None
    folder_id: int | None = None
    folder_path: str | None = None
    exam_kind: str
    status: str
    question_count: int
    submitted: bool = False
    created_at: datetime
    updated_at: datetime


class ExamDetail(ExamSummary):
    questions: list[ExamQuestionSummary]


class ExamAnswerInput(BaseModel):
    question_id: int
    answer_text: str | None = None
    selected_choice_index: int | None = None


class ExamSubmitRequest(BaseModel):
    answers: list[ExamAnswerInput]


class ExamSubmitResponse(BaseModel):
    submission_id: int
    exam_id: int
    status: str
    submitted_at: datetime


class ExamSubmissionSummary(BaseModel):
    id: int
    exam_id: int
    exam_title: str
    exam_kind: str
    folder_path: str | None = None
    status: str
    submitted_at: datetime


class AdminExamSubmissionAnswer(BaseModel):
    question_id: int
    question_order: int
    question_type: str
    prompt_md: str
    answer_text: str | None = None
    selected_choice_index: int | None = None


class AdminExamSubmissionDetail(BaseModel):
    submission_id: int
    exam_id: int
    exam_title: str
    user_id: int
    username: str
    status: str
    submitted_at: datetime
    answers: list[AdminExamSubmissionAnswer]
