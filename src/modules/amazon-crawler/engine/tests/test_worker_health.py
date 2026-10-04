from __future__ import annotations

import unittest

from engine.distributed.worker_health import WorkerHealth


class WorkerHealthTests(unittest.TestCase):
    def test_degrades_after_five_failures_and_halves_capacity(self) -> None:
        now = [0.0]
        health = WorkerHealth(clock=lambda: now[0])

        for failure in range(4):
            health.record_failure("worker_exit", timestamp=f"failure-{failure}")

        before_threshold = health.snapshot(configured_concurrency=8)
        self.assertEqual(before_threshold["state"], "healthy")
        self.assertEqual(before_threshold["effectiveConcurrency"], 8)

        health.record_failure("worker_timeout", timestamp="failure-4")
        degraded = health.snapshot(configured_concurrency=8)
        self.assertEqual(degraded["state"], "degraded")
        self.assertEqual(degraded["failuresInWindow"], 5)
        self.assertEqual(degraded["effectiveConcurrency"], 4)

    def test_recovers_after_failure_window_expires_and_keeps_minimum_capacity(self) -> None:
        now = [0.0]
        health = WorkerHealth(clock=lambda: now[0])
        for failure in range(5):
            health.record_failure("worker_exit", timestamp=f"failure-{failure}")

        self.assertEqual(health.snapshot(configured_concurrency=1)["state"], "degraded")
        self.assertEqual(health.snapshot(configured_concurrency=1)["effectiveConcurrency"], 1)

        now[0] = WorkerHealth.WINDOW_SECONDS
        recovered = health.snapshot(configured_concurrency=1)
        self.assertEqual(recovered["state"], "healthy")
        self.assertEqual(recovered["failuresInWindow"], 0)


if __name__ == "__main__":
    unittest.main()
