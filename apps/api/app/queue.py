from __future__ import annotations

from redis import Redis
from redis.exceptions import RedisError
from rq import Queue

from app.config import REDIS_URL

redis_conn = Redis.from_url(REDIS_URL)
grading_queue = Queue("grading", connection=redis_conn)


def check_redis_connection() -> bool:
    try:
        return bool(redis_conn.ping())
    except Exception:
        return False


def increment_rate_limit(key: str, window_seconds: int) -> int:
    pipe = redis_conn.pipeline(transaction=True)
    try:
        pipe.incr(key)
        pipe.expire(key, window_seconds, nx=True)
        current, _ = pipe.execute()
    except RedisError:
        return -1
    return int(current)


def clear_rate_limit(key: str) -> None:
    try:
        redis_conn.delete(key)
    except RedisError:
        return
