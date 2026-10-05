"""Read-only and bounded agent self-test report tests."""
import unittest
from unittest.mock import patch

from engine.distributed.client_self_test import build_self_test_report


class ClientSelfTestTests(unittest.TestCase):
    def test_healthy_agent_reports_pass_without_sensitive_storage_fields(self):
        report = build_self_test_report(session_authenticated=True,
            storage={"blocked": False, "freeBytes": 123456, "reasons": [], "warnings": [], "path": "secret-path"},
            database_integrity=True,
            worker_health={"state": "healthy", "failuresInWindow": 0, "effectiveConcurrency": 3})
        self.assertEqual(report["status"], "PASS")
        self.assertEqual({check["status"] for check in report["checks"].values()}, {"PASS"})
        self.assertNotIn("path", report["checks"]["disk"]["detail"])

    def test_auth_failure_disk_pressure_and_worker_degradation_are_explicit(self):
        report = build_self_test_report(session_authenticated=False,
            storage={"blocked": True, "freeBytes": 100, "reasons": ["LOW_DISK_SPACE"], "warnings": []},
            database_integrity=True,
            worker_health={"state": "degraded", "failuresInWindow": 5, "effectiveConcurrency": 2})
        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["checks"]["authentication"]["status"], "FAIL")
        self.assertEqual(report["checks"]["disk"]["status"], "FAIL")
        self.assertEqual(report["checks"]["worker"]["status"], "DEGRADED")
        self.assertEqual(report["checks"]["serialization"]["status"], "PASS")

    def test_storage_warning_without_blocking_condition_is_degraded(self):
        report = build_self_test_report(session_authenticated=True,
            storage={"blocked": False, "freeBytes": 1000, "reasons": [], "warnings": ["OUTBOX_AGE_WARNING"]},
            database_integrity=True, worker_health={"state": "healthy"})
        self.assertEqual(report["status"], "DEGRADED")
        self.assertEqual(report["checks"]["disk"]["status"], "DEGRADED")

    def test_serialization_failure_is_reported_as_fail(self):
        with patch("engine.distributed.client_self_test.json.dumps", side_effect=TypeError("unsafe")):
            report = build_self_test_report(session_authenticated=True,
                storage={"blocked": False, "reasons": [], "warnings": []}, database_integrity=True,
                worker_health={"state": "healthy"})
        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["checks"]["serialization"]["status"], "FAIL")


if __name__ == "__main__":
    unittest.main()
