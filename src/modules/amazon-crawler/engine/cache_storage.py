"""Bounded cache storage, process locks, retention and persistent counters."""
from __future__ import annotations

import contextlib
import errno
import hashlib
import json
import os
import sqlite3
import threading
import time
import weakref
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .timeouts import check_deadline, remaining_seconds


@dataclass(frozen=True)
class CacheLimits:
    entry_bytes: int = 32 * 1024 * 1024
    journal_bytes: int = 128 * 1024 * 1024
    total_bytes: int = 512 * 1024 * 1024
    total_files: int = 10000
    family_ttl_seconds: int = 7 * 86400
    checkpoint_ttl_seconds: int = 86400
    maintenance_seconds: int = 60


class CacheCapacityError(ValueError):
    pass


_locks_guard = threading.Lock()
_locks: weakref.WeakValueDictionary = weakref.WeakValueDictionary()
_held = threading.local()
LOCK_BUCKETS = 1024  # Fixed metadata footprint; colliding keys safely share a lock.


@contextlib.contextmanager
def file_lock(path: Path, *, blocking: bool = True) -> Iterator[bool]:
    identity = str(path.resolve())
    with _locks_guard:
        lock = _locks.setdefault(identity, threading.RLock())
    acquired = lock.acquire(blocking=False)
    started = time.monotonic()
    while not acquired and blocking:
        check_deadline()
        if time.monotonic() - started >= 30:
            raise TimeoutError("Cache lock could not be acquired within 30 seconds.")
        acquired = lock.acquire(timeout=remaining_seconds(0.05))
    if not acquired:
        yield False
        return
    held = getattr(_held, "paths", None)
    if held is None:
        held = _held.paths = {}
    handle = None
    owns_file_lock = False
    try:
        if identity in held:
            yield True
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a+b")
        if handle.seek(0, os.SEEK_END) == 0:
            handle.write(b"\0")
            handle.flush()
        while True:
            handle.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                owns_file_lock = True
                held[identity] = handle
                break
            except OSError as error:
                if error.errno not in {errno.EACCES, errno.EAGAIN} and getattr(error, "winerror", None) not in {33, 36}:
                    raise
                if not blocking:
                    yield False
                    return
                check_deadline()
                if time.monotonic() - started >= 30:
                    raise TimeoutError("Cache lock could not be acquired within 30 seconds.") from error
                time.sleep(remaining_seconds(0.02))
        yield True
    finally:
        if owns_file_lock:
            held.pop(identity, None)
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        if handle is not None:
            handle.close()
        lock.release()


def cache_digest(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]


class CacheStorage:
    def __init__(self, directory: Path, limits: CacheLimits) -> None:
        self.directory = directory
        self.limits = limits
        self.directory.mkdir(parents=True, exist_ok=True)
        self.database = directory / "cache-metrics.sqlite3"
        try:
            self._initialize()
        except sqlite3.DatabaseError as error:
            corrupt_codes = {getattr(sqlite3, "SQLITE_CORRUPT", 11), getattr(sqlite3, "SQLITE_NOTADB", 26)}
            err_msg = str(error).lower()
            is_corrupt = getattr(error, "sqlite_errorcode", None) in corrupt_codes or "not a database" in err_msg or "malformed" in err_msg
            if not is_corrupt:
                raise
            with self.budget_lock():
                try:
                    self._initialize()
                except sqlite3.DatabaseError as current:
                    curr_msg = str(current).lower()
                    curr_is_corrupt = getattr(current, "sqlite_errorcode", None) in corrupt_codes or "not a database" in curr_msg or "malformed" in curr_msg
                    if not curr_is_corrupt:
                        raise
                else:
                    return  # Another process already rebuilt the metadata database.
                quarantine = directory / "quarantine"
                quarantine.mkdir(exist_ok=True)
                os.replace(self.database, quarantine / f"cache-metrics.sqlite3-{uuid.uuid4().hex}.corrupt")
                self.database.with_name(self.database.name + "-journal").unlink(missing_ok=True)
                self._initialize()
                self.count("corrupt")

    def _initialize(self) -> None:
        with self.connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS entries (
                    path TEXT PRIMARY KEY, cache_key TEXT NOT NULL, bytes INTEGER NOT NULL,
                    accessed REAL NOT NULL, modified REAL NOT NULL, expires REAL
                );
                CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS maintenance (id INTEGER PRIMARY KEY, performed REAL NOT NULL);
            """)

    @contextlib.contextmanager
    def connection(self):
        connection = sqlite3.connect(self.database, timeout=5)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def lock(self, digest: str, kind: str = "io", *, blocking: bool = True):
        bucket = int(digest, 16) % LOCK_BUCKETS
        return file_lock(self.directory / ".locks" / f"{kind}-{bucket:04x}.lock", blocking=blocking)

    def budget_lock(self, *, blocking: bool = True):
        return file_lock(self.directory / ".locks" / "budget.lock", blocking=blocking)

    def count(self, name: str, amount: int = 1) -> None:
        with self.connection() as connection:
            connection.execute("INSERT INTO counters VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value=value+excluded.value", (name, amount))

    def register(self, path: Path, digest: str, *, expires: float | None = None) -> None:
        try:
            stat = path.stat()
        except FileNotFoundError:
            self.forget(path)
            return
        with self.connection() as connection:
            connection.execute("""INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET bytes=excluded.bytes, accessed=excluded.accessed,
                    modified=excluded.modified, expires=excluded.expires""",
                (str(path.relative_to(self.directory)), digest, stat.st_size, time.time(), stat.st_mtime, expires))

    def forget(self, path: Path) -> None:
        with self.connection() as connection:
            connection.execute("DELETE FROM entries WHERE path=?", (str(path.relative_to(self.directory)),))

    def touch(self, path: Path) -> None:
        with self.connection() as connection:
            connection.execute("UPDATE entries SET accessed=? WHERE path=?", (time.time(), str(path.relative_to(self.directory))))

    def metrics(self) -> dict[str, int]:
        with self.connection() as connection:
            counters = dict(connection.execute("SELECT name,value FROM counters"))
            size, files = connection.execute("SELECT COALESCE(SUM(bytes),0),COUNT(*) FROM entries").fetchone()
        return {**{name: counters.get(name, 0) for name in ("hit", "miss", "corrupt", "evicted", "writeRejected", "temporaryRemoved")},
                "bytes": size, "files": files, "maxBytes": self.limits.total_bytes, "maxFiles": self.limits.total_files}

    def _expiry(self, path: Path, modified: float) -> float | None:
        fallback = modified + self.limits.family_ttl_seconds if path.name.startswith("family-") else modified + self.limits.checkpoint_ttl_seconds
        if path.name.startswith("checkpoint-"):
            return modified + self.limits.checkpoint_ttl_seconds
        if not path.name.startswith(("family-", "partial-", "failure-")):
            return None
        try:
            with path.open("rb") as stream:
                content = stream.read(self.limits.entry_bytes + 1)
            if len(content) > self.limits.entry_bytes:
                return fallback
            payload = json.loads(content)
            value = payload.get("expiresAt") or payload.get("failure", {}).get("retryAfter")
            return datetime.fromisoformat(str(value)).astimezone(timezone.utc).timestamp() if value else fallback
        except (OSError, ValueError, TypeError, AttributeError, OverflowError, RecursionError):
            return fallback

    def _scan(self) -> None:
        paths = [*self.directory.glob("family-*.json"), *self.directory.glob("partial-*.json"),
                 *self.directory.glob("failure-*.json"), *self.directory.glob("checkpoint-*.jsonl"),
                 *self.directory.glob(".amazon-cache-*.tmp"), *self.directory.glob("quarantine/*.corrupt")]
        seen = set()
        with self.connection() as connection:
            known = {row[0]: row[1:] for row in connection.execute("SELECT path,bytes,modified FROM entries")}
            for path in paths:
                try:
                    stat = path.stat()
                except FileNotFoundError:
                    continue
                relative = str(path.relative_to(self.directory))
                seen.add(relative)
                if relative in known and known[relative] == (stat.st_size, stat.st_mtime):
                    continue
                digest = self.path_digest(path)
                connection.execute("""INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET bytes=excluded.bytes, modified=excluded.modified, expires=excluded.expires""",
                    (relative, digest, stat.st_size, stat.st_mtime, stat.st_mtime, self._expiry(path, stat.st_mtime)))
            for relative in set(known) - seen:
                connection.execute("DELETE FROM entries WHERE path=?", (relative,))

    @staticmethod
    def path_digest(path: Path) -> str:
        import re
        match = re.search(r"(?:family|failure|partial|checkpoint)-([0-9a-f]{24})|\.amazon-cache-([0-9a-f]{24})-", path.name)
        return next(group for group in match.groups() if group) if match else "0" * 24

    def _evict(self, relative: str, digest: str) -> bool:
        path = self.directory / relative
        if self.is_held(digest, "active"):
            return False
        with self.lock(digest, "active", blocking=False) as idle:
            if not idle:
                return False
            with self.lock(digest, blocking=False) as available:
                if not available:
                    return False
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    return False
                self.forget(path)
                self.count("temporaryRemoved" if path.suffix == ".tmp" else "evicted")
                return True

    def is_held(self, digest: str, kind: str) -> bool:
        # An active guard acquired before this cleanup is reentrant in its owner thread.
        identity = str((self.directory / ".locks" / f"{kind}-{int(digest, 16) % LOCK_BUCKETS:04x}.lock").resolve())
        return identity in getattr(_held, "paths", {})

    def prune(self, *, incoming: int = 0, preserve: str = "") -> bool:
        with self.connection() as connection:
            total, files = connection.execute("SELECT COALESCE(SUM(bytes),0),COUNT(*) FROM entries").fetchone()
            if incoming > self.limits.total_bytes:
                return False
            if incoming and total + incoming <= self.limits.total_bytes and files + 1 <= self.limits.total_files:
                return True
            entries = list(connection.execute("SELECT path,cache_key,bytes,expires FROM entries ORDER BY accessed"))
        total = sum(row[2] for row in entries)
        files = len(entries)
        extra_files = int(incoming > 0)
        now = time.time()
        for relative, digest, size, expires in entries:
            if digest == preserve:
                continue
            expired = expires is not None and expires <= now
            temporary = relative.endswith(".tmp")
            # Retain active cooldowns even under disk pressure.
            protected_failure = Path(relative).name.startswith("failure-") and expires is not None and expires > now
            over_budget = total + incoming > self.limits.total_bytes or files + extra_files > self.limits.total_files
            if expired or temporary or (over_budget and not protected_failure):
                if self._evict(relative, digest):
                    total -= size
                    files -= 1
        return total + incoming <= self.limits.total_bytes and files + extra_files <= self.limits.total_files

    def maintain(self, *, force: bool = False) -> None:
        with self.budget_lock(blocking=False) as available:
            if not available:
                return
            with self.connection() as connection:
                row = connection.execute("SELECT performed FROM maintenance WHERE id=1").fetchone()
            if not force and row is not None and time.time() - row[0] < self.limits.maintenance_seconds:
                return
            self._scan()
            self.trim_quarantine()
            self.prune()
            with self.connection() as connection:
                connection.execute("INSERT INTO maintenance VALUES (1,?) ON CONFLICT(id) DO UPDATE SET performed=excluded.performed", (time.time(),))

    def trim_quarantine(self, *, limit: int = 20, maximum: int = 50 * 1024 * 1024) -> None:
        with self.connection() as connection:
            records = list(connection.execute("SELECT path,cache_key,bytes FROM entries WHERE path LIKE 'quarantine%' ORDER BY modified DESC"))
        total = 0
        for index, (relative, digest, size) in enumerate(records):
            total += size
            if index < limit and total <= maximum:
                continue
            with self.lock(digest, blocking=False) as available:
                if not available:
                    continue
                try:
                    path = self.directory / relative
                    path.unlink(missing_ok=True)
                    self.forget(path)
                    self.count("evicted")
                except OSError:
                    continue
