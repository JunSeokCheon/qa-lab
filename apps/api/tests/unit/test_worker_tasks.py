from __future__ import annotations

import io
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

API_DIR = Path(__file__).resolve().parents[2]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from app.worker_tasks import _build_grade_feedback, _is_retryable_failure, _safe_extract_zip_bytes


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zf:
        for path, content in files.items():
            zf.writestr(path, content)
    return buffer.getvalue()


def test_is_retryable_failure_classifies_non_retryable_markers() -> None:
    assert not _is_retryable_failure("bundle sha256 mismatch")
    assert not _is_retryable_failure("bundle extract failed: bad zip")
    assert not _is_retryable_failure("bundle missing test target: tests")
    assert _is_retryable_failure("docker daemon temporary unavailable")


def test_safe_extract_zip_bytes_blocks_zip_slip() -> None:
    payload = _zip_bytes({"../escape.txt": b"bad"})
    with tempfile.TemporaryDirectory() as tmp:
        with pytest.raises(ValueError, match="path traversal"):
            _safe_extract_zip_bytes(payload, Path(tmp))


def test_build_grade_feedback_hides_hidden_case_details() -> None:
    report = {
        "tests": [
            {"nodeid": "tests/public/test_public.py::test_ok", "outcome": "passed"},
            {"nodeid": "tests/hidden/test_hidden.py::test_secret", "outcome": "failed", "longrepr": "secret input"},
        ],
        "_rubric": {"weights": {}, "time_limit_seconds": 30},
    }

    score, feedback = _build_grade_feedback(report, max_score=100, exit_code=1)

    assert score == 50
    assert feedback["public"]["total"] == 1
    assert feedback["hidden"]["total"] == 1
    assert feedback["hidden"]["failed_count"] == 1
    assert "failed_cases" not in feedback["hidden"]
