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
    Grade,
    GradeRun,
    MasterySnapshot,
    PasswordResetToken,
    Problem,
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
    AuthTokenResponse,
    AdminSubmissionDetailResponse,
    BundleUploadResponse,
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
    problem = Problem(title=payload.title)
    session.add(problem)
    await session.flush()
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="problem.create",
        resource_type="problem",
        resource_id=str(problem.id),
        metadata={"title": problem.title},
    )
    await session.commit()
    await session.refresh(problem)
    return ProblemResponse(
        id=problem.id,
        title=problem.title,
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
        type=payload.type,
        difficulty=payload.difficulty,
        max_score=payload.max_score,
        statement_md=payload.statement_md,
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
        metadata={"problem_version_id": version.id, "version": next_version},
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
        bundle_key=latest.bundle_key,
        created_at=latest.created_at,
    )


@app.get("/problems", response_model=list[ProblemListItem])
async def list_problems(session: Annotated[AsyncSession, Depends(get_async_session)]) -> list[ProblemListItem]:
    result = await session.execute(select(Problem).order_by(Problem.id.asc()))
    problems = result.scalars().all()

    items: list[ProblemListItem] = []
    for problem in problems:
        latest = await _latest_version_summary(session, problem.id)
        items.append(
            ProblemListItem(
                id=problem.id,
                title=problem.title,
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

    version = await session.scalar(select(ProblemVersion).where(ProblemVersion.id == payload.problem_version_id))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem version not found")
    if version.status != ProblemVersionStatus.PUBLISHED.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Problem version is not published")

    submission = Submission(
        user_id=user.id,
        problem_version_id=payload.problem_version_id,
        code_text=payload.code_text,
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

    submission.status = SubmissionStatus.QUEUED.value
    await _write_admin_audit_log(
        session=session,
        request=request,
        actor_user_id=admin_user.id,
        action="submission.regrade",
        resource_type="submission",
        resource_id=str(submission_id),
        metadata={"status": SubmissionStatus.QUEUED.value},
    )
    await session.commit()
    grading_queue.enqueue("app.worker_tasks.grade_submission_job", submission.id)

    return RegradeResponse(
        status="queued",
        submission_id=submission.id,
        message="Regrade job enqueued",
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
