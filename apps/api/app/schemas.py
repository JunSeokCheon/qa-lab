from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class RegisterRequest(BaseModel):
    username: str
    name: str
    track_name: str
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    remember_me: bool = False


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    id: int
    username: str
    name: str
    track_name: str
    role: str
    created_at: datetime


class AdminUserSummary(BaseModel):
    id: int
    username: str
    name: str
    track_name: str
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
    actor_username: str | None = None
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


class ExamResourcePruneResponse(BaseModel):
    retention_days: int
    pruned_count: int
    pruned_bytes: int


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
    correct_choice_index: int | None = None
    correct_choice_indexes: list[int] | None = None
    answer_key_text: str | None = None
    image_resource_id: int | None = None
    image_resource_ids: list[int] | None = None


class ExamCreate(BaseModel):
    title: str
    description: str | None = None
    folder_id: int | None = None
    exam_kind: str = "quiz"
    target_track_name: str
    status: str = "published"
    starts_at: datetime | None = None
    duration_minutes: int | None = Field(default=60, ge=1, le=1440)
    questions: list[ExamQuestionCreate]


class ExamUpdate(BaseModel):
    title: str
    description: str | None = None
    folder_id: int | None = None
    exam_kind: str = "quiz"
    target_track_name: str
    status: str = "published"
    starts_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)


class ExamRepublish(BaseModel):
    title: str
    description: str | None = None
    folder_id: int | None = None
    exam_kind: str = "quiz"
    target_track_name: str
    status: str = "published"
    starts_at: datetime | None = None
    duration_minutes: int | None = Field(default=60, ge=1, le=1440)
    questions: list[ExamQuestionCreate]
    copy_resources: bool = True


class ExamQuestionSummary(BaseModel):
    id: int
    order_index: int
    type: str
    prompt_md: str
    required: bool
    multiple_select: bool = False
    choices: list[str] | None = None
    image_resource_id: int | None = None
    image_resource_ids: list[int] = Field(default_factory=list)


class ExamResourceSummary(BaseModel):
    id: int
    file_name: str
    content_type: str | None = None
    size_bytes: int
    created_at: datetime


class ExamQuestionImageUpdate(BaseModel):
    image_resource_id: int | None = None


class ExamQuestionImagesUpdate(BaseModel):
    image_resource_ids: list[int] = Field(default_factory=list)


class ExamDraftAnswer(BaseModel):
    question_id: int
    answer_text: str | None = None
    selected_choice_index: int | None = None
    selected_choice_indexes: list[int] | None = None


class ExamSummary(BaseModel):
    id: int
    title: str
    description: str | None = None
    folder_id: int | None = None
    folder_path: str | None = None
    exam_kind: str
    target_track_name: str | None = None
    status: str
    starts_at: datetime | None = None
    duration_minutes: int | None = None
    results_published: bool = False
    results_published_at: datetime | None = None
    question_count: int
    submitted: bool = False
    created_at: datetime
    updated_at: datetime


class ExamDetail(ExamSummary):
    attempt_started_at: datetime | None = None
    attempt_expires_at: datetime | None = None
    remaining_seconds: int | None = None
    draft_saved_at: datetime | None = None
    draft_answers: list[ExamDraftAnswer] = Field(default_factory=list)
    questions: list[ExamQuestionSummary]


class AdminExamQuestionSummary(ExamQuestionSummary):
    correct_choice_index: int | None = None
    correct_choice_indexes: list[int] = Field(default_factory=list)
    answer_key_text: str | None = None


class AdminExamDetail(ExamSummary):
    questions: list[AdminExamQuestionSummary]


class ExamAnswerInput(BaseModel):
    question_id: int
    answer_text: str | None = None
    selected_choice_index: int | None = None
    selected_choice_indexes: list[int] | None = None


class ExamSubmitRequest(BaseModel):
    answers: list[ExamAnswerInput]


class ExamDraftSaveRequest(BaseModel):
    answers: list[ExamAnswerInput]


class ExamDraftSaveResponse(BaseModel):
    exam_id: int
    saved_at: datetime | None = None
    answer_count: int


class ExamSubmitResponse(BaseModel):
    submission_id: int
    exam_id: int
    status: str
    submitted_at: datetime


class MeExamSubmissionAnswer(BaseModel):
    question_id: int
    question_order: int
    question_type: str
    prompt_md: str
    choices: list[str] | None = None
    image_resource_id: int | None = None
    image_resource_ids: list[int] = Field(default_factory=list)
    correct_choice_index: int | None = None
    correct_choice_indexes: list[int] = Field(default_factory=list)
    answer_key_text: str | None = None
    answer_text: str | None = None
    selected_choice_index: int | None = None
    selected_choice_indexes: list[int] = Field(default_factory=list)
    grading_status: str | None = None
    grading_score: int | None = None
    grading_max_score: int | None = None
    grading_feedback_json: dict[str, Any] | None = None
    graded_at: datetime | None = None


class MeExamSubmissionDetail(BaseModel):
    submission_id: int
    exam_id: int
    exam_title: str
    status: str
    submitted_at: datetime
    results_published: bool
    results_published_at: datetime | None = None
    answers: list[MeExamSubmissionAnswer]


class ExamSubmissionSummary(BaseModel):
    id: int
    exam_id: int
    exam_title: str
    exam_kind: str
    folder_path: str | None = None
    status: str
    submitted_at: datetime


class MeExamQuestionResult(BaseModel):
    question_id: int
    question_order: int
    question_type: str
    prompt_preview: str
    verdict: str
    skill_keywords: list[str] = Field(default_factory=list)


class MeExamResultSummary(BaseModel):
    submission_id: int
    exam_id: int
    exam_title: str
    exam_kind: str
    status: str
    submitted_at: datetime
    objective_total: int
    objective_answered: int
    objective_correct: int
    coding_total: int
    coding_graded: int
    coding_failed: int
    coding_pending: int
    coding_score: int | None = None
    coding_max_score: int | None = None
    has_subjective: bool
    grading_ready: bool
    results_published: bool
    results_published_at: datetime | None = None
    objective_pending: int = 0
    objective_incorrect: int = 0
    subjective_total: int = 0
    subjective_correct: int = 0
    subjective_incorrect: int = 0
    subjective_pending: int = 0
    coding_correct: int = 0
    coding_incorrect: int = 0
    coding_review_pending: int = 0
    overall_total: int = 0
    overall_correct: int = 0
    overall_incorrect: int = 0
    overall_pending: int = 0
    strong_skill_keywords: list[str] = Field(default_factory=list)
    weak_skill_keywords: list[str] = Field(default_factory=list)
    question_results: list[MeExamQuestionResult] = Field(default_factory=list)


class AdminExamResultPublishRequest(BaseModel):
    published: bool = True


class AdminExamSubmissionAnswer(BaseModel):
    question_id: int
    question_order: int
    question_type: str
    prompt_md: str
    choices: list[str] | None = None
    image_resource_id: int | None = None
    image_resource_ids: list[int] = Field(default_factory=list)
    correct_choice_index: int | None = None
    correct_choice_indexes: list[int] = Field(default_factory=list)
    answer_key_text: str | None = None
    answer_text: str | None = None
    selected_choice_index: int | None = None
    selected_choice_indexes: list[int] = Field(default_factory=list)
    grading_status: str | None = None
    grading_score: int | None = None
    grading_max_score: int | None = None
    grading_feedback_json: dict[str, Any] | None = None
    grading_logs: str | None = None
    graded_at: datetime | None = None


class AdminExamSubmissionDetail(BaseModel):
    submission_id: int
    exam_id: int
    exam_title: str
    user_id: int
    user_name: str
    username: str
    status: str
    submitted_at: datetime
    answers: list[AdminExamSubmissionAnswer]


class AdminGradingSubmissionSummary(BaseModel):
    submission_id: int
    exam_id: int
    exam_title: str
    exam_kind: str
    user_id: int
    user_name: str
    username: str
    status: str
    submitted_at: datetime
    coding_question_count: int
    coding_graded_count: int
    coding_failed_count: int
    coding_pending_count: int
    review_pending_count: int = 0
    has_review_pending: bool = False
    results_published: bool = False
    results_published_at: datetime | None = None
    results_publish_scope: str = "none"


class AdminGradingEnqueueRequest(BaseModel):
    force: bool = False


class AdminGradingEnqueueResponse(BaseModel):
    submission_id: int
    exam_id: int
    queued: bool
    status: str
    message: str


class AdminManualGradeRequest(BaseModel):
    is_correct: bool
    note: str | None = None


class AdminManualGradeResponse(BaseModel):
    submission_id: int
    exam_id: int
    question_id: int
    grading_status: str
    grading_score: int
    grading_max_score: int
    submission_status: str
    message: str


class AdminAppealRegradeRequest(BaseModel):
    question_id: int
    reason: str | None = None


class AdminAppealRegradeResponse(BaseModel):
    submission_id: int
    exam_id: int
    question_id: int
    queued: bool
    status: str
    message: str


class AdminSubmissionResultShareRequest(BaseModel):
    submission_ids: list[int]
    published: bool = True


class AdminSubmissionResultShareResponse(BaseModel):
    updated_count: int
    message: str
