from __future__ import annotations

import os
import time
import uuid
from typing import Any

import pytest
import requests

API_BASE_URL = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000")
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


def _login(username: str, password: str) -> str:
    response = requests.post(
        f"{API_BASE_URL}/auth/login",
        json={"username": username, "password": password},
        timeout=REQUEST_TIMEOUT,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return str(payload["access_token"])


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_exam(admin_token: str) -> dict[str, Any]:
    unique = uuid.uuid4().hex[:8]
    response = requests.post(
        f"{API_BASE_URL}/admin/exams",
        headers={**_auth_headers(admin_token), "Content-Type": "application/json"},
        json={
            "title": f"e2e-시험-{unique}",
            "description": "시험지 전용 e2e",
            "exam_kind": "quiz",
            "status": "published",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt_md": "1 + 1 = ?",
                    "required": True,
                    "choices": ["1", "2", "3"],
                    "correct_choice_index": 1,
                },
                {
                    "type": "subjective",
                    "prompt_md": "학습 소감을 간단히 작성하세요.",
                    "required": True,
                },
            ],
        },
        timeout=REQUEST_TIMEOUT,
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture(scope="module")
def tokens() -> tuple[str, str]:
    _wait_for_api()
    admin = _login("admin", "admin1234")
    student = _login("user", "user1234")
    return admin, student


def test_a_admin_create_exam_and_list(tokens: tuple[str, str]) -> None:
    admin_token, _ = tokens
    exam = _create_exam(admin_token)
    exam_id = int(exam["id"])

    list_response = requests.get(
        f"{API_BASE_URL}/admin/exams",
        headers=_auth_headers(admin_token),
        timeout=REQUEST_TIMEOUT,
    )
    assert list_response.status_code == 200, list_response.text
    ids = [int(item["id"]) for item in list_response.json()]
    assert exam_id in ids


def test_b_student_submit_exam_and_history(tokens: tuple[str, str]) -> None:
    admin_token, student_token = tokens
    exam = _create_exam(admin_token)
    exam_id = int(exam["id"])
    questions = exam["questions"]
    q1 = int(questions[0]["id"])
    q2 = int(questions[1]["id"])

    submit_response = requests.post(
        f"{API_BASE_URL}/exams/{exam_id}/submit",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={
            "answers": [
                {"question_id": q1, "selected_choice_index": 1},
                {"question_id": q2, "answer_text": "열심히 복습하겠습니다."},
            ]
        },
        timeout=REQUEST_TIMEOUT,
    )
    assert submit_response.status_code == 200, submit_response.text
    submission_id = int(submit_response.json()["submission_id"])

    me_history = requests.get(
        f"{API_BASE_URL}/me/exam-submissions?limit=20",
        headers=_auth_headers(student_token),
        timeout=REQUEST_TIMEOUT,
    )
    assert me_history.status_code == 200, me_history.text
    history_ids = [int(item["id"]) for item in me_history.json()]
    assert submission_id in history_ids

    admin_submissions = requests.get(
        f"{API_BASE_URL}/admin/exams/{exam_id}/submissions",
        headers=_auth_headers(admin_token),
        timeout=REQUEST_TIMEOUT,
    )
    assert admin_submissions.status_code == 200, admin_submissions.text
    rows = admin_submissions.json()
    assert any(int(item["submission_id"]) == submission_id for item in rows)


def test_c_student_cannot_submit_same_exam_twice(tokens: tuple[str, str]) -> None:
    admin_token, student_token = tokens
    exam = _create_exam(admin_token)
    exam_id = int(exam["id"])
    questions = exam["questions"]
    q1 = int(questions[0]["id"])
    q2 = int(questions[1]["id"])

    first = requests.post(
        f"{API_BASE_URL}/exams/{exam_id}/submit",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={
            "answers": [
                {"question_id": q1, "selected_choice_index": 1},
                {"question_id": q2, "answer_text": "첫 제출"},
            ]
        },
        timeout=REQUEST_TIMEOUT,
    )
    assert first.status_code == 200, first.text

    second = requests.post(
        f"{API_BASE_URL}/exams/{exam_id}/submit",
        headers={**_auth_headers(student_token), "Content-Type": "application/json"},
        json={
            "answers": [
                {"question_id": q1, "selected_choice_index": 2},
                {"question_id": q2, "answer_text": "두 번째 제출"},
            ]
        },
        timeout=REQUEST_TIMEOUT,
    )
    assert second.status_code == 409, second.text
