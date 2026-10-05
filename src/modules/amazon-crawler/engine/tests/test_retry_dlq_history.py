from __future__ import annotations

import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select
from fastapi.testclient import TestClient

from engine.distributed.coordinator_models import CrawlTask, TaskAttempt, create_database_engine, create_session_factory
from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.operator_authorization import OperatorAudit, OperatorCredentials
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.protocol import utc_now
from engine.tests.coordinator_test_support import create_coordinator_test_schema
from engine.tests.test_distributed import client_hello


class RetryDlqHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "coordinator.sqlite3"
        self.engine = create_database_engine(f"sqlite:///{database_path.as_posix()}")
        create_coordinator_test_schema(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temporary_directory.cleanup()

    def _fail_once(self, job_id: str, error: dict[str, object]) -> str:
        leases = self.store.lease_tasks("client-a", 1)
        self.assertEqual(len(leases), 1)
        lease = leases[0]
        self.store.fail_task("client-a", {
            "taskId": lease["taskId"], "leaseId": lease["leaseId"], "error": error,
        })
        return str(lease["taskId"])

    def test_error_taxonomy_maps_failures_to_stable_classes(self) -> None:
        from engine.distributed.retry_taxonomy import classify_task_error

        cases = [
            ({"reason": "http_429"}, "RATE_LIMITED"),
            ({"reason": "dns_error"}, "DNS_ERROR"),
            ({"reason": "worker_crash"}, "WORKER_CRASH"),
            ({"reason": "captcha", "retryable": False}, "ACCESS_BLOCKED"),
            ({"reason": "not_found", "notFoundConfirmed": True}, "NOT_FOUND"),
            ({"reason": "surprise"}, "UNKNOWN"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                classified = classify_task_error({**raw, "token": "never-persist-this"})
                self.assertEqual(classified["errorCode"], expected)
                self.assertNotIn("token", classified)

    def test_retry_budget_is_persistent_and_permanent_error_goes_to_dlq(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        task_id = ""
        for attempt in range(3):
            task_id = self._fail_once(str(job["id"]), {
                "reason": "network_timeout", "retryable": True, "message": "timeout",
                "retryAfter": (utc_now() - timedelta(seconds=1)).isoformat(),
            })
            if attempt < 2:
                with self.sessions.begin() as session:
                    task = session.get(CrawlTask, task_id)
                    task.next_retry_at = utc_now() - timedelta(seconds=1)
                    task.last_error = {**task.last_error, "retryAfter": (utc_now() - timedelta(seconds=1)).isoformat()}

        with self.sessions() as session:
            task = session.get(CrawlTask, task_id)
            self.assertEqual(task.status, "dead_letter")
            self.assertEqual(task.failure_count, 3)
            self.assertIsNotNone(task.next_retry_at)
            self.assertEqual(session.scalar(select(CrawlTask.max_retry).where(CrawlTask.id == task_id)), 3)
            attempts = list(session.scalars(select(TaskAttempt).where(TaskAttempt.task_id == task_id)))
            self.assertEqual(len(attempts), 3)
            self.assertTrue(all(attempt.error_code == "NETWORK_TIMEOUT" for attempt in attempts))
            self.assertTrue(all(attempt.agent_version == "5.0.0" for attempt in attempts))

    def test_retry_after_is_persisted_and_operator_requeue_keeps_attempt_history(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        task_id = self._fail_once(str(job["id"]), {
            "reason": "network_timeout", "retryable": True,
            "retryAfter": (utc_now() + timedelta(minutes=2)).isoformat(),
        })
        with self.sessions() as session:
            task = session.get(CrawlTask, task_id)
            from engine.distributed.coordinator_store import _as_utc
            self.assertGreater(_as_utc(task.next_retry_at), utc_now())
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, task_id)
            task.next_retry_at = utc_now() - timedelta(seconds=1)
            task.last_error = {**task.last_error, "retryAfter": (utc_now() - timedelta(seconds=1)).isoformat()}
        self._fail_once(str(job["id"]), {
            "reason": "not_found", "retryable": False, "notFoundConfirmed": True,
        })
        before = self.store.list_dead_letter_tasks(job_id=str(job["id"]))
        self.assertEqual(before["total"], 1)
        self.assertEqual(before["items"][0]["errorCode"], "NOT_FOUND")

        requeued = self.store.requeue_dead_letter_tasks(
            [task_id], expected_count=1, request_id="requeue-request-1",
            actor="operator", reason="Verified the product URL is valid.",
        )
        self.assertEqual(requeued["changed"], 1)
        with self.sessions() as session:
            task = session.get(CrawlTask, task_id)
            attempts = list(session.scalars(select(TaskAttempt).where(TaskAttempt.task_id == task_id)))
            self.assertEqual(task.status, "queued")
            self.assertEqual(task.failure_count, 0)
            self.assertEqual(task.requeue_count, 1)
            self.assertEqual(len(attempts), 2)
            self.assertEqual(self.store.lease_tasks("client-a", 1)[0]["taskId"], task_id)

    def test_dlq_delete_is_soft_delete_and_retains_attempt_history(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        task_id = self._fail_once(str(job["id"]), {
            "reason": "invalid_url", "retryable": False, "message": "bad URL",
        })
        deleted = self.store.delete_dead_letter_task(
            task_id, actor="operator", reason="Duplicate input verified.",
        )
        self.assertTrue(deleted)
        self.assertEqual(self.store.list_dead_letter_tasks(job_id=str(job["id"]))["total"], 0)
        with self.sessions() as session:
            task = session.get(CrawlTask, task_id)
            attempts = list(session.scalars(select(TaskAttempt).where(TaskAttempt.task_id == task_id)))
            self.assertEqual(task.status, "dead_letter_deleted")
            self.assertEqual(len(attempts), 1)
        self.assertTrue(self.store.delete_job(str(job["id"])))
        archived_attempts = self.store.list_task_attempts(task_id)
        self.assertEqual(len(archived_attempts), 1)
        self.assertTrue(archived_attempts[0]["archived"])


class DeadLetterOperatorRouteTests(unittest.TestCase):
    def test_routes_require_operator_and_actions_are_confirmed_audited_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("engine.distributed.coordinator_server.find_project_root", return_value=root):
                app = create_coordinator_app(
                    database_url=f"sqlite:///{(root / 'dlq.db').as_posix()}",
                    operator_credentials=OperatorCredentials("operator", "fixture-secret"),
                )
            with TestClient(app) as client:
                self.assertEqual(client.get("/api/v1/dead-letter").status_code, 401)
                created = client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}, auth=("operator", "fixture-secret"))
                self.assertEqual(created.status_code, 202)
                app.state.store.register_client(client_hello(slots=1))
                lease = app.state.store.lease_tasks("client-a", 1)[0]
                app.state.store.fail_task("client-a", {
                    "taskId": lease["taskId"], "leaseId": lease["leaseId"],
                    "error": {"reason": "invalid_url", "retryable": False, "message": "invalid source"},
                })
                page = client.get("/api/v1/dead-letter", auth=("operator", "fixture-secret"))
                self.assertEqual(page.status_code, 200, page.text)
                self.assertEqual(page.json()["items"][0]["errorCode"], "INVALID_URL")
                request = {
                    "action": "requeue", "requestId": "operator-requeue-001",
                    "taskIds": [lease["taskId"]], "expectedCount": 1,
                    "reason": "Operator verified the source and approved retry.",
                }
                self.assertEqual(client.post("/api/v1/dead-letter/actions", json=request).status_code, 401)
                mismatch = {**request, "expectedCount": 2}
                self.assertEqual(client.post("/api/v1/dead-letter/actions", json=mismatch,
                    auth=("operator", "fixture-secret")).status_code, 409)
                response = client.post("/api/v1/dead-letter/actions", json=request, auth=("operator", "fixture-secret"))
                self.assertEqual(response.status_code, 200, response.text)
                duplicate = client.post("/api/v1/dead-letter/actions", json=request, auth=("operator", "fixture-secret"))
                self.assertEqual(duplicate.json(), response.json())
                conflict = client.post("/api/v1/dead-letter/actions", json={
                    **request, "taskIds": ["different-task"],
                }, auth=("operator", "fixture-secret"))
                self.assertEqual(conflict.status_code, 409)
                with app.state.store.sessions() as session:
                    audits = list(session.scalars(select(OperatorAudit).where(OperatorAudit.route == "/api/v1/dead-letter/actions")))
                    self.assertTrue(any(entry.outcome == "denied" for entry in audits))
                    self.assertTrue(any(entry.outcome == "completed" for entry in audits))


if __name__ == "__main__":
    unittest.main()
