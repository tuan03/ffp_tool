"""Versioned, atomic raw-family cache."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

CACHE_SCHEMA_VERSION = 2


class RawFamilyCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, asin: str) -> Path:
        key = hashlib.sha256(asin.encode("utf-8")).hexdigest()[:24]
        return self.directory / f"family-{key}.json"

    def load(self, asin: str, *, require_matrix: bool = True, require_customization: bool = False) -> dict[str, Any] | None:
        path = self._path(asin)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if payload.get("schemaVersion") != CACHE_SCHEMA_VERSION:
            return None
        family = payload.get("family")
        if not isinstance(family, dict):
            return None
        if require_matrix and family.get("variantMatrix", {}).get("complete") is not True:
            return None
        if require_customization and family.get("customizationChecked") is not True:
            return None
        return family

    def save(self, asin: str, family: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        payload = {"schemaVersion": CACHE_SCHEMA_VERSION, "family": family}
        fd, temporary_name = tempfile.mkstemp(prefix=".amazon-cache-", suffix=".tmp", dir=self.directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, self._path(asin))
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)
