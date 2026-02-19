from __future__ import annotations

import hashlib
import io
import time
import uuid
import zipfile
from typing import Any

import pytest
import requests

API_BASE_URL = "http://127.0.0.1:8000"
REQUEST_TIMEOUT = 10
POLL_TIMEOUT_SECONDS = 60


def _wait_for_api() -> None:
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    last_error = ""
    while time.time() < deadline:
        try:
            response = requests.get(f"{API_BASE_URL}/health", timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                return
            last_error = f"status={response.status_code}"
        except requests.RequestException as exc:
            last_error = str(exc)
        time.sleep(1)
    raise AssertionError(f"API health check timed out: {last_error}")


def _login(email: str, password: str) -> str:
    response = requests.post(
        f"{API_BASE_URL}/auth/login",
        json={"email": email, "password": password},
        timeout=REQUEST_TIMEOUT,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return str(payload["access_token"])


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_bundle_zip(kind: str, *, malicious: bool = False) -> tuple[bytes, str]:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("statement.md", "# Bundle")
        zf.writestr("starter/README.md", "starter")
        zf.writestr("rubric.yaml", "time_limit_seconds: 20\nweights: {}\n")
        if malicious:
            zf.writestr("../escape.txt", "bad")
        if kind == "sum":
            zf.writestr(
                "tests/public/test_public.py",
                "from solution import solve\n\n"
                "def test_sum_public_1() -> None:\n"
                "    assert solve(2, 3) == 5\n\n"
                "def test_sum_public_2() -> None:\n"
                "    assert solve(10, 1) == 11\n",
            )
            zf.writestr(
                "tests/hidden/test_hidden.py",
                "from solution import solve\n\n"
                "def test_sum_hidden() -> None:\n"
                "    assert solve(100, 23) == 123\n",
            )
        elif kind == "public-hidden-split":
            zf.writestr(
                "tests/public/test_public.py",
                "from solution import solve\n\n"
                "def test_public_easy() -> None:\n"
                "    assert solve(2) == 3\n",
            )
            zf.writestr(
                "tests/hidden/test_hidden.py",
                "from solution import solve\n\n"
                "def test_hidden_strict() -> None:\n"
                "    assert solve(10) == 21\n",
            )
        else:
            raise ValueError(f"unknown bundle kind: {kind}")

    data = buffer.getvalue()
    return data, hashlib.sha256(data).hexdigest()


def _create_problem_version(admin_token: str, *, suffix: str) -> tuple[int, int]:
    skill_response = requests.post(
        f"{API_BASE_URL}/admin/skills",
        headers={**_auth_headers(admin_token), "Content-Type": "application/json"},
        json={"name": f"skill-{suffix}", "description": "e2e"},
        timeout=REQUEST_TIMEOUT,
    )
    assert skill_response.status_code == 200, skill_response.text
    skill_id = int(skill_response.json()["id"])

    problem_response = requests.post(
        f"{API_BASE_URL}/admin/problems",
        headers={**_auth_headers(admin_token), "Content-Type": "application/json"},
        json={"title": f"problem-{suffix}"},
        timeout=REQUEST_TIMEOUT,
    )
    assert problem_response.status_code == 200, problem_response.text
    problem_id = int(problem_response.json()["id"])

    version_response = requests.post(
        f"{API_BASE_URL}/admin/problems/{problem_id}/versions",
        headers={**_auth_headers(admin_token), "Content-Type": "application/json"},
        json={
            "type": "coding",
            "difficulty": "easy",
            "max_score": 100,
            "statement_md": "# E2E",
            "skills": [{"skill_id": skill_id, "weight": 100}],
        },
        timeout=REQUEST_TIMEOUT,
    )
    assert version_response.status_code == 200, version_response.text
    version_id = int(version_response.json()["id"])
    return problem_id, version_id


def _create_skill(admin_token: str, *, name: str) -> int:
    skill_response = requests.post(
        f"{API_BASE_URL}/admin/skills",
        headers={**_auth_headers(admin_token), "Content-Type": "application/json"},
        json={"name": name, "description": "e2e"},
        timeout=REQUEST_TIMEOUT,
    )
    assert skill_response.status_code == 200, skill_response.text
    return int(skill_response.json()["id"])


def _create_problem_and_version_with_skills(
    admin_token: str,
    *,
    suffix: str,
    skill_weights: list[dict[str, int]],
) -> tuple[int, int]:
    problem_response = requests.post(
        f"{API_BASE_URL}/admin/problems",
        headers={**_auth_headers(admin_token), "Content-Type": "application/json"},
        json={"title": f"problem-{suffix}"},
        timeout=REQUEST_TIMEOUT,
    )
    assert problem_response.status_code == 200, problem_response.text
    problem_id = int(problem_response.json()["id"])

    version_response = requests.post(
        f"{API_BASE_URL}/admin/problems/{problem_id}/versions",
        headers={**_auth_headers(admin_token), "Content-Type": "application/json"},
        json={
            "type": "coding",
            "difficulty": "easy",
            "max_score": 100,
            "statement_md": "# E2E",
            "skills": skill_weights,
        },
        timeout=REQUEST_TIMEOUT,
    )
    assert version_response.status_code == 200, version_response.text
    version_id = int(version_response.json()["id"])
    return problem_id, version_id


def _upload_bundle(admin_token: str, version_id: int, bundle_bytes: bytes) -> dict[str, Any]:
    response = requests.post(
        f"{API_BASE_URL}/admin/problem-versions/{version_id}/bundle",
        headers=_auth_headers(admin_token),
        files={"file": ("bundle.zip", bundle_bytes, "application/zip")},
        timeout=REQUEST_TIMEOUT,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _poll_submission(user_token: str, submission_id: int) -> dict[str, Any]:
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    last_payload: dict[str, Any] = {}
    while time.time() < deadline:
        response = requests.get(
            f"{API_BASE_URL}/submissions/{submission_id}",
            headers=_auth_headers(user_token),
            timeout=REQUEST_TIMEOUT,
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        last_payload = payload
        if payload.get("status") in {"GRADED", "FAILED"}:
            return payload
        time.sleep(2)
    raise AssertionError(f"submission polling timed out: {last_payload}")


def _admin_submission_debug(admin_token: str, submission_id: int) -> dict[str, Any]:
    response = requests.get(
        f"{API_BASE_URL}/admin/submissions/{submission_id}",
        headers=_auth_headers(admin_token),
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        return {"error": f"admin detail fetch failed status={response.status_code}", "body": response.text}
    body = response.json()
    runs = body.get("grade_runs", [])
    latest_run = runs[0] if runs else None
    return {"status": body.get("status"), "latest_run": latest_run}


@pytest.fixture(scope="module")
def tokens() -> tuple[str, str]:
    _wait_for_api()
    admin = _login("admin@example.com", "admin1234")
    student = _login("user@example.com", "user1234")
    return admin, student


def test_a_admin_bundle_upload_submit_and_grade(tokens: tuple[str, str]) -> None:
    admin_token, student_token = tokens
    suffix = f"a-{uuid.uuid4().hex[:8]}"
    problem_id, version_id = _create_problem_version(admin_token, suffix=suffix)

    bundle_bytes, bundle_sha = _create_bundle_zip("sum")
    upload = _upload_bundle(admin_token, version_id, bundle_bytes)
    assert upload["bundle_sha256"] == bundle_sha
    assert int(upload["bundle_size"]) > 0

    problem_detail = requests.get(
        f"{API_BASE_URL}/problems/{problem_id}",
        timeout=REQUEST_TIMEOUT,
    )
    assert problem_detail.status_code == 200, problem_detail.text
    latest = problem_detail.json()["latest_version"]
    assert latest["id"] == version_id
    assert latest["bundle_key"] == upload["bundle_key"]
    assert latest["bundle_sha256"] == bundle_sha

    create_submission = requests.post(
        f"{API_BASE_URL}/submissions",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={"problem_version_id": version_id, "code_text": "def solve(a, b):\n    return a + b\n"},
        timeout=REQUEST_TIMEOUT,
    )
    assert create_submission.status_code == 200, create_submission.text
    submission_id = int(create_submission.json()["id"])

    final = _poll_submission(student_token, submission_id)
    debug_info = _admin_submission_debug(admin_token, submission_id)
    assert final["status"] == "GRADED", {"final": final, "debug": debug_info}
    assert final["grade"] is not None
    assert int(final["grade"]["score"]) == 100


def test_b_student_run_public(tokens: tuple[str, str]) -> None:
    admin_token, student_token = tokens
    suffix = f"b-{uuid.uuid4().hex[:8]}"
    problem_id, version_id = _create_problem_version(admin_token, suffix=suffix)
    bundle_bytes, _ = _create_bundle_zip("public-hidden-split")
    _upload_bundle(admin_token, version_id, bundle_bytes)

    response = requests.post(
        f"{API_BASE_URL}/problems/{problem_id}/run-public",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={"code_text": "def solve(n):\n    return n + 1\n"},
        timeout=REQUEST_TIMEOUT,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "PASSED", payload
    assert int(payload["public_feedback"]["passed"]) == int(payload["public_feedback"]["total"])
    assert int(payload["public_feedback"]["total"]) >= 1

    dumped = str(payload).lower()
    assert "hidden" not in dumped


def test_c_student_submit_hidden_grading(tokens: tuple[str, str]) -> None:
    admin_token, student_token = tokens
    suffix = f"c-{uuid.uuid4().hex[:8]}"
    problem_id, version_id = _create_problem_version(admin_token, suffix=suffix)
    bundle_bytes, _ = _create_bundle_zip("public-hidden-split")
    _upload_bundle(admin_token, version_id, bundle_bytes)

    submit = requests.post(
        f"{API_BASE_URL}/submissions",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={"problem_version_id": version_id, "code_text": "def solve(n):\n    return n + 1\n"},
        timeout=REQUEST_TIMEOUT,
    )
    assert submit.status_code == 200, submit.text
    submission_id = int(submit.json()["id"])

    final = _poll_submission(student_token, submission_id)
    debug_info = _admin_submission_debug(admin_token, submission_id)
    assert final["status"] == "GRADED", {"final": final, "debug": debug_info}
    assert final["grade"] is not None
    assert int(final["grade"]["score"]) < int(final["grade"]["max_score"])
    feedback = final["grade"]["feedback_json"]
    assert int(feedback["hidden"]["total"]) >= 1
    assert int(feedback["hidden"]["failed_count"]) >= 1
    assert "failed_cases" not in feedback["hidden"]

    admin_detail = requests.get(
        f"{API_BASE_URL}/admin/submissions/{submission_id}",
        headers=_auth_headers(admin_token),
        timeout=REQUEST_TIMEOUT,
    )
    assert admin_detail.status_code == 200, admin_detail.text
    runs = admin_detail.json()["grade_runs"]
    assert len(runs) >= 1
    assert runs[0]["exit_code"] in {0, 1}


def test_d_zip_slip_is_blocked_during_grading(tokens: tuple[str, str]) -> None:
    admin_token, student_token = tokens
    suffix = f"d-{uuid.uuid4().hex[:8]}"
    _, version_id = _create_problem_version(admin_token, suffix=suffix)
    bundle_bytes, _ = _create_bundle_zip("sum", malicious=True)
    _upload_bundle(admin_token, version_id, bundle_bytes)

    submit = requests.post(
        f"{API_BASE_URL}/submissions",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={"problem_version_id": version_id, "code_text": "def solve(a, b):\n    return a + b\n"},
        timeout=REQUEST_TIMEOUT,
    )
    assert submit.status_code == 200, submit.text
    submission_id = int(submit.json()["id"])

    final = _poll_submission(student_token, submission_id)
    assert final["status"] == "FAILED", final


def test_e_mastery_model_weighted_formula(tokens: tuple[str, str]) -> None:
    admin_token, student_token = tokens
    suffix = f"m-{uuid.uuid4().hex[:8]}"
    skill_a_name = f"skill-a-{suffix}"
    skill_b_name = f"skill-b-{suffix}"
    skill_a_id = _create_skill(admin_token, name=skill_a_name)
    skill_b_id = _create_skill(admin_token, name=skill_b_name)

    bundle_sum, _ = _create_bundle_zip("sum")

    # Submission 1: skill A only, full score expected.
    _, version_id_1 = _create_problem_and_version_with_skills(
        admin_token,
        suffix=f"{suffix}-1",
        skill_weights=[{"skill_id": skill_a_id, "weight": 100}],
    )
    _upload_bundle(admin_token, version_id_1, bundle_sum)
    submit_1 = requests.post(
        f"{API_BASE_URL}/submissions",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={"problem_version_id": version_id_1, "code_text": "def solve(a, b):\n    return a + b\n"},
        timeout=REQUEST_TIMEOUT,
    )
    assert submit_1.status_code == 200, submit_1.text
    final_1 = _poll_submission(student_token, int(submit_1.json()["id"]))
    assert final_1["status"] == "GRADED", final_1
    assert int(final_1["grade"]["score"]) == 100

    # Submission 2: skill A/B split, zero score expected.
    _, version_id_2 = _create_problem_and_version_with_skills(
        admin_token,
        suffix=f"{suffix}-2",
        skill_weights=[{"skill_id": skill_a_id, "weight": 50}, {"skill_id": skill_b_id, "weight": 50}],
    )
    _upload_bundle(admin_token, version_id_2, bundle_sum)
    submit_2 = requests.post(
        f"{API_BASE_URL}/submissions",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={"problem_version_id": version_id_2, "code_text": "def solve(a, b):\n    return a - b\n"},
        timeout=REQUEST_TIMEOUT,
    )
    assert submit_2.status_code == 200, submit_2.text
    final_2 = _poll_submission(student_token, int(submit_2.json()["id"]))
    assert final_2["status"] == "GRADED", final_2
    assert int(final_2["grade"]["score"]) == 0

    progress = requests.get(
        f"{API_BASE_URL}/me/progress",
        headers=_auth_headers(student_token),
        timeout=REQUEST_TIMEOUT,
    )
    assert progress.status_code == 200, progress.text
    items = progress.json()["skills"]
    by_name = {item["skill_name"]: item for item in items}
    assert skill_a_name in by_name, items
    assert skill_b_name in by_name, items

    skill_a = by_name[skill_a_name]
    skill_b = by_name[skill_b_name]

    # skill A: (100*100 + 0*50) / (100*100 + 100*50) * 100 = 66.67
    assert float(skill_a["earned_points"]) == pytest.approx(10000.0, abs=0.01)
    assert float(skill_a["possible_points"]) == pytest.approx(15000.0, abs=0.01)
    assert float(skill_a["mastery"]) == pytest.approx(66.67, abs=0.01)

    # skill B: (0*50) / (100*50) * 100 = 0
    assert float(skill_b["earned_points"]) == pytest.approx(0.0, abs=0.01)
    assert float(skill_b["possible_points"]) == pytest.approx(5000.0, abs=0.01)
    assert float(skill_b["mastery"]) == pytest.approx(0.0, abs=0.01)
