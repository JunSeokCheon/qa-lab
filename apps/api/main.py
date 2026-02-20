from __future__ import annotations

import asyncio
import hashlib
import io
import re
import tempfile
import time
import zipfile
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Annotated, Any
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    APP_ENV,
    ALLOWED_ORIGINS,
    BUNDLE_MAX_ENTRIES,
    BUNDLE_MAX_SIZE_BYTES,
    BUNDLE_MAX_UNCOMPRESSED_BYTES,
    GRADING_STUCK_TIMEOUT_SECONDS,
    LOGIN_RATE_LIMIT_ATTEMPTS,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    SUBMISSION_MAX_ACTIVE_PER_USER,
    SUBMISSION_QUEUE_MAX_DEPTH,
    access_token_ttl,
    password_reset_token_ttl,
)
from app.db import check_db_connection, get_async_session
from app.deps import get_current_user, require_admin
from app.models import (
    AdminAuditLog,
    Exam,
    ExamAnswer,
    ExamQuestion,
    ExamSubmission,
    Grade,
    GradeRun,
    MasterySnapshot,
    PasswordResetToken,
    Problem,
    ProblemFolder,
    ProblemVersion,
    ProblemVersionStatus,
    ProblemVersionSkill,
    RubricHistory,
    Skill,
    Submission,
    SubmissionStatus,
    User,
)
from app.observability import get_logger, log_event
from app.queue import check_redis_connection, clear_rate_limit, grading_queue, increment_rate_limit
from app.schemas import (
    AdminAuditLogResponse,
    AdminExamSubmissionDetail,
    AdminExamSubmissionAnswer,
    AuthTokenResponse,
    AdminSubmissionDetailResponse,
    BundleUploadResponse,
    ExamCreate,
    ExamDetail,
    ExamSubmitRequest,
    ExamSubmitResponse,
    ExamSubmissionSummary,
    ExamSummary,
    ExamQuestionSummary,
    GradeResponse,
    GradeRunResponse,
    LoginRequest,
    PasswordForgotRequest,
    PasswordForgotResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    MeProgressResponse,
    MeResponse,
    ProblemCreate,
    ProblemDetail,
    ProblemFolderCreate,
    ProblemFolderResponse,
    ProblemListItem,
    ProblemResponse,
    ProblemVersionCreate,
    ProblemVersionStatusUpdate,
    ProblemVersionDetail,
    ProblemVersionSkillResponse,
    ProblemVersionSummary,
    ProgressRecentSubmission,
    ProgressSkillItem,
    ProgressTrendItem,
    ProgressTrendPoint,
    RegradeResponse,
    RubricHistoryResponse,
    RunPublicRequest,
    RunPublicResponse,
    RegisterRequest,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
    SubmissionCreate,
    SubmissionResponse,
    WatchdogRequeueResponse,
)
from app.security import create_access_token, hash_password, verify_password
from app.storage import storage
from app.worker_tasks import requeue_stale_running_submissions, run_public_tests_for_bundle

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
_ALLOWED_BUNDLE_FILES = {"statement.md", "rubric.yaml"}
_ALLOWED_BUNDLE_DIRS = ("starter/", "tests/public/", "tests/hidden/")
_BLOCKED_BUNDLE_SUFFIXES = {
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bat",
    ".cmd",
    ".ps1",
    ".msi",
    ".com",
    ".jar",
    ".class",
}
_BLOCKED_NAME_PATTERNS = (
    re.compile(r"(^|/)\.(git|svn|hg)(/|$)", re.IGNORECASE),
    re.compile(r"(^|/)(__pycache__)(/|$)", re.IGNORECASE),
    re.compile(r"(^|/)(id_rsa|id_ed25519|\.env)(/|$)", re.IGNORECASE),
)
_BLOCKED_MAGIC_HEADERS = (
    b"MZ",  # Windows PE
    b"\x7fELF",  # Linux ELF
    b"\xca\xfe\xba\xbe",  # Java class
    b"PK\x03\x04",  # nested zip/jar
)
_PROBLEM_TYPE_ALIASES = {
    "coding": "coding",
    "code": "coding",
    "multiple_choice": "multiple_choice",
    "mcq": "multiple_choice",
    "objective": "multiple_choice",
    "subjective": "subjective",
    "short_answer": "subjective",
}
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


def _validate_bundle_member_name(name: str) -> None:
    normalized = name.replace("\\", "/")
    lowered = normalized.lower()

    if "\x00" in normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bundle contains invalid filename")
    if lowered.startswith("/") or lowered.startswith("./"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bundle contains invalid path")
    if ".." in lowered.split("/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bundle contains path traversal sequence")
    if lowered not in _ALLOWED_BUNDLE_FILES and not any(lowered.startswith(root) for root in _ALLOWED_BUNDLE_DIRS):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Bundle contains unsupported path: {name}")
    if Path(lowered).suffix in _BLOCKED_BUNDLE_SUFFIXES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Blocked file type in bundle: {name}")
    for pattern in _BLOCKED_NAME_PATTERNS:
        if pattern.search(lowered):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Suspicious file path in bundle: {name}")


def _validate_uploaded_zip(temp_path: Path) -> None:
    try:
        with zipfile.ZipFile(temp_path) as zf:
            members = zf.infolist()
            if len(members) > BUNDLE_MAX_ENTRIES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Bundle has too many files")

            total_uncompressed = 0
            for member in members:
                if not member.filename:
                    continue
                _validate_bundle_member_name(member.filename)
                total_uncompressed += int(member.file_size)
                if total_uncompressed > BUNDLE_MAX_UNCOMPRESSED_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Bundle uncompressed size is too large",
                    )
                if member.is_dir():
                    continue
                with zf.open(member, "r") as fp:
                    head = fp.read(8)
                if any(head.startswith(sig) for sig in _BLOCKED_MAGIC_HEADERS):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Blocked file signature detected in bundle: {member.filename}",
                    )
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid zip file") from exc


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or f"folder-{uuid4().hex[:8]}"


def _normalize_problem_type(raw_type: str) -> str:
    normalized = _PROBLEM_TYPE_ALIASES.get(raw_type.strip().lower())
    if normalized is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported problem type. Use coding, multiple_choice, or subjective.",
        )
    return normalized


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


def _sanitize_exam_question_choices(question_type: str, choices: list[str] | None) -> list[str] | None:
    if question_type != "multiple_choice":
        return None
    normalized_choices = [choice.strip() for choice in (choices or []) if choice.strip()]
    if len(normalized_choices) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="객관식 문항은 선택지 2개 이상이 필요합니다.")
    return normalized_choices


def _sanitize_question_meta(problem_type: str, question_meta_json: dict[str, Any] | None) -> dict[str, Any] | None:
    if problem_type == "multiple_choice":
        choices = list((question_meta_json or {}).get("choices") or [])
        return {"choices": choices}
    if problem_type == "subjective":
        return {"answer_format": "short_text"}
    return None


def _normalize_answer_text(text: str, *, case_sensitive: bool) -> str:
    collapsed = re.sub(r"\s+", " ", text.strip())
    return collapsed if case_sensitive else collapsed.lower()


def _validate_question_meta(problem_type: str, question_meta_json: dict[str, Any] | None) -> dict[str, Any] | None:
    data = question_meta_json or {}
    if problem_type == "coding":
        return None

    if problem_type == "multiple_choice":
        raw_choices = data.get("choices")
        if not isinstance(raw_choices, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="multiple_choice requires a choices list",
            )
        choices = [str(item).strip() for item in raw_choices if str(item).strip()]
        if len(choices) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="multiple_choice requires at least 2 non-empty choices",
            )

        correct_index_value = data.get("correct_index")
        if correct_index_value is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="multiple_choice requires correct_index",
            )
        try:
            correct_index = int(correct_index_value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="correct_index must be an integer",
            ) from exc
        if correct_index < 0 or correct_index >= len(choices):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="correct_index is out of range",
            )
        return {"choices": choices, "correct_index": correct_index}

    if problem_type == "subjective":
        case_sensitive = bool(data.get("case_sensitive", False))

        raw_answers = data.get("acceptable_answers")
        if raw_answers is None:
            raw_single = data.get("correct_text")
            raw_answers = [raw_single] if raw_single is not None else []
        if not isinstance(raw_answers, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="subjective requires acceptable_answers list or correct_text",
            )
        acceptable_answers = [str(item).strip() for item in raw_answers if str(item).strip()]
        if not acceptable_answers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="subjective requires at least one answer key",
            )
        return {"acceptable_answers": acceptable_answers, "case_sensitive": case_sensitive}

    return None


def _grade_non_coding_submission(version: ProblemVersion, submitted_text: str) -> tuple[int, dict[str, Any]]:
    question_type = version.type
    meta = version.question_meta_json or {}
    cleaned = submitted_text.strip()

    if question_type == "multiple_choice":
        choices = list(meta.get("choices") or [])
        correct_index = int(meta.get("correct_index", -1))
        selected_index: int | None = None
        if re.fullmatch(r"-?\d+", cleaned):
            submitted_number = int(cleaned)
            if 1 <= submitted_number <= len(choices):
                selected_index = submitted_number - 1
            elif 0 <= submitted_number < len(choices):
                selected_index = submitted_number
        if selected_index is None:
            submitted_key = cleaned.casefold()
            for idx, choice in enumerate(choices):
                if str(choice).strip().casefold() == submitted_key:
                    selected_index = idx
                    break
        is_correct = selected_index == correct_index
        score = version.max_score if is_correct else 0
        feedback = {
            "type": "multiple_choice",
            "is_correct": is_correct,
            "selected_index": selected_index,
            "selected_choice": choices[selected_index] if selected_index is not None and selected_index < len(choices) else None,
            "choice_count": len(choices),
        }
        return score, feedback

    if question_type == "subjective":
        case_sensitive = bool(meta.get("case_sensitive", False))
        expected_values = [str(item) for item in (meta.get("acceptable_answers") or [])]
        normalized_submitted = _normalize_answer_text(cleaned, case_sensitive=case_sensitive)
        is_correct = any(
            _normalize_answer_text(candidate, case_sensitive=case_sensitive) == normalized_submitted
            for candidate in expected_values
        )
        score = version.max_score if is_correct else 0
        feedback = {
            "type": "subjective",
            "is_correct": is_correct,
            "expected_count": len(expected_values),
            "case_sensitive": case_sensitive,
        }
        return score, feedback

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only coding problems are async graded")


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
        status=exam.status,
        question_count=question_count,
        submitted=submitted,
        created_at=exam.created_at,
        updated_at=exam.updated_at,
    )


def _extract_rubric_yaml(bundle_bytes: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as zf:
            with zf.open("rubric.yaml", "r") as fp:
                content = fp.read()
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bundle must include rubric.yaml") from exc
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid zip file") from exc

    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="rubric.yaml must be utf-8 text") from exc


def _request_context(request: Request) -> dict[str, str | None]:
    return {
        "method": request.method,
        "path": request.url.path,
        "request_id": getattr(request.state, "request_id", None),
        "client_ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username is required")
    client_host = request.client.host if request.client else "unknown"
    client_key = f"{client_host}:{username.lower()}"
    if _is_login_rate_limited(client_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many login attempts. Try again later.")

    result = await session.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    _reset_login_attempts(client_key)
    token = create_access_token(subject=user.username, role=user.role, expires_delta=access_token_ttl())
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
    if len(payload.password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")

    user = User(username=username, password_hash=hash_password(payload.password), role="user")
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return MeResponse(id=user.id, username=user.username, role=user.role, created_at=user.created_at)


@app.post("/auth/password/forgot", response_model=PasswordForgotResponse)
async def forgot_password(
    payload: PasswordForgotRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PasswordForgotResponse:
    username = payload.username.strip()
    user = await session.scalar(select(User).where(User.username == username))
    if user is None:
        return PasswordForgotResponse(message="If the account exists, reset instructions were generated.")

    raw_token = uuid4().hex
    expires_at = datetime.now(timezone.utc) + password_reset_token_ttl()
    reset = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_reset_token(raw_token),
        expires_at=expires_at,
    )
    session.add(reset)
    await session.commit()

    if APP_ENV in {"development", "dev", "test"}:
        return PasswordForgotResponse(
            message="Reset token generated (development mode).",
            reset_token=raw_token,
        )
    return PasswordForgotResponse(message="If the account exists, reset instructions were generated.")


@app.post("/auth/password/reset", response_model=PasswordResetResponse)
async def reset_password(
    payload: PasswordResetRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PasswordResetResponse:
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")

    hashed = _hash_reset_token(payload.token)
    reset_token = await session.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hashed))
    now = datetime.now(timezone.utc)
    if reset_token is None or reset_token.used_at is not None or reset_token.expires_at < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    user = await session.scalar(select(User).where(User.id == reset_token.user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")

    user.password_hash = hash_password(payload.new_password)
    reset_token.used_at = now
    await session.commit()
    return PasswordResetResponse(message="Password has been reset successfully")


@app.get("/me", response_model=MeResponse)
async def me(user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(id=user.id, username=user.username, role=user.role, created_at=user.created_at)


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
    rows = await session.execute(select(AdminAuditLog).order_by(AdminAuditLog.id.desc()).limit(limit))
    logs = rows.scalars().all()
    return [
        AdminAuditLogResponse(
            id=log.id,
            actor_user_id=log.actor_user_id,
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
        for log in logs
    ]


@app.post("/admin/problem-versions/{problem_version_id}/bundle", response_model=BundleUploadResponse)
async def upload_problem_bundle(
    problem_version_id: int,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    file: UploadFile = File(...),
) -> BundleUploadResponse:
    version = await session.scalar(select(ProblemVersion).where(ProblemVersion.id == problem_version_id))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem version not found")
    if version.type != "coding":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bundle upload is only supported for coding problems")

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .zip bundle is allowed")
    if file.content_type not in {"application/zip", "application/x-zip-compressed", "application/octet-stream"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid content type for zip bundle")

    sha256 = hashlib.sha256()
    total_size = 0

    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temp_file:
        temp_path = Path(temp_file.name)
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > BUNDLE_MAX_SIZE_BYTES:
                temp_file.close()
                temp_path.unlink(missing_ok=True)
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Bundle too large")
            sha256.update(chunk)
            temp_file.write(chunk)

    digest = sha256.hexdigest()
    try:
        _validate_uploaded_zip(temp_path)
        bundle_bytes = temp_path.read_bytes()
        rubric_yaml = _extract_rubric_yaml(bundle_bytes)
        rubric_sha256 = hashlib.sha256(rubric_yaml.encode("utf-8")).hexdigest()
        bundle_key, bundle_size = storage.save_bundle(problem_version_id, temp_path, digest)
    finally:
        temp_path.unlink(missing_ok=True)

    next_rubric_version = (
        await session.scalar(
            select(func.max(RubricHistory.rubric_version)).where(RubricHistory.problem_version_id == problem_version_id)
        )
        or 0
    ) + 1

    version.bundle_key = bundle_key
    version.bundle_sha256 = digest
    version.bundle_size = bundle_size
    version.rubric_version = int(next_rubric_version)
    session.add(
        RubricHistory(
            problem_version_id=problem_version_id,
            rubric_version=int(next_rubric_version),
            rubric_sha256=rubric_sha256,
            rubric_yaml=rubric_yaml,
            bundle_key=bundle_key,
        )
    )
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="problem_version.bundle_upload",
        resource_type="problem_version",
        resource_id=str(problem_version_id),
        metadata={"bundle_key": bundle_key, "bundle_size": bundle_size},
    )
    await session.commit()

    return BundleUploadResponse(
        problem_version_id=problem_version_id,
        bundle_key=bundle_key,
        bundle_sha256=digest,
        bundle_size=bundle_size,
        rubric_version=version.rubric_version,
    )


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


@app.post("/admin/exams", response_model=ExamDetail, status_code=status.HTTP_201_CREATED)
async def create_exam(
    payload: ExamCreate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ExamDetail:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시험 제목은 필수입니다.")
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
        status=_sanitize_exam_status(payload.status),
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
        )
        session.add(question)
        questions.append(question)

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="exam.create",
        resource_type="exam",
        resource_id=str(exam.id),
        metadata={"title": exam.title, "question_count": len(questions), "exam_kind": exam.exam_kind},
    )
    await session.commit()
    await session.refresh(exam)

    folder_path_map = await _load_folder_path_map(session)
    return ExamDetail(
        **_to_exam_summary(exam, folder_path_map=folder_path_map, question_count=len(questions), submitted=False).model_dump(),
        questions=[_to_exam_question_summary(question) for question in questions],
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
                    answer_text=answer.answer_text,
                    selected_choice_index=answer.selected_choice_index,
                )
            )
        payload.append(
            AdminExamSubmissionDetail(
                submission_id=submission.id,
                exam_id=exam.id,
                exam_title=exam.title,
                user_id=user.id,
                username=user.username,
                status=submission.status,
                submitted_at=submission.submitted_at,
                answers=answers,
            )
        )
    return payload


@app.get("/exams", response_model=list[ExamSummary])
async def list_exams(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[ExamSummary]:
    exams = (
        await session.execute(select(Exam).where(Exam.status == "published").order_by(Exam.id.asc()))
    ).scalars().all()
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
    if exam is None or exam.status != "published":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    questions = (
        await session.execute(select(ExamQuestion).where(ExamQuestion.exam_id == exam_id).order_by(ExamQuestion.order_index.asc()))
    ).scalars().all()
    folder_path_map = await _load_folder_path_map(session)
    submitted = (
        await session.scalar(
            select(func.count(ExamSubmission.id)).where(ExamSubmission.exam_id == exam_id, ExamSubmission.user_id == user.id)
        )
        or 0
    ) > 0

    return ExamDetail(
        **_to_exam_summary(
            exam,
            folder_path_map=folder_path_map,
            question_count=len(questions),
            submitted=submitted,
        ).model_dump(),
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
    if exam is None or exam.status != "published":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시험을 찾을 수 없습니다.")

    existing = await session.scalar(
        select(ExamSubmission).where(ExamSubmission.exam_id == exam_id, ExamSubmission.user_id == user.id)
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 제출한 시험입니다.")

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

    submission = ExamSubmission(exam_id=exam_id, user_id=user.id, status="SUBMITTED")
    session.add(submission)
    await session.flush()

    for question in questions:
        submitted = answer_by_question.get(question.id)
        selected_choice_index: int | None = None
        answer_text: str | None = None

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

        session.add(
            ExamAnswer(
                exam_submission_id=submission.id,
                exam_question_id=question.id,
                answer_text=answer_text,
                selected_choice_index=selected_choice_index,
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


@app.post("/admin/problems", response_model=ProblemResponse)
async def create_problem(
    payload: ProblemCreate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ProblemResponse:
    folder_id = payload.folder_id
    folder_path: str | None = None
    if folder_id is not None:
        folder = await session.scalar(select(ProblemFolder).where(ProblemFolder.id == folder_id))
        if folder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem folder not found")
        folder_path_map = await _load_folder_path_map(session)
        folder_path = folder_path_map.get(folder.id)

    problem = Problem(title=payload.title, folder_id=folder_id)
    session.add(problem)
    await session.flush()
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="problem.create",
        resource_type="problem",
        resource_id=str(problem.id),
        metadata={"title": problem.title, "folder_id": problem.folder_id},
    )
    await session.commit()
    await session.refresh(problem)
    return ProblemResponse(
        id=problem.id,
        title=problem.title,
        folder_id=problem.folder_id,
        folder_path=folder_path,
        created_at=problem.created_at,
        updated_at=problem.updated_at,
    )


@app.post("/admin/problems/{problem_id}/versions", response_model=ProblemVersionDetail)
async def create_problem_version(
    problem_id: int,
    payload: ProblemVersionCreate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ProblemVersionDetail:
    normalized_type = _normalize_problem_type(payload.type)
    validated_question_meta = _validate_question_meta(normalized_type, payload.question_meta_json)

    problem_result = await session.execute(select(Problem).where(Problem.id == problem_id))
    problem = problem_result.scalar_one_or_none()
    if problem is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem not found")

    for entry in payload.skills:
        skill_result = await session.execute(select(Skill).where(Skill.id == entry.skill_id))
        if skill_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Skill {entry.skill_id} not found",
            )

    current_max = await session.scalar(
        select(func.max(ProblemVersion.version)).where(ProblemVersion.problem_id == problem_id)
    )
    next_version = 1 if current_max is None else current_max + 1

    version = ProblemVersion(
        problem_id=problem_id,
        version=next_version,
        status=ProblemVersionStatus.PUBLISHED.value,
        type=normalized_type,
        difficulty=payload.difficulty,
        max_score=payload.max_score,
        statement_md=payload.statement_md,
        question_meta_json=validated_question_meta,
    )
    session.add(version)
    await session.flush()

    for skill_weight in payload.skills:
        session.add(
            ProblemVersionSkill(
                problem_version_id=version.id,
                skill_id=skill_weight.skill_id,
                weight=skill_weight.weight,
            )
        )

    problem.updated_at = func.now()
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="problem_version.create",
        resource_type="problem",
        resource_id=str(problem_id),
        metadata={"problem_version_id": version.id, "version": next_version, "type": version.type},
    )

    await session.commit()
    await session.refresh(version)

    skill_rows = await session.execute(
        select(ProblemVersionSkill, Skill)
        .join(Skill, Skill.id == ProblemVersionSkill.skill_id)
        .where(ProblemVersionSkill.problem_version_id == version.id)
    )

    skill_items = [
        ProblemVersionSkillResponse(skill_id=pvs.skill_id, skill_name=skill.name, weight=pvs.weight)
        for pvs, skill in skill_rows.all()
    ]

    return ProblemVersionDetail(
        id=version.id,
        version=version.version,
        status=version.status,
        rubric_version=version.rubric_version,
        type=version.type,
        difficulty=version.difficulty,
        max_score=version.max_score,
        question_meta=_sanitize_question_meta(version.type, version.question_meta_json),
        bundle_key=version.bundle_key,
        bundle_sha256=version.bundle_sha256,
        bundle_size=version.bundle_size,
        created_at=version.created_at,
        statement_md=version.statement_md,
        skills=skill_items,
    )


@app.put("/admin/problem-versions/{problem_version_id}/status", response_model=ProblemVersionDetail)
async def update_problem_version_status(
    problem_version_id: int,
    payload: ProblemVersionStatusUpdate,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ProblemVersionDetail:
    version = await session.scalar(select(ProblemVersion).where(ProblemVersion.id == problem_version_id))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem version not found")

    allowed = {ProblemVersionStatus.DRAFT.value, ProblemVersionStatus.PUBLISHED.value, ProblemVersionStatus.ARCHIVED.value}
    if payload.status not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid version status")
    version.status = payload.status

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="problem_version.status_update",
        resource_type="problem_version",
        resource_id=str(problem_version_id),
        metadata={"status": payload.status},
    )
    await session.commit()
    await session.refresh(version)

    skill_rows = await session.execute(
        select(ProblemVersionSkill, Skill)
        .join(Skill, Skill.id == ProblemVersionSkill.skill_id)
        .where(ProblemVersionSkill.problem_version_id == version.id)
    )
    skill_items = [
        ProblemVersionSkillResponse(skill_id=pvs.skill_id, skill_name=skill.name, weight=pvs.weight)
        for pvs, skill in skill_rows.all()
    ]
    return ProblemVersionDetail(
        id=version.id,
        version=version.version,
        status=version.status,
        rubric_version=version.rubric_version,
        type=version.type,
        difficulty=version.difficulty,
        max_score=version.max_score,
        question_meta=_sanitize_question_meta(version.type, version.question_meta_json),
        bundle_key=version.bundle_key,
        bundle_sha256=version.bundle_sha256,
        bundle_size=version.bundle_size,
        created_at=version.created_at,
        statement_md=version.statement_md,
        skills=skill_items,
    )


@app.get("/admin/problem-versions/{problem_version_id}/rubric-history", response_model=list[RubricHistoryResponse])
async def get_problem_version_rubric_history(
    problem_version_id: int,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> list[RubricHistoryResponse]:
    rows = await session.execute(
        select(RubricHistory)
        .where(RubricHistory.problem_version_id == problem_version_id)
        .order_by(RubricHistory.rubric_version.desc())
    )
    histories = rows.scalars().all()
    return [
        RubricHistoryResponse(
            id=history.id,
            problem_version_id=history.problem_version_id,
            rubric_version=history.rubric_version,
            rubric_sha256=history.rubric_sha256,
            bundle_key=history.bundle_key,
            created_at=history.created_at,
        )
        for history in histories
    ]


async def _latest_version_summary(
    session: AsyncSession,
    problem_id: int,
) -> ProblemVersionSummary | None:
    latest = await session.scalar(
        select(ProblemVersion)
        .where(
            ProblemVersion.problem_id == problem_id,
            ProblemVersion.status == ProblemVersionStatus.PUBLISHED.value,
        )
        .order_by(ProblemVersion.version.desc())
        .limit(1)
    )
    if latest is None:
        return None

    return ProblemVersionSummary(
        id=latest.id,
        version=latest.version,
        status=latest.status,
        rubric_version=latest.rubric_version,
        type=latest.type,
        difficulty=latest.difficulty,
        max_score=latest.max_score,
        question_meta=_sanitize_question_meta(latest.type, latest.question_meta_json),
        bundle_key=latest.bundle_key,
        created_at=latest.created_at,
    )


@app.get("/problems", response_model=list[ProblemListItem])
async def list_problems(session: Annotated[AsyncSession, Depends(get_async_session)]) -> list[ProblemListItem]:
    result = await session.execute(select(Problem).order_by(Problem.id.asc()))
    problems = result.scalars().all()
    folder_path_map = await _load_folder_path_map(session)

    items: list[ProblemListItem] = []
    for problem in problems:
        latest = await _latest_version_summary(session, problem.id)
        items.append(
            ProblemListItem(
                id=problem.id,
                title=problem.title,
                folder_id=problem.folder_id,
                folder_path=folder_path_map.get(problem.folder_id) if problem.folder_id is not None else None,
                created_at=problem.created_at,
                updated_at=problem.updated_at,
                latest_version=latest,
            )
        )
    return items


@app.get("/problems/{problem_id}", response_model=ProblemDetail)
async def get_problem(problem_id: int, session: Annotated[AsyncSession, Depends(get_async_session)]) -> ProblemDetail:
    problem = await session.scalar(select(Problem).where(Problem.id == problem_id))
    if problem is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem not found")
    folder_path_map = await _load_folder_path_map(session)

    latest = await session.scalar(
        select(ProblemVersion)
        .where(
            ProblemVersion.problem_id == problem_id,
            ProblemVersion.status == ProblemVersionStatus.PUBLISHED.value,
        )
        .order_by(ProblemVersion.version.desc())
        .limit(1)
    )

    latest_detail: ProblemVersionDetail | None = None
    if latest is not None:
        skill_rows = await session.execute(
            select(ProblemVersionSkill, Skill)
            .join(Skill, Skill.id == ProblemVersionSkill.skill_id)
            .where(ProblemVersionSkill.problem_version_id == latest.id)
        )
        skill_items = [
            ProblemVersionSkillResponse(skill_id=pvs.skill_id, skill_name=skill.name, weight=pvs.weight)
            for pvs, skill in skill_rows.all()
        ]
        latest_detail = ProblemVersionDetail(
            id=latest.id,
            version=latest.version,
            status=latest.status,
            rubric_version=latest.rubric_version,
            type=latest.type,
            difficulty=latest.difficulty,
            max_score=latest.max_score,
            question_meta=_sanitize_question_meta(latest.type, latest.question_meta_json),
            bundle_key=latest.bundle_key,
            bundle_sha256=latest.bundle_sha256,
            bundle_size=latest.bundle_size,
            created_at=latest.created_at,
            statement_md=latest.statement_md,
            skills=skill_items,
        )

    return ProblemDetail(
        id=problem.id,
        title=problem.title,
        folder_id=problem.folder_id,
        folder_path=folder_path_map.get(problem.folder_id) if problem.folder_id is not None else None,
        created_at=problem.created_at,
        updated_at=problem.updated_at,
        latest_version=latest_detail,
    )


@app.post("/problems/{problem_id}/run-public", response_model=RunPublicResponse)
async def run_public_tests(
    problem_id: int,
    payload: RunPublicRequest,
    _: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> RunPublicResponse:
    if payload.problem_version is None:
        version = await session.scalar(
            select(ProblemVersion)
            .where(
                ProblemVersion.problem_id == problem_id,
                ProblemVersion.status == ProblemVersionStatus.PUBLISHED.value,
            )
            .order_by(ProblemVersion.version.desc())
            .limit(1)
        )
    else:
        version = await session.scalar(
            select(ProblemVersion).where(
                ProblemVersion.problem_id == problem_id,
                ProblemVersion.version == payload.problem_version,
                ProblemVersion.status == ProblemVersionStatus.PUBLISHED.value,
            )
        )

    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem version not found")
    if version.type != "coding":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Run public tests is only supported for coding problems")
    if not version.bundle_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bundle not configured for problem version")

    result = await asyncio.to_thread(
        run_public_tests_for_bundle,
        version.version,
        version.bundle_key,
        payload.code_text,
        version.bundle_sha256,
    )
    return RunPublicResponse(**result)


def _to_grade_response(grade: Grade | None) -> GradeResponse | None:
    if grade is None:
        return None
    return GradeResponse(
        id=grade.id,
        submission_id=grade.submission_id,
        score=grade.score,
        max_score=grade.max_score,
        feedback_json=grade.feedback_json,
        created_at=grade.created_at,
    )


def _to_grade_run_response(run: GradeRun) -> GradeRunResponse:
    return GradeRunResponse(
        id=run.id,
        submission_id=run.submission_id,
        grader_image_tag=run.grader_image_tag,
        started_at=run.started_at,
        finished_at=run.finished_at,
        score=run.score,
        feedback_json=run.feedback_json,
        exit_code=run.exit_code,
        logs=run.logs,
        created_at=run.created_at,
    )


def _to_submission_response(submission: Submission, grade: Grade | None = None) -> SubmissionResponse:
    return SubmissionResponse(
        id=submission.id,
        user_id=submission.user_id,
        problem_version_id=submission.problem_version_id,
        code_text=submission.code_text,
        bundle_key_snapshot=submission.bundle_key_snapshot,
        bundle_sha256_snapshot=submission.bundle_sha256_snapshot,
        rubric_version_snapshot=submission.rubric_version_snapshot,
        status=submission.status,
        created_at=submission.created_at,
        grade=_to_grade_response(grade),
    )


@app.post("/submissions", response_model=SubmissionResponse)
async def create_submission(
    payload: SubmissionCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> SubmissionResponse:
    version = await session.scalar(select(ProblemVersion).where(ProblemVersion.id == payload.problem_version_id))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem version not found")
    if version.status != ProblemVersionStatus.PUBLISHED.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Problem version is not published")

    submitted_text = payload.code_text if payload.code_text is not None else payload.answer_text
    if submitted_text is None or not submitted_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission answer is required")

    if version.type == "coding":
        try:
            queue_depth = int(grading_queue.count)
        except Exception:
            queue_depth = 0
        if queue_depth >= SUBMISSION_QUEUE_MAX_DEPTH:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Grading queue is busy. Please try again shortly.",
            )

        active_count = await session.scalar(
            select(func.count(Submission.id)).where(
                Submission.user_id == user.id,
                Submission.status.in_([SubmissionStatus.QUEUED.value, SubmissionStatus.RUNNING.value]),
            )
        )
        if int(active_count or 0) >= SUBMISSION_MAX_ACTIVE_PER_USER:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many active submissions in progress. Please wait for grading to finish.",
            )

        submission = Submission(
            user_id=user.id,
            problem_version_id=payload.problem_version_id,
            code_text=submitted_text,
            bundle_key_snapshot=version.bundle_key,
            bundle_sha256_snapshot=version.bundle_sha256,
            rubric_version_snapshot=version.rubric_version,
            status=SubmissionStatus.QUEUED.value,
        )
        session.add(submission)
        await session.commit()
        await session.refresh(submission)
        grading_queue.enqueue("app.worker_tasks.grade_submission_job", submission.id)
        return _to_submission_response(submission)

    submission = Submission(
        user_id=user.id,
        problem_version_id=payload.problem_version_id,
        code_text=submitted_text,
        bundle_key_snapshot=version.bundle_key,
        bundle_sha256_snapshot=version.bundle_sha256,
        rubric_version_snapshot=version.rubric_version,
        status=SubmissionStatus.GRADED.value,
    )
    session.add(submission)
    await session.flush()

    score, feedback_json = _grade_non_coding_submission(version, submitted_text)
    grade = Grade(
        submission_id=submission.id,
        score=score,
        max_score=version.max_score,
        feedback_json=feedback_json,
    )
    session.add(grade)

    await session.commit()
    await session.refresh(submission)
    await session.refresh(grade)
    return _to_submission_response(submission, grade)


@app.get("/submissions/{submission_id}", response_model=SubmissionResponse)
async def get_submission(
    submission_id: int,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> SubmissionResponse:
    row = await session.execute(
        select(Submission, Grade)
        .outerjoin(Grade, Grade.submission_id == Submission.id)
        .where(Submission.id == submission_id)
    )
    result = row.first()
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    submission, grade = result
    if submission.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    return _to_submission_response(submission, grade)


@app.get("/admin/submissions/{submission_id}", response_model=AdminSubmissionDetailResponse)
async def admin_get_submission_detail(
    submission_id: int,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AdminSubmissionDetailResponse:
    row = await session.execute(
        select(Submission, Grade)
        .outerjoin(Grade, Grade.submission_id == Submission.id)
        .where(Submission.id == submission_id)
    )
    result = row.first()
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    submission, grade = result
    runs_rows = await session.execute(
        select(GradeRun).where(GradeRun.submission_id == submission_id).order_by(GradeRun.id.desc())
    )
    runs = runs_rows.scalars().all()

    base = _to_submission_response(submission, grade)
    return AdminSubmissionDetailResponse(**base.model_dump(), grade_runs=[_to_grade_run_response(run) for run in runs])


@app.post("/admin/submissions/{submission_id}/regrade", response_model=RegradeResponse)
async def admin_regrade_submission(
    submission_id: int,
    request: Request,
    admin_user: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> RegradeResponse:
    submission = await session.scalar(select(Submission).where(Submission.id == submission_id))
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    version = await session.scalar(select(ProblemVersion).where(ProblemVersion.id == submission.problem_version_id))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem version not found")

    if version.type == "coding":
        submission.status = SubmissionStatus.QUEUED.value
    else:
        score, feedback_json = _grade_non_coding_submission(version, submission.code_text)
        existing_grade = await session.scalar(select(Grade).where(Grade.submission_id == submission.id))
        if existing_grade is None:
            existing_grade = Grade(
                submission_id=submission.id,
                score=score,
                max_score=version.max_score,
                feedback_json=feedback_json,
            )
            session.add(existing_grade)
        else:
            existing_grade.score = score
            existing_grade.max_score = version.max_score
            existing_grade.feedback_json = feedback_json
        submission.status = SubmissionStatus.GRADED.value

    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="submission.regrade",
        resource_type="submission",
        resource_id=str(submission_id),
        metadata={"status": submission.status},
    )
    await session.commit()
    if version.type == "coding":
        grading_queue.enqueue("app.worker_tasks.grade_submission_job", submission.id)

    return RegradeResponse(
        status="queued" if version.type == "coding" else "graded",
        submission_id=submission.id,
        message="Regrade job enqueued" if version.type == "coding" else "Submission regraded immediately",
    )


@app.get("/me/submissions", response_model=list[SubmissionResponse])
async def get_my_submissions(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[SubmissionResponse]:
    rows = await session.execute(
        select(Submission, Grade)
        .outerjoin(Grade, Grade.submission_id == Submission.id)
        .where(Submission.user_id == user.id)
        .order_by(Submission.id.desc())
        .limit(limit)
    )

    return [_to_submission_response(submission, grade) for submission, grade in rows.all()]
