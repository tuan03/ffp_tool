"""Versioned, atomic raw-family cache."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import uuid
import math
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .retry_policy import retry_delay
from .cache_storage import CacheCapacityError, CacheLimits, CacheStorage, cache_digest

CACHE_SCHEMA_VERSION = 8
CACHE_QUARANTINE_LIMIT = 20
CACHE_QUARANTINE_BYTES = 50 * 1024 * 1024


class RawFamilyCache:
    def __init__(self, directory: Path, *, limits: CacheLimits | None = None) -> None:
        self.directory = directory
        self.limits = limits or CacheLimits()
        self.storage = CacheStorage(directory, self.limits)
        self.maintain(force=True)

    def _guard(self, asin: str):
        return self.storage.lock(cache_digest(asin))

    def crawl_guard(self, asin: str):
        """Pin one family through crawling; maintenance skips pinned contexts."""
        return self.storage.lock(cache_digest(asin), "active")

    def maintain(self, *, force: bool = False) -> None:
        self.storage.maintain(force=force)

    def metrics_snapshot(self) -> dict[str, int]:
        return self.storage.metrics()

    def _path(self, asin: str, kind: str = "family") -> Path:
        key = cache_digest(asin)
        return self.directory / f"{kind}-{key}.json"

    def _read(self, asin: str, kind: str) -> dict[str, Any] | None:
        with self._guard(asin):
            try:
                path = self._path(asin, kind)
                with path.open("rb") as handle:
                    if os.fstat(handle.fileno()).st_size > self.limits.entry_bytes:
                        raise CacheCapacityError("Cache file exceeds its size limit.")
                    content = handle.read(self.limits.entry_bytes + 1)
                if len(content) > self.limits.entry_bytes:
                    raise CacheCapacityError("Cache file exceeds its size limit.")
                payload = json.loads(content)
            except OSError:
                self.storage.count("miss")
                return None
            except (ValueError, UnicodeError, RecursionError):
                self._quarantine(self._path(asin, kind))
                self.storage.count("miss")
                return None
            if not isinstance(payload, dict):
                self._quarantine(self._path(asin, kind))
                self.storage.count("miss")
                return None
            if payload.get("schemaVersion") != CACHE_SCHEMA_VERSION:
                self.storage.count("miss")
                return None
            if not self._checksum_valid(payload):
                self._quarantine(path)
                self.storage.count("miss")
                return None
            return payload

    def _encode(self, payload: dict[str, Any], maximum: int) -> bytes:
        chunks = []
        size = 0
        for chunk in json.JSONEncoder(ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).iterencode(payload):
            encoded = chunk.encode("utf-8")
            size += len(encoded)
            if size > maximum:
                raise CacheCapacityError("Cache entry exceeds its size limit.")
            chunks.append(encoded)
        return b"".join(chunks)

    def _seal(self, payload: dict[str, Any], maximum: int) -> bytes:
        sealed = {**payload, "cacheFormatVersion": 1}
        sealed.pop("checksum", None)
        sealed["checksum"] = hashlib.sha256(self._encode(sealed, maximum)).hexdigest()
        return self._encode(sealed, maximum)

    def _checksum_valid(self, payload: dict[str, Any]) -> bool:
        if "checksum" not in payload and "cacheFormatVersion" not in payload:
            return True  # Legacy records are validated and upgraded on successful reads.
        if payload.get("cacheFormatVersion") != 1 or not isinstance(payload.get("checksum"), str):
            return False
        try:
            unsigned = {key: value for key, value in payload.items() if key != "checksum"}
            return hashlib.sha256(self._encode(unsigned, self.limits.entry_bytes)).hexdigest() == payload["checksum"]
        except (ValueError, TypeError, RecursionError):
            return False

    def _accept(self, asin: str, kind: str, payload: dict[str, Any]) -> None:
        path = self._path(asin, kind)
        expires = datetime.fromisoformat(str(payload["expiresAt"])).timestamp() if payload.get("expiresAt") else self.storage._expiry(path, path.stat().st_mtime)
        if "checksum" not in payload:
            if kind == "family":
                payload = {**payload, "expiresAt": datetime.fromtimestamp(expires, timezone.utc).isoformat()}
            self._write(asin, kind, payload)
        self.storage.register(path, cache_digest(asin), expires=expires)
        self.storage.count("hit")

    def _quarantine(self, path: Path) -> None:
        """Preserve corrupt entries for inspection; keep at most twenty files."""
        self.storage.count("corrupt")
        with self.storage.budget_lock():
            try:
                directory = self.directory / "quarantine"
                directory.mkdir(parents=True, exist_ok=True)
                destination = directory / f"{path.name}-{uuid.uuid4().hex}.corrupt"
                os.replace(path, destination)
                self.storage.forget(path)
                self.storage.register(destination, self.storage.path_digest(path))
                self.storage.trim_quarantine(limit=CACHE_QUARANTINE_LIMIT, maximum=CACHE_QUARANTINE_BYTES)
                self.storage.prune()
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
            if price is not None:
                try:
                    if not isinstance(price, dict) or not isinstance(price.get("amount"), (int, float)) or isinstance(price["amount"], bool) or not math.isfinite(price["amount"]) or not isinstance(price.get("currency"), str):
                        return False
                except OverflowError:
                    return False
        return all(isinstance(family.get(key, []), list) for key in ("media", "bulletPoints", "categories")) and isinstance(family.get("productDetails", {}), dict)

    def _replace_bytes(self, asin: str, path: Path, content: bytes, expires: float | None) -> bool:
        digest = cache_digest(asin)
        maximum = self.limits.journal_bytes if path.suffix == ".jsonl" else CACHE_QUARANTINE_BYTES if path.suffix == ".corrupt" else self.limits.entry_bytes
        if len(content) > maximum:
            self.storage.count("writeRejected")
            return False
        with self.storage.budget_lock():
            if not self.storage.prune(incoming=len(content), preserve=digest):
                self.storage.count("writeRejected")
                return False
            fd, temporary_name = tempfile.mkstemp(prefix=f".amazon-cache-{digest}-", suffix=".tmp", dir=self.directory)
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary_name, path)
                if os.name != "nt":
                    directory_fd = os.open(self.directory, os.O_RDONLY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                self.storage.register(path, digest, expires=expires)
                return True
            finally:
                if os.path.exists(temporary_name):
                    os.unlink(temporary_name)

    def _write(self, asin: str, kind: str, payload: dict[str, Any]) -> bool:
        self.maintain()
        with self._guard(asin):
            if kind == "family" and "expiresAt" not in payload:
                payload = {**payload, "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=self.limits.family_ttl_seconds)).isoformat()}
            try:
                content = self._seal({**payload, "schemaVersion": CACHE_SCHEMA_VERSION}, self.limits.entry_bytes)
            except (ValueError, TypeError, RecursionError):
                self.storage.count("writeRejected")
                return False
            expires = None
            timestamp = payload.get("expiresAt") or payload.get("failure", {}).get("retryAfter")
            if timestamp:
                try:
                    expires = datetime.fromisoformat(str(timestamp)).timestamp()
                except (ValueError, TypeError):
                    pass
            return self._replace_bytes(asin, self._path(asin, kind), content, expires)

    def _remove(self, asin: str, kind: str) -> None:
        with self._guard(asin):
            path = self._path(asin, kind)
            path.unlink(missing_ok=True)
            self.storage.forget(path)

    def load(self, asin: str, *, require_matrix: bool = True, require_customization: bool = False) -> dict[str, Any] | None:
        with self._guard(asin):
            return self._load_family(asin, require_matrix=require_matrix, require_customization=require_customization)

    def _load_family(self, asin: str, *, require_matrix: bool, require_customization: bool) -> dict[str, Any] | None:
        payload = self._read(asin, "family")
        if payload is None:
            return None
        try:
            expires = datetime.fromisoformat(str(payload["expiresAt"])).timestamp() if "expiresAt" in payload else self._path(asin).stat().st_mtime + self.limits.family_ttl_seconds
        except (ValueError, TypeError, OverflowError, OSError):
            self._quarantine(self._path(asin))
            return None
        if expires <= time.time():
            self._remove(asin, "family")
            self.storage.count("miss")
            self.storage.count("evicted")
            return None
        family = payload.get("family")
        if not self.valid_family(family):
            self._quarantine(self._path(asin, "family"))
            self.storage.count("miss")
            return None
        if require_matrix and family.get("variantMatrix", {}).get("complete") is not True:
            self.storage.count("miss")
            return None
        if require_customization and family.get("customizationChecked") is not True:
            self.storage.count("miss")
            return None
        variants = family.get("sourceVariants")
        if isinstance(variants, list) and any(
            not isinstance(variant, dict)
            or variant.get("price") is None
            or (variant.get("diagnostics") or {}).get("fetchMode") == "failed"
            or any("gallery" in str(warning).casefold() for warning in variant.get("warnings", []))
            for variant in variants
        ):
            self.storage.count("miss")
            return None
        self._accept(asin, "family", payload)
        return family

    def save(self, asin: str, family: dict[str, Any]) -> None:
        with self._guard(asin):
            if self._write(asin, "family", {"family": family}):
                self._remove(asin, "failure")
                self._remove(asin, "partial")
                self._remove_checkpoint(asin)

    def _checkpoint_path(self, asin: str) -> Path:
        return self._path(asin, "checkpoint").with_suffix(".jsonl")

    def _remove_checkpoint(self, asin: str) -> None:
        with self._guard(asin):
            path = self._checkpoint_path(asin)
            path.unlink(missing_ok=True)
            self.storage.forget(path)

    def append_checkpoint(self, asin: str, stage: str, payload: dict[str, Any]) -> None:
        """Durably append one completed crawl stage without rewriting earlier children."""
        try:
            record = self._seal({"schemaVersion": CACHE_SCHEMA_VERSION, "stage": stage, "payload": payload}, self.limits.entry_bytes) + b"\n"
        except (ValueError, TypeError, RecursionError):
            self.storage.count("writeRejected")
            return
        with self._guard(asin), self.storage.budget_lock():
            if self._path(asin).exists():
                return  # A completed family supersedes late writes from a stale worker.
            path = self._checkpoint_path(asin)
            if (path.stat().st_size if path.exists() else 0) + len(record) + 1 > self.limits.journal_bytes or not self.storage.prune(incoming=len(record) + 1, preserve=cache_digest(asin)):
                self.storage.count("writeRejected")
                return
            with path.open("a+b") as handle:
                handle.seek(0, os.SEEK_END)
                if handle.tell():
                    handle.seek(-1, os.SEEK_END)
                    if handle.read(1) != b"\n":
                        handle.write(b"\n")
                handle.write(record)
                handle.flush()
                os.fsync(handle.fileno())
            self.storage.register(path, cache_digest(asin), expires=time.time() + self.limits.checkpoint_ttl_seconds)

    def load_checkpoint(self, asin: str, *, ttl_seconds: int = 86400) -> dict[str, Any] | None:
        with self._guard(asin):
            path = self._checkpoint_path(asin)
            try:
                if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) + timedelta(seconds=ttl_seconds) <= datetime.now(timezone.utc):
                    path.unlink(missing_ok=True)
                    self.storage.forget(path)
                    self.storage.count("evicted")
                    self.storage.count("miss")
                    return None
                with path.open("rb") as handle:
                    if os.fstat(handle.fileno()).st_size > self.limits.journal_bytes:
                        self._quarantine(path)
                        return None
                    content = handle.read(self.limits.journal_bytes + 1)
                if len(content) > self.limits.journal_bytes:
                    self._quarantine(path)
                    return None
            except OSError:
                self.storage.count("miss")
                return None
            checkpoint, valid_lines, damaged, legacy = self._decode_checkpoint(content)
            if damaged:
                if valid_lines:
                    self.storage.count("corrupt")
                    directory = self.directory / "quarantine"
                    directory.mkdir(exist_ok=True)
                    destination = directory / f"{path.name}-{uuid.uuid4().hex}.corrupt"
                    # Preserve the source until atomic replacement succeeds, including on a crash.
                    if len(content) <= CACHE_QUARANTINE_BYTES:
                        self._replace_bytes(asin, destination, content, None)
                    self._replace_bytes(asin, path, b"".join(valid_lines), time.time() + ttl_seconds)
                    with self.storage.budget_lock():
                        self.storage.trim_quarantine(limit=CACHE_QUARANTINE_LIMIT, maximum=CACHE_QUARANTINE_BYTES)
                else:
                    self._quarantine(path)
            elif valid_lines and legacy:
                self._replace_bytes(asin, path, b"".join(valid_lines), time.time() + ttl_seconds)
            self.storage.touch(path)
            self.storage.count("hit" if checkpoint["parent"] is not None else "miss")
            return checkpoint if checkpoint["parent"] is not None else None

    def _decode_checkpoint(self, content: bytes) -> tuple[dict[str, Any], list[bytes], bool, bool]:
        checkpoint: dict[str, Any] = {"parent": None, "matrix": None, "children": {}}
        valid_lines = []
        damaged = False
        legacy = False
        for line in content.splitlines():
            try:
                if len(line) > self.limits.entry_bytes:
                    raise CacheCapacityError("Checkpoint record exceeds its size limit.")
                record = json.loads(line)
            except (ValueError, UnicodeError, RecursionError):
                damaged = True
                continue  # A crash may leave an incomplete final line; retain earlier stages.
            if not isinstance(record, dict) or record.get("schemaVersion") != CACHE_SCHEMA_VERSION:
                continue
            if not self._checksum_valid(record):
                damaged = True
                continue
            legacy = legacy or "checksum" not in record
            stage = record.get("stage")
            payload = record.get("payload")
            if not isinstance(payload, dict):
                continue
            try:
                valid_lines.append(self._seal(record, self.limits.entry_bytes) + b"\n")
            except (ValueError, TypeError, RecursionError):
                damaged = True
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
        return checkpoint, valid_lines, damaged, legacy

    def load_failure(self, asin: str) -> dict[str, Any] | None:
        with self._guard(asin):
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
                self.storage.count("evicted")
                self.storage.count("miss")
                return None
            self._accept(asin, "failure", payload)
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
        with self.crawl_guard(cache_key), self._guard(cache_key):
            paths = [self._checkpoint_path(cache_key) if kind == "checkpoint" else self._path(cache_key, kind)
                     for kind in ("family", "failure", "partial", "checkpoint")]
            digest = self._path(cache_key).stem.removeprefix("family-")
            paths.extend(self.directory.glob(f"quarantine/*-{digest}.json-*.corrupt"))
            for path in paths:
                try:
                    size = path.stat().st_size
                    path.unlink()
                    self.storage.forget(path)
                except FileNotFoundError:
                    continue
                removed_files += 1
                removed_bytes += size
        return {"removedFiles": removed_files, "removedBytes": removed_bytes}

    def load_partial(self, asin: str) -> dict[str, Any] | None:
        with self._guard(asin):
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
                self.storage.count("evicted")
                self.storage.count("miss")
                return None
            self._accept(asin, "partial", payload)
            return partial

    def save_partial(self, asin: str, partial: dict[str, Any], *, ttl_seconds: int = 86400) -> None:
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)).isoformat()
        with self._guard(asin):
            if self._load_family(asin, require_matrix=True, require_customization=True) is not None:
                return
            existing = self.load_partial(asin)
            merged = self._merge_partial(existing, partial) if existing else partial
            self._write(asin, "partial", {"partial": merged, "expiresAt": expires_at})

    @staticmethod
    def _complete_variant(variant: dict[str, Any]) -> bool:
        return variant.get("price") is not None and variant.get("customizationComplete") is True and (variant.get("diagnostics") or {}).get("fetchMode") != "failed" and not any("gallery" in str(warning).casefold() for warning in variant.get("warnings", []))

    @classmethod
    def _merge_partial(cls, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        merged = deepcopy(incoming)
        if not cls.valid_family(incoming.get("family")) or existing["family"]["parentAsin"] != incoming["family"]["parentAsin"]:
            return merged
        variants = {variant["asin"]: deepcopy(variant) for variant in existing["family"]["sourceVariants"]}
        for variant in incoming["family"]["sourceVariants"]:
            previous = variants.get(variant["asin"])
            if previous is None or previous.get("options") != variant.get("options") or not cls._complete_variant(previous) or cls._complete_variant(variant):
                variants[variant["asin"]] = deepcopy(variant)
        merged["family"]["sourceVariants"] = list(variants.values())
        if cls.valid_parent(merged.get("parent")):
            merged["parent"]["asinOptions"] = {**existing["parent"]["asinOptions"], **merged["parent"]["asinOptions"]}
            for asin, variant in variants.items():
                merged["parent"]["asinOptions"].setdefault(asin, deepcopy(variant.get("options", {})))
            for name, values in existing["parent"]["dimensions"].items():
                dimensions = merged["parent"]["dimensions"].setdefault(name, [])
                dimensions.extend(value for value in values if value not in dimensions)
            matrix = merged["family"]["variantMatrix"]
            matrix["dimensions"] = deepcopy(merged["parent"]["dimensions"])
            matrix["discoveredCount"] = len(merged["parent"]["asinOptions"])
            matrix["expectedCount"] = max(matrix.get("expectedCount", 0), existing["family"]["variantMatrix"].get("expectedCount", 0), len(variants))
        if any("completedAsins" in snapshot for snapshot in (existing, incoming)):
            completed = {asin for asin, variant in variants.items() if cls._complete_variant(variant)}
            failed = set(variants) - completed
            non_retryable = ((set(existing.get("nonRetryableAsins", [])) - set(incoming.get("failedAsins", []))) | set(incoming.get("nonRetryableAsins", []))) & failed
            merged.update({"completedAsins": sorted(completed), "failedAsins": sorted(failed),
                "retryableAsins": sorted(failed - non_retryable), "nonRetryableAsins": sorted(non_retryable)})
        return merged

    def clear(self) -> dict[str, int]:
        """Remove Amazon product, failure, partial, and abandoned write files."""
        removed_files = 0
        removed_bytes = 0
        with self.storage.budget_lock():
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
                    digest = self.storage.path_digest(path)
                    if self.storage.is_held(digest, "active"):
                        continue
                    with self.storage.lock(digest, "active", blocking=False) as idle, self.storage.lock(digest, blocking=False) as available:
                        if not idle or not available:
                            continue
                        size = path.stat().st_size
                        path.unlink()
                        self.storage.forget(path)
                except FileNotFoundError:
                    continue
                removed_files += 1
                removed_bytes += size
        return {"removedFiles": removed_files, "removedBytes": removed_bytes}

    def clear_temporary_files(self) -> dict[str, int]:
        """Remove abandoned atomic-write files while preserving cache entries."""
        removed_files = 0
        removed_bytes = 0
        with self.storage.budget_lock():
            for path in self.directory.glob(".amazon-cache-*.tmp"):
                if not path.is_file():
                    continue
                try:
                    digest = self.storage.path_digest(path)
                    size = path.stat().st_size
                    if not self.storage._evict(str(path.relative_to(self.directory)), digest):
                        continue
                except FileNotFoundError:
                    continue
                removed_files += 1
                removed_bytes += size
        return {"removedFiles": removed_files, "removedBytes": removed_bytes}
