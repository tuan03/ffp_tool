"""Bounded rolling health state for disposable Amazon crawl workers."""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any


class WorkerHealth:
    FAILURE_LIMIT = 5
    WINDOW_SECONDS = 10 * 60

    def __init__(self, *, clock=time.monotonic) -> None:
        self._clock = clock
        self._failures: deque[tuple[float, str, str]] = deque()
        self._lock = threading.Lock()

    def record_failure(self, reason: str, *, timestamp: str | None = None) -> None:
        now = self._clock()
        recorded_at = timestamp or datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._prune(now)
            self._failures.append((now, reason[:80], recorded_at[:40]))

    def snapshot(self, configured_concurrency: int) -> dict[str, Any]:
        now = self._clock()
        with self._lock:
            self._prune(now)
            failure_count = len(self._failures)
            is_degraded = failure_count >= self.FAILURE_LIMIT
            effective_concurrency = max(1, (configured_concurrency + 1) // 2) if is_degraded else configured_concurrency
            last_failure_at = self._failures[-1][2] if self._failures else None
            return {
                "state": "degraded" if is_degraded else "healthy",
                "failuresInWindow": failure_count,
                "failureLimit": self.FAILURE_LIMIT,
                "windowSeconds": self.WINDOW_SECONDS,
                "configuredConcurrency": configured_concurrency,
                "effectiveConcurrency": effective_concurrency,
                "lastFailureAt": last_failure_at,
            }

    def reset(self) -> int:
        with self._lock:
            cleared = len(self._failures)
            self._failures.clear()
            return cleared

    def _prune(self, now: float) -> None:
        while self._failures and now - self._failures[0][0] >= self.WINDOW_SECONDS:
            self._failures.popleft()
