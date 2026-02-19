from __future__ import annotations

import shutil
from os.path import commonpath
from pathlib import Path

from app.storage.base import BundleStorage


class LocalBundleStorage(BundleStorage):
    def __init__(self, root_dir: str) -> None:
        self.root_dir = Path(root_dir).resolve()
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_key(self, key: str) -> Path:
        path = (self.root_dir / key).resolve()
        if commonpath([str(path), str(self.root_dir)]) != str(self.root_dir):
            raise ValueError("Invalid bundle key path")
        return path

    def save_bundle(self, problem_version_id: int, source_path: Path, sha256: str) -> tuple[str, int]:
        key = f"problem_versions/{problem_version_id}/{sha256}.zip"
        target = self._resolve_key(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target)
        return key, target.stat().st_size

    def read_bundle(self, key: str) -> bytes:
        target = self._resolve_key(key)
        return target.read_bytes()
