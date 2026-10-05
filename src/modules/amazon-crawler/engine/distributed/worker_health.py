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
        self._resource_pressure = False
        self._high_samples = 0
        self._healthy_samples = 0
        self._last_cpu_percent: float | None = None
        self._last_rss_bytes: int | None = None
        self._quota_pressure_until = 0.0

    def record_failure(self, reason: str, *, timestamp: str | None = None) -> None:
        now = self._clock()
        recorded_at = timestamp or datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._prune(now)
            self._failures.append((now, reason[:80], recorded_at[:40]))
            lowered_reason = reason.casefold()
            if any(marker in lowered_reason for marker in ("quota", "rate limit", "rate_limit", "429", "throttle")):
                self._quota_pressure_until = max(self._quota_pressure_until, now + 60)

    def record_resource_sample(self, *, cpu_percent: float | None, rss_bytes: int | None,
                               memory_budget_bytes: int | None = None) -> None:
        if cpu_percent is not None and (not isinstance(cpu_percent, (int, float)) or not 0 <= cpu_percent <= 100):
            raise ValueError("CPU utilization must be between 0 and 100 percent.")
        if rss_bytes is not None and (not isinstance(rss_bytes, int) or rss_bytes < 0):
            raise ValueError("RSS must be a non-negative integer.")
        if memory_budget_bytes is not None and (not isinstance(memory_budget_bytes, int) or memory_budget_bytes <= 0):
            raise ValueError("Memory budget must be a positive integer.")
        now = self._clock()
        is_high = ((cpu_percent is not None and cpu_percent >= 85)
            or (rss_bytes is not None and memory_budget_bytes is not None and rss_bytes >= memory_budget_bytes * 0.9))
        is_healthy = ((cpu_percent is None or cpu_percent <= 65)
            and (rss_bytes is None or memory_budget_bytes is None or rss_bytes <= memory_budget_bytes * 0.75))
        with self._lock:
            self._last_cpu_percent = float(cpu_percent) if cpu_percent is not None else None
            self._last_rss_bytes = rss_bytes
            if is_high:
                self._high_samples += 1
                self._healthy_samples = 0
                if self._high_samples >= 3:
                    self._resource_pressure = True
            elif is_healthy:
                self._healthy_samples += 1
                self._high_samples = 0
                if self._healthy_samples >= 5:
                    self._resource_pressure = False
            else:
                self._high_samples = 0
                self._healthy_samples = 0

    def snapshot(self, configured_concurrency: int) -> dict[str, Any]:
        now = self._clock()
        with self._lock:
            self._prune(now)
            failure_count = len(self._failures)
            quota_pressure = now < self._quota_pressure_until
            is_degraded = failure_count >= self.FAILURE_LIMIT or self._resource_pressure or quota_pressure
            effective_concurrency = max(1, (configured_concurrency + 1) // 2) if is_degraded else configured_concurrency
            last_failure_at = self._failures[-1][2] if self._failures else None
            return {
                "state": "degraded" if is_degraded else "healthy",
                "failuresInWindow": failure_count,
                "failureLimit": self.FAILURE_LIMIT,
                "windowSeconds": self.WINDOW_SECONDS,
                "configuredConcurrency": configured_concurrency,
                "effectiveConcurrency": effective_concurrency,
                "resourcePressure": self._resource_pressure,
                "quotaPressure": quota_pressure,
                "cpuPercent": self._last_cpu_percent,
                "rssBytes": self._last_rss_bytes,
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
