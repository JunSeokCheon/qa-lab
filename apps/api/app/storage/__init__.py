from __future__ import annotations

from app.config import BUNDLE_ROOT
from app.storage.base import BundleStorage
from app.storage.local import LocalBundleStorage

storage: BundleStorage = LocalBundleStorage(BUNDLE_ROOT)
