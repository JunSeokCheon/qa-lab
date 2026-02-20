from __future__ import annotations

import sys
from collections.abc import AsyncGenerator
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parents[2]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import main
from app.db import get_async_session
from app.deps import get_current_user, require_admin


class _FakeScalars:
    def __init__(self, items: list[object] | None = None) -> None:
        self._items = items or []

    def all(self) -> list[object]:
        return list(self._items)


class _FakeResult:
    def __init__(self, *, rows: list[object] | None = None, scalars: list[object] | None = None) -> None:
        self._rows = rows or []
        self._scalars = scalars or []

    def all(self) -> list[object]:
        return list(self._rows)

    def scalars(self) -> _FakeScalars:
        return _FakeScalars(self._scalars)


class _FakeSession:
    def __init__(self, scalars: list[object] | None = None) -> None:
        self._scalars = list(scalars or [])

    async def scalar(self, _query):  # noqa: ANN001
        if self._scalars:
            return self._scalars.pop(0)
        return None

    async def execute(self, _query):  # noqa: ANN001
        return _FakeResult()

    def add(self, _obj) -> None:  # noqa: ANN001
        return

    async def flush(self) -> None:
        return

    async def commit(self) -> None:
        return

    async def refresh(self, _obj) -> None:  # noqa: ANN001
        return


@pytest.fixture(autouse=True)
def clear_overrides() -> None:
    yield
    main.app.dependency_overrides.clear()


@pytest.fixture()
def client() -> TestClient:
    async def _override_user() -> object:
        return SimpleNamespace(id=100, username="user", role="user")

    async def _override_admin() -> object:
        return SimpleNamespace(id=1, username="admin", role="admin")

    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession()

    main.app.dependency_overrides[get_current_user] = _override_user
    main.app.dependency_overrides[require_admin] = _override_admin
    main.app.dependency_overrides[get_async_session] = _override_session
    return TestClient(main.app)


def test_create_exam_requires_at_least_one_question(client: TestClient) -> None:
    response = client.post(
        "/admin/exams",
        json={
            "title": "샘플 시험",
            "exam_kind": "quiz",
            "status": "published",
            "questions": [],
        },
    )
    assert response.status_code == 400
    assert "최소 1개" in response.text


def test_submit_exam_returns_404_when_exam_not_published(client: TestClient) -> None:
    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession(scalars=[SimpleNamespace(id=1, status="draft")])

    main.app.dependency_overrides[get_async_session] = _override_session
    response = client.post("/exams/1/submit", json={"answers": []})

    assert response.status_code == 404
    assert "시험을 찾을 수 없습니다" in response.text


def test_submit_exam_returns_409_when_already_submitted(client: TestClient) -> None:
    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession(
            scalars=[
                SimpleNamespace(id=1, status="published"),
                SimpleNamespace(id=10, exam_id=1, user_id=100),
            ]
        )

    main.app.dependency_overrides[get_async_session] = _override_session
    response = client.post("/exams/1/submit", json={"answers": []})

    assert response.status_code == 409
    assert "이미 제출" in response.text


def test_admin_exam_submissions_returns_404_for_missing_exam(client: TestClient) -> None:
    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession(scalars=[None])

    main.app.dependency_overrides[get_async_session] = _override_session
    response = client.get("/admin/exams/404/submissions")

    assert response.status_code == 404
    assert "시험을 찾을 수 없습니다" in response.text
