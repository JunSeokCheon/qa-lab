from __future__ import annotations

import io
import sys
import zipfile
from collections.abc import AsyncGenerator
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parents[2]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import main
from app.config import SUBMISSION_MAX_ACTIVE_PER_USER, SUBMISSION_QUEUE_MAX_DEPTH
from app.db import get_async_session
from app.deps import get_current_user, require_admin


class _FakeSession:
    def __init__(self, scalars: list[object] | None = None) -> None:
        self._scalars = list(scalars or [])

    async def scalar(self, _query):  # noqa: ANN001
        if self._scalars:
            return self._scalars.pop(0)
        return None

    async def execute(self, _query):  # noqa: ANN001
        return SimpleNamespace(all=lambda: [], scalars=lambda: SimpleNamespace(all=lambda: []))

    def add(self, _obj) -> None:  # noqa: ANN001
        return

    async def flush(self) -> None:
        return

    async def commit(self) -> None:
        return

    async def refresh(self, _obj) -> None:  # noqa: ANN001
        return


def _published_coding_version() -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        status="published",
        type="coding",
        bundle_key=None,
        bundle_sha256=None,
        rubric_version=1,
        max_score=100,
    )


def _make_zip_with_signature(sig: bytes, filename: str = "starter/bad.bin") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("statement.md", "# Statement")
        zf.writestr("rubric.yaml", "time_limit_seconds: 20\nweights: {}\n")
        zf.writestr("tests/public/test_public.py", "def test_ok():\n    assert True\n")
        zf.writestr("tests/hidden/test_hidden.py", "def test_hidden():\n    assert True\n")
        zf.writestr(filename, sig + b"payload")
    return buffer.getvalue()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    async def _override_user() -> object:
        return SimpleNamespace(id=100, username="user", role="user")

    async def _override_admin() -> object:
        return SimpleNamespace(id=1, username="admin", role="admin")

    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession()

    main.app.dependency_overrides[get_current_user] = _override_user
    main.app.dependency_overrides[require_admin] = _override_admin
    main.app.dependency_overrides[get_async_session] = _override_session
    monkeypatch.setattr(main, "grading_queue", SimpleNamespace(count=0, enqueue=lambda *_a, **_k: None))
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def clear_overrides() -> None:
    yield
    main.app.dependency_overrides.clear()


def test_create_submission_returns_429_when_queue_backpressure_hits(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession(scalars=[_published_coding_version()])

    main.app.dependency_overrides[get_async_session] = _override_session
    monkeypatch.setattr(
        main,
        "grading_queue",
        SimpleNamespace(count=SUBMISSION_QUEUE_MAX_DEPTH, enqueue=lambda *_a, **_k: None),
    )

    response = client.post(
        "/submissions",
        json={"problem_version_id": 1, "code_text": "print('x')"},
    )

    assert response.status_code == 429
    assert "queue" in response.text.lower()


def test_create_submission_returns_429_when_user_active_limit_hits(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession(scalars=[_published_coding_version(), SUBMISSION_MAX_ACTIVE_PER_USER])

    main.app.dependency_overrides[get_async_session] = _override_session
    monkeypatch.setattr(main, "grading_queue", SimpleNamespace(count=0, enqueue=lambda *_a, **_k: None))

    response = client.post(
        "/submissions",
        json={"problem_version_id": 1, "code_text": "print('x')"},
    )

    assert response.status_code == 429
    assert "active submissions" in response.text.lower()


def test_upload_bundle_rejects_blocked_signature(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_version = SimpleNamespace(id=9, type="coding", bundle_key=None, bundle_sha256=None, bundle_size=None)

    async def _override_session() -> AsyncGenerator[_FakeSession]:
        yield _FakeSession(scalars=[fake_version])

    main.app.dependency_overrides[get_async_session] = _override_session
    monkeypatch.setattr(main, "storage", SimpleNamespace(save_bundle=lambda *_a, **_k: ("x", 1)))

    bundle = _make_zip_with_signature(b"MZ", filename="starter/evil.exe")
    response = client.post(
        "/admin/problem-versions/9/bundle",
        files={"file": ("bundle.zip", bundle, "application/zip")},
    )

    assert response.status_code == 400
    assert "blocked file" in response.text.lower()
