"""Versioned, atomic raw-family cache."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CACHE_SCHEMA_VERSION = 8
CACHE_IO_LOCK = threading.RLock()


class RawFamilyCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, asin: str, kind: str = "family") -> Path:
        key = hashlib.sha256(asin.encode("utf-8")).hexdigest()[:24]
        return self.directory / f"{kind}-{key}.json"

    def _read(self, asin: str, kind: str) -> dict[str, Any] | None:
        try:
            with CACHE_IO_LOCK:
                payload = json.loads(self._path(asin, kind).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) and payload.get("schemaVersion") == CACHE_SCHEMA_VERSION else None

    def _write(self, asin: str, kind: str, payload: dict[str, Any]) -> None:
        with CACHE_IO_LOCK:
            self.directory.mkdir(parents=True, exist_ok=True)
            fd, temporary_name = tempfile.mkstemp(prefix=".amazon-cache-", suffix=".tmp", dir=self.directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump({"schemaVersion": CACHE_SCHEMA_VERSION, **payload}, handle, ensure_ascii=False, separators=(",", ":"))
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary_name, self._path(asin, kind))
            finally:
                if os.path.exists(temporary_name):
                    os.unlink(temporary_name)

    def _remove(self, asin: str, kind: str) -> None:
        with CACHE_IO_LOCK:
            self._path(asin, kind).unlink(missing_ok=True)

    def load(self, asin: str, *, require_matrix: bool = True, require_customization: bool = False) -> dict[str, Any] | None:
        payload = self._read(asin, "family")
        if payload is None:
            return None
        family = payload.get("family")
        if not isinstance(family, dict):
            return None
        if require_matrix and family.get("variantMatrix", {}).get("complete") is not True:
            return None
        if require_customization and family.get("customizationChecked") is not True:
            return None
        variants = family.get("sourceVariants")
        if isinstance(variants, list) and any(
            not isinstance(variant, dict)
            or variant.get("price") is None
            or (variant.get("diagnostics") or {}).get("fetchMode") == "failed"
            or any("gallery" in str(warning).casefold() for warning in variant.get("warnings", []))
            for variant in variants
        ):
            return None
        return family

    def save(self, asin: str, family: dict[str, Any]) -> None:
        self._write(asin, "family", {"family": family})
        self._remove(asin, "failure")
        self._remove(asin, "partial")

    def load_failure(self, asin: str) -> dict[str, Any] | None:
        with CACHE_IO_LOCK:
            payload = self._read(asin, "failure")
            failure = payload.get("failure") if payload else None
            if not isinstance(failure, dict):
                return None
            try:
                retry_after = datetime.fromisoformat(str(failure["retryAfter"]))
                is_expired = retry_after <= datetime.now(timezone.utc)
            except (KeyError, ValueError, TypeError):
                return None
            if is_expired:
                self._remove(asin, "failure")
                return None
            return failure

    def save_failure(self, asin: str, *, status: str, reason: str, retry_after_seconds: int) -> dict[str, Any]:
        failure = {
            "asin": asin.split(":", 1)[0], "status": status, "reason": reason,
            "retryAfter": (datetime.now(timezone.utc) + timedelta(seconds=retry_after_seconds)).isoformat(),
        }
        self._write(asin, "failure", {"failure": failure})
        return failure

    def clear_failure(self, asin: str) -> None:
        self._remove(asin, "failure")

    def load_partial(self, asin: str) -> dict[str, Any] | None:
        with CACHE_IO_LOCK:
            payload = self._read(asin, "partial")
            partial = payload.get("partial") if payload else None
            if not isinstance(partial, dict):
                return None
            try:
                is_expired = datetime.fromisoformat(str(payload["expiresAt"])) <= datetime.now(timezone.utc)
            except (KeyError, ValueError, TypeError):
                return None
            if is_expired:
                self._remove(asin, "partial")
                return None
            return partial

    def save_partial(self, asin: str, partial: dict[str, Any], *, ttl_seconds: int = 86400) -> None:
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)).isoformat()
        self._write(asin, "partial", {"partial": partial, "expiresAt": expires_at})

    def clear(self) -> dict[str, int]:
        """Remove Amazon product, failure, partial, and abandoned write files."""
        removed_files = 0
        removed_bytes = 0
        with CACHE_IO_LOCK:
            if not self.directory.is_dir():
                return {"removedFiles": 0, "removedBytes": 0}
            paths = [
                *self.directory.glob("family-*.json"), *self.directory.glob("failure-*.json"),
                *self.directory.glob("partial-*.json"), *self.directory.glob(".amazon-cache-*.tmp"),
            ]
            for path in paths:
                if not path.is_file():
                    continue
                try:
                    size = path.stat().st_size
                    path.unlink()
                except FileNotFoundError:
                    continue
                removed_files += 1
                removed_bytes += size
        return {"removedFiles": removed_files, "removedBytes": removed_bytes}
