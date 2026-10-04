"""Lease mutation authority, independent of transport and browser execution."""
from __future__ import annotations

import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select

from engine.distributed.coordinator_models import (
    Base, CrawlTask, DeletedCrawlJob, JobEvent, TaskAttempt,
    create_database_engine, create_session_factory,
)
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.protocol import utc_now


class LeaseMutationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_database_engine(f"sqlite:///{Path(self.directory.name).as_posix()}/test.sqlite3")
        self.initialize_fixture()

    def initialize_fixture(self):
        Base.metadata.create_all(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)
        self.job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        for name in ("a", "b"):
            self.store.register_client({"clientId": name, "displayName": name, "availableSlots": 1, "maxConcurrentInputs": 1})
        self.lease = self.store.lease_tasks("a", 1)[0]
        self.local = {"taskId": self.lease["taskId"], "leaseId": self.lease["leaseId"], "jobId": self.job["id"]}

    def tearDown(self):
        self.engine.dispose()
        self.directory.cleanup()

    def expire(self):
        with self.sessions.begin() as session:
            session.get(CrawlTask, self.lease["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)

    def snapshot(self):
        with self.sessions() as session:
            task = session.get(CrawlTask, self.lease["taskId"])
            attempts = list(session.scalars(select(TaskAttempt).order_by(TaskAttempt.leased_at)))
            return (task.status, task.assigned_client_id, task.lease_id, task.lease_expires_at,
                    task.failure_count, task.last_error,
                    [(attempt.lease_id, attempt.status, attempt.finished_at) for attempt in attempts],
                    len(list(session.scalars(select(JobEvent)))))

    def test_expired_heartbeat_does_not_renew(self):
        self.expire()
        before = self.snapshot()
        self.store.heartbeat("a", [self.local], "busy")
        self.assertEqual(self.snapshot(), before)

    def test_expired_progress_does_not_renew_or_emit_event(self):
        self.expire()
        before = self.snapshot()
        self.store.update_progress("a", {**self.local, "progress": {"message": "late"}})
        self.assertEqual(self.snapshot(), before)

    def test_expired_failure_does_not_increment_budget(self):
        self.expire()
        before = self.snapshot()
        self.assertEqual(self.store.fail_task("a", {**self.local, "error": {"retryable": False}})["status"], "stale")
        self.assertEqual(self.snapshot(), before)

    def test_expired_reconcile_does_not_resume(self):
        self.expire()
        before = self.snapshot()
        result = self.store.reconcile_tasks("a", [self.local])
        self.assertEqual(result["resumeTaskIds"], [])
        self.assertEqual(result["discardTaskIds"], [self.lease["taskId"]])
        self.assertEqual(self.snapshot(), before)

    def test_requeued_task_cannot_be_claimed_by_reconnect(self):
        self.expire()
        self.store.reap_expired()
        before = self.snapshot()
        for owner, local in (("a", self.local), ("b", {**self.local, "leaseId": "never-issued"})):
            self.assertEqual(self.store.reconcile_tasks(owner, [local])["resumeTaskIds"], [])
            self.assertEqual(self.snapshot(), before)

    def test_reassigned_lease_ignores_all_old_mutations(self):
        self.expire()
        self.store.reap_expired()
        self.store.lease_tasks("b", 1)
        before = self.snapshot()
        self.store.heartbeat("a", [self.local])
        self.store.update_progress("a", self.local)
        self.assertEqual(self.store.fail_task("a", self.local)["status"], "stale")
        self.assertEqual(self.store.acknowledge_task_cancel("a", self.local)["status"], "stale")
        self.assertEqual(self.store.acknowledge_task_cancel_received("a", self.local)["status"], "stale")
        self.assertEqual(self.store.reconcile_tasks("a", [self.local])["resumeTaskIds"], [])
        self.assertEqual(self.snapshot(), before)

    def test_wrong_job_tombstone_cannot_cancel_valid_task(self):
        with self.sessions.begin() as session:
            session.add(DeletedCrawlJob(job_id="other-job", cancellation_id="fixture-cancel", expires_at=utc_now() + timedelta(days=1)))
        before = self.snapshot()
        result = self.store.reconcile_tasks("a", [{**self.local, "jobId": "other-job"}])
        self.assertEqual(result["resumeTaskIds"], [])
        self.assertEqual(self.snapshot(), before)

    def test_current_lease_renews_resumes_and_can_fail(self):
        self.store.heartbeat("a", [self.local])
        self.store.update_progress("a", {**self.local, "progress": {"message": "current"}})
        self.assertEqual(self.store.reconcile_tasks("a", [self.local])["resumeTaskIds"], [self.lease["taskId"]])
        self.assertEqual(self.store.fail_task("a", {**self.local, "error": {"retryable": False}})["status"], "failed")

    def test_cancel_ack_from_old_owner_cannot_cancel_current_owner(self):
        self.expire()
        self.store.reap_expired()
        current = self.store.lease_tasks("b", 1)[0]
        self.store.cancel_job(self.job["id"])
        before = self.snapshot()
        self.assertEqual(self.store.acknowledge_task_cancel_received("a", self.local)["status"], "stale")
        self.assertEqual(self.store.acknowledge_task_cancel("a", self.local)["status"], "stale")
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.store.acknowledge_task_cancel_received("b", current)["status"], "received")
        self.assertEqual(self.store.acknowledge_task_cancel("b", current)["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
