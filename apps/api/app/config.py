from __future__ import annotations

import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://devuser:devpass@127.0.0.1:5432/devdb",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
BUNDLE_ROOT = os.getenv("BUNDLE_ROOT", "./var/bundles")
BUNDLE_MAX_SIZE_BYTES = int(os.getenv("BUNDLE_MAX_SIZE_BYTES", str(50 * 1024 * 1024)))
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
GRADER_IMAGE = os.getenv("GRADER_IMAGE", "qa-lab-grader-python")
GRADER_TIMEOUT_SECONDS = int(os.getenv("GRADER_TIMEOUT_SECONDS", "30"))


def access_token_ttl() -> timedelta:
    return timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
