from __future__ import annotations

from redis import Redis
from rq import Queue

from app.config import REDIS_URL

redis_conn = Redis.from_url(REDIS_URL)
grading_queue = Queue("grading", connection=redis_conn)


def check_redis_connection() -> bool:
    try:
        return bool(redis_conn.ping())
    except Exception:
        return False
