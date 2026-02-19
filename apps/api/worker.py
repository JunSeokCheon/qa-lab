from __future__ import annotations

import os

from redis import Redis
from rq import SimpleWorker, Worker

from app.config import REDIS_URL


def main() -> None:
    redis_url = os.getenv("REDIS_URL", REDIS_URL)
    conn = Redis.from_url(redis_url)
    worker_cls = SimpleWorker if os.name == "nt" else Worker
    worker = worker_cls(["grading"], connection=conn)
    print(f"[worker] listening queue=grading redis={redis_url}")
    worker.work()


if __name__ == "__main__":
    main()
