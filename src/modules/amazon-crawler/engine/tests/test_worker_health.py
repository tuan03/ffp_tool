from __future__ import annotations

import unittest

from engine.distributed.worker_health import WorkerHealth


class WorkerHealthTests(unittest.TestCase):
    def test_resource_pressure_uses_hysteresis_and_keeps_capacity_within_configured_cap(self) -> None:
        health = WorkerHealth(clock=lambda: 10.0)
        for _ in range(2):
            health.record_resource_sample(cpu_percent=90, rss_bytes=500, memory_budget_bytes=1000)
        self.assertEqual(health.snapshot(8)["effectiveConcurrency"], 8)
        health.record_resource_sample(cpu_percent=90, rss_bytes=500, memory_budget_bytes=1000)
        self.assertEqual(health.snapshot(8)["effectiveConcurrency"], 4)

        health.record_resource_sample(cpu_percent=70, rss_bytes=500, memory_budget_bytes=1000)
        self.assertEqual(health.snapshot(8)["effectiveConcurrency"], 4)
        for _ in range(5):
            health.record_resource_sample(cpu_percent=50, rss_bytes=500, memory_budget_bytes=1000)
        self.assertEqual(health.snapshot(8)["effectiveConcurrency"], 8)
        self.assertLessEqual(health.snapshot(3)["effectiveConcurrency"], 3)

    def test_quota_failures_trigger_a_bounded_temporary_concurrency_cap(self) -> None:
        now = [0.0]
        health = WorkerHealth(clock=lambda: now[0])
        health.record_failure("HTTP 429 quota rate limit")
        self.assertTrue(health.snapshot(6)["quotaPressure"])
        self.assertEqual(health.snapshot(6)["effectiveConcurrency"], 3)
        now[0] = 61
        self.assertFalse(health.snapshot(6)["quotaPressure"])
        self.assertEqual(health.snapshot(6)["effectiveConcurrency"], 6)

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
