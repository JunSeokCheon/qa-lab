from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
from os.path import commonpath
from pathlib import Path
from typing import Any
from zipfile import ZipFile
import shutil as shutil_lib
import stat

import yaml
from sqlalchemy import func, select

from app.config import (
    BUNDLE_MAX_ENTRIES,
    BUNDLE_MAX_UNCOMPRESSED_BYTES,
    GRADER_IMAGE,
    GRADING_RETRY_BACKOFF_SECONDS,
    GRADING_RETRY_MAX_ATTEMPTS,
    GRADING_STUCK_TIMEOUT_SECONDS,
    GRADER_TIMEOUT_SECONDS,
    MAX_LOG_BYTES,
)
from app.db import AsyncSessionLocal
from app.models import Grade, GradeRun, ProblemVersion, Submission, SubmissionStatus
from app.storage import storage

MAX_OUTPUT_BYTES = MAX_LOG_BYTES
NON_RETRYABLE_ERROR_MARKERS = (
    "bundle sha256 mismatch",
    "bundle extract failed",
    "bundle missing test target",
)


def grade_submission_job(submission_id: int) -> None:
    print(f"[worker] start grading submission_id={submission_id}")
    asyncio.run(_grade_submission_async(submission_id))
    print(f"[worker] finished grading submission_id={submission_id}")


def _combine_logs(stdout: str, stderr: str) -> str:
    merged = f"[stdout]\n{stdout}\n\n[stderr]\n{stderr}".strip()
    return _truncate_output(merged, MAX_OUTPUT_BYTES)


def _is_retryable_failure(error_message: str) -> bool:
    lowered = (error_message or "").lower()
    return not any(marker in lowered for marker in NON_RETRYABLE_ERROR_MARKERS)


async def requeue_stale_running_submissions(
    stale_seconds: int | None = None,
    max_requeue: int = 100,
) -> dict[str, object]:
    threshold_seconds = stale_seconds or GRADING_STUCK_TIMEOUT_SECONDS
    threshold_seconds = max(int(threshold_seconds), 1)
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=threshold_seconds)

    async with AsyncSessionLocal() as session:
        running_count = await session.scalar(
            select(func.count(Submission.id)).where(Submission.status == SubmissionStatus.RUNNING.value)
        )
        rows = await session.execute(
            select(Submission)
            .where(
                Submission.status == SubmissionStatus.RUNNING.value,
                Submission.created_at < cutoff,
            )
            .order_by(Submission.id.asc())
            .limit(max_requeue)
        )
        stale_submissions = rows.scalars().all()

        submission_ids = [submission.id for submission in stale_submissions]
        for submission in stale_submissions:
            submission.status = SubmissionStatus.QUEUED.value

        await session.commit()

    return {
        "stale_seconds": threshold_seconds,
        "scanned_running": int(running_count or 0),
        "requeued_submission_ids": submission_ids,
    }


async def _grade_submission_async(submission_id: int) -> None:
    async with AsyncSessionLocal() as session:
        submission = await session.scalar(select(Submission).where(Submission.id == submission_id))
        if submission is None:
            print(f"[worker] submission not found submission_id={submission_id}")
            return

        version = await session.scalar(select(ProblemVersion).where(ProblemVersion.id == submission.problem_version_id))
        if version is None:
            submission.status = SubmissionStatus.FAILED.value
            await session.commit()
            print(f"[worker] problem version not found submission_id={submission_id}")
            return

        bundle_key = submission.bundle_key_snapshot or version.bundle_key
        bundle_sha256 = submission.bundle_sha256_snapshot or version.bundle_sha256
        if not bundle_key:
            submission.status = SubmissionStatus.FAILED.value
            await session.commit()
            print(f"[worker] bundle not configured problem_version_id={version.id}")
            return

        submission.status = SubmissionStatus.RUNNING.value
        await session.commit()

        attempts = max(GRADING_RETRY_MAX_ATTEMPTS, 1)

        for attempt in range(1, attempts + 1):
            started_at = datetime.now(timezone.utc)
            report, exit_code, stderr, stdout, _ = await asyncio.to_thread(
                _run_grader,
                submission_id=submission_id,
                bundle_key=bundle_key,
                code_text=submission.code_text,
                test_target="tests",
                expected_bundle_sha256=bundle_sha256,
            )
            finished_at = datetime.now(timezone.utc)
            logs = _combine_logs(stdout, stderr)

            if report is None:
                run = GradeRun(
                    submission_id=submission_id,
                    grader_image_tag=GRADER_IMAGE,
                    started_at=started_at,
                    finished_at=finished_at,
                    score=None,
                    feedback_json={"error": stderr, "attempt": attempt, "max_attempts": attempts},
                    exit_code=exit_code,
                    logs=logs,
                )
                session.add(run)

                should_retry = _is_retryable_failure(stderr) and attempt < attempts
                if should_retry:
                    submission.status = SubmissionStatus.RUNNING.value
                    await session.commit()
                    backoff_seconds = max(GRADING_RETRY_BACKOFF_SECONDS, 1) * attempt
                    print(
                        "[worker] transient grading failure: "
                        f"submission_id={submission_id} attempt={attempt}/{attempts} "
                        f"retry_in={backoff_seconds}s error={stderr}"
                    )
                    await asyncio.sleep(backoff_seconds)
                    continue

                submission.status = SubmissionStatus.FAILED.value
                await session.commit()
                print(
                    "[worker] grading failed: "
                    f"submission_id={submission_id} attempt={attempt}/{attempts} error={stderr}"
                )
                return

            score, feedback = _build_grade_feedback(
                report,
                version.max_score,
                exit_code,
                submission.rubric_version_snapshot or version.rubric_version,
            )
            run = GradeRun(
                submission_id=submission_id,
                grader_image_tag=GRADER_IMAGE,
                started_at=started_at,
                finished_at=finished_at,
                score=score,
                feedback_json=feedback,
                exit_code=exit_code,
                logs=logs,
            )
            session.add(run)

            grade = await session.scalar(select(Grade).where(Grade.submission_id == submission_id))
            if grade is None:
                grade = Grade(
                    submission_id=submission_id,
                    score=score,
                    max_score=version.max_score,
                    feedback_json=feedback,
                )
                session.add(grade)
            else:
                grade.score = score
                grade.max_score = version.max_score
                grade.feedback_json = feedback

            submission.status = SubmissionStatus.GRADED.value
            await session.commit()
            print(
                "[worker] graded "
                f"submission_id={submission_id} score={score}/{version.max_score} attempt={attempt}/{attempts}"
            )
            return


def _safe_extract_zip_bytes(zip_bytes: bytes, destination: Path) -> None:
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)

    with ZipFile(io.BytesIO(zip_bytes)) as zf:
        members = zf.infolist()
        if len(members) > BUNDLE_MAX_ENTRIES:
            raise ValueError("bundle has too many files")

        total_uncompressed = 0
        for member in members:
            total_uncompressed += int(member.file_size)
            if total_uncompressed > BUNDLE_MAX_UNCOMPRESSED_BYTES:
                raise ValueError("bundle uncompressed size is too large")

            mode = (member.external_attr >> 16) & 0o777777
            if stat.S_ISLNK(mode):
                raise ValueError(f"symlink entry is not allowed: {member.filename}")

        for member in members:
            member_name = member.filename
            if not member_name:
                continue

            target = (destination / member_name).resolve()
            if commonpath([str(target), str(destination)]) != str(destination):
                raise ValueError(f"Zip path traversal detected: {member_name}")

            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member, "r") as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)


def _load_rubric(workdir: Path) -> tuple[dict[str, int], int]:
    rubric_path = workdir / "rubric.yaml"
    if not rubric_path.exists():
        return {}, GRADER_TIMEOUT_SECONDS

    data = yaml.safe_load(rubric_path.read_text(encoding="utf-8")) or {}
    weights_raw = data.get("weights", {})
    weights: dict[str, int] = {}
    if isinstance(weights_raw, dict):
        for nodeid, value in weights_raw.items():
            try:
                weights[str(nodeid)] = int(value)
            except Exception:
                continue

    timeout_raw = data.get("time_limit_seconds", GRADER_TIMEOUT_SECONDS)
    try:
        timeout = int(timeout_raw)
    except Exception:
        timeout = GRADER_TIMEOUT_SECONDS

    timeout = max(1, min(timeout, GRADER_TIMEOUT_SECONDS))
    return weights, timeout


def _truncate_output(text: str, limit: int = MAX_OUTPUT_BYTES) -> str:
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= limit:
        return text
    clipped = encoded[:limit].decode("utf-8", errors="ignore")
    return f"{clipped}\n...<truncated>"


def _strip_hidden_lines(text: str) -> str:
    lines = text.splitlines()
    visible = [line for line in lines if "hidden" not in line.lower()]
    return "\n".join(visible)


def _run_grader(
    submission_id: int,
    bundle_key: str,
    code_text: str,
    test_target: str = "tests",
    expected_bundle_sha256: str | None = None,
) -> tuple[dict[str, Any] | None, int, str, str, int]:
    bundle_bytes = storage.read_bundle(bundle_key)
    if expected_bundle_sha256:
        digest = hashlib.sha256(bundle_bytes).hexdigest()
        if digest != expected_bundle_sha256:
            return None, 1, "bundle sha256 mismatch", "", 0

    with tempfile.TemporaryDirectory(prefix=f"submission-{submission_id}-") as tmp_dir:
        workdir = Path(tmp_dir)
        try:
            workdir.chmod(0o777)
        except OSError:
            # Best-effort permission widening for container mounts on CI runners.
            pass

        try:
            _safe_extract_zip_bytes(bundle_bytes, workdir)
        except Exception as exc:
            return None, 1, f"bundle extract failed: {exc}", "", 0

        starter_dir = workdir / "starter"
        if starter_dir.exists() and starter_dir.is_dir():
            for src in starter_dir.rglob("*"):
                if src.is_dir():
                    continue
                rel = src.relative_to(starter_dir)
                dst = workdir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)

        (workdir / "solution.py").write_text(code_text, encoding="utf-8")

        target_path = workdir / test_target
        if not target_path.exists():
            return None, 1, f"bundle missing test target: {test_target}", "", 0

        report_path = workdir / "report.json"
        weights, timeout_seconds = _load_rubric(workdir)

        docker_bin = os.getenv("DOCKER_BIN")
        if not docker_bin:
            docker_bin = shutil_lib.which("docker")
        if not docker_bin:
            for candidate in ("/usr/bin/docker", "/usr/local/bin/docker"):
                if Path(candidate).exists():
                    docker_bin = candidate
                    break
        if not docker_bin:
            return None, 1, "docker binary not found", "", 0

        cmd = [
            docker_bin,
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--security-opt",
            "no-new-privileges=true",
            "--cap-drop",
            "ALL",
            "--pids-limit",
            "256",
            "--cpus",
            "1.0",
            "--memory",
            "1g",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",
            "-e",
            "PYTHONDONTWRITEBYTECODE=1",
            "-e",
            "PYTHONPATH=/work",
            "-v",
            f"{workdir.resolve()}:/work:rw",
            GRADER_IMAGE,
            "sh",
            "-lc",
            f"cd /work && pytest -q -p no:cacheprovider --json-report --json-report-file=/work/report.json {test_target}",
        ]

        print("[worker] docker run:", " ".join(cmd))
        started_at = time.monotonic()

        try:
            completed = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
        except Exception as exc:
            duration_ms = int((time.monotonic() - started_at) * 1000)
            return None, 1, str(exc), "", duration_ms

        duration_ms = int((time.monotonic() - started_at) * 1000)
        stdout_limited = _truncate_output(_strip_hidden_lines((completed.stdout or "").strip()))
        stderr_limited = _truncate_output(_strip_hidden_lines((completed.stderr or "").strip()))

        if not report_path.exists():
            detail = f"exit={completed.returncode} stdout={stdout_limited} stderr={stderr_limited}"
            return None, completed.returncode, detail, stdout_limited, duration_ms

        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except Exception as exc:
            return None, completed.returncode, f"failed to parse report: {exc}", stdout_limited, duration_ms

        report["_rubric"] = {"time_limit_seconds": timeout_seconds, "weights": weights}
        return report, completed.returncode, stderr_limited, stdout_limited, duration_ms


def run_public_tests_for_bundle(
    problem_version: int,
    bundle_key: str,
    code_text: str,
    expected_bundle_sha256: str | None = None,
) -> dict[str, Any]:
    report, exit_code, stderr, stdout, duration_ms = _run_grader(
        submission_id=problem_version,
        bundle_key=bundle_key,
        code_text=code_text,
        test_target="tests/public",
        expected_bundle_sha256=expected_bundle_sha256,
    )

    if report is None:
        return {
            "status": "FAILED",
            "summary": {
                "problem_version": problem_version,
                "docker_exit_code": exit_code,
                "duration_ms": duration_ms,
                "stdout": stdout,
                "stderr": stderr,
            },
            "public_feedback": {"passed": 0, "total": 0, "failed_cases": []},
        }

    tests = report.get("tests", [])
    public_tests = [t for t in tests if "/public/" in str(t.get("nodeid", ""))]
    passed = sum(1 for t in public_tests if t.get("outcome") == "passed")
    failed_cases: list[dict[str, str]] = []
    for test in public_tests:
        if test.get("outcome") == "passed":
            continue
        failed_cases.append(
            {
                "name": str(test.get("nodeid", "")),
                "outcome": str(test.get("outcome", "failed")),
                "message": _truncate_output(str(test.get("longrepr", "")), 500),
            }
        )

    status_value = "PASSED" if passed == len(public_tests) and exit_code == 0 else "FAILED"
    return {
        "status": status_value,
        "summary": {
            "problem_version": problem_version,
            "docker_exit_code": exit_code,
            "duration_ms": duration_ms,
            "stdout": stdout,
            "stderr": stderr,
        },
        "public_feedback": {"passed": passed, "total": len(public_tests), "failed_cases": failed_cases},
    }


def _build_grade_feedback(
    report: dict[str, Any], max_score: int, exit_code: int, rubric_version: int | None = None
) -> tuple[int, dict[str, Any]]:
    tests = report.get("tests", [])

    public_tests = [t for t in tests if "/public/" in str(t.get("nodeid", ""))]
    hidden_tests = [t for t in tests if "/hidden/" in str(t.get("nodeid", ""))]

    rubric = report.get("_rubric", {})
    weights: dict[str, int] = rubric.get("weights", {}) if isinstance(rubric, dict) else {}

    total_weight = 0
    passed_weight = 0
    for test in tests:
        nodeid = str(test.get("nodeid", ""))
        weight = int(weights.get(nodeid, 1))
        total_weight += max(weight, 0)
        if test.get("outcome") == "passed":
            passed_weight += max(weight, 0)

    if total_weight <= 0:
        score = 0
    else:
        score = round(max_score * (passed_weight / total_weight))

    public_failed_cases = []
    for test in public_tests:
        if test.get("outcome") == "passed":
            continue
        public_failed_cases.append(
            {
                "name": test.get("nodeid"),
                "outcome": test.get("outcome"),
                "message": str(test.get("longrepr", ""))[:300],
            }
        )

    public_passed = sum(1 for t in public_tests if t.get("outcome") == "passed")
    hidden_passed = sum(1 for t in hidden_tests if t.get("outcome") == "passed")

    feedback = {
        "engine": "docker-pytest-json-report",
        "docker_exit_code": exit_code,
        "rubric_version": rubric_version,
        "public": {
            "passed": public_passed,
            "total": len(public_tests),
            "failed_cases": public_failed_cases,
        },
        "hidden": {
            "passed": hidden_passed,
            "total": len(hidden_tests),
            "failed_count": len(hidden_tests) - hidden_passed,
        },
        "summary": {
            "score": score,
            "max_score": max_score,
            "weighted_passed": passed_weight,
            "weighted_total": total_weight,
        },
    }

    return score, feedback
