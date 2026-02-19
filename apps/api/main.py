from __future__ import annotations

import asyncio
import hashlib
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUNDLE_MAX_SIZE_BYTES, access_token_ttl
from app.db import check_db_connection, get_async_session
from app.deps import get_current_user, require_admin
from app.models import Grade, GradeRun, Problem, ProblemVersion, ProblemVersionSkill, Skill, Submission, SubmissionStatus, User
from app.queue import grading_queue
from app.schemas import (
    AuthTokenResponse,
    AdminSubmissionDetailResponse,
    BundleUploadResponse,
    GradeResponse,
    GradeRunResponse,
    LoginRequest,
    MeProgressResponse,
    MeResponse,
    ProblemCreate,
    ProblemDetail,
    ProblemListItem,
    ProblemResponse,
    ProblemVersionCreate,
    ProblemVersionDetail,
    ProblemVersionSkillResponse,
    ProblemVersionSummary,
    ProgressRecentSubmission,
    ProgressSkillItem,
    RegradeResponse,
    RunPublicRequest,
    RunPublicResponse,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
    SubmissionCreate,
    SubmissionResponse,
)
from app.security import create_access_token, verify_password
from app.storage import storage
from app.worker_tasks import run_public_tests_for_bundle

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
async def health_db() -> JSONResponse:
    ok = await check_db_connection()
    if ok:
        return JSONResponse(content={"db": "ok"}, status_code=status.HTTP_200_OK)
    return JSONResponse(content={"db": "error"}, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)


@app.post("/auth/login", response_model=AuthTokenResponse)
async def login(payload: LoginRequest, session: Annotated[AsyncSession, Depends(get_async_session)]) -> AuthTokenResponse:
    result = await session.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(subject=user.email, role=user.role, expires_delta=access_token_ttl())
    return AuthTokenResponse(access_token=token, token_type="bearer")


@app.post("/auth/logout")
def logout() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/me", response_model=MeResponse)
async def me(user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(id=user.id, email=user.email, role=user.role, created_at=user.created_at)


@app.get("/me/progress", response_model=MeProgressResponse)
async def me_progress(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> MeProgressResponse:
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
        .where(Submission.user_id == user.id)
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
        .where(Submission.user_id == user.id)
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

    return MeProgressResponse(skills=skills, recent_submissions=recent_submissions)


@app.get("/admin/health")
async def admin_health(_: Annotated[User, Depends(require_admin)]) -> dict[str, str]:
    return {"admin": "ok"}


@app.post("/admin/problem-versions/{problem_version_id}/bundle", response_model=BundleUploadResponse)
async def upload_problem_bundle(
    problem_version_id: int,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    file: UploadFile = File(...),
) -> BundleUploadResponse:
    version = await session.scalar(select(ProblemVersion).where(ProblemVersion.id == problem_version_id))
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem version not found")

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .zip bundle is allowed")

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
        bundle_key, bundle_size = storage.save_bundle(problem_version_id, temp_path, digest)
    finally:
        temp_path.unlink(missing_ok=True)

    version.bundle_key = bundle_key
    version.bundle_sha256 = digest
    version.bundle_size = bundle_size
    await session.commit()

    return BundleUploadResponse(
        problem_version_id=problem_version_id,
        bundle_key=bundle_key,
        bundle_sha256=digest,
        bundle_size=bundle_size,
    )


@app.post("/admin/skills", response_model=SkillResponse)
async def create_skill(
    payload: SkillCreate,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> SkillResponse:
    skill = Skill(name=payload.name, description=payload.description)
    session.add(skill)
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
    _: Annotated[User, Depends(require_admin)],
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

    await session.commit()
    await session.refresh(skill)
    return SkillResponse(id=skill.id, name=skill.name, description=skill.description)


@app.post("/admin/problems", response_model=ProblemResponse)
async def create_problem(
    payload: ProblemCreate,
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> ProblemResponse:
    problem = Problem(title=payload.title)
    session.add(problem)
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
    _: Annotated[User, Depends(require_admin)],
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


async def _latest_version_summary(
    session: AsyncSession,
    problem_id: int,
) -> ProblemVersionSummary | None:
    latest = await session.scalar(
        select(ProblemVersion)
        .where(ProblemVersion.problem_id == problem_id)
        .order_by(ProblemVersion.version.desc())
        .limit(1)
    )
    if latest is None:
        return None

    return ProblemVersionSummary(
        id=latest.id,
        version=latest.version,
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
        .where(ProblemVersion.problem_id == problem_id)
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
            .where(ProblemVersion.problem_id == problem_id)
            .order_by(ProblemVersion.version.desc())
            .limit(1)
        )
    else:
        version = await session.scalar(
            select(ProblemVersion).where(
                ProblemVersion.problem_id == problem_id,
                ProblemVersion.version == payload.problem_version,
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

    submission = Submission(
        user_id=user.id,
        problem_version_id=payload.problem_version_id,
        code_text=payload.code_text,
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
    _: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> RegradeResponse:
    submission = await session.scalar(select(Submission).where(Submission.id == submission_id))
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    submission.status = SubmissionStatus.QUEUED.value
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
