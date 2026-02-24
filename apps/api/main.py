from __future__ import annotations

import hashlib
import re
import shutil
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Annotated, Any
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    APP_ENV,
    ALLOWED_ORIGINS,
    GRADING_STUCK_TIMEOUT_SECONDS,
    LOGIN_RATE_LIMIT_ATTEMPTS,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    EXAM_RESOURCE_MAX_SIZE_BYTES,
    EXAM_RESOURCE_RETENTION_BATCH_LIMIT,
    EXAM_RESOURCE_RETENTION_DAYS,
    EXAM_RESOURCE_ROOT,
    access_token_ttl,
    password_reset_token_ttl,
)
from app.db import check_db_connection, get_async_session
from app.deps import get_current_user, require_admin
from app.models import (
    AdminAuditLog,
    Exam,
    ExamAttempt,
    ExamAnswer,
    ExamQuestion,
    ExamResource,
    ExamSubmission,
    Grade,
    GradeRun,
    MasterySnapshot,
    PasswordResetToken,
    Problem,
    ProblemFolder,
    ProblemVersion,
    ProblemVersionSkill,
    Skill,
    Submission,
    User,
)
from app.observability import get_logger, log_event
from app.queue import check_redis_connection, clear_rate_limit, grading_queue, increment_rate_limit
from app.schemas import (
    AdminAppealRegradeRequest,
    AdminAppealRegradeResponse,
    AdminAuditLogResponse,
    AdminExamDetail,
    AdminGradingEnqueueRequest,
    AdminGradingEnqueueResponse,
    AdminManualGradeRequest,
    AdminManualGradeResponse,
    AdminGradingSubmissionSummary,
    AdminExamQuestionSummary,
    AdminExamSubmissionDetail,
    AdminExamSubmissionAnswer,
    AdminExamResultPublishRequest,
    AdminSubmissionResultShareRequest,
    AdminSubmissionResultShareResponse,
    AdminUserSummary,
    AuthTokenResponse,
    ExamCreate,
    ExamRepublish,
    ExamUpdate,
    ExamDetail,
    ExamQuestionSummary,
    ExamResourceSummary,
    ExamResourcePruneResponse,
    ExamSubmitRequest,
    ExamSubmitResponse,
    ExamSubmissionSummary,
    ExamSummary,
    LoginRequest,
    PasswordForgotRequest,
    PasswordForgotResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    MeProgressResponse,
    MeExamQuestionResult,
    MeExamResultSummary,
    MeExamSubmissionAnswer,
    MeExamSubmissionDetail,
    MeResponse,
    ProblemFolderCreate,
    ProblemFolderResponse,
    ProgressRecentSubmission,
    ProgressSkillItem,
    ProgressTrendItem,
    ProgressTrendPoint,
    RegisterRequest,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
    WatchdogRequeueResponse,
)
from app.security import create_access_token, hash_password, verify_password
from app.worker_tasks import requeue_stale_running_submissions

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
logger = get_logger()

_login_attempts: defaultdict[str, deque[float]] = defaultdict(deque)
_login_rate_lock = Lock()
_EXAM_QUESTION_TYPE_ALIASES = {
    "multiple_choice": "multiple_choice",
    "objective": "multiple_choice",
    "mcq": "multiple_choice",
    "subjective": "subjective",
    "short_answer": "subjective",
    "coding": "coding",
    "code": "coding",
}
_EXAM_KIND_ALIASES = {
    "quiz": "quiz",
    "퀴즈": "quiz",
    "assessment": "assessment",
    "성취도평가": "assessment",
    "성취도 평가": "assessment",
}
_TRACK_OPTIONS = {
    "데이터 분석 11기",
    "QAQC 4기",
}
_APPEAL_REGRADING_MODEL = "gpt-5-mini"
_EXAM_SKILL_KEYWORD_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "판다스",
        (
            "pandas",
            "pd.",
            "read_csv",
            "dataframe",
            "concat",
            "merge",
            "drop_duplicates",
            "fillna",
            "groupby",
            "pivot",
            "iloc",
            "loc",
        ),
    ),
    (
        "통계",
        (
            "p-value",
            "가설",
            "검정",
            "정규성",
            "분산",
            "anova",
            "mann-whitney",
            "chi",
            "t-test",
            "통계",
        ),
    ),
    (
        "시각화",
        (
            "시각화",
            "그래프",
            "plot",
            "matplotlib",
            "seaborn",
            "bar",
            "line",
            "scatter",
            "hist",
        ),
    ),
    (
        "머신러닝",
        (
            "train",
            "validation",
            "test set",
            "모델",
            "과적합",
            "예측",
            "회귀",
            "분류",
            "feature",
            "loss",
        ),
    ),
    (
        "파이썬 기초",
        (
            "python",
            "파이썬",
            "def ",
            "for ",
            "while ",
            "list",
            "dict",
            "set",
            "len(",
        ),
    ),
)


def _is_login_rate_limited(client_key: str) -> bool:
    redis_key = f"auth:login-attempts:{client_key}"
    redis_count = increment_rate_limit(redis_key, LOGIN_RATE_LIMIT_WINDOW_SECONDS)
    if redis_count >= 0:
        return redis_count > LOGIN_RATE_LIMIT_ATTEMPTS

    now = time.time()
    with _login_rate_lock:
        attempts = _login_attempts[client_key]
        while attempts and now - attempts[0] > LOGIN_RATE_LIMIT_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= LOGIN_RATE_LIMIT_ATTEMPTS:
            return True
        attempts.append(now)
        return False


def _reset_login_attempts(client_key: str) -> None:
    clear_rate_limit(f"auth:login-attempts:{client_key}")
    with _login_rate_lock:
        _login_attempts.pop(client_key, None)

def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or f"folder-{uuid4().hex[:8]}"

def _normalize_exam_question_type(raw_type: str) -> str:
    normalized = _EXAM_QUESTION_TYPE_ALIASES.get(raw_type.strip().lower())
    if normalized is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="지원하지 않는 문항 유형입니다. multiple_choice, subjective, coding 중에서 선택하세요.",
        )
    return normalized


def _normalize_exam_kind(raw_kind: str) -> str:
    normalized = _EXAM_KIND_ALIASES.get(raw_kind.strip().lower())
    if normalized is not None:
        return normalized
    cleaned = raw_kind.strip().lower()
    if cleaned in {"quiz", "assessment"}:
        return cleaned
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="시험 유형은 quiz(퀴즈) 또는 assessment(성취도 평가)만 가능합니다.",
    )


def _sanitize_exam_status(raw_status: str) -> str:
    status_value = raw_status.strip().lower()
    if status_value not in {"draft", "published"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시험 상태는 draft 또는 published만 가능합니다.")
    return status_value


def _sanitize_exam_target_track_name(raw_track_name: str) -> str:
    track_name = raw_track_name.strip()
    if track_name not in _TRACK_OPTIONS:
        options = ", ".join(sorted(_TRACK_OPTIONS))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"시험 대상 반은 다음 중 하나여야 합니다: {options}",
        )
    return track_name


def _sanitize_exam_duration_minutes(duration_minutes: int | None) -> int | None:
    if duration_minutes is None:
        return None
    if duration_minutes < 1 or duration_minutes > 1440:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="시험 시간은 1분 이상 1440분 이하로 설정해 주세요.",
        )
    return int(duration_minutes)


def _can_user_access_exam(exam: Exam, user: User) -> bool:
    if user.role == "admin":
        return True
    if exam.status != "published":
        return False
    return exam.target_track_name == user.track_name


def _sanitize_exam_question_choices(question_type: str, choices: list[str] | None) -> list[str] | None:
    if question_type != "multiple_choice":
        return None
    normalized_choices = [choice.strip() for choice in (choices or []) if choice.strip()]
    if len(normalized_choices) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="객관식 문항은 선택지 2개 이상이 필요합니다.")
    return normalized_choices


def _sanitize_exam_correct_choice_index(
    question_type: str, choices: list[str] | None, correct_choice_index: int | None
) -> int | None:
    if question_type != "multiple_choice":
        return None
    if correct_choice_index is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="객관식 문항은 정답 번호가 필요합니다.")
    choice_count = len(choices or [])
    if correct_choice_index < 0 or correct_choice_index >= choice_count:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="객관식 정답 번호가 선택지 범위를 벗어났습니다.")
    return correct_choice_index


def _sanitize_exam_answer_key_text(question_type: str, answer_key_text: str | None) -> str | None:
    if question_type == "multiple_choice":
        return None
    if answer_key_text is None:
        return None
    normalized = answer_key_text.strip()
    return normalized or None


async def _load_folder_path_map(session: AsyncSession) -> dict[int, str]:
    rows = (await session.execute(select(ProblemFolder).order_by(ProblemFolder.sort_order.asc(), ProblemFolder.id.asc()))).scalars().all()
    by_id = {folder.id: folder for folder in rows}
    cache: dict[int, str] = {}

    def build(folder_id: int) -> str:
        cached = cache.get(folder_id)
        if cached is not None:
            return cached
        folder = by_id.get(folder_id)
        if folder is None:
            return ""
        if folder.parent_id is None:
            path = folder.name
        else:
            parent_path = build(folder.parent_id)
            path = f"{parent_path} > {folder.name}" if parent_path else folder.name
        cache[folder_id] = path
        return path

    for folder_id in by_id:
        build(folder_id)
    return cache


def _to_problem_folder_response(folder: ProblemFolder, path_map: dict[int, str]) -> ProblemFolderResponse:
    return ProblemFolderResponse(
        id=folder.id,
        name=folder.name,
        slug=folder.slug,
        parent_id=folder.parent_id,
        sort_order=folder.sort_order,
        path=path_map.get(folder.id, folder.name),
    )


def _to_exam_question_summary(question: ExamQuestion) -> ExamQuestionSummary:
    return ExamQuestionSummary(
        id=question.id,
        order_index=question.order_index,
        type=question.type,
        prompt_md=question.prompt_md,
        required=question.required,
        choices=list(question.choices_json or []) if question.choices_json is not None else None,
    )


def _to_admin_exam_question_summary(question: ExamQuestion) -> AdminExamQuestionSummary:
    return AdminExamQuestionSummary(
        **_to_exam_question_summary(question).model_dump(),
        correct_choice_index=question.correct_choice_index,
        answer_key_text=question.answer_key_text,
    )


def _to_exam_resource_summary(resource: ExamResource) -> ExamResourceSummary:
    return ExamResourceSummary(
        id=resource.id,
        file_name=resource.file_name,
        content_type=resource.content_type,
        size_bytes=resource.size_bytes,
        created_at=resource.created_at,
    )


def _resolve_exam_resource_path(exam_id: int, stored_name: str) -> Path:
    root = Path(EXAM_RESOURCE_ROOT).resolve()
    path = (root / str(exam_id) / stored_name).resolve()
    if root not in path.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="잘못된 리소스 경로입니다.")
    return path


async def _prune_expired_exam_resources(
    session: AsyncSession,
    *,
    retention_days: int,
    batch_limit: int = EXAM_RESOURCE_RETENTION_BATCH_LIMIT,
) -> tuple[int, int]:
    if retention_days <= 0:
        return 0, 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    pruned_count = 0
    pruned_bytes = 0

    while True:
        expired = (
            await session.execute(
                select(ExamResource)
                .where(ExamResource.created_at < cutoff)
                .order_by(ExamResource.id.asc())
                .limit(batch_limit)
            )
        ).scalars().all()

        if not expired:
            break

        for resource in expired:
            path = _resolve_exam_resource_path(resource.exam_id, resource.stored_name)
            if path.is_file():
                path.unlink(missing_ok=True)
            pruned_count += 1
            pruned_bytes += int(resource.size_bytes or 0)
            await session.delete(resource)

    return pruned_count, pruned_bytes


def _to_exam_summary(
    exam: Exam,
    *,
    folder_path_map: dict[int, str],
    question_count: int,
    submitted: bool,
) -> ExamSummary:
    return ExamSummary(
        id=exam.id,
        title=exam.title,
        description=exam.description,
        folder_id=exam.folder_id,
        folder_path=folder_path_map.get(exam.folder_id) if exam.folder_id is not None else None,
        exam_kind=exam.exam_kind,
        target_track_name=exam.target_track_name,
        status=exam.status,
        duration_minutes=exam.duration_minutes,
        results_published=bool(exam.results_published),
        results_published_at=exam.results_published_at,
        question_count=question_count,
        submitted=submitted,
        created_at=exam.created_at,
        updated_at=exam.updated_at,
    )


def _resolve_submission_result_visibility(
    exam: Exam, submission: ExamSubmission
) -> tuple[bool, datetime | None, str]:
    if bool(exam.results_published):
        return True, exam.results_published_at, "exam"
    if bool(submission.results_published):
        return True, submission.results_published_at, "submission"
    return False, None, "none"


def _feedback_bool(feedback_json: dict[str, Any] | None, key: str) -> bool:
    if not isinstance(feedback_json, dict):
        return False
    value = feedback_json.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "y"}
    if isinstance(value, (int, float)):
        return bool(value)
    return False


def _resolve_me_question_verdict(answer: ExamAnswer, question: ExamQuestion) -> str:
    if question.type == "multiple_choice":
        if question.correct_choice_index is None or answer.selected_choice_index is None:
            return "pending"
        if answer.selected_choice_index == question.correct_choice_index:
            return "correct"
        return "incorrect"

    if answer.grading_status not in {"GRADED", "FAILED"}:
        return "pending"

    feedback = answer.grading_feedback_json if isinstance(answer.grading_feedback_json, dict) else None
    if _feedback_bool(feedback, "needs_review"):
        return "review_pending"

    if feedback and isinstance(feedback.get("verdict"), str):
        verdict = str(feedback.get("verdict")).strip().upper()
        if verdict == "CORRECT":
            return "correct"
        if verdict == "INCORRECT":
            return "incorrect"

    if (
        answer.grading_score is not None
        and answer.grading_max_score is not None
        and answer.grading_max_score > 0
    ):
        return "correct" if answer.grading_score == answer.grading_max_score else "incorrect"

    return "incorrect" if answer.grading_status == "FAILED" else "pending"


def _build_prompt_preview(prompt_md: str, max_chars: int = 96) -> str:
    compact = re.sub(r"\s+", " ", (prompt_md or "").strip())
    if len(compact) <= max_chars:
        return compact
    return f"{compact[:max_chars].rstrip()}..."


def _extract_question_skill_keywords(question: ExamQuestion) -> list[str]:
    base_text = f"{question.prompt_md or ''}\n{question.answer_key_text or ''}".lower()
    matched: list[str] = []
    for label, tokens in _EXAM_SKILL_KEYWORD_RULES:
        if any(token in base_text for token in tokens):
            matched.append(label)

    if matched:
        return matched
    if question.type == "coding":
        return ["코딩 구현"]
    if question.type == "subjective":
        return ["주관식 개념"]
    return ["객관식 개념"]


def _compute_submission_skill_keywords(question_results: list[MeExamQuestionResult]) -> tuple[list[str], list[str]]:
    stats: defaultdict[str, dict[str, int]] = defaultdict(lambda: {"correct": 0, "incorrect": 0})
    for item in question_results:
        if item.verdict not in {"correct", "incorrect"}:
            continue
        for keyword in item.skill_keywords:
            if item.verdict == "correct":
                stats[keyword]["correct"] += 1
            else:
                stats[keyword]["incorrect"] += 1

    if not stats:
        return [], []

    scored: list[tuple[str, float, int, int]] = []
    for keyword, stat in stats.items():
        total = stat["correct"] + stat["incorrect"]
        if total == 0:
            continue
        mastery = stat["correct"] / total
        scored.append((keyword, mastery, stat["correct"], total))

    if not scored:
        return [], []

    strong = [
        keyword
        for keyword, mastery, correct, _total in sorted(scored, key=lambda row: (-row[1], -row[2], row[0]))
        if mastery >= 0.7 and correct > 0
    ][:3]
    weak = [
        keyword
        for keyword, mastery, _correct, total in sorted(scored, key=lambda row: (row[1], -row[3], row[0]))
        if mastery <= 0.4 and total > 0
    ][:3]
    return strong, weak

def _request_context(request: Request) -> dict[str, str | None]:
    return {
        "method": request.method,
        "path": request.url.path,
        "request_id": getattr(request.state, "request_id", None),
        "client_ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


def _append_appeal_feedback(
    feedback_json: dict[str, Any] | None,
    *,
    actor_user_id: int,
    question_id: int,
    reason: str | None,
    model_override: str | None,
    previous_status: str | None,
    previous_score: int | None,
) -> dict[str, Any]:
    feedback = dict(feedback_json or {})
    appeals_raw = feedback.get("appeals")
    appeals: list[dict[str, Any]]
    if isinstance(appeals_raw, list):
        appeals = [item for item in appeals_raw if isinstance(item, dict)]
    else:
        appeals = []

    appeals.append(
        {
            "requested_at": datetime.now(timezone.utc).isoformat(),
            "requested_by_user_id": actor_user_id,
            "question_id": question_id,
            "reason": (reason.strip() if reason else None),
            "model_override": (model_override.strip() if model_override else None),
            "previous_status": previous_status,
            "previous_score": previous_score,
        }
    )
    feedback["appeals"] = appeals[-20:]
    feedback["appeal_pending"] = True
    feedback["needs_review"] = True
    feedback["review_reason_code"] = "appeal_pending"
    feedback["review_reason_ko"] = "이의제기 재채점 요청이 있어 최종 검토가 필요합니다."
    feedback["verdict"] = "AMBIGUOUS"
    return feedback


def _feedback_needs_review(feedback_json: dict[str, Any] | None) -> bool:
    if not isinstance(feedback_json, dict):
        return False
    value = feedback_json.get("needs_review")
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "y"}
    if isinstance(value, (int, float)):
        return bool(value)
    return False


async def _load_submission_review_pending_counts(
    session: AsyncSession,
    submission_ids: list[int],
) -> dict[int, int]:
    if not submission_ids:
        return {}

    rows = (
        await session.execute(
            select(
                ExamAnswer.exam_submission_id,
                ExamAnswer.grading_feedback_json,
                ExamQuestion.type,
                ExamQuestion.answer_key_text,
            )
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(ExamAnswer.exam_submission_id.in_(submission_ids))
        )
    ).all()

    counts: defaultdict[int, int] = defaultdict(int)
    for submission_id, feedback_json, question_type, answer_key_text in rows:
        if question_type not in {"subjective", "coding"}:
            continue
        if not bool((answer_key_text or "").strip()):
            continue
        if _feedback_needs_review(feedback_json):
            counts[int(submission_id)] += 1
    return dict(counts)


async def _write_admin_audit_log(
    session: AsyncSession,
    request: Request,
    actor_user_id: int | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    ctx = _request_context(request)
    session.add(
        AdminAuditLog(
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            method=ctx["method"] or "UNKNOWN",
            path=ctx["path"] or "",
            request_id=ctx["request_id"],
            client_ip=ctx["client_ip"],
            user_agent=ctx["user_agent"],
            metadata_json=metadata,
        )
    )


@app.middleware("http")
async def add_request_id_and_logging(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid4().hex
    request.state.request_id = request_id
    started_at = time.monotonic()
    response = None

    try:
        response = await call_next(request)
        return response
    finally:
        duration_ms = int((time.monotonic() - started_at) * 1000)
        if response is not None:
            response.headers["X-Request-ID"] = request_id
            status_code = response.status_code
        else:
            status_code = 500
        log_event(
            logger,
            "request.completed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=status_code,
            duration_ms=duration_ms,
            client=(request.client.host if request.client else "unknown"),
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
async def health_db() -> JSONResponse:
    ok = await check_db_connection()
    if ok:
        return JSONResponse(content={"db": "ok"}, status_code=status.HTTP_200_OK)
    return JSONResponse(content={"db": "error"}, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)


@app.get("/health/redis")
def health_redis() -> JSONResponse:
    ok = check_redis_connection()
    if ok:
        return JSONResponse(content={"redis": "ok"}, status_code=status.HTTP_200_OK)
    return JSONResponse(content={"redis": "error"}, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)


@app.post("/auth/login", response_model=AuthTokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AuthTokenResponse:
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="아이디를 입력해 주세요.")
    client_host = request.client.host if request.client else "unknown"
    client_key = f"{client_host}:{username.lower()}"
    if _is_login_rate_limited(client_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        )

    result = await session.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="아이디 또는 비밀번호가 올바르지 않습니다.")

    _reset_login_attempts(client_key)
    token = create_access_token(
        subject=user.username,
        role=user.role,
        expires_delta=access_token_ttl(remember_me=payload.remember_me),
    )
    return AuthTokenResponse(access_token=token, token_type="bearer")


@app.post("/auth/logout")
def logout() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/register", response_model=MeResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> MeResponse:
    username = payload.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username must be at least 3 characters")
    if len(username) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username must be 50 characters or fewer")

    existing = await session.scalar(select(User).where(User.username == username))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already in use")
    display_name = payload.name.strip()
    if len(display_name) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name must be at least 2 characters")
    if len(display_name) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name must be 100 characters or fewer")
    track_name = payload.track_name.strip()
    if track_name not in _TRACK_OPTIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Track must be one of: 데이터 분석 11기, QAQC 4기",
        )
    if len(payload.password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")

    user = User(
        username=username,
        display_name=display_name,
        track_name=track_name,
        password_hash=hash_password(payload.password),
        role="user",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return MeResponse(
        id=user.id,
        username=user.username,
        name=user.display_name,
        track_name=user.track_name,
        role=user.role,
        created_at=user.created_at,
    )


@app.post("/auth/password/forgot", response_model=PasswordForgotResponse)
async def forgot_password(
    payload: PasswordForgotRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PasswordForgotResponse:
    username = payload.username.strip()
    user = await session.scalar(select(User).where(User.username == username))
    if user is None:
        return PasswordForgotResponse(message="입력한 계정이 존재하면 재설정 안내가 전송됩니다.")

    raw_token = uuid4().hex
    expires_at = datetime.now(timezone.utc) + password_reset_token_ttl()
    reset = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_reset_token(raw_token),
        expires_at=expires_at,
    )
    session.add(reset)
    await session.commit()

    # 현재는 이메일 발송 연동이 없어, 환경과 관계없이 재설정 토큰을 직접 반환합니다.
    return PasswordForgotResponse(
        message="비밀번호 재설정 토큰이 생성되었습니다. 아래 토큰으로 비밀번호를 재설정해 주세요.",
        reset_token=raw_token,
    )


@app.post("/auth/password/reset", response_model=PasswordResetResponse)
async def reset_password(
    payload: PasswordResetRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PasswordResetResponse:
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="비밀번호는 8자 이상이어야 합니다.")

    hashed = _hash_reset_token(payload.token)
    reset_token = await session.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hashed))
    now = datetime.now(timezone.utc)
    if reset_token is None or reset_token.used_at is not None or reset_token.expires_at < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="유효하지 않거나 만료된 재설정 토큰입니다.")

    user = await session.scalar(select(User).where(User.id == reset_token.user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="유효하지 않은 재설정 토큰입니다.")

    user.password_hash = hash_password(payload.new_password)
    reset_token.used_at = now
    await session.commit()
    return PasswordResetResponse(message="비밀번호가 성공적으로 변경되었습니다.")


@app.get("/me", response_model=MeResponse)
async def me(user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(
        id=user.id,
        username=user.username,
        name=user.display_name,
        track_name=user.track_name,
        role=user.role,
        created_at=user.created_at,
    )


async def _compute_skill_progress(
    session: AsyncSession, user_id: int
) -> tuple[list[ProgressSkillItem], list[ProgressRecentSubmission]]:
    all_skills_rows = await session.execute(select(Skill.id, Skill.name).order_by(Skill.id.asc()))
    accum: dict[int, dict[str, float | int | str]] = {
        skill_id: {"skill_name": skill_name, "earned_points": 0.0, "possible_points": 0.0}
        for skill_id, skill_name in all_skills_rows.all()
    }

    skill_rows = await session.execute(
        select(Skill.id, Skill.name, Grade.score, Grade.max_score, ProblemVersionSkill.weight)
        .join(ProblemVersionSkill, ProblemVersionSkill.skill_id == Skill.id)
        .join(ProblemVersion, ProblemVersion.id == ProblemVersionSkill.problem_version_id)
        .join(Submission, Submission.problem_version_id == ProblemVersion.id)
        .join(Grade, Grade.submission_id == Submission.id)
        .where(Submission.user_id == user_id)
    )

    for skill_id, skill_name, score, max_score, weight in skill_rows.all():
        record = accum.setdefault(
            skill_id,
            {"skill_name": skill_name, "earned_points": 0.0, "possible_points": 0.0},
        )
        record["earned_points"] += float(score * weight)
        record["possible_points"] += float(max_score * weight)

    skills = []
    for skill_id, record in accum.items():
        earned = float(record["earned_points"])
        possible = float(record["possible_points"])
        mastery = 0.0 if possible <= 0 else round((earned / possible) * 100, 2)
        skills.append(
            ProgressSkillItem(
                skill_id=skill_id,
                skill_name=str(record["skill_name"]),
                earned_points=earned,
                possible_points=possible,
                mastery=mastery,
            )
        )
    skills.sort(key=lambda item: item.mastery, reverse=True)

    recent_rows = await session.execute(
        select(Submission, Grade, ProblemVersion, Problem)
        .join(ProblemVersion, ProblemVersion.id == Submission.problem_version_id)
        .join(Problem, Problem.id == ProblemVersion.problem_id)
        .outerjoin(Grade, Grade.submission_id == Submission.id)
        .where(Submission.user_id == user_id)
        .order_by(Submission.id.desc())
        .limit(10)
    )
    recent_submissions = [
        ProgressRecentSubmission(
            submission_id=submission.id,
            problem_id=problem.id,
            problem_title=problem.title,
            problem_version=problem_version.version,
            status=submission.status,
            created_at=submission.created_at,
            score=grade.score if grade else None,
            max_score=grade.max_score if grade else None,
        )
        for submission, grade, problem_version, problem in recent_rows.all()
    ]

    return skills, recent_submissions


@app.get("/me/progress", response_model=MeProgressResponse)
async def me_progress(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> MeProgressResponse:
    skills, recent_submissions = await _compute_skill_progress(session, user.id)
    return MeProgressResponse(skills=skills, recent_submissions=recent_submissions)


@app.post("/admin/progress/snapshots/capture")
async def admin_capture_mastery_snapshots(
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> dict[str, int]:
    user_ids = [user_id for user_id in (await session.execute(select(User.id))).scalars().all()]
    captured = 0
    now = datetime.now(timezone.utc)
    for user_id in user_ids:
        skills, _ = await _compute_skill_progress(session, user_id)
        for skill in skills:
            session.add(
                MasterySnapshot(
                    user_id=user_id,
                    skill_id=skill.skill_id,
                    mastery=skill.mastery,
                    earned_points=skill.earned_points,
                    possible_points=skill.possible_points,
                    captured_at=now,
                )
            )
            captured += 1

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="mastery_snapshot.capture",
        resource_type="mastery_snapshot",
        metadata={"captured_count": captured},
    )
    await session.commit()
    return {"captured": captured}


@app.get("/me/progress/trend", response_model=list[ProgressTrendItem])
async def me_progress_trend(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ProgressTrendItem]:
    rows = await session.execute(
        select(MasterySnapshot, Skill)
        .join(Skill, Skill.id == MasterySnapshot.skill_id)
        .where(MasterySnapshot.user_id == user.id)
        .order_by(MasterySnapshot.captured_at.desc())
        .limit(limit * 20)
    )
    by_skill: dict[int, ProgressTrendItem] = {}
    for snapshot, skill in rows.all():
        item = by_skill.get(skill.id)
        if item is None:
            item = ProgressTrendItem(skill_id=skill.id, skill_name=skill.name, points=[])
            by_skill[skill.id] = item
        if len(item.points) >= limit:
            continue
        item.points.append(ProgressTrendPoint(captured_at=snapshot.captured_at, mastery=snapshot.mastery))

    for item in by_skill.values():
        item.points.sort(key=lambda point: point.captured_at)

    return sorted(by_skill.values(), key=lambda item: item.skill_id)


@app.get("/admin/health")
async def admin_health(_: Annotated[User, Depends(require_admin)]) -> dict[str, str]:
    return {"admin": "ok"}


@app.get("/admin/users/tracks", response_model=list[str])
async def list_admin_user_tracks(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[str]:
    rows = await session.execute(select(User.track_name).distinct().order_by(User.track_name.asc()))
    db_tracks = [str(track).strip() for track in rows.scalars().all() if str(track).strip()]
    merged = set(db_tracks) | set(_TRACK_OPTIONS)
    return sorted(merged)


@app.get("/admin/users", response_model=list[AdminUserSummary])
async def list_admin_users(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    track_name: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    role_filter: Annotated[str, Query(alias="role")] = "all",
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[AdminUserSummary]:
    normalized_role = role_filter.strip().lower()
    if normalized_role not in {"all", "admin", "user"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role은 all, admin, user 중 하나여야 합니다.")

    query = select(User)
    trimmed_track = track_name.strip() if isinstance(track_name, str) else ""
    if trimmed_track:
        query = query.where(User.track_name == trimmed_track)

    trimmed_keyword = keyword.strip() if isinstance(keyword, str) else ""
    if trimmed_keyword:
        like_value = f"%{trimmed_keyword.lower()}%"
        query = query.where(
            func.lower(User.username).like(like_value)
            | func.lower(User.display_name).like(like_value)
            | func.lower(User.track_name).like(like_value)
        )

    if normalized_role != "all":
        query = query.where(User.role == normalized_role)

    users = (
        await session.execute(
            query.order_by(User.created_at.desc(), User.id.desc()).limit(limit)
        )
    ).scalars().all()
    return [
        AdminUserSummary(
            id=user.id,
            username=user.username,
            name=user.display_name,
            track_name=user.track_name,
            role=user.role,
            created_at=user.created_at,
        )
        for user in users
    ]


@app.delete("/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin_user(
    user_id: int,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> None:
    target = await session.scalar(select(User).where(User.id == user_id))
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다.")
    if target.id == admin_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="현재 로그인한 관리자 계정은 삭제할 수 없습니다.")

    if target.role == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="관리자 계정은 삭제할 수 없습니다.")

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="user.delete",
        resource_type="user",
        resource_id=str(target.id),
        metadata={
            "username": target.username,
            "role": target.role,
            "track_name": target.track_name,
        },
    )
    await session.delete(target)
    await session.commit()


@app.get("/admin/ops/summary")
async def admin_ops_summary(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> dict[str, object]:
    status_rows = await session.execute(
        select(Submission.status, func.count(Submission.id)).group_by(Submission.status)
    )
    submission_status_counts = {row[0]: int(row[1]) for row in status_rows.all()}

    pending_grade_runs = await session.scalar(
        select(func.count(GradeRun.id)).where(GradeRun.score.is_(None))
    )

    try:
        queue_depth = int(grading_queue.count)
    except Exception:
        queue_depth = -1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "queue_depth": queue_depth,
        "pending_grade_runs": int(pending_grade_runs or 0),
        "submission_status_counts": submission_status_counts,
        "health": {
            "db": "ok" if await check_db_connection() else "error",
            "redis": "ok" if check_redis_connection() else "error",
        },
    }


@app.post("/admin/watchdog/requeue-stale", response_model=WatchdogRequeueResponse)
async def admin_requeue_stale_submissions(
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    stale_seconds: Annotated[int, Query(ge=1, le=86400)] = GRADING_STUCK_TIMEOUT_SECONDS,
) -> WatchdogRequeueResponse:
    result = await requeue_stale_running_submissions(stale_seconds=stale_seconds)
    for submission_id in result["requeued_submission_ids"]:
        grading_queue.enqueue("app.worker_tasks.grade_submission_job", submission_id)

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="watchdog.requeue_stale",
        resource_type="submission",
        resource_id=None,
        metadata={
            "stale_seconds": int(result["stale_seconds"]),
            "requeued_count": len(result["requeued_submission_ids"]),
            "requeued_submission_ids": [int(submission_id) for submission_id in result["requeued_submission_ids"]],
        },
    )
    await session.commit()

    return WatchdogRequeueResponse(
        status="ok",
        stale_seconds=int(result["stale_seconds"]),
        scanned_running=int(result["scanned_running"]),
        requeued_count=len(result["requeued_submission_ids"]),
        requeued_submission_ids=[int(submission_id) for submission_id in result["requeued_submission_ids"]],
    )


@app.get("/admin/audit-logs", response_model=list[AdminAuditLogResponse])
async def admin_list_audit_logs(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AdminAuditLogResponse]:
    rows = await session.execute(
        select(AdminAuditLog, User.username)
        .outerjoin(User, User.id == AdminAuditLog.actor_user_id)
        .order_by(AdminAuditLog.id.desc())
        .limit(limit)
    )
    entries = rows.all()
    return [
        AdminAuditLogResponse(
            id=log.id,
            actor_user_id=log.actor_user_id,
            actor_username=actor_username,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            method=log.method,
            path=log.path,
            request_id=log.request_id,
            client_ip=log.client_ip,
            user_agent=log.user_agent,
            metadata_json=log.metadata_json,
            created_at=log.created_at,
        )
        for log, actor_username in entries
    ]


@app.post("/admin/skills", response_model=SkillResponse)
async def create_skill(
    payload: SkillCreate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> SkillResponse:
    skill = Skill(name=payload.name, description=payload.description)
    session.add(skill)
    await session.flush()
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="skill.create",
        resource_type="skill",
        resource_id=str(skill.id),
        metadata={"name": skill.name},
    )
    await session.commit()
    await session.refresh(skill)
    return SkillResponse(id=skill.id, name=skill.name, description=skill.description)


@app.get("/admin/skills", response_model=list[SkillResponse])
async def list_skills(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[SkillResponse]:
    result = await session.execute(select(Skill).order_by(Skill.id.asc()))
    skills = result.scalars().all()
    return [SkillResponse(id=s.id, name=s.name, description=s.description) for s in skills]


@app.post("/admin/problem-folders", response_model=ProblemFolderResponse)
async def create_problem_folder(
    payload: ProblemFolderCreate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ProblemFolderResponse:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Folder name is required")

    parent_id = payload.parent_id
    if parent_id is not None:
        parent = await session.scalar(select(ProblemFolder).where(ProblemFolder.id == parent_id))
        if parent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent folder not found")

    explicit_slug = payload.slug.strip() if payload.slug else ""
    if explicit_slug:
        slug = _slugify(explicit_slug)
        if await session.scalar(select(ProblemFolder).where(ProblemFolder.slug == slug)) is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Folder slug already in use")
    else:
        base_slug = _slugify(name)
        slug = base_slug
        suffix = 2
        while await session.scalar(select(ProblemFolder).where(ProblemFolder.slug == slug)) is not None:
            slug = f"{base_slug}-{suffix}"
            suffix += 1

    folder = ProblemFolder(
        name=name,
        slug=slug,
        parent_id=parent_id,
        sort_order=payload.sort_order,
    )
    session.add(folder)
    await session.flush()
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="problem_folder.create",
        resource_type="problem_folder",
        resource_id=str(folder.id),
        metadata={"name": folder.name, "slug": folder.slug, "parent_id": folder.parent_id},
    )
    await session.commit()
    await session.refresh(folder)

    path_map = await _load_folder_path_map(session)
    return _to_problem_folder_response(folder, path_map)


@app.get("/admin/problem-folders", response_model=list[ProblemFolderResponse])
async def list_admin_problem_folders(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[ProblemFolderResponse]:
    folders = (
        await session.execute(select(ProblemFolder).order_by(ProblemFolder.sort_order.asc(), ProblemFolder.id.asc()))
    ).scalars().all()
    path_map = await _load_folder_path_map(session)
    return [_to_problem_folder_response(folder, path_map) for folder in folders]


@app.get("/problem-folders", response_model=list[ProblemFolderResponse])
async def list_problem_folders(session: Annotated[AsyncSession, Depends(get_async_session)]) -> list[ProblemFolderResponse]:
    folders = (
        await session.execute(select(ProblemFolder).order_by(ProblemFolder.sort_order.asc(), ProblemFolder.id.asc()))
    ).scalars().all()
    path_map = await _load_folder_path_map(session)
    return [_to_problem_folder_response(folder, path_map) for folder in folders]


def _normalize_exam_title(raw_title: str | None) -> str:
    return re.sub(r"\s+", " ", (raw_title or "")).strip()


async def _ensure_exam_title_unique(
    session: AsyncSession,
    title: str,
    *,
    exclude_exam_id: int | None = None,
) -> None:
    stmt = select(Exam.id).where(func.lower(Exam.title) == title.lower())
    if exclude_exam_id is not None:
        stmt = stmt.where(Exam.id != exclude_exam_id)
    existing = await session.scalar(stmt.limit(1))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="같은 시험명은 사용할 수 없습니다. 시험명을 다르게 입력해 주세요.",
        )


async def _create_exam_with_questions(
    session: AsyncSession,
    payload: ExamCreate | ExamRepublish,
) -> tuple[Exam, list[ExamQuestion]]:
    title = _normalize_exam_title(payload.title)
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시험 제목은 필수입니다.")
    await _ensure_exam_title_unique(session, title)
    if len(payload.questions) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시험에는 최소 1개 이상의 문항이 필요합니다.")

    folder_id = payload.folder_id
    if folder_id is not None:
        folder = await session.scalar(select(ProblemFolder).where(ProblemFolder.id == folder_id))
        if folder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="카테고리(폴더)를 찾을 수 없습니다.")

    exam = Exam(
        title=title,
        description=payload.description.strip() if payload.description else None,
        folder_id=folder_id,
        exam_kind=_normalize_exam_kind(payload.exam_kind),
        target_track_name=_sanitize_exam_target_track_name(payload.target_track_name),
        status=_sanitize_exam_status(payload.status),
        duration_minutes=_sanitize_exam_duration_minutes(payload.duration_minutes),
    )
    session.add(exam)
    await session.flush()

    questions: list[ExamQuestion] = []
    for index, question_payload in enumerate(payload.questions, start=1):
        question_type = _normalize_exam_question_type(question_payload.type)
        prompt_md = question_payload.prompt_md.strip()
        if not prompt_md:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{index}번 문항의 내용이 비어 있습니다.")
        choices = _sanitize_exam_question_choices(question_type, question_payload.choices)
        question = ExamQuestion(
            exam_id=exam.id,
            order_index=index,
            type=question_type,
            prompt_md=prompt_md,
            required=bool(question_payload.required),
            choices_json=choices,
            correct_choice_index=_sanitize_exam_correct_choice_index(
                question_type, choices, question_payload.correct_choice_index
            ),
            answer_key_text=_sanitize_exam_answer_key_text(question_type, question_payload.answer_key_text),
        )
        session.add(question)
        questions.append(question)
    return exam, questions


async def _copy_exam_resources(
    session: AsyncSession,
    *,
    source_exam_id: int,
    target_exam_id: int,
) -> int:
    resources = (
        await session.execute(select(ExamResource).where(ExamResource.exam_id == source_exam_id).order_by(ExamResource.id.asc()))
    ).scalars().all()
    copied = 0
    for resource in resources:
        source_path = _resolve_exam_resource_path(source_exam_id, resource.stored_name)
        if not source_path.exists() or not source_path.is_file():
            continue
        payload = source_path.read_bytes()
        suffix = Path(resource.file_name).suffix[:20] or Path(resource.stored_name).suffix[:20]
        stored_name = f"{uuid4().hex}{suffix}"
        target_path = _resolve_exam_resource_path(target_exam_id, stored_name)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(payload)
        session.add(
            ExamResource(
                exam_id=target_exam_id,
                file_name=resource.file_name,
                stored_name=stored_name,
                content_type=resource.content_type,
                size_bytes=len(payload),
            )
        )
        copied += 1
    return copied


async def _prepare_exam_submission_enqueue(
    session: AsyncSession,
    *,
    submission_id: int,
    force: bool,
    target_question_id: int | None = None,
    preserve_feedback_json: bool = False,
) -> tuple[ExamSubmission, int, bool, str]:
    submission = await session.scalar(select(ExamSubmission).where(ExamSubmission.id == submission_id))
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="제출을 찾을 수 없습니다.")

    answer_rows = (
        await session.execute(
            select(ExamAnswer, ExamQuestion)
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(
                ExamAnswer.exam_submission_id == submission.id,
            )
            .order_by(ExamAnswer.id.asc())
        )
    ).all()
    llm_target_rows = [
        (answer, question)
        for answer, question in answer_rows
        if question.type in {"subjective", "coding"}
        and bool((question.answer_key_text or "").strip())
        and (target_question_id is None or question.id == target_question_id)
    ]

    if not llm_target_rows:
        if target_question_id is not None:
            return submission, 0, False, "해당 문항은 자동 재채점 대상이 아닙니다."
        return submission, 0, False, "정답/채점 기준이 입력된 주관식·코딩 문항이 없어 자동 채점 대상이 아닙니다."

    if not force and submission.status in {"QUEUED", "RUNNING"}:
        return submission, len(llm_target_rows), False, f"이미 {submission.status} 상태입니다."

    submission.status = "QUEUED"
    submission.note = None
    for answer, _ in llm_target_rows:
        answer.grading_status = "QUEUED"
        answer.grading_score = None
        answer.grading_max_score = None
        if not preserve_feedback_json:
            answer.grading_feedback_json = None
        answer.grading_logs = None
        answer.graded_at = None

    if target_question_id is not None:
        return submission, len(llm_target_rows), True, "해당 문항 재채점을 시작했습니다."
    return submission, len(llm_target_rows), True, "자동 채점 큐에 등록했습니다."


def _resolve_submission_status_from_answers(
    submission: ExamSubmission,
    rows: list[tuple[ExamAnswer, ExamQuestion]],
) -> str:
    has_failed = False
    has_pending_auto = False
    has_pending_manual = False

    for answer, question in rows:
        if question.type not in {"coding", "subjective"}:
            continue

        if answer.grading_status == "FAILED":
            has_failed = True
            continue

        if answer.grading_status == "GRADED":
            continue

        if (question.answer_key_text or "").strip():
            has_pending_auto = True
        else:
            has_pending_manual = True

    if has_pending_auto:
        if submission.status in {"RUNNING", "QUEUED"}:
            return submission.status
        # LLM auto-grading answers are queued only after admin approval.
        return "SUBMITTED"
    if has_failed:
        return "FAILED"
    if has_pending_manual:
        return "SUBMITTED"
    return "GRADED"


@app.post("/admin/exams", response_model=AdminExamDetail, status_code=status.HTTP_201_CREATED)
async def create_exam(
    payload: ExamCreate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminExamDetail:
    exam, questions = await _create_exam_with_questions(session, payload)
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam.create",
        resource_type="exam",
        resource_id=str(exam.id),
        metadata={
            "title": exam.title,
            "question_count": len(questions),
            "exam_kind": exam.exam_kind,
            "target_track_name": exam.target_track_name,
            "duration_minutes": exam.duration_minutes,
        },
    )
    await session.commit()
    await session.refresh(exam)

    folder_path_map = await _load_folder_path_map(session)
    return AdminExamDetail(
        **_to_exam_summary(exam, folder_path_map=folder_path_map, question_count=len(questions), submitted=False).model_dump(),
        questions=[_to_admin_exam_question_summary(question) for question in questions],
    )


@app.get("/admin/exams", response_model=list[ExamSummary])
async def list_admin_exams(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[ExamSummary]:
    exams = (await session.execute(select(Exam).order_by(Exam.id.desc()))).scalars().all()
    if not exams:
        return []
    folder_path_map = await _load_folder_path_map(session)
    question_count_rows = await session.execute(
        select(ExamQuestion.exam_id, func.count(ExamQuestion.id)).group_by(ExamQuestion.exam_id)
    )
    question_count_map = {exam_id: int(count) for exam_id, count in question_count_rows.all()}
    return [
        _to_exam_summary(
            exam,
            folder_path_map=folder_path_map,
            question_count=question_count_map.get(exam.id, 0),
            submitted=False,
        )
        for exam in exams
    ]


@app.get("/admin/exams/{exam_id}", response_model=AdminExamDetail)
async def get_admin_exam_detail(
    exam_id: int,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminExamDetail:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")
    questions = (
        await session.execute(
            select(ExamQuestion).where(ExamQuestion.exam_id == exam_id).order_by(ExamQuestion.order_index.asc())
        )
    ).scalars().all()
    folder_path_map = await _load_folder_path_map(session)
    return AdminExamDetail(
        **_to_exam_summary(exam, folder_path_map=folder_path_map, question_count=len(questions), submitted=False).model_dump(),
        questions=[_to_admin_exam_question_summary(question) for question in questions],
    )


@app.post("/admin/exams/{exam_id}/republish", response_model=AdminExamDetail, status_code=status.HTTP_201_CREATED)
async def republish_admin_exam(
    exam_id: int,
    payload: ExamRepublish,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminExamDetail:
    source_exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if source_exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="원본 시험을 찾을 수 없습니다.")

    new_exam, new_questions = await _create_exam_with_questions(session, payload)
    copied_resources = 0
    if payload.copy_resources:
        copied_resources = await _copy_exam_resources(
            session,
            source_exam_id=source_exam.id,
            target_exam_id=new_exam.id,
        )

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam.republish",
        resource_type="exam",
        resource_id=str(new_exam.id),
        metadata={
            "source_exam_id": source_exam.id,
            "new_exam_id": new_exam.id,
            "question_count": len(new_questions),
            "copied_resources": copied_resources,
            "target_track_name": new_exam.target_track_name,
            "duration_minutes": new_exam.duration_minutes,
        },
    )
    await session.commit()
    await session.refresh(new_exam)
    folder_path_map = await _load_folder_path_map(session)
    return AdminExamDetail(
        **_to_exam_summary(
            new_exam,
            folder_path_map=folder_path_map,
            question_count=len(new_questions),
            submitted=False,
        ).model_dump(),
        questions=[_to_admin_exam_question_summary(question) for question in new_questions],
    )


@app.put("/admin/exams/{exam_id}", response_model=ExamSummary)
async def update_admin_exam(
    exam_id: int,
    payload: ExamUpdate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ExamSummary:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    title = _normalize_exam_title(payload.title)
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시험 제목은 필수입니다.")
    await _ensure_exam_title_unique(session, title, exclude_exam_id=exam.id)
    folder_id = payload.folder_id
    if folder_id is not None:
        folder = await session.scalar(select(ProblemFolder).where(ProblemFolder.id == folder_id))
        if folder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="카테고리(폴더)를 찾을 수 없습니다.")

    exam.title = title
    exam.description = payload.description.strip() if payload.description else None
    exam.folder_id = folder_id
    exam.exam_kind = _normalize_exam_kind(payload.exam_kind)
    exam.target_track_name = _sanitize_exam_target_track_name(payload.target_track_name)
    exam.status = _sanitize_exam_status(payload.status)
    exam.duration_minutes = _sanitize_exam_duration_minutes(payload.duration_minutes)

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam.update",
        resource_type="exam",
        resource_id=str(exam.id),
        metadata={
            "title": exam.title,
            "exam_kind": exam.exam_kind,
            "target_track_name": exam.target_track_name,
            "status": exam.status,
            "folder_id": exam.folder_id,
            "duration_minutes": exam.duration_minutes,
        },
    )
    await session.commit()
    await session.refresh(exam)

    question_count = int(
        (
            await session.scalar(
                select(func.count(ExamQuestion.id)).where(ExamQuestion.exam_id == exam.id)
            )
        )
        or 0
    )
    folder_path_map = await _load_folder_path_map(session)
    return _to_exam_summary(exam, folder_path_map=folder_path_map, question_count=question_count, submitted=False)


@app.post("/admin/exams/{exam_id}/results/share", response_model=ExamSummary)
async def update_admin_exam_results_publish(
    exam_id: int,
    payload: AdminExamResultPublishRequest,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ExamSummary:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    publish = bool(payload.published)
    if publish:
        ungraded_count = int(
            (
                await session.scalar(
                    select(func.count(ExamSubmission.id)).where(
                        ExamSubmission.exam_id == exam.id,
                        ExamSubmission.status != "GRADED",
                    )
                )
            )
            or 0
        )
        if ungraded_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "채점이 완료되지 않은 제출이 있어 공유할 수 없습니다. "
                    f"(미완료 {ungraded_count}건)"
                ),
            )

        submission_ids = (
            await session.execute(
                select(ExamSubmission.id).where(ExamSubmission.exam_id == exam.id)
            )
        ).scalars().all()
        review_pending_counts = await _load_submission_review_pending_counts(
            session,
            [int(submission_id) for submission_id in submission_ids],
        )
        review_pending_submission_ids = sorted(
            submission_id
            for submission_id, review_count in review_pending_counts.items()
            if review_count > 0
        )
        if review_pending_submission_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "검토 필요 상태(애매 판정)가 남아 있어 전체 공유할 수 없습니다. "
                    "관리자 화면에서 검토 필요 항목을 먼저 확정해 주세요. "
                    f"(검토 필요 제출 ID: {', '.join(str(submission_id) for submission_id in review_pending_submission_ids)})"
                ),
            )

    exam.results_published = publish
    exam.results_published_at = datetime.now(timezone.utc) if publish else None

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam.results_publish",
        resource_type="exam",
        resource_id=str(exam.id),
        metadata={
            "results_published": exam.results_published,
            "results_published_at": exam.results_published_at.isoformat() if exam.results_published_at else None,
        },
    )
    await session.commit()
    await session.refresh(exam)

    question_count = int(
        (
            await session.scalar(
                select(func.count(ExamQuestion.id)).where(ExamQuestion.exam_id == exam.id)
            )
        )
        or 0
    )
    folder_path_map = await _load_folder_path_map(session)
    return _to_exam_summary(exam, folder_path_map=folder_path_map, question_count=question_count, submitted=False)


@app.delete("/admin/exams/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin_exam(
    exam_id: int,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> None:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam.delete",
        resource_type="exam",
        resource_id=str(exam.id),
        metadata={"title": exam.title},
    )
    await session.delete(exam)
    await session.commit()

    resource_dir = (Path(EXAM_RESOURCE_ROOT).resolve() / str(exam_id)).resolve()
    if resource_dir.is_dir():
        shutil.rmtree(resource_dir, ignore_errors=True)


@app.get("/admin/exams/{exam_id}/submissions", response_model=list[AdminExamSubmissionDetail])
async def list_admin_exam_submissions(
    exam_id: int,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[AdminExamSubmissionDetail]:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    rows = await session.execute(
        select(ExamSubmission, User)
        .join(User, User.id == ExamSubmission.user_id)
        .where(ExamSubmission.exam_id == exam_id)
        .order_by(ExamSubmission.id.desc())
    )
    submissions = rows.all()
    if not submissions:
        return []

    question_map = {
        question.id: question
        for question in (
            await session.execute(select(ExamQuestion).where(ExamQuestion.exam_id == exam_id))
        ).scalars().all()
    }

    payload: list[AdminExamSubmissionDetail] = []
    for submission, user in submissions:
        answer_rows = (
            await session.execute(
                select(ExamAnswer)
                .where(ExamAnswer.exam_submission_id == submission.id)
                .order_by(ExamAnswer.id.asc())
            )
        ).scalars().all()
        answers: list[AdminExamSubmissionAnswer] = []
        for answer in answer_rows:
            question = question_map.get(answer.exam_question_id)
            if question is None:
                continue
            answers.append(
                AdminExamSubmissionAnswer(
                    question_id=question.id,
                    question_order=question.order_index,
                    question_type=question.type,
                    prompt_md=question.prompt_md,
                    choices=list(question.choices_json or []) if question.choices_json is not None else None,
                    correct_choice_index=question.correct_choice_index,
                    answer_key_text=question.answer_key_text,
                    answer_text=answer.answer_text,
                    selected_choice_index=answer.selected_choice_index,
                    grading_status=answer.grading_status,
                    grading_score=answer.grading_score,
                    grading_max_score=answer.grading_max_score,
                    grading_feedback_json=answer.grading_feedback_json,
                    grading_logs=answer.grading_logs,
                    graded_at=answer.graded_at,
                )
            )
        payload.append(
            AdminExamSubmissionDetail(
                submission_id=submission.id,
                exam_id=exam.id,
                exam_title=exam.title,
                user_id=user.id,
                user_name=user.display_name,
                username=user.username,
                status=submission.status,
                submitted_at=submission.submitted_at,
                answers=answers,
            )
        )
    return payload


@app.get("/admin/exams/{exam_id}/resources", response_model=list[ExamResourceSummary])
async def list_admin_exam_resources(
    exam_id: int,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[ExamResourceSummary]:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    resources = (
        await session.execute(select(ExamResource).where(ExamResource.exam_id == exam_id).order_by(ExamResource.id.desc()))
    ).scalars().all()
    return [_to_exam_resource_summary(resource) for resource in resources]


@app.post("/admin/exam-resources/prune", response_model=ExamResourcePruneResponse)
async def prune_admin_exam_resources(
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    retention_days: Annotated[int | None, Query(ge=1, le=3650)] = None,
) -> ExamResourcePruneResponse:
    resolved_retention_days = int(retention_days or EXAM_RESOURCE_RETENTION_DAYS)
    pruned_count, pruned_bytes = await _prune_expired_exam_resources(
        session,
        retention_days=resolved_retention_days,
    )
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam_resource.prune",
        resource_type="exam_resource",
        resource_id=None,
        metadata={
            "retention_days": resolved_retention_days,
            "pruned_count": pruned_count,
            "pruned_bytes": pruned_bytes,
        },
    )
    await session.commit()
    return ExamResourcePruneResponse(
        retention_days=resolved_retention_days,
        pruned_count=pruned_count,
        pruned_bytes=pruned_bytes,
    )


@app.post("/admin/exams/{exam_id}/resources", response_model=ExamResourceSummary, status_code=status.HTTP_201_CREATED)
async def upload_admin_exam_resource(
    exam_id: int,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    file: UploadFile = File(...),
) -> ExamResourceSummary:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    original_name = Path(file.filename or "").name.strip()
    if not original_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="업로드 파일명이 비어 있습니다.")

    payload = await file.read()
    await file.close()
    size_bytes = len(payload)
    if size_bytes == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="빈 파일은 업로드할 수 없습니다.")
    if size_bytes > EXAM_RESOURCE_MAX_SIZE_BYTES:
        max_mb = EXAM_RESOURCE_MAX_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"파일 크기는 최대 {EXAM_RESOURCE_MAX_SIZE_BYTES} bytes(약 {max_mb}MB)까지 허용됩니다. "
                "더 큰 자료는 Google Drive 링크를 시험 설명/문항에 첨부해 주세요."
            ),
        )

    suffix = Path(original_name).suffix[:20]
    stored_name = f"{uuid4().hex}{suffix}"
    target_path = _resolve_exam_resource_path(exam_id, stored_name)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(payload)

    resource = ExamResource(
        exam_id=exam_id,
        file_name=original_name,
        stored_name=stored_name,
        content_type=(file.content_type or None),
        size_bytes=size_bytes,
    )
    session.add(resource)
    pruned_count, pruned_bytes = await _prune_expired_exam_resources(
        session,
        retention_days=EXAM_RESOURCE_RETENTION_DAYS,
    )
    await session.flush()
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam.resource.upload",
        resource_type="exam_resource",
        resource_id=str(resource.id),
        metadata={
            "exam_id": exam_id,
            "file_name": resource.file_name,
            "size_bytes": resource.size_bytes,
            "retention_days": EXAM_RESOURCE_RETENTION_DAYS,
            "auto_pruned_count": pruned_count,
            "auto_pruned_bytes": pruned_bytes,
        },
    )
    await session.commit()
    await session.refresh(resource)
    return _to_exam_resource_summary(resource)


@app.get("/exams/{exam_id}/resources", response_model=list[ExamResourceSummary])
async def list_exam_resources(
    exam_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[ExamResourceSummary]:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None or not _can_user_access_exam(exam, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    resources = (
        await session.execute(select(ExamResource).where(ExamResource.exam_id == exam_id).order_by(ExamResource.id.desc()))
    ).scalars().all()
    return [_to_exam_resource_summary(resource) for resource in resources]


@app.get("/exams/{exam_id}/resources/{resource_id}/download")
async def download_exam_resource(
    exam_id: int,
    resource_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> FileResponse:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None or not _can_user_access_exam(exam, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    resource = await session.scalar(
        select(ExamResource).where(ExamResource.id == resource_id, ExamResource.exam_id == exam_id)
    )
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="리소스를 찾을 수 없습니다.")

    path = _resolve_exam_resource_path(exam_id, resource.stored_name)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="저장된 파일을 찾을 수 없습니다.")

    return FileResponse(
        path=str(path),
        media_type=resource.content_type or "application/octet-stream",
        filename=resource.file_name,
    )


@app.get("/exams", response_model=list[ExamSummary])
async def list_exams(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[ExamSummary]:
    query = select(Exam).where(Exam.status == "published")
    if user.role != "admin":
        query = query.where(Exam.target_track_name == user.track_name)
    exams = (await session.execute(query.order_by(Exam.id.asc()))).scalars().all()
    if not exams:
        return []

    folder_path_map = await _load_folder_path_map(session)
    question_count_rows = await session.execute(
        select(ExamQuestion.exam_id, func.count(ExamQuestion.id)).group_by(ExamQuestion.exam_id)
    )
    question_count_map = {exam_id: int(count) for exam_id, count in question_count_rows.all()}
    submitted_rows = await session.execute(
        select(ExamSubmission.exam_id).where(ExamSubmission.user_id == user.id)
    )
    submitted_exam_ids = {int(exam_id) for exam_id in submitted_rows.scalars().all()}

    return [
        _to_exam_summary(
            exam,
            folder_path_map=folder_path_map,
            question_count=question_count_map.get(exam.id, 0),
            submitted=exam.id in submitted_exam_ids,
        )
        for exam in exams
    ]


@app.get("/exams/{exam_id}", response_model=ExamDetail)
async def get_exam(
    exam_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ExamDetail:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None or not _can_user_access_exam(exam, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    questions = (
        await session.execute(select(ExamQuestion).where(ExamQuestion.exam_id == exam_id).order_by(ExamQuestion.order_index.asc()))
    ).scalars().all()
    folder_path_map = await _load_folder_path_map(session)
    existing_submission = await session.scalar(
        select(ExamSubmission).where(ExamSubmission.exam_id == exam_id, ExamSubmission.user_id == user.id)
    )
    submitted = existing_submission is not None

    attempt_started_at: datetime | None = None
    attempt_expires_at: datetime | None = None
    remaining_seconds: int | None = None
    if user.role != "admin" and not submitted and exam.duration_minutes is not None:
        attempt = await session.scalar(
            select(ExamAttempt).where(ExamAttempt.exam_id == exam_id, ExamAttempt.user_id == user.id)
        )
        if attempt is None:
            attempt = ExamAttempt(exam_id=exam_id, user_id=user.id)
            session.add(attempt)
            try:
                await session.commit()
                await session.refresh(attempt)
            except IntegrityError:
                await session.rollback()
                attempt = await session.scalar(
                    select(ExamAttempt).where(ExamAttempt.exam_id == exam_id, ExamAttempt.user_id == user.id)
                )
                if attempt is None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="응시 시작 처리 중 충돌이 발생했습니다. 잠시 후 다시 시도해 주세요.",
                    )

        attempt_started_at = attempt.started_at
        attempt_expires_at = attempt.started_at + timedelta(minutes=exam.duration_minutes)
        remaining_seconds = max(0, int((attempt_expires_at - datetime.now(timezone.utc)).total_seconds()))

    return ExamDetail(
        **_to_exam_summary(
            exam,
            folder_path_map=folder_path_map,
            question_count=len(questions),
            submitted=submitted,
        ).model_dump(),
        attempt_started_at=attempt_started_at,
        attempt_expires_at=attempt_expires_at,
        remaining_seconds=remaining_seconds,
        questions=[_to_exam_question_summary(question) for question in questions],
    )


@app.post("/exams/{exam_id}/submit", response_model=ExamSubmitResponse)
async def submit_exam(
    exam_id: int,
    payload: ExamSubmitRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ExamSubmitResponse:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None or not _can_user_access_exam(exam, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    existing = await session.scalar(
        select(ExamSubmission).where(ExamSubmission.exam_id == exam_id, ExamSubmission.user_id == user.id)
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 제출한 시험입니다.")

    if user.role != "admin" and exam.duration_minutes is not None:
        attempt = await session.scalar(
            select(ExamAttempt).where(ExamAttempt.exam_id == exam_id, ExamAttempt.user_id == user.id)
        )
        if attempt is None:
            attempt = ExamAttempt(exam_id=exam_id, user_id=user.id)
            session.add(attempt)
            try:
                await session.flush()
            except IntegrityError:
                await session.rollback()
                attempt = await session.scalar(
                    select(ExamAttempt).where(ExamAttempt.exam_id == exam_id, ExamAttempt.user_id == user.id)
                )
                if attempt is None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="응시 시작 처리 중 충돌이 발생했습니다. 잠시 후 다시 시도해 주세요.",
                    )

        expires_at = attempt.started_at + timedelta(minutes=exam.duration_minutes)
        if datetime.now(timezone.utc) >= expires_at:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="시험 시간이 종료되어 제출할 수 없습니다.",
            )

    questions = (
        await session.execute(select(ExamQuestion).where(ExamQuestion.exam_id == exam_id).order_by(ExamQuestion.order_index.asc()))
    ).scalars().all()
    if not questions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시험 문항이 없습니다.")

    answer_by_question: dict[int, dict[str, Any]] = {}
    for answer in payload.answers:
        answer_by_question[answer.question_id] = {
            "answer_text": answer.answer_text.strip() if answer.answer_text else None,
            "selected_choice_index": answer.selected_choice_index,
        }

    has_llm_target_question = any(
        question.type in {"subjective", "coding"}
        and bool(_sanitize_exam_answer_key_text(question.type, question.answer_key_text))
        for question in questions
    )
    has_manual_review_question = any(
        question.type in {"subjective", "coding"}
        and not bool(_sanitize_exam_answer_key_text(question.type, question.answer_key_text))
        for question in questions
    )
    initial_status = "SUBMITTED" if (has_llm_target_question or has_manual_review_question) else "GRADED"
    submission = ExamSubmission(exam_id=exam_id, user_id=user.id, status=initial_status)
    session.add(submission)
    await session.flush()

    for question in questions:
        submitted = answer_by_question.get(question.id)
        selected_choice_index: int | None = None
        answer_text: str | None = None
        grading_status: str | None = None
        grading_score: int | None = None
        grading_max_score: int | None = None
        grading_feedback_json: dict[str, Any] | None = None
        graded_at: datetime | None = None

        if question.type == "multiple_choice":
            if submitted is not None:
                selected_choice_index = submitted["selected_choice_index"]
            choices = list(question.choices_json or [])
            if question.required and selected_choice_index is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{question.order_index}번 문항 답변이 필요합니다.")
            if selected_choice_index is not None and (selected_choice_index < 0 or selected_choice_index >= len(choices)):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{question.order_index}번 문항 선택지 번호가 올바르지 않습니다.")
        else:
            if submitted is not None:
                answer_text = submitted["answer_text"]
            if question.required and not (answer_text and answer_text.strip()):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{question.order_index}번 문항 답변이 필요합니다.")
            if question.type in {"coding", "subjective"}:
                # Non-objective questions are graded later by LLM auto-grader (or manual grading fallback).
                grading_status = None

        session.add(
            ExamAnswer(
                exam_submission_id=submission.id,
                exam_question_id=question.id,
                answer_text=answer_text,
                selected_choice_index=selected_choice_index,
                grading_status=grading_status,
                grading_score=grading_score,
                grading_max_score=grading_max_score,
                grading_feedback_json=grading_feedback_json,
                graded_at=graded_at,
            )
        )

    await session.commit()
    await session.refresh(submission)

    return ExamSubmitResponse(
        submission_id=submission.id,
        exam_id=submission.exam_id,
        status=submission.status,
        submitted_at=submission.submitted_at,
    )


@app.get("/exams/{exam_id}/my-submission", response_model=MeExamSubmissionDetail)
async def get_my_exam_submission_detail(
    exam_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> MeExamSubmissionDetail:
    exam = await session.scalar(select(Exam).where(Exam.id == exam_id))
    if exam is None or not _can_user_access_exam(exam, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    submission = await session.scalar(
        select(ExamSubmission).where(ExamSubmission.exam_id == exam_id, ExamSubmission.user_id == user.id)
    )
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="해당 시험 제출 내역이 없습니다.")

    answer_rows = (
        await session.execute(
            select(ExamAnswer, ExamQuestion)
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(ExamAnswer.exam_submission_id == submission.id)
            .order_by(ExamQuestion.order_index.asc())
        )
    ).all()

    answers = [
        MeExamSubmissionAnswer(
            question_id=question.id,
            question_order=question.order_index,
            question_type=question.type,
            prompt_md=question.prompt_md,
            choices=list(question.choices_json or []) if question.choices_json is not None else None,
            correct_choice_index=question.correct_choice_index,
            answer_key_text=question.answer_key_text,
            answer_text=answer.answer_text,
            selected_choice_index=answer.selected_choice_index,
            grading_status=answer.grading_status,
            grading_score=answer.grading_score,
            grading_max_score=answer.grading_max_score,
            grading_feedback_json=answer.grading_feedback_json,
            graded_at=answer.graded_at,
        )
        for answer, question in answer_rows
    ]

    results_published, results_published_at, _ = _resolve_submission_result_visibility(exam, submission)

    return MeExamSubmissionDetail(
        submission_id=submission.id,
        exam_id=exam.id,
        exam_title=exam.title,
        status=submission.status,
        submitted_at=submission.submitted_at,
        results_published=results_published,
        results_published_at=results_published_at,
        answers=answers,
    )


@app.get("/me/exam-submissions", response_model=list[ExamSubmissionSummary])
async def get_my_exam_submissions(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[ExamSubmissionSummary]:
    rows = await session.execute(
        select(ExamSubmission, Exam)
        .join(Exam, Exam.id == ExamSubmission.exam_id)
        .where(ExamSubmission.user_id == user.id)
        .order_by(ExamSubmission.id.desc())
        .limit(limit)
    )
    items = rows.all()
    if not items:
        return []
    folder_path_map = await _load_folder_path_map(session)
    return [
        ExamSubmissionSummary(
            id=submission.id,
            exam_id=exam.id,
            exam_title=exam.title,
            exam_kind=exam.exam_kind,
            folder_path=folder_path_map.get(exam.folder_id) if exam.folder_id is not None else None,
            status=submission.status,
            submitted_at=submission.submitted_at,
        )
        for submission, exam in items
    ]


@app.get("/me/exam-results", response_model=list[MeExamResultSummary])
async def get_my_exam_results(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[MeExamResultSummary]:
    rows = await session.execute(
        select(ExamSubmission, Exam)
        .join(Exam, Exam.id == ExamSubmission.exam_id)
        .where(ExamSubmission.user_id == user.id)
        .order_by(ExamSubmission.id.desc())
        .limit(limit)
    )
    items = rows.all()
    if not items:
        return []

    submission_ids = [submission.id for submission, _ in items]
    answer_rows = (
        await session.execute(
            select(ExamAnswer, ExamQuestion)
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(ExamAnswer.exam_submission_id.in_(submission_ids))
            .order_by(ExamAnswer.id.asc())
        )
    ).all()
    answers_by_submission: dict[int, list[tuple[ExamAnswer, ExamQuestion]]] = defaultdict(list)
    for answer, question in answer_rows:
        answers_by_submission[answer.exam_submission_id].append((answer, question))

    payload: list[MeExamResultSummary] = []
    for submission, exam in items:
        results_published, results_published_at, _ = _resolve_submission_result_visibility(exam, submission)
        objective_total = 0
        objective_answered = 0
        objective_correct = 0
        objective_pending = 0
        objective_incorrect = 0
        subjective_total = 0
        subjective_correct = 0
        subjective_incorrect = 0
        subjective_pending = 0
        coding_total = 0
        coding_graded = 0
        coding_failed = 0
        coding_pending = 0
        coding_correct = 0
        coding_incorrect = 0
        coding_review_pending = 0
        coding_score_acc = 0
        coding_max_acc = 0
        coding_score_seen = False
        coding_max_seen = False
        has_subjective = False
        overall_total = 0
        overall_correct = 0
        overall_incorrect = 0
        overall_pending = 0
        question_results: list[MeExamQuestionResult] = []

        for answer, question in answers_by_submission.get(submission.id, []):
            verdict = _resolve_me_question_verdict(answer, question)
            skill_keywords = _extract_question_skill_keywords(question)
            question_results.append(
                MeExamQuestionResult(
                    question_id=question.id,
                    question_order=question.order_index,
                    question_type=question.type,
                    prompt_preview=_build_prompt_preview(question.prompt_md),
                    verdict=verdict,
                    skill_keywords=skill_keywords,
                )
            )

            overall_total += 1
            if verdict == "correct":
                overall_correct += 1
            elif verdict == "incorrect":
                overall_incorrect += 1
            else:
                overall_pending += 1

            if question.type == "multiple_choice":
                if question.correct_choice_index is None:
                    continue
                objective_total += 1
                if answer.selected_choice_index is not None:
                    objective_answered += 1
                if answer.selected_choice_index == question.correct_choice_index:
                    objective_correct += 1
                elif answer.selected_choice_index is None:
                    objective_pending += 1
                else:
                    objective_incorrect += 1
                continue

            if question.type == "coding":
                coding_total += 1
                if answer.grading_status == "GRADED":
                    coding_graded += 1
                elif answer.grading_status == "FAILED":
                    coding_failed += 1
                else:
                    coding_pending += 1
                if answer.grading_score is not None:
                    coding_score_acc += int(answer.grading_score)
                    coding_score_seen = True
                if answer.grading_max_score is not None:
                    coding_max_acc += int(answer.grading_max_score)
                    coding_max_seen = True
                if verdict == "correct":
                    coding_correct += 1
                elif verdict == "incorrect":
                    coding_incorrect += 1
                elif verdict == "review_pending":
                    coding_review_pending += 1
                continue

            if question.type == "subjective":
                has_subjective = True
                subjective_total += 1
                if verdict == "correct":
                    subjective_correct += 1
                elif verdict == "incorrect":
                    subjective_incorrect += 1
                else:
                    subjective_pending += 1

        strong_skill_keywords, weak_skill_keywords = _compute_submission_skill_keywords(question_results)

        payload.append(
            MeExamResultSummary(
                submission_id=submission.id,
                exam_id=exam.id,
                exam_title=exam.title,
                exam_kind=exam.exam_kind,
                status=submission.status,
                submitted_at=submission.submitted_at,
                objective_total=objective_total,
                objective_answered=objective_answered,
                objective_correct=objective_correct,
                coding_total=coding_total,
                coding_graded=coding_graded,
                coding_failed=coding_failed,
                coding_pending=coding_pending,
                coding_score=coding_score_acc if coding_score_seen else None,
                coding_max_score=coding_max_acc if coding_max_seen else None,
                has_subjective=has_subjective,
                grading_ready=submission.status == "GRADED" and results_published,
                results_published=results_published,
                results_published_at=results_published_at,
                objective_pending=objective_pending,
                objective_incorrect=objective_incorrect,
                subjective_total=subjective_total,
                subjective_correct=subjective_correct,
                subjective_incorrect=subjective_incorrect,
                subjective_pending=subjective_pending,
                coding_correct=coding_correct,
                coding_incorrect=coding_incorrect,
                coding_review_pending=coding_review_pending,
                overall_total=overall_total,
                overall_correct=overall_correct,
                overall_incorrect=overall_incorrect,
                overall_pending=overall_pending,
                strong_skill_keywords=strong_skill_keywords,
                weak_skill_keywords=weak_skill_keywords,
                question_results=question_results,
            )
        )
    return payload


@app.get("/admin/grading/exam-submissions", response_model=list[AdminGradingSubmissionSummary])
async def list_admin_grading_exam_submissions(
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    exam_id: Annotated[int | None, Query(ge=1)] = None,
    status_filter: Annotated[str, Query(alias="status")] = "all",
    coding_only: bool = True,
    needs_review_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[AdminGradingSubmissionSummary]:
    normalized_status = status_filter.strip().upper()
    allowed_statuses = {"ALL", "SUBMITTED", "QUEUED", "RUNNING", "GRADED", "FAILED"}
    if normalized_status not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="status는 all, submitted, queued, running, graded, failed 중 하나여야 합니다.",
        )

    query = (
        select(ExamSubmission, Exam, User)
        .join(Exam, Exam.id == ExamSubmission.exam_id)
        .join(User, User.id == ExamSubmission.user_id)
        .order_by(ExamSubmission.id.desc())
        .limit(limit)
    )
    if exam_id is not None:
        query = query.where(ExamSubmission.exam_id == exam_id)
    if normalized_status != "ALL":
        query = query.where(ExamSubmission.status == normalized_status)

    rows = (await session.execute(query)).all()
    if not rows:
        return []

    submission_ids = [submission.id for submission, _, _ in rows]
    grading_rows = (
        await session.execute(
            select(
                ExamAnswer.exam_submission_id,
                ExamAnswer.grading_status,
                ExamAnswer.grading_feedback_json,
                ExamQuestion.type,
                ExamQuestion.answer_key_text,
            )
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(
                ExamAnswer.exam_submission_id.in_(submission_ids),
            )
        )
    ).all()
    auto_grade_stats: dict[int, dict[str, int]] = defaultdict(
        lambda: {"total": 0, "graded": 0, "failed": 0, "pending": 0, "review_pending": 0}
    )
    coding_question_counts: defaultdict[int, int] = defaultdict(int)
    for submission_id, grading_status, grading_feedback_json, question_type, answer_key_text in grading_rows:
        if question_type == "coding":
            coding_question_counts[int(submission_id)] += 1
        if question_type not in {"subjective", "coding"} or not bool((answer_key_text or "").strip()):
            continue
        stat = auto_grade_stats[int(submission_id)]
        stat["total"] += 1
        if grading_status == "GRADED":
            stat["graded"] += 1
        elif grading_status == "FAILED":
            stat["failed"] += 1
        else:
            stat["pending"] += 1
        if _feedback_needs_review(grading_feedback_json):
            stat["review_pending"] += 1

    payload: list[AdminGradingSubmissionSummary] = []
    for submission, exam, actor in rows:
        stat = auto_grade_stats[int(submission.id)]
        if stat["total"] == 0:
            continue
        if coding_only and coding_question_counts[int(submission.id)] == 0:
            continue
        if needs_review_only and stat["review_pending"] == 0:
            continue
        results_published, results_published_at, results_publish_scope = _resolve_submission_result_visibility(
            exam, submission
        )
        payload.append(
            AdminGradingSubmissionSummary(
                submission_id=submission.id,
                exam_id=exam.id,
                exam_title=exam.title,
                exam_kind=exam.exam_kind,
                user_id=actor.id,
                user_name=actor.display_name,
                username=actor.username,
                status=submission.status,
                submitted_at=submission.submitted_at,
                coding_question_count=stat["total"],
                coding_graded_count=stat["graded"],
                coding_failed_count=stat["failed"],
                coding_pending_count=stat["pending"],
                review_pending_count=stat["review_pending"],
                has_review_pending=stat["review_pending"] > 0,
                results_published=results_published,
                results_published_at=results_published_at,
                results_publish_scope=results_publish_scope,
            )
        )
    return payload


@app.post(
    "/admin/grading/exam-submissions/share",
    response_model=AdminSubmissionResultShareResponse,
)
async def share_admin_exam_submission_results(
    payload: AdminSubmissionResultShareRequest,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminSubmissionResultShareResponse:
    submission_ids = sorted({int(submission_id) for submission_id in payload.submission_ids if int(submission_id) > 0})
    if not submission_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="공유할 제출 ID를 1개 이상 선택해 주세요.")

    rows = (
        await session.execute(
            select(ExamSubmission)
            .where(ExamSubmission.id.in_(submission_ids))
            .order_by(ExamSubmission.id.asc())
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="공유 대상 제출을 찾을 수 없습니다.")

    publish = bool(payload.published)
    if publish:
        blocked_ids = [int(submission.id) for submission in rows if submission.status != "GRADED"]
        if blocked_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "채점이 완료된 제출만 공유할 수 있습니다. "
                    f"(미완료 제출 ID: {', '.join(str(submission_id) for submission_id in blocked_ids)})"
                ),
            )

        review_pending_counts = await _load_submission_review_pending_counts(
            session,
            [int(submission.id) for submission in rows],
        )
        review_blocked_ids = sorted(
            submission_id
            for submission_id, review_count in review_pending_counts.items()
            if review_count > 0
        )
        if review_blocked_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "검토 필요 상태(애매 판정)가 남아 있는 제출은 공유할 수 없습니다. "
                    "관리자 화면에서 먼저 수동 확정해 주세요. "
                    f"(검토 필요 제출 ID: {', '.join(str(submission_id) for submission_id in review_blocked_ids)})"
                ),
            )

    published_at = datetime.now(timezone.utc) if publish else None
    for submission in rows:
        submission.results_published = publish
        submission.results_published_at = published_at

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam_submission.results_share",
        resource_type="exam_submission",
        resource_id=",".join(str(submission.id) for submission in rows),
        metadata={
            "published": publish,
            "updated_count": len(rows),
            "submission_ids": [int(submission.id) for submission in rows],
            "exam_ids": sorted({int(submission.exam_id) for submission in rows}),
            "user_ids": sorted({int(submission.user_id) for submission in rows}),
        },
    )
    await session.commit()

    message = (
        f"{len(rows)}건 제출 결과를 해당 수강생에게 공유했습니다."
        if publish
        else f"{len(rows)}건 제출 결과 공유를 해제했습니다."
    )
    return AdminSubmissionResultShareResponse(
        updated_count=len(rows),
        message=message,
    )


@app.post("/admin/grading/exam-submissions/{submission_id}/enqueue", response_model=AdminGradingEnqueueResponse)
async def enqueue_admin_exam_submission_grading(
    submission_id: int,
    payload: AdminGradingEnqueueRequest,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminGradingEnqueueResponse:
    submission, target_count, queued, message = await _prepare_exam_submission_enqueue(
        session,
        submission_id=submission_id,
        force=bool(payload.force),
    )

    if not queued:
        return AdminGradingEnqueueResponse(
            submission_id=submission.id,
            exam_id=submission.exam_id,
            queued=False,
            status=submission.status,
            message=message,
        )

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam_submission.enqueue_grading",
        resource_type="exam_submission",
        resource_id=str(submission.id),
        metadata={
            "exam_id": submission.exam_id,
            "auto_grade_question_count": target_count,
            "force": bool(payload.force),
        },
    )
    await session.commit()

    try:
        grading_queue.enqueue("app.worker_tasks.grade_exam_submission_job", submission.id)
    except Exception as exc:
        submission.status = "FAILED"
        submission.note = f"grading queue enqueue failed: {exc}"
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="자동 채점 큐 등록에 실패했습니다. 잠시 후 다시 시도하세요.",
        ) from exc

    return AdminGradingEnqueueResponse(
        submission_id=submission.id,
        exam_id=submission.exam_id,
        queued=True,
        status=submission.status,
        message=message,
    )


@app.post(
    "/admin/grading/exam-submissions/{submission_id}/appeal-regrade",
    response_model=AdminAppealRegradeResponse,
)
async def request_admin_exam_submission_appeal_regrade(
    submission_id: int,
    payload: AdminAppealRegradeRequest,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminAppealRegradeResponse:
    row = (
        await session.execute(
            select(ExamSubmission, ExamAnswer, ExamQuestion)
            .join(ExamAnswer, ExamAnswer.exam_submission_id == ExamSubmission.id)
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(
                ExamSubmission.id == submission_id,
                ExamQuestion.id == payload.question_id,
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="이의제기 대상 답안을 찾을 수 없습니다.")

    submission, answer, question = row
    if question.type == "multiple_choice":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="객관식 문항은 이의제기 재채점 대상이 아닙니다.")
    if not bool((question.answer_key_text or "").strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="정답/채점 기준이 없는 문항은 재채점 대신 수동 채점을 사용해 주세요.",
        )

    previous_status = answer.grading_status
    previous_score = answer.grading_score
    answer.grading_feedback_json = _append_appeal_feedback(
        answer.grading_feedback_json,
        actor_user_id=admin_user.id,
        question_id=question.id,
        reason=payload.reason,
        model_override=_APPEAL_REGRADING_MODEL,
        previous_status=previous_status,
        previous_score=previous_score,
    )

    submission, target_count, queued, message = await _prepare_exam_submission_enqueue(
        session,
        submission_id=submission_id,
        force=True,
        target_question_id=payload.question_id,
        preserve_feedback_json=True,
    )

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam_submission.appeal_regrade",
        resource_type="exam_submission_answer",
        resource_id=str(answer.id),
        metadata={
            "exam_id": submission.exam_id,
            "submission_id": submission.id,
            "question_id": question.id,
            "question_type": question.type,
            "reason": payload.reason.strip() if payload.reason else None,
            "model_override": _APPEAL_REGRADING_MODEL,
            "previous_status": previous_status,
            "previous_score": previous_score,
            "auto_grade_question_count": target_count,
        },
    )
    await session.commit()

    if queued:
        try:
            grading_queue.enqueue("app.worker_tasks.grade_exam_submission_job", submission.id)
        except Exception as exc:
            submission.status = "FAILED"
            submission.note = f"grading queue enqueue failed: {exc}"
            await session.commit()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="재채점 큐 등록에 실패했습니다. 잠시 후 다시 시도하세요.",
            ) from exc

    return AdminAppealRegradeResponse(
        submission_id=submission.id,
        exam_id=submission.exam_id,
        question_id=question.id,
        queued=queued,
        status=submission.status,
        message=message if queued else f"재채점 대기열 등록 생략: {message}",
    )


@app.post(
    "/admin/grading/exam-submissions/{submission_id}/answers/{question_id}/manual-grade",
    response_model=AdminManualGradeResponse,
)
async def manual_grade_admin_exam_submission_answer(
    submission_id: int,
    question_id: int,
    payload: AdminManualGradeRequest,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminManualGradeResponse:
    score = 100 if payload.is_correct else 0
    reason = (
        payload.note.strip()
        if payload.note and payload.note.strip()
        else ("관리자가 수동 채점으로 정답 처리했습니다." if payload.is_correct else "관리자가 수동 채점으로 오답 처리했습니다.")
    )

    submission = await session.scalar(select(ExamSubmission).where(ExamSubmission.id == submission_id))
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="제출을 찾을 수 없습니다.")

    row = (
        await session.execute(
            select(ExamAnswer, ExamQuestion)
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(
                ExamAnswer.exam_submission_id == submission_id,
                ExamQuestion.id == question_id,
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="문항 답안을 찾을 수 없습니다.")

    answer, question = row
    if question.type == "multiple_choice":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="객관식 문항은 수동 채점 대상이 아닙니다.")

    answer.grading_status = "GRADED"
    answer.grading_score = score
    answer.grading_max_score = 100
    answer.grading_feedback_json = {
        "source": "manual",
        "is_correct": payload.is_correct,
        "reason": reason,
        "note": (payload.note.strip() if payload.note else None),
        "needs_review": False,
        "review_reason_code": None,
        "review_reason_ko": None,
        "verdict": "CORRECT" if payload.is_correct else "INCORRECT",
    }
    answer.grading_logs = reason
    answer.graded_at = datetime.now(timezone.utc)

    all_rows = (
        await session.execute(
            select(ExamAnswer, ExamQuestion)
            .join(ExamQuestion, ExamQuestion.id == ExamAnswer.exam_question_id)
            .where(ExamAnswer.exam_submission_id == submission_id)
            .order_by(ExamQuestion.order_index.asc())
        )
    ).all()
    submission.status = _resolve_submission_status_from_answers(submission, all_rows)

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam_submission.manual_grade_answer",
        resource_type="exam_submission_answer",
        resource_id=str(answer.id),
        metadata={
            "submission_id": submission.id,
            "exam_id": submission.exam_id,
            "question_id": question.id,
            "question_type": question.type,
            "is_correct": payload.is_correct,
            "score": score,
        },
    )
    await session.commit()

    return AdminManualGradeResponse(
        submission_id=submission.id,
        exam_id=submission.exam_id,
        question_id=question.id,
        grading_status=answer.grading_status or "GRADED",
        grading_score=score,
        grading_max_score=100,
        submission_status=submission.status,
        message="수동 채점을 반영했습니다.",
    )


@app.put("/admin/skills/{skill_id}", response_model=SkillResponse)
async def update_skill(
    skill_id: int,
    payload: SkillUpdate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> SkillResponse:
    result = await session.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")

    if payload.name is not None:
        skill.name = payload.name
    if payload.description is not None:
        skill.description = payload.description

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="skill.update",
        resource_type="skill",
        resource_id=str(skill_id),
        metadata={"name": skill.name},
    )
    await session.commit()
    await session.refresh(skill)
    return SkillResponse(id=skill.id, name=skill.name, description=skill.description)
