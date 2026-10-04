"""Task 08: storage pressure blocks admission without deleting results."""
import asyncio
import sqlite3
import json
import threading
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from engine.distributed.client_config import AgentConfig
from engine.distributed.client_agent import DistributedCrawlerAgent
from engine.distributed.client_storage_pressure import OutboxLimits
from engine.distributed.protocol import AgentLimits, payload_checksum


class OutboxPressureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.agent = DistributedCrawlerAgent(project_root=self.root, config=AgentConfig(
            server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=1,
            limits=AgentLimits(), data_directory=self.root / "agent"))
        self.disk = patch("engine.distributed.client_storage_pressure.shutil.disk_usage", return_value=SimpleNamespace(free=10 * 1024**3))
        self.disk_mock = self.disk.start()

    def tearDown(self):
        self.disk.stop()
        self.directory.cleanup()

    def spool(self):
        payload = {"jobId": "job", "products": []}
        self.agent.store.spool_result(task_id="task", lease_id="lease", checksum=payload_checksum(payload), payload=payload)

    def test_approved_defaults_and_invalid_override(self):
        limits = OutboxLimits()
        self.assertEqual((limits.max_bytes, limits.max_records, limits.min_free_bytes, limits.warn_age_seconds), (1024**3, 10000, 2*1024**3, 86400))
        with self.assertRaises(ValueError):
            OutboxLimits.from_payload({"maxRecords": 0})

    def test_record_limit_counts_quarantine_and_keeps_payload(self):
        self.agent.config = replace(self.agent.config, outbox=OutboxLimits(max_records=1))
        self.spool()
        self.agent.store.discard_job("job")
        self.assertEqual(self.agent._available_slots(), 0)
        self.assertIn("OUTBOX_RECORD_LIMIT", self.agent.status_snapshot()["storage"]["reasons"])
        self.assertEqual(self.agent.store.upload_counts()["results"], 1)

    def test_byte_limit_and_return_to_available_after_valid_ack(self):
        self.agent.config = replace(self.agent.config, outbox=OutboxLimits(max_bytes=1))
        self.spool()
        self.assertEqual(self.agent._available_slots(), 0)
        row = self.agent.store.pending_results()[0]
        self.agent.store.acknowledge_result(row["resultId"])
        self.assertEqual(self.agent._available_slots(), 1)

    def test_low_disk_and_disk_probe_error_fail_closed(self):
        self.disk_mock.return_value = SimpleNamespace(free=2*1024**3-1)
        self.assertEqual(self.agent._available_slots(), 0)
        self.disk_mock.side_effect = OSError("fixture unavailable")
        self.assertEqual(self.agent._available_slots(), 0)
        self.assertTrue(self.agent.status_snapshot()["storage"]["blocked"])

    def test_oldest_result_warns_without_deleting_or_blocking(self):
        self.spool()
        with self.agent.store._connection() as connection:
            connection.execute("UPDATE pending_results SET created_at='2000-01-01T00:00:00Z'")
        health = self.agent.status_snapshot()["storage"]
        self.assertIn("OUTBOX_AGE_WARNING", health["warnings"])
        self.assertFalse(health["blocked"])
        self.assertEqual(self.agent.store.upload_counts()["results"], 1)

    def test_failed_save_latches_admission_and_never_marks_complete(self):
        self.agent.store.save_assignment({"taskId": "task", "jobId": "job", "leaseId": "lease", "settingsFingerprint": "settings"})
        with patch.object(self.agent.store, "_spool", side_effect=sqlite3.OperationalError("database or disk is full")):
            with self.assertRaises(sqlite3.OperationalError):
                self.spool()
        self.assertEqual(self.agent._available_slots(), 0)
        self.assertEqual(self.agent.store.local_tasks()[0]["status"], "leased")
        self.assertEqual(self.agent.store.upload_counts()["results"], 0)
        with self.assertRaises(OSError):
            self.spool()

    async def test_pressure_keeps_upload_loop_running(self):
        self.spool()
        self.disk_mock.return_value = SimpleNamespace(free=0)
        row = self.agent.store.pending_results()[0]
        receipt = {"status": "accepted", "checksum": row["checksum"],
                   "receiptId": payload_checksum(["final", "task", self.agent.client_id, "lease", ""])}
        with patch.object(self.agent, "_upload_result", return_value=receipt) as upload, patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await self.agent._upload_loop()
        upload.assert_called_once()
        self.assertEqual(self.agent.store.upload_counts()["results"], 0)

    async def test_pressure_blocks_execution_of_queued_work(self):
        self.disk_mock.return_value = SimpleNamespace(free=0)
        self.agent.assignment_queue.put_nowait({"taskId": "fixture"})
        async def stop(_seconds):
            self.agent.stop_event.set()
        with patch("engine.distributed.client_agent.asyncio.sleep", side_effect=stop), patch.object(self.agent, "_run_batch") as run:
            await self.agent._execution_loop()
        run.assert_not_called()
        self.assertEqual(self.agent.assignment_queue.qsize(), 1)

    async def test_inflight_assignment_is_not_accepted_under_pressure(self):
        self.disk_mock.return_value = SimpleNamespace(free=0)
        async def messages():
            yield json.dumps({"type": "assignment", "taskId": "new", "jobId": "job", "leaseId": "lease", "settingsFingerprint": "settings"})
        await self.agent._receiver(messages())
        self.assertEqual(self.agent.active, {})
        self.assertEqual(self.agent.store.local_tasks(), [])
        self.assertEqual(await self.agent.outbound_queue.get(), {"type": "ready", "availableSlots": 0})

    async def test_failed_review_result_save_never_enqueues_completed(self):
        assignment = {"taskId": "task", "jobId": "job", "leaseId": "lease", "source": "fixture", "asin": "fixture"}
        with patch("engine.distributed.client_agent.crawl_reviews_with_agent", return_value={"warnings": []}), patch.object(self.agent.store, "_spool", side_effect=sqlite3.OperationalError("disk full")):
            with self.assertRaises(sqlite3.OperationalError):
                await asyncio.to_thread(self.agent._run_review_batch, [assignment], threading.Event(), asyncio.get_running_loop())
        self.assertTrue(self.agent.completion_queue.empty())
        self.assertEqual(self.agent._available_slots(), 0)

    def test_json_limits_load_and_warning_text(self):
        from engine.distributed.client_storage_pressure import storage_warning_text
        path = self.root / "agent.json"
        path.write_text(json.dumps({"serverUrl": "http://127.0.0.1", "outbox": {"maxRecords": 17}}), encoding="utf-8")
        self.assertEqual(AgentConfig.load(path).outbox.max_records, 17)
        self.assertIn("ngừng nhận", storage_warning_text({"blocked": True, "reasons": ["LOW_DISK_SPACE"]}))
        self.assertTrue(storage_warning_text({"warnings": ["OUTBOX_AGE_WARNING"]}))

    def test_unreadable_store_reports_pressure_instead_of_ready(self):
        with patch.object(self.agent.store, "_connect", side_effect=sqlite3.OperationalError("unreadable")):
            snapshot = self.agent.status_snapshot()
        self.assertEqual(snapshot["availableSlots"], 0)
        self.assertTrue(snapshot["storage"]["blocked"])

    def test_failed_new_save_preserves_existing_backlog(self):
        self.spool()
        before = self.agent.store.pending_results()
        with patch.object(self.agent.store, "_spool", side_effect=sqlite3.OperationalError("disk full")):
            with self.assertRaises(sqlite3.OperationalError):
                self.agent.store.spool_product(task_id="new", lease_id="new", product_key="new", checksum="fixture", payload={})
        self.assertEqual(self.agent.store.pending_results(), before)
        self.assertEqual(self.agent.store.pending_products(), [])
        self.assertEqual(self.agent._available_slots(), 0)

    def test_free_space_at_approved_boundary_is_allowed(self):
        self.disk_mock.return_value = SimpleNamespace(free=2*1024**3)
        self.assertEqual(self.agent._available_slots(), 1)
