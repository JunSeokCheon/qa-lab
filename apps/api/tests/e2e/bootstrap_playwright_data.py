from __future__ import annotations

import argparse
import json
import os
import sys
import uuid

import requests

API_BASE_URL = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000")
TIMEOUT = 10


def _login_admin() -> str:
    response = requests.post(
        f"{API_BASE_URL}/auth/login",
        json={"username": "admin", "password": "admin1234"},
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


def bootstrap() -> dict[str, int]:
    token = _login_admin()
    unique = uuid.uuid4().hex[:8]
    response = requests.post(
        f"{API_BASE_URL}/admin/exams",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "title": f"pw-시험-{unique}",
            "description": "playwright bootstrap exam",
            "exam_kind": "quiz",
            "status": "published",
            "questions": [
                {
                    "type": "multiple_choice",
                    "prompt_md": "부트스트랩 객관식 문항",
                    "required": True,
                    "choices": ["A", "B", "C"],
                },
                {
                    "type": "subjective",
                    "prompt_md": "부트스트랩 주관식 문항",
                    "required": True,
                },
            ],
        },
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    exam = response.json()
    return {"exam_id": int(exam["id"])}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default="", help="write KEY=VALUE lines for GitHub Actions")
    args = parser.parse_args()

    data = bootstrap()
    print(json.dumps(data))

    if args.env_file:
        with open(args.env_file, "a", encoding="utf-8") as fp:
            fp.write(f"PW_EXAM_ID={data['exam_id']}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
