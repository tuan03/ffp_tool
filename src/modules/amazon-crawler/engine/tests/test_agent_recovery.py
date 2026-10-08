"""Recovery admission gates, independent of crawler/browser execution."""
import asyncio
import json
import threading
import tempfile
import unittest
from dataclasses import replace
import websockets
from pathlib import Path
from unittest.mock import patch

from engine.distributed.client_agent import DistributedCrawlerAgent
from engine.distributed.client_config import AgentConfig
from engine.distributed.agent_runtime_config import AgentRuntimeConfig
from engine.distributed.protocol import AgentLimits, payload_checksum


class AgentRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
            server_url="http://127.0.0.1:9999", display_name="recovery", max_concurrent_inputs=1,
            limits=AgentLimits(), data_directory=root / "agent"))
        self.agent._command_recovery_complete = True
        self.agent._command_recovery_event.set()

    def tearDown(self):
        self.directory.cleanup()

    def test_completed_upload_remains_in_heartbeat_until_durable_ack(self):
        assignment = {"taskId": "task", "leaseId": "lease", "jobId": "job", "settingsFingerprint": "x"}
        self.agent.store.save_assignment(assignment)
        payload = {"jobId": "job", "products": []}
        self.agent.store.spool_result(task_id="task", lease_id="lease", checksum=payload_checksum(payload), payload=payload)
        self.assertEqual(self.agent.store.recover_assignments(), [])
        self.assertEqual(self.agent._current_tasks_snapshot()[0]["leaseId"], "lease")
        self.assertEqual(self.agent.executing_task_ids, set())
        self.agent.store.acknowledge_result(self.agent.store.pending_results()[0]["resultId"])
        self.assertEqual(self.agent._current_tasks_snapshot(), [])

    def test_quarantined_upload_is_not_renewed_or_retried(self):
        assignment = {"taskId": "task", "leaseId": "lease", "jobId": "job", "settingsFingerprint": "x"}
        self.agent.store.save_assignment(assignment)
        self.agent.store.spool_result(task_id="task", lease_id="lease", checksum="x", payload={"products": []})
        self.agent.store.quarantine_attempt("task", "lease", "upload_stale")
        self.assertEqual(self.agent._current_tasks_snapshot(), [])
        self.assertEqual(self.agent.store.pending_results(), [])

    async def test_lost_ack_keeps_final_result_pending_and_duplicate_receipt_finishes_it(self):
        assignment = {"taskId": "task", "leaseId": "lease", "jobId": "job", "settingsFingerprint": "x"}
        self.agent.store.save_assignment(assignment)
        payload = {"jobId": "job", "products": []}
        self.agent.store.spool_result(task_id="task", lease_id="lease", checksum=payload_checksum(payload), payload=payload)
        with patch.object(self.agent, "_upload_result", side_effect=TimeoutError("ACK lost")), \
                patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await self.agent._upload_loop()
        self.assertEqual(len(self.agent._current_tasks_snapshot()), 1)
        pending = self.agent.store.pending_results()[0]
        receipt = {"status": "duplicate", "receiptId": payload_checksum([
            "final", "task", self.agent.client_id, "lease", ""]), "checksum": payload_checksum(payload)}
        with patch.object(self.agent, "_upload_result", return_value=receipt), \
                patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await self.agent._upload_loop()
        self.assertEqual(pending["attempts"], 1)
        self.assertEqual(self.agent.store.pending_results(), [])
        self.assertEqual(self.agent._current_tasks_snapshot(), [])

    async def test_final_upload_waits_for_product_receipts(self):
        self.agent.store.spool_product(task_id="task", lease_id="lease", product_key="product", checksum="x",
            payload={"product": {"id": "product"}})
        self.agent.store.spool_result(task_id="task", lease_id="lease", checksum="x", payload={"products": []})
        with patch.object(self.agent, "_upload_product", side_effect=TimeoutError("not acknowledged")), \
                patch.object(self.agent, "_upload_result") as upload_final, \
                patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await self.agent._upload_loop()
        upload_final.assert_not_called()
        self.assertEqual(len(self.agent.store.pending_results()), 1)

    async def test_slow_product_does_not_block_other_product_uploads(self):
        release = threading.Event()
        fast_uploaded = asyncio.Event()
        loop = asyncio.get_running_loop()
        for key in ("slow", "fast"):
            self.agent.store.spool_product(task_id="task", lease_id="lease", product_key=key,
                checksum=key, payload={"product": {"id": key}})

        def upload(product):
            if product["productKey"] == "slow":
                if not release.wait(3):
                    raise TimeoutError("slow test upload was never released")
            else:
                loop.call_soon_threadsafe(fast_uploaded.set)
            return {"status": "accepted"}

        with patch.object(self.agent, "_upload_product", side_effect=upload), patch.object(self.agent, "_validate_upload_receipt"):
            uploader = asyncio.create_task(self.agent._upload_loop())
            try:
                await asyncio.wait_for(fast_uploaded.wait(), timeout=1)
                self.assertFalse(release.is_set())
            finally:
                release.set()
                uploader.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await uploader

    def test_offline_and_unreconciled_capacity_is_zero(self):
        self.agent._command_recovery_complete = True
        with patch.object(self.agent, "_storage_pressure", return_value={"blocked": False}):
            self.assertEqual(self.agent._available_slots(), 0)
            self.agent._is_connected = True
            self.assertEqual(self.agent._available_slots(), 0)
            self.agent._recovery_complete = True
            self.assertEqual(self.agent._available_slots(), 1)

    def test_command_recovery_blocks_admission_until_synced(self):
        self.agent._is_connected = True
        self.agent._recovery_complete = True
        self.agent._command_recovery_complete = False
        with patch.object(self.agent, "_storage_pressure", return_value={"blocked": False}):
            self.assertEqual(self.agent._available_slots(), 0)
            self.agent._command_recovery_complete = True
            self.assertEqual(self.agent._available_slots(), 1)

    def test_worker_crash_storm_reduces_admission_without_touching_outbox(self):
        self.agent.store.spool_result(task_id="task-a", lease_id="lease-a", checksum="checksum-a", payload={"value": 1})
        self.agent.config = replace(self.agent.config, max_concurrent_inputs=8)
        self.agent._agent_runtime_config = AgentRuntimeConfig.from_payload({
            "maxConcurrentInputs": 8,
            "limits": self.agent.config.limits.apply({}),
        })
        self.agent._is_connected = True
        self.agent._recovery_complete = True
        self.agent._command_recovery_complete = True

        for failure in range(5):
            self.agent._record_worker_failure({"reason": f"worker_exit_{failure}"})

        with patch.object(self.agent, "_storage_pressure", return_value={"blocked": False}):
            self.assertEqual(self.agent._available_slots(), 4)
            self.assertEqual(self.agent.status_snapshot()["workerHealth"]["state"], "degraded")
        self.assertEqual(len(self.agent.store.pending_results()), 1)

    async def test_offline_queue_does_not_start(self):
        self.agent.assignment_queue.put_nowait({"taskId": "task"})
        async def stop(_):
            self.agent.stop_event.set()
        with patch("engine.distributed.client_agent.asyncio.sleep", side_effect=stop):
            await self.agent._execution_loop()
        self.assertEqual(self.agent.assignment_queue.qsize(), 1)

    async def test_receipt_only_recovery_keeps_outbox_without_recrawl(self):
        assignment = {"taskId": "task", "leaseId": "lease", "jobId": "job", "settingsFingerprint": "x"}
        self.agent.store.save_assignment(assignment)
        self.agent.active["task"] = assignment
        payload = {"jobId": "job", "products": []}
        self.agent.store.spool_result(task_id="task", lease_id="lease", checksum=payload_checksum(payload), payload=payload)
        await self.agent._apply_reconciliation({"uploadTaskIds": ["task"]})
        self.assertEqual(len(self.agent.store.pending_results()), 1)
        self.assertEqual(self.agent.store.recover_assignments(), [])
        self.assertEqual(self.agent.assignment_queue.qsize(), 0)
        self.assertNotIn("task", self.agent.active)

    async def test_repeated_reconcile_does_not_duplicate_queue(self):
        assignment = {"taskId": "task", "leaseId": "lease", "jobId": "job", "settingsFingerprint": "x"}
        self.agent.store.save_assignment(assignment)
        self.agent.active["task"] = assignment
        await self.agent._apply_reconciliation({"resumeTaskIds": ["task"]})
        await self.agent._apply_reconciliation({"resumeTaskIds": ["task"]})
        self.assertEqual(self.agent.assignment_queue.qsize(), 1)

    async def test_failed_control_reconciliation_never_approves_execution(self):
        assignment = {"taskId": "task", "leaseId": "lease", "jobId": "job", "settingsFingerprint": "x"}
        self.agent.store.save_assignment(assignment)
        with patch.object(self.agent, "_ensure_cache_generation", side_effect=OSError("fixture failure")):
            with self.assertRaises(OSError):
                await self.agent._apply_reconciliation({"resumeTaskIds": ["task"], "requiredCacheGeneration": 1})
        self.assertFalse(self.agent._recovery_complete)
        self.assertEqual(self.agent._approved_attempts, set())
        self.assertTrue(self.agent.assignment_queue.empty())

    async def test_gate_waits_for_first_upload_pass(self):
        self.agent._is_connected = True
        gate = asyncio.create_task(self.agent._recovery_gate_loop())
        await asyncio.sleep(0)
        self.assertFalse(self.agent._recovery_complete)
        self.agent._uploads_checked.set()
        await asyncio.sleep(0)
        self.assertTrue(self.agent._recovery_complete)
        self.agent.stop_event.set()
        await gate

    async def test_sender_replaces_stale_capacity(self):
        agent = self.agent
        class Socket:
            async def send(self, raw):
                self.payload = json.loads(raw)
                raise asyncio.CancelledError
        socket = Socket()
        await agent.outbound_queue.put({"type": "ready", "availableSlots": 99})
        with self.assertRaises(asyncio.CancelledError):
            await agent._sender(socket)
        self.assertEqual(socket.payload["availableSlots"], 0)

    async def test_websocket_hello_has_zero_capacity_until_recovery(self):
        ready = asyncio.Event()
        hellos = []
        async def coordinator(socket):
            hellos.append(json.loads(await socket.recv()))
            await socket.send(json.dumps({"type": "hello_ack"}))
            async for raw in socket:
                payload = json.loads(raw)
                if payload.get("type") == "ready" and payload.get("availableSlots") == 1:
                    ready.set()
        from dataclasses import replace
        async with websockets.serve(coordinator, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            self.agent.config = replace(self.agent.config, server_url=f"http://127.0.0.1:{port}")
            with patch.object(self.agent, "_storage_pressure", return_value={"blocked": False}):
                task = asyncio.create_task(self.agent._connection_supervisor())
                try:
                    await asyncio.wait_for(ready.wait(), timeout=5)
                    self.assertEqual(hellos[0]["availableSlots"], 0)
                    self.assertTrue(self.agent._recovery_complete)
                finally:
                    self.agent.stop_event.set()
                    await asyncio.wait_for(task, timeout=5)
            self.assertFalse(self.agent._is_connected)
            self.assertFalse(self.agent._recovery_complete)
