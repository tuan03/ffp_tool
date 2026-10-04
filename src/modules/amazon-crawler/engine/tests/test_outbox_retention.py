"""Task 07: stop and cleanup retain unacknowledged results."""
import tempfile
import unittest
import asyncio
import sqlite3
import threading
import urllib.error
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from engine.distributed.client_store import ClientStore
from engine.distributed.protocol import payload_checksum


class OutboxRetentionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "agent.sqlite3"
        self.store = ClientStore(self.path)
        self.assignment = {"taskId": "task", "jobId": "job", "leaseId": "a", "settingsFingerprint": "settings"}
        self.store.save_assignment(self.assignment)
        self.spool()

    def tearDown(self):
        self.directory.cleanup()

    def spool(self, lease="a"):
        payload = {"jobId": "job", "product": {"sourceKey": "product"}}
        args = dict(task_id="task", lease_id=lease, checksum=payload_checksum(payload), payload=payload)
        self.store.spool_result(**args)
        self.store.spool_product(product_key="product", **args)

    def assert_retained(self):
        self.store = ClientStore(self.path)
        self.assertEqual(self.store.upload_counts(), {"products": 1, "results": 1})
        self.assertEqual(self.store.pending_results(), [])
        self.assertEqual(self.store.pending_products(), [])
        self.assertEqual(len(self.store.quarantined_uploads()), 2)

    def test_discard_task_keeps_rows_but_excludes_upload(self):
        self.store.discard_task("task")
        self.assert_retained()

    def test_discard_job_finds_results_after_assignment_removed(self):
        self.store.complete_lease("task")
        self.store.discard_job("job")
        self.assert_retained()

    def test_orphan_cleanup_keeps_result_and_reason_after_reopen(self):
        self.store.clear_orphaned_jobs(set())
        self.assert_retained()
        self.assertTrue(all(row["reason"] == "orphaned_job" for row in self.store.quarantined_uploads()))

    def test_stop_blocks_late_result_from_worker(self):
        self.store.cancel_job("job")
        self.spool("late")
        self.assertEqual(self.store.upload_counts(), {"products": 2, "results": 2})
        self.assertEqual(self.store.pending_results(), [])
        self.assertEqual(self.store.pending_products(), [])

    def test_old_attempt_quarantine_preserves_new_attempt(self):
        self.spool("b")
        self.store.quarantine_attempt("task", "a", "stale_lease")
        self.assertEqual([row["leaseId"] for row in self.store.pending_results()], ["b"])
        self.assertEqual([row["leaseId"] for row in self.store.pending_products()], ["b"])

    def test_ack_in_flight_cannot_remove_quarantined_result(self):
        final = self.store.pending_results()[0]
        product = self.store.pending_products()[0]
        self.store.cancel_job("job")
        self.store.acknowledge_result(final["resultId"])
        self.store.acknowledge_product(product["resultId"])
        self.assert_retained()

    def test_v1_migration_preserves_ids_and_creates_backup(self):
        before = self.store.pending_results()
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("DROP TABLE outbox_quarantine")
            connection.execute("DROP TABLE outbox_blocks")
            connection.execute("PRAGMA user_version=1")
        self.store = ClientStore(self.path)
        self.assertEqual(self.store.pending_results(), before)
        self.assertEqual(len(list(self.path.parent.glob("*.pre-outbox-v2-*.bak"))), 1)
        self.store.discard_job("job")
        self.assert_retained()

    def test_other_job_remains_eligible_after_cleanup(self):
        payload = {"jobId": "retained"}
        self.store.spool_result(task_id="other", lease_id="b", checksum=payload_checksum(payload), payload=payload)
        self.store.clear_orphaned_jobs({"retained"})
        self.assertEqual([row["taskId"] for row in self.store.pending_results()], ["other"])
        self.assertEqual(self.store.upload_counts(), {"products": 1, "results": 2})

    def test_v2_migration_failure_rolls_back_without_losing_results(self):
        from engine.distributed import client_outbox_migrations as migration
        before = self.store.pending_results()
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("DROP TABLE outbox_quarantine")
            connection.execute("DROP TABLE outbox_blocks")
            connection.execute("PRAGMA user_version=1")
        original = migration._create_retention
        def fail(connection):
            original(connection)
            raise RuntimeError("injected migration failure")
        with patch.object(migration, "_create_retention", side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                ClientStore(self.path)
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
        self.assertEqual(ClientStore(self.path).pending_results(), before)


class AgentRetentionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from engine.distributed.client_agent import DistributedCrawlerAgent
        from engine.distributed.client_config import AgentConfig
        from engine.distributed.protocol import AgentLimits
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.agent = DistributedCrawlerAgent(project_root=self.root, config=AgentConfig(
            server_url="http://127.0.0.1:9999", display_name="test", max_concurrent_inputs=1,
            limits=AgentLimits(), data_directory=self.root / "agent"))
        self.assignment = {"taskId": "task", "jobId": "job", "leaseId": "a", "settingsFingerprint": "settings"}
        self.agent.store.save_assignment(self.assignment)
        self.agent.active["task"] = self.assignment
        self.asset = self.root / "review-output.png"
        self.asset.write_bytes(b"fixture-output-bytes")
        self.payload = {"jobId": "job", "assetPath": str(self.asset), "product": {"sourceKey": "product"}}
        self.spool()

    def spool(self, lease="a"):
        args = dict(task_id="task", lease_id=lease, checksum=payload_checksum(self.payload), payload=self.payload)
        self.agent.store.spool_result(**args)
        self.agent.store.spool_product(product_key="product", **args)

    def tearDown(self):
        self.directory.cleanup()

    async def cycle(self):
        with patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await self.agent._upload_loop()

    async def assert_not_published(self):
        with patch.object(self.agent, "_upload_product") as product, patch.object(self.agent, "_upload_result") as final:
            await self.cycle()
        product.assert_not_called()
        final.assert_not_called()

    async def test_local_stop_cleanup_retains_payload_and_binary_without_publish(self):
        self.agent.stop_and_discard_local_work()
        await self.agent.clear_temporary_data("fixture", set())
        await self.agent.clear_local_cache("fixture")
        self.assertEqual(self.asset.read_bytes(), b"fixture-output-bytes")
        self.assertEqual(self.agent.store.upload_counts(), {"products": 1, "results": 1})
        with closing(sqlite3.connect(self.agent.store.path)) as connection:
            stored = connection.execute("SELECT payload_json FROM pending_results").fetchone()[0]
            import json
            self.assertEqual(json.loads(stored), self.payload)
        await self.assert_not_published()

    async def test_remote_stop_cleanup_retains_result_and_asset(self):
        self.agent._cancel_job("job")
        self.agent._pending_stop_cleanups["job"] = 1
        await self.agent._complete_stop_cleanup("job", 1)
        self.assertEqual(len(self.agent.store.quarantined_uploads()), 2)
        self.assertTrue(self.asset.exists())
        await self.assert_not_published()

    async def test_reconcile_blocks_late_output_from_executing_task(self):
        self.agent.executing_task_ids.add("task")
        await self.agent._apply_reconciliation({"discardTaskIds": ["task"]})
        self.spool()
        self.assertEqual(len(self.agent.store.quarantined_uploads()), 2)
        await self.assert_not_published()

    async def test_reconcile_discard_cancels_only_the_stale_task_in_a_shared_job(self):
        selected = threading.Event()
        sibling = threading.Event()
        self.agent.active["sibling"] = {"taskId": "sibling", "jobId": "job", "leaseId": "b"}
        self.agent.executing_task_ids.update({"task", "sibling"})
        self.agent.task_cancel_events.update({"task": selected, "sibling": sibling})

        await self.agent._apply_reconciliation({"discardTaskIds": ["task"]})

        self.assertTrue(selected.is_set())
        self.assertFalse(sibling.is_set())

    async def test_http_conflict_quarantines_attempt_and_does_not_retry_publish(self):
        error = urllib.error.HTTPError("fixture", 409, "conflict", {}, None)
        with patch.object(self.agent, "_upload_product", side_effect=error) as upload:
            await self.cycle()
        self.assertEqual(upload.call_count, 1)
        self.assertEqual(self.agent.store.upload_counts(), {"products": 1, "results": 1})
        self.assertTrue(all(row["reason"] == "upload_http_409" for row in self.agent.store.quarantined_uploads()))
        await self.assert_not_published()
