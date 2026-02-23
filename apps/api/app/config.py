from __future__ import annotations

import os
from pathlib import Path
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://devuser:devpass@127.0.0.1:5432/devdb",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
BUNDLE_ROOT = os.getenv("BUNDLE_ROOT", "./var/bundles")
BUNDLE_MAX_SIZE_BYTES = int(os.getenv("BUNDLE_MAX_SIZE_BYTES", str(50 * 1024 * 1024)))
EXAM_RESOURCE_ROOT = os.getenv("EXAM_RESOURCE_ROOT", str(Path(BUNDLE_ROOT) / "exam-resources"))
EXAM_RESOURCE_MAX_SIZE_BYTES = int(os.getenv("EXAM_RESOURCE_MAX_SIZE_BYTES", str(500 * 1024 * 1024)))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
EXAM_LLM_MODEL = os.getenv("EXAM_LLM_MODEL", "gpt-4.1-mini")
EXAM_LLM_PROMPT_VERSION = os.getenv("EXAM_LLM_PROMPT_VERSION", "exam_answer_key_prompt_v2_2026-02-22")
EXAM_LLM_SCHEMA_VERSION = os.getenv("EXAM_LLM_SCHEMA_VERSION", "exam_grading_schema_v2")
EXAM_LLM_TIMEOUT_SECONDS = int(os.getenv("EXAM_LLM_TIMEOUT_SECONDS", "30"))
EXAM_LLM_MAX_TOKENS = int(os.getenv("EXAM_LLM_MAX_TOKENS", "500"))
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
ACCESS_TOKEN_REMEMBER_EXPIRE_DAYS = int(os.getenv("ACCESS_TOKEN_REMEMBER_EXPIRE_DAYS", "30"))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "30"))
GRADER_IMAGE = os.getenv("GRADER_IMAGE", "qa-lab-grader-python")
GRADER_TIMEOUT_SECONDS = int(os.getenv("GRADER_TIMEOUT_SECONDS", "30"))
BUNDLE_MAX_ENTRIES = int(os.getenv("BUNDLE_MAX_ENTRIES", "2000"))
BUNDLE_MAX_UNCOMPRESSED_BYTES = int(os.getenv("BUNDLE_MAX_UNCOMPRESSED_BYTES", str(200 * 1024 * 1024)))
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
LOGIN_RATE_LIMIT_ATTEMPTS = int(os.getenv("LOGIN_RATE_LIMIT_ATTEMPTS", "10"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "60"))
MAX_LOG_BYTES = int(os.getenv("MAX_LOG_BYTES", str(8 * 1024)))
SUBMISSION_QUEUE_MAX_DEPTH = int(os.getenv("SUBMISSION_QUEUE_MAX_DEPTH", "200"))
SUBMISSION_MAX_ACTIVE_PER_USER = int(os.getenv("SUBMISSION_MAX_ACTIVE_PER_USER", "3"))
GRADING_RETRY_MAX_ATTEMPTS = int(os.getenv("GRADING_RETRY_MAX_ATTEMPTS", "3"))
GRADING_RETRY_BACKOFF_SECONDS = int(os.getenv("GRADING_RETRY_BACKOFF_SECONDS", "2"))
GRADING_STUCK_TIMEOUT_SECONDS = int(os.getenv("GRADING_STUCK_TIMEOUT_SECONDS", "300"))

if APP_ENV in {"production", "prod"} and JWT_SECRET_KEY == "change-this-in-production":
    raise RuntimeError("JWT_SECRET_KEY must be set in production")


def access_token_ttl(*, remember_me: bool = False) -> timedelta:
    if remember_me:
        return timedelta(days=ACCESS_TOKEN_REMEMBER_EXPIRE_DAYS)
    return timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)


def password_reset_token_ttl() -> timedelta:
    return timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)
