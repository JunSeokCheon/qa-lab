#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${GRADER_IMAGE:-qa-lab-grader-python}"
SMOKE_ROOT="${ROOT_DIR}/tmp/smoke-grader"
WORK_DIR="${SMOKE_ROOT}/work"
REPORT_PATH="${WORK_DIR}/report.json"
RUN_LOG="${SMOKE_ROOT}/docker-run.log"

on_error() {
  local exit_code=$?
  echo "[smoke] failed (exit=${exit_code})"
  if [[ -f "${RUN_LOG}" ]]; then
    echo "[smoke] docker run log:" >&2
    cat "${RUN_LOG}" >&2
  fi
  exit "${exit_code}"
}
trap on_error ERR

cleanup() {
  rm -rf "${SMOKE_ROOT}"
}
trap cleanup EXIT

mkdir -p "${WORK_DIR}/tests/public" "${WORK_DIR}/tests/hidden"

echo "[smoke] building grader image: ${IMAGE_NAME}"
docker build -t "${IMAGE_NAME}" -f "${ROOT_DIR}/grader-images/python/Dockerfile" "${ROOT_DIR}"

cat > "${WORK_DIR}/solution.py" <<'PY'
def solve(a: int, b: int) -> int:
    return a + b
PY

cat > "${WORK_DIR}/tests/public/test_public.py" <<'PY'
from solution import solve


def test_add_public() -> None:
    assert solve(2, 3) == 5
PY

cat > "${WORK_DIR}/tests/hidden/test_hidden.py" <<'PY'
import socket

from solution import solve


def test_add_hidden() -> None:
    assert solve(10, 5) == 15


def test_network_blocked_hidden() -> None:
    try:
        socket.create_connection(("example.com", 80), timeout=1)
        connected = True
    except OSError:
        connected = False

    assert connected is False
PY

echo "[smoke] running docker grader"
set +e
docker run --rm \
  --network none \
  --read-only \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  --pids-limit 256 \
  --cpus 1.0 \
  --memory 1g \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -e PYTHONPATH=/work \
  -v "${WORK_DIR}:/work:rw" \
  "${IMAGE_NAME}" \
  sh -lc "cd /work && pytest -q -p no:cacheprovider --json-report --json-report-file=/work/report.json tests" >"${RUN_LOG}" 2>&1
run_exit=$?
set -e

if [[ ${run_exit} -ne 0 ]]; then
  echo "[smoke] docker run failed with exit=${run_exit}" >&2
  cat "${RUN_LOG}" >&2
  exit 1
fi

if [[ ! -f "${REPORT_PATH}" ]]; then
  echo "[smoke] report.json not found: ${REPORT_PATH}" >&2
  cat "${RUN_LOG}" >&2
  exit 1
fi

python3 - <<'PY' "${REPORT_PATH}"
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

tests = data.get("tests")
if not isinstance(tests, list):
    raise SystemExit("report.json parsed but tests field is invalid")

hidden = [t for t in tests if "/hidden/" in str(t.get("nodeid", ""))]
if not hidden:
    raise SystemExit("hidden tests missing in report")

print(f"[smoke] report parsed successfully: tests={len(tests)} hidden={len(hidden)}")
PY

echo "[smoke] grader smoke test passed"