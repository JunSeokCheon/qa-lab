from __future__ import annotations

import os

from redis import Redis
from rq import Worker

from app.config import REDIS_URL


def main() -> None:
    redis_url = os.getenv("REDIS_URL", REDIS_URL)
    conn = Redis.from_url(redis_url)
    worker = Worker(["grading"], connection=conn)
    print(f"[worker] listening queue=grading redis={redis_url}")
    worker.work()


if __name__ == "__main__":
    main()
