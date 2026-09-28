"""Versioned, atomic raw-family cache."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import uuid
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .retry_policy import retry_delay

CACHE_SCHEMA_VERSION = 8
CACHE_IO_LOCK = threading.RLock()
CACHE_QUARANTINE_LIMIT = 20
CACHE_QUARANTINE_BYTES = 50 * 1024 * 1024


class RawFamilyCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, asin: str, kind: str = "family") -> Path:
        key = hashlib.sha256(asin.encode("utf-8")).hexdigest()[:24]
        return self.directory / f"{kind}-{key}.json"

    def _read(self, asin: str, kind: str) -> dict[str, Any] | None:
        with CACHE_IO_LOCK:
            try:
                payload = json.loads(self._path(asin, kind).read_text(encoding="utf-8"))
            except OSError:
                return None
            except (ValueError, UnicodeError):
                self._quarantine(self._path(asin, kind))
                return None
            if not isinstance(payload, dict):
                self._quarantine(self._path(asin, kind))
                return None
            return payload if payload.get("schemaVersion") == CACHE_SCHEMA_VERSION else None

    def _quarantine(self, path: Path) -> None:
        """Preserve corrupt entries for inspection; keep at most twenty files."""
        with CACHE_IO_LOCK:
            try:
                directory = self.directory / "quarantine"
                directory.mkdir(parents=True, exist_ok=True)
                os.replace(path, directory / f"{path.name}-{uuid.uuid4().hex}.corrupt")
                paths = sorted(directory.glob("*.corrupt"), key=lambda file: file.stat().st_mtime, reverse=True)
                total_bytes = 0
                for index, old in enumerate(paths):
                    total_bytes += old.stat().st_size
                    if index >= CACHE_QUARANTINE_LIMIT or total_bytes > CACHE_QUARANTINE_BYTES:
                        old.unlink(missing_ok=True)
            except OSError:
                pass  # A read-only cache must still behave as a miss rather than a parser failure.

    @staticmethod
    def valid_parent(parent: Any) -> bool:
        return isinstance(parent, dict) and all(isinstance(parent.get(key), str) for key in ("asin", "title", "parentAsin")) and all(
            isinstance(parent.get(key), dict) for key in ("asinOptions", "dimensions")
        ) and all(isinstance(options, dict) for options in parent["asinOptions"].values()) and all(
            isinstance(values, list) for values in parent["dimensions"].values()
        )

    @staticmethod
    def valid_family(family: Any) -> bool:
        if not isinstance(family, dict) or not all(isinstance(family.get(key), str) for key in ("parentAsin", "sourceTitle", "canonicalUrl")):
            return False
        if not isinstance(family.get("diagnostics"), dict) or not isinstance(family.get("variantMatrix"), dict):
            return False
        matrix = family["variantMatrix"]
        if "dimensions" in matrix and (not isinstance(matrix["dimensions"], dict) or any(not isinstance(values, list) for values in matrix["dimensions"].values())):
            return False
        variants = family.get("sourceVariants")
        if not isinstance(variants, list) or not variants:
            return False
        for variant in variants:
            if not isinstance(variant, dict) or not isinstance(variant.get("asin"), str) or not isinstance(variant.get("options"), dict):
                return False
            if not isinstance(variant.get("media", []), list) or not isinstance(variant.get("warnings", []), list) or not isinstance(variant.get("diagnostics", {}), dict):
                return False
            if any(not isinstance(warning, str) for warning in variant.get("warnings", [])) or any(not isinstance(media, dict) for media in variant.get("media", [])):
                return False
            price = variant.get("price")
            if price is not None and (not isinstance(price, dict) or not isinstance(price.get("amount"), (int, float)) or not math.isfinite(price["amount"]) or not isinstance(price.get("currency"), str)):
                return False
        return all(isinstance(family.get(key, []), list) for key in ("media", "bulletPoints", "categories")) and isinstance(family.get("productDetails", {}), dict)

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
        with CACHE_IO_LOCK:
            return self._load_family(asin, require_matrix=require_matrix, require_customization=require_customization)

    def _load_family(self, asin: str, *, require_matrix: bool, require_customization: bool) -> dict[str, Any] | None:
        payload = self._read(asin, "family")
        if payload is None:
            return None
        family = payload.get("family")
        if not self.valid_family(family):
            self._quarantine(self._path(asin, "family"))
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
        self._remove_checkpoint(asin)

    def _checkpoint_path(self, asin: str) -> Path:
        return self._path(asin, "checkpoint").with_suffix(".jsonl")

    def _remove_checkpoint(self, asin: str) -> None:
        with CACHE_IO_LOCK:
            self._checkpoint_path(asin).unlink(missing_ok=True)

    def append_checkpoint(self, asin: str, stage: str, payload: dict[str, Any]) -> None:
        """Durably append one completed crawl stage without rewriting earlier children."""
        record = json.dumps(
            {"schemaVersion": CACHE_SCHEMA_VERSION, "stage": stage, "payload": payload},
            ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8") + b"\n"
        with CACHE_IO_LOCK:
            self.directory.mkdir(parents=True, exist_ok=True)
            with self._checkpoint_path(asin).open("a+b") as handle:
                handle.seek(0, os.SEEK_END)
                if handle.tell():
                    handle.seek(-1, os.SEEK_END)
                    if handle.read(1) != b"\n":
                        handle.write(b"\n")
                handle.write(record)
                handle.flush()
                os.fsync(handle.fileno())

    def load_checkpoint(self, asin: str, *, ttl_seconds: int = 86400) -> dict[str, Any] | None:
        with CACHE_IO_LOCK:
            path = self._checkpoint_path(asin)
            try:
                if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) + timedelta(seconds=ttl_seconds) <= datetime.now(timezone.utc):
                    path.unlink(missing_ok=True)
                    return None
                lines = path.read_bytes().splitlines()
            except OSError:
                return None
        checkpoint: dict[str, Any] = {"parent": None, "matrix": None, "children": {}}
        for line in lines:
            try:
                record = json.loads(line)
            except (ValueError, UnicodeError):
                continue  # A crash may leave an incomplete final line.
            if not isinstance(record, dict) or record.get("schemaVersion") != CACHE_SCHEMA_VERSION:
                continue
            stage = record.get("stage")
            payload = record.get("payload")
            if not isinstance(payload, dict):
                continue
            if stage == "parent_complete":
                if checkpoint["parent"] != payload:
                    checkpoint = {"parent": payload, "matrix": None, "children": {}}
            elif stage in {"matrix_snapshot", "matrix_complete"} and checkpoint["parent"] is not None:
                if checkpoint["matrix"] != payload:
                    checkpoint["matrix"] = payload
            elif stage in {"child_page_complete", "media_complete", "customization_complete", "child_complete"} and checkpoint["matrix"] is not None:
                child_asin = payload.get("asin")
                if not isinstance(child_asin, str):
                    continue
                child = checkpoint["children"].setdefault(child_asin, {})
                if stage == "child_page_complete":
                    child.clear()
                    child["page"] = payload
                elif stage == "media_complete":
                    child["media"] = payload
                elif stage == "customization_complete":
                    child["customization"] = payload
                else:
                    child["complete"] = True
        return checkpoint if checkpoint["parent"] is not None else None

    def load_failure(self, asin: str) -> dict[str, Any] | None:
        with CACHE_IO_LOCK:
            payload = self._read(asin, "failure")
            failure = payload.get("failure") if payload else None
            if not isinstance(failure, dict):
                if payload:
                    self._quarantine(self._path(asin, "failure"))
                return None
            try:
                retry_after = datetime.fromisoformat(str(failure["retryAfter"]))
                is_expired = retry_after <= datetime.now(timezone.utc)
            except (KeyError, ValueError, TypeError):
                self._quarantine(self._path(asin, "failure"))
                return None
            if failure.get("status") not in {"not_found", "temporarily_blocked", "network_error", "parser_error", "partial"}:
                self._quarantine(self._path(asin, "failure"))
                return None
            if failure.get("status") == "not_found" and failure.get("notFoundConfirmed") is not True:
                self._remove(asin, "failure")  # Older records did not distinguish unverified HTTP 404.
                return None
            if is_expired:
                self._remove(asin, "failure")
                return None
            return failure

    def save_failure(self, asin: str, *, status: str, reason: str, retry_after_seconds: float, details: dict[str, Any] | None = None) -> dict[str, Any]:
        if status == "network_error" and retry_after_seconds >= 0:
            retry_after_seconds = retry_delay(1, base=30, retry_after=retry_after_seconds)
        failure = {
            **(details or {}),
            "asin": asin.split(":", 1)[0], "status": status, "reason": reason,
            "retryAfter": (datetime.now(timezone.utc) + timedelta(seconds=retry_after_seconds)).isoformat(),
        }
        self._write(asin, "failure", {"failure": failure})
        return failure

    def clear_failure(self, asin: str) -> None:
        self._remove(asin, "failure")

    def invalidate(self, cache_key: str) -> dict[str, int]:
        """Remove one product context without touching another product's cache."""
        removed_files = 0
        removed_bytes = 0
        with CACHE_IO_LOCK:
            paths = [self._checkpoint_path(cache_key) if kind == "checkpoint" else self._path(cache_key, kind)
                     for kind in ("family", "failure", "partial", "checkpoint")]
            digest = self._path(cache_key).stem.removeprefix("family-")
            paths.extend(self.directory.glob(f"quarantine/*-{digest}.json-*.corrupt"))
            for path in paths:
                try:
                    size = path.stat().st_size
                    path.unlink()
                except FileNotFoundError:
                    continue
                removed_files += 1
                removed_bytes += size
        return {"removedFiles": removed_files, "removedBytes": removed_bytes}

    def load_partial(self, asin: str) -> dict[str, Any] | None:
        with CACHE_IO_LOCK:
            payload = self._read(asin, "partial")
            partial = payload.get("partial") if payload else None
            if not isinstance(partial, dict):
                if payload:
                    self._quarantine(self._path(asin, "partial"))
                return None
            try:
                is_expired = datetime.fromisoformat(str(payload["expiresAt"])) <= datetime.now(timezone.utc)
            except (KeyError, ValueError, TypeError):
                self._quarantine(self._path(asin, "partial"))
                return None
            if not self.valid_parent(partial.get("parent")) or not self.valid_family(partial.get("family")) or any(
                key in partial and (not isinstance(partial[key], list) or any(not isinstance(child, str) for child in partial[key]))
                for key in ("completedAsins", "failedAsins", "retryableAsins", "nonRetryableAsins")
            ):
                self._quarantine(self._path(asin, "partial"))
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
                *self.directory.glob("partial-*.json"), *self.directory.glob("checkpoint-*.jsonl"),
                *self.directory.glob(".amazon-cache-*.tmp"),
                *self.directory.glob("quarantine/*.corrupt"),
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

    def clear_temporary_files(self) -> dict[str, int]:
        """Remove abandoned atomic-write files while preserving cache entries."""
        removed_files = 0
        removed_bytes = 0
        with CACHE_IO_LOCK:
            for path in self.directory.glob(".amazon-cache-*.tmp"):
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
