from __future__ import annotations

from pathlib import Path
from typing import Protocol


class BundleStorage(Protocol):
    def save_bundle(self, problem_version_id: int, source_path: Path, sha256: str) -> tuple[str, int]:
        ...

    def read_bundle(self, key: str) -> bytes:
        ...
