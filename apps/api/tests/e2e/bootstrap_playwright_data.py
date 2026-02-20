from __future__ import annotations

import argparse
import io
import json
import sys
import uuid
import zipfile

import requests

API_BASE_URL = "http://127.0.0.1:8000"
TIMEOUT = 10


def _login_admin() -> str:
    response = requests.post(
        f"{API_BASE_URL}/auth/login",
        json={"username": "admin", "password": "admin1234"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


def _create_bundle() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("statement.md", "# Playwright E2E")
        zf.writestr("starter/README.md", "starter")
        zf.writestr("rubric.yaml", "time_limit_seconds: 20\nweights: {}\n")
        zf.writestr(
            "tests/public/test_public.py",
            "from solution import solve\n\n"
            "def test_public_sum_1() -> None:\n"
            "    assert solve(2, 3) == 5\n\n"
            "def test_public_sum_2() -> None:\n"
            "    assert solve(7, 8) == 15\n",
        )
        zf.writestr(
            "tests/hidden/test_hidden.py",
            "from solution import solve\n\n"
            "def test_hidden_sum() -> None:\n"
            "    assert solve(100, 22) == 122\n",
        )
    return buffer.getvalue()


def bootstrap() -> dict[str, int]:
    token = _login_admin()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    suffix = uuid.uuid4().hex[:8]

    skill = requests.post(
        f"{API_BASE_URL}/admin/skills",
        headers=headers,
        json={"name": f"pw-skill-{suffix}", "description": "playwright"},
        timeout=TIMEOUT,
    )
    skill.raise_for_status()
    skill_id = int(skill.json()["id"])

    problem = requests.post(
        f"{API_BASE_URL}/admin/problems",
        headers=headers,
        json={"title": f"pw-problem-{suffix}"},
        timeout=TIMEOUT,
    )
    problem.raise_for_status()
    problem_id = int(problem.json()["id"])

    version = requests.post(
        f"{API_BASE_URL}/admin/problems/{problem_id}/versions",
        headers=headers,
        json={
            "type": "coding",
            "difficulty": "easy",
            "max_score": 100,
            "statement_md": "# Playwright",
            "skills": [{"skill_id": skill_id, "weight": 100}],
        },
        timeout=TIMEOUT,
    )
    version.raise_for_status()
    version_id = int(version.json()["id"])

    bundle = requests.post(
        f"{API_BASE_URL}/admin/problem-versions/{version_id}/bundle",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("bundle.zip", _create_bundle(), "application/zip")},
        timeout=TIMEOUT,
    )
    bundle.raise_for_status()

    return {"problem_id": problem_id, "problem_version_id": version_id}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default="", help="write KEY=VALUE lines for GitHub Actions")
    args = parser.parse_args()

    data = bootstrap()
    print(json.dumps(data))

    if args.env_file:
        with open(args.env_file, "a", encoding="utf-8") as fp:
            fp.write(f"PW_PROBLEM_ID={data['problem_id']}\n")
            fp.write(f"PW_PROBLEM_VERSION_ID={data['problem_version_id']}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
