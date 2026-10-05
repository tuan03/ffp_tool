"""Durable command replay and remote pause state tests."""
from __future__ import annotations

import asyncio
import tempfile
import threading
import unittest
import uuid
import os
from contextlib import ExitStack
from datetime import timedelta
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from engine.distributed.agent_command_ledger import AgentCommand, AgentCommandEvent, AgentCommandLedger
from engine.distributed import AGENT_VERSION
from engine.distributed.client_store import ClientStore
from engine.distributed.client_agent import DistributedCrawlerAgent
from engine.distributed.client_config import AgentConfig
from engine.distributed.coordinator_migrations import migrate_coordinator
from engine.distributed.coordinator_models import ClientRecord, CrawlTask
from engine.distributed.protocol import AgentLimits, utc_now
from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.operator_authorization import OperatorCredentials


class AgentCommandLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        migrate_coordinator(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        with self.sessions.begin() as session:
            session.add(ClientRecord(id="agent-1", display_name="Agent 1"))
        self.ledger = AgentCommandLedger(self.sessions)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_command_is_durable_idempotent_and_transitions_in_order(self) -> None:
        request_id = uuid.uuid4().hex
        first = self.ledger.submit("agent-1", request_id, "PAUSE", 300)
        replay = self.ledger.submit("agent-1", request_id, "PAUSE", 300)
        self.assertEqual(first["commandId"], replay["commandId"])
        self.assertEqual(first["sequence"], 1)
        self.assertEqual(first["priority"], 4)
        self.assertFalse(self.ledger.admission_open("agent-1", 0, "RUNNING"))
        self.ledger.update("agent-1", {"commandId": first["commandId"], "sequence": 1, "status": "ACKED"})
        self.ledger.update("agent-1", {"commandId": first["commandId"], "sequence": 1, "status": "RUNNING"})
        self.ledger.update("agent-1", {"commandId": first["commandId"], "sequence": 1, "status": "SUCCESS"})
        with self.sessions() as session:
            agent = session.get(ClientRecord, "agent-1")
            self.assertEqual(agent.desired_execution_state, "PAUSED")
            self.assertEqual(agent.applied_execution_state, "PAUSED")
            self.assertEqual(agent.last_processed_command_sequence, 1)
            self.assertEqual(session.scalar(select(AgentCommand).where(AgentCommand.id == first["commandId"])).status, "SUCCESS")
            self.assertEqual(len(list(session.scalars(select(AgentCommandEvent)))), 4)
        resume = self.ledger.submit("agent-1", uuid.uuid4().hex, "RESUME", 300)
        self.assertFalse(self.ledger.admission_open("agent-1", 1, "PAUSED"))
        for status in ("ACKED", "RUNNING", "SUCCESS"):
            self.ledger.update("agent-1", {"commandId": resume["commandId"], "sequence": 2, "status": status})
        self.assertTrue(self.ledger.admission_open("agent-1", 2, "RUNNING"))

    def test_expired_command_is_recorded_and_agent_is_not_admitted(self) -> None:
        command = self.ledger.submit("agent-1", uuid.uuid4().hex, "PAUSE", 5)
        with self.sessions.begin() as session:
            row = session.get(AgentCommand, command["commandId"])
            row.expires_at = utc_now() - timedelta(seconds=1)
        self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1, "status": "EXPIRED"})
        self.assertTrue(self.ledger.admission_open("agent-1", 1, "RUNNING"))
        with self.sessions() as session:
            agent = session.get(ClientRecord, "agent-1")
            self.assertEqual(agent.desired_execution_state, "RUNNING")
            self.assertEqual(agent.applied_execution_state, "RUNNING")

    def test_reload_config_versions_are_idempotent_and_last_known_good_only_moves_on_ack(self) -> None:
        from engine.distributed.agent_runtime_config import AgentRuntimeConfig

        config = AgentRuntimeConfig.from_payload({"maxConcurrentInputs": 3}).to_payload()
        command = self.ledger.submit_config("agent-1", uuid.uuid4().hex, 300, AgentRuntimeConfig.from_payload(config))
        replay = self.ledger.submit_config("agent-1", command["requestId"], 300, AgentRuntimeConfig.from_payload(config))
        self.assertEqual(command["commandId"], replay["commandId"])
        self.assertEqual(command["payload"]["configVersion"], 1)
        with self.sessions() as session:
            agent = session.get(ClientRecord, "agent-1")
            self.assertEqual(agent.desired_config_version, 1)
            self.assertEqual(agent.applied_config_version, 0)
            self.assertEqual(agent.applied_agent_config, {})
        for status in ("ACKED", "RUNNING"):
            self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1, "status": status})
        with self.assertRaises(Exception):
            self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1,
                "status": "SUCCESS", "result": {"appliedConfigVersion": 2}})
        self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1,
            "status": "SUCCESS", "result": {"appliedConfigVersion": 1}})
        with self.sessions() as session:
            agent = session.get(ClientRecord, "agent-1")
            self.assertEqual(agent.applied_config_version, 1)
            self.assertEqual(agent.applied_agent_config, config)

    def test_drain_stops_admission_until_all_tasks_and_outbox_are_confirmed(self) -> None:
        payload = {"reason": "planned local updater rehearsal", "scope": "agent", "waitForOutboxAck": True}
        command = self.ledger.submit("agent-1", uuid.uuid4().hex, "DRAIN", 300, payload)
        self.assertEqual(command["payload"], payload)
        with self.sessions.begin() as session:
            stored_command = session.get(AgentCommand, command["commandId"])
            stored_command.expires_at = utc_now() - timedelta(seconds=1)
        self.assertEqual(self.ledger.expire_pending(), 0)
        self.assertFalse(self.ledger.admission_open("agent-1", 0, "RUNNING"))
        for status in ("ACKED", "RUNNING"):
            self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1, "status": status})
        with self.assertRaisesRegex(Exception, "tasks or outbox entries remain"):
            self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1,
                "status": "SUCCESS", "result": {"drained": True, "activeTaskCount": 0, "pendingOutboxCount": 1}})
        with self.sessions() as session:
            agent = session.get(ClientRecord, "agent-1")
            self.assertEqual(agent.desired_execution_state, "DRAINING")
            self.assertEqual(agent.applied_execution_state, "RUNNING")
        self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1,
            "status": "SUCCESS", "result": {"drained": True, "activeTaskCount": 0, "pendingOutboxCount": 0}})
        with self.sessions() as session:
            agent = session.get(ClientRecord, "agent-1")
            self.assertEqual(agent.desired_execution_state, "DRAINED")
            self.assertEqual(agent.applied_execution_state, "DRAINED")

    def test_update_command_is_eligible_only_after_server_acknowledged_drain(self) -> None:
        self.assertFalse(self.ledger.update_allowed("agent-1"))
        drain = self.ledger.submit("agent-1", uuid.uuid4().hex, "DRAIN", 300,
            {"reason": "safe updater rollout", "scope": "agent", "waitForOutboxAck": True})
        for status in ("ACKED", "RUNNING"):
            self.ledger.update("agent-1", {"commandId": drain["commandId"], "sequence": 1, "status": status})
        self.assertFalse(self.ledger.update_allowed("agent-1"))
        self.ledger.update("agent-1", {"commandId": drain["commandId"], "sequence": 1, "status": "SUCCESS",
            "result": {"drained": True, "activeTaskCount": 0, "pendingOutboxCount": 0}})
        self.assertTrue(self.ledger.update_allowed("agent-1"))

    def test_update_success_requires_target_identity_empty_outbox_and_passed_self_test(self) -> None:
        command = self.ledger.submit("agent-1", uuid.uuid4().hex, "UPDATE_AGENT", 86400,
            {"reason": "approved safe updater", "targetVersion": "5.3.0", "previousVersion": "5.2.2"})
        for status in ("ACKED", "RUNNING"):
            self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1, "status": status})
        unsafe = {"previousVersion": "5.2.2", "version": "5.3.0", "identityRetained": True,
            "pendingOutboxCount": 1, "selfTest": {"status": "PASS"}}
        with self.assertRaisesRegex(Exception, "requires the requested version"):
            self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1,
                "status": "SUCCESS", "result": unsafe})
        safe = {**unsafe, "pendingOutboxCount": 0}
        self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1,
            "status": "SUCCESS", "result": safe})
        event = self.ledger.history("agent-1")[0]["events"][-1]["detail"]["result"]
        self.assertEqual(event["selfTestStatus"], "PASS")
        self.assertNotIn("checks", event)

    def test_self_test_result_is_bounded_and_does_not_change_execution_state(self) -> None:
        payload = {"reason": "operator readiness verification", "scope": "read-only"}
        request_id = uuid.uuid4().hex
        command = self.ledger.submit("agent-1", request_id, "RUN_SELF_TEST", 300, payload)
        replay = self.ledger.submit("agent-1", request_id, "RUN_SELF_TEST", 300, payload)
        self.assertEqual(command["commandId"], replay["commandId"])
        with self.assertRaisesRegex(Exception, "different command scope"):
            self.ledger.submit("agent-1", request_id, "RUN_SELF_TEST", 300,
                {"reason": "different audited reason", "scope": "read-only"})
        for status in ("ACKED", "RUNNING"):
            self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1, "status": status})
        self.ledger.update("agent-1", {"commandId": command["commandId"], "sequence": 1, "status": "SUCCESS",
            "result": {"status": "DEGRADED", "secret": "must not persist", "checks": {
                "worker": {"status": "DEGRADED", "detail": {"failuresInWindow": 3, "secret": "hidden"}},
                "invalid": {"status": "PASS", "detail": "ignored"},
            }}})
        history = self.ledger.history("agent-1", limit=10)
        result = next(event["detail"]["result"] for event in history[0]["events"] if "result" in event["detail"])
        self.assertEqual(result["status"], "DEGRADED")
        self.assertEqual(set(result["checks"]), {"worker"})
        self.assertEqual(result["checks"]["worker"]["detail"], {"failuresInWindow": 3})
        with self.sessions() as session:
            agent = session.get(ClientRecord, "agent-1")
            self.assertEqual(agent.desired_execution_state, "RUNNING")
            self.assertEqual(agent.applied_execution_state, "RUNNING")


class AgentCommandInboxTests(unittest.TestCase):
    def test_receipt_state_and_sequence_survive_restart_and_duplicates_are_safe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.sqlite3"
            command = {"commandId": "cmd-1", "sequence": 1, "type": "PAUSE",
                "payload": {"desiredExecutionState": "PAUSED"}, "createdAt": utc_now().isoformat(),
                "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}
            store = ClientStore(path)
            self.assertEqual(store.begin_server_command(command)["decision"], "process")
            self.assertEqual(store.server_command_status("cmd-1"), "ACKED")
            store.set_server_command_running("cmd-1")
            restarted = ClientStore(path)
            self.assertEqual(restarted.begin_server_command(command)["decision"], "resume")
            restarted.complete_server_command("cmd-1", 1, "SUCCESS", "PAUSED")
            self.assertEqual(ClientStore(path).remote_execution_state(), "PAUSED")
            self.assertEqual(ClientStore(path).last_processed_command_sequence(), 1)
            self.assertEqual(ClientStore(path).begin_server_command(command)["decision"], "duplicate")

    def test_sequence_gap_does_not_acknowledge_or_advance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.sqlite3")
            command = {"commandId": "cmd-2", "sequence": 2, "type": "RESUME",
                "payload": {"desiredExecutionState": "RUNNING"}, "createdAt": utc_now().isoformat(),
                "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}
            receipt = store.begin_server_command(command)
            self.assertEqual(receipt, {"decision": "gap", "expectedSequence": 1})
            self.assertEqual(store.last_processed_command_sequence(), 0)

    def test_agent_runtime_config_and_version_persist_atomically(self) -> None:
        from engine.distributed.agent_runtime_config import AgentRuntimeConfig

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.sqlite3"
            store = ClientStore(path)
            config = AgentRuntimeConfig.from_payload({"maxConcurrentInputs": 5}).to_payload()
            store.save_agent_runtime_config(3, config)
            restarted = ClientStore(path)
            self.assertEqual(restarted.agent_runtime_config(), (3, {
                "maxConcurrentInputs": 5, "heartbeatIntervalSeconds": 10,
                "clientOfflineAfterSeconds": 30, "leaseSeconds": 60,
                "limits": {"productThreads": 4, "variantThreads": 8, "urllibThreads": 12,
                    "browserProfiles": 4, "browserTabs": 2, "headless": False},
            }))
            with self.assertRaises(ValueError):
                restarted.save_agent_runtime_config(2, config)

    def test_drain_state_and_outbox_survive_restart_and_only_complete_after_ack(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.sqlite3"
            store = ClientStore(path)
            command = {"commandId": "drain-1", "sequence": 1, "type": "DRAIN",
                "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat(), "payload": {}}
            store.begin_server_command(command)
            store.set_server_command_running("drain-1")
            store.set_drain_command("drain-1", 1, "DRAINING")
            store.spool_result(task_id="task-1", lease_id="lease-1", checksum="checksum", payload={"value": 1})
            restarted = ClientStore(path)
            self.assertEqual(restarted.remote_execution_state(), "DRAINING")
            self.assertEqual(restarted.drain_command(), {"commandId": "drain-1", "sequence": 1, "state": "DRAINING"})
            self.assertEqual(restarted.drain_outbox_count(), 1)
            with self.assertRaisesRegex(ValueError, "contiguous or durable"):
                restarted.complete_drain_command("drain-1", 2)
            restarted.acknowledge_result(restarted.pending_results()[0]["resultId"])
            self.assertEqual(restarted.drain_outbox_count(), 0)
            restarted.complete_drain_command("drain-1", 1)
            self.assertEqual(ClientStore(path).remote_execution_state(), "DRAINED")
            self.assertEqual(ClientStore(path).last_processed_command_sequence(), 1)

    def test_quarantined_payload_remains_part_of_drain_outbox(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.sqlite3")
            store.spool_result(task_id="task-1", lease_id="lease-1", checksum="checksum", payload={"value": 1})
            store.quarantine_attempt("task-1", "lease-1", "operator_review")
            counts = store.drain_outbox_counts()
            self.assertEqual(counts["quarantined"], 1)
            self.assertEqual(counts["results"], 0)
            self.assertEqual(counts["total"], 1)

    def test_operator_pause_does_not_clear_local_pause(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.sqlite3")
            store.set_paused(True)
            self.assertTrue(store.is_paused())
            self.assertEqual(store.remote_execution_state(), "RUNNING")


class AgentCommandExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_update_agent_requires_drained_empty_outbox_and_acks_only_after_boot_self_test(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target_version = "99.0.0"
            config = AgentConfig(server_url="https://crawler.example", display_name="fixture",
                max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent",
                trusted_signer_thumbprints=("A" * 40,))
            launcher = Mock(return_value=True)
            old_agent = DistributedCrawlerAgent(project_root=root, config=config, update_launcher=launcher)
            old_agent._remote_execution_state = "DRAINED"
            drain = {"commandId": "update-drain-1", "sequence": 1, "type": "DRAIN",
                "payload": {"reason": "safe updater rehearsal"}, "createdAt": utc_now().isoformat(),
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat()}
            old_agent.store.begin_server_command(drain)
            old_agent.store.set_server_command_running(drain["commandId"])
            old_agent.store.set_drain_command(drain["commandId"], 1, "DRAINING")
            old_agent.store.complete_drain_command(drain["commandId"], 1)
            identity = old_agent.client_id
            command = {"commandId": "update-agent-1", "sequence": 2, "type": "UPDATE_AGENT",
                "payload": {"reason": "approved local updater test", "targetVersion": target_version,
                    "previousVersion": AGENT_VERSION},
                "createdAt": utc_now().isoformat(), "expiresAt": (utc_now() + timedelta(days=1)).isoformat()}
            await old_agent._process_command_batch({"commands": [command], "latestCommandSequence": 2,
                "desiredExecutionState": "DRAINED", "appliedExecutionState": "DRAINED",
                "serverLastProcessedCommandSequence": 1})
            launcher.assert_called_once()
            self.assertTrue(old_agent.stop_event.is_set())
            self.assertEqual(old_agent.store.server_command_status("update-agent-1"), "RUNNING")
            self.assertEqual(old_agent.store.agent_update_journal(), {
                "commandId": "update-agent-1", "targetVersion": target_version,
                "previousVersion": AGENT_VERSION,
                "stage": "INSTALLING", "clientId": identity, "selfTestStatus": "PENDING",
            })

            with patch("engine.distributed.client_agent.AGENT_VERSION", target_version):
                replacement = DistributedCrawlerAgent(project_root=root, config=config)
                replacement._remote_execution_state = "DRAINED"
                replacement.store.reconcile_remote_execution_state("DRAINED")
                with patch.object(replacement, "_run_self_test", return_value={"status": "PASS", "checks": {}}):
                    await replacement._process_command_batch({"commands": [command], "latestCommandSequence": 2,
                        "desiredExecutionState": "DRAINED", "appliedExecutionState": "DRAINED",
                        "serverLastProcessedCommandSequence": 1})
                self.assertEqual(replacement.store.server_command_status("update-agent-1"), "SUCCESS")
                self.assertEqual(replacement.store.client_id(), identity)
                self.assertEqual(replacement.store.drain_outbox_count(), 0)
                self.assertEqual(replacement.store.agent_update_journal()["stage"], "ACKED")
                self.assertEqual(replacement.outbound_queue.get_nowait()["status"], "RUNNING")
                update = replacement.outbound_queue.get_nowait()
                self.assertEqual(update["status"], "SUCCESS")
                self.assertTrue(update["result"]["identityRetained"])

    async def test_update_agent_refuses_unacknowledged_outbox_without_launching(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            launcher = Mock(return_value=True)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="https://crawler.example", display_name="fixture", max_concurrent_inputs=1,
                limits=AgentLimits(), data_directory=root / "agent", trusted_signer_thumbprints=("A" * 40,)),
                update_launcher=launcher)
            agent._remote_execution_state = "DRAINED"
            drain = {"commandId": "pending-drain-1", "sequence": 1, "type": "DRAIN",
                "payload": {"reason": "safe updater rehearsal"}, "createdAt": utc_now().isoformat(),
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat()}
            agent.store.begin_server_command(drain)
            agent.store.set_server_command_running(drain["commandId"])
            agent.store.set_drain_command(drain["commandId"], 1, "DRAINING")
            agent.store.complete_drain_command(drain["commandId"], 1)
            agent.store.spool_result(task_id="task-pending", lease_id="lease-pending",
                checksum="checksum", payload={"value": 1})
            command = {"commandId": "update-agent-pending", "sequence": 2, "type": "UPDATE_AGENT",
                "payload": {"reason": "approved local updater test", "targetVersion": "99.0.0",
                    "previousVersion": AGENT_VERSION},
                "createdAt": utc_now().isoformat(), "expiresAt": (utc_now() + timedelta(days=1)).isoformat()}
            await agent._process_command_batch({"commands": [command], "latestCommandSequence": 2})
            launcher.assert_not_called()
            self.assertEqual(agent.store.server_command_status(command["commandId"]), "FAILED")
            self.assertEqual(agent.store.drain_outbox_count(), 1)

    async def test_run_self_test_is_read_only_and_reports_all_required_checks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=root / "agent"))
            agent._is_connected = True
            agent.connection_status = "online"
            command = {"commandId": "self-test-1", "sequence": 1, "type": "RUN_SELF_TEST",
                "payload": {"reason": "operator requested readiness check"}, "createdAt": utc_now().isoformat(),
                "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}
            before = agent.store.outbox_usage()
            await agent._process_command_batch({"commands": [command], "latestCommandSequence": 1})
            self.assertEqual(agent.store.server_command_status("self-test-1"), "SUCCESS")
            self.assertEqual(agent.store.outbox_usage(), before)
            self.assertEqual((await agent.outbound_queue.get())["status"], "ACKED")
            self.assertEqual((await agent.outbound_queue.get())["status"], "RUNNING")
            update = await agent.outbound_queue.get()
            self.assertEqual(update["status"], "SUCCESS")
            self.assertEqual(update["result"]["status"], "PASS")
            self.assertEqual(set(update["result"]["checks"]), {"authentication", "disk", "worker", "serialization"})

    async def test_drain_waits_for_durable_tasks_and_outbox_ack(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=root / "agent"))
            agent._is_connected = False
            agent._recovery_complete = True
            agent._command_recovery_complete = True
            agent.store.spool_result(task_id="task-1", lease_id="lease-1", checksum="checksum", payload={"value": 1})
            command = {"commandId": "drain-1", "sequence": 1, "type": "DRAIN",
                "payload": {"reason": "planned test drain"}, "createdAt": utc_now().isoformat(),
                "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}
            await agent._process_command_batch({"commands": [command], "latestCommandSequence": 1})
            self.assertEqual(agent.store.server_command_status("drain-1"), "RUNNING")
            self.assertEqual(agent.store.remote_execution_state(), "DRAINING")
            self.assertEqual(agent.store.drain_outbox_count(), 1)
            self.assertEqual(agent._available_slots(), 0)
            self.assertEqual((await agent.outbound_queue.get())["status"], "ACKED")
            self.assertEqual((await agent.outbound_queue.get())["status"], "RUNNING")
            with patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
                with self.assertRaises(asyncio.CancelledError):
                    await agent._drain_monitor_loop()
            self.assertEqual(agent.store.server_command_status("drain-1"), "RUNNING")
            self.assertEqual(agent.store.drain_outbox_count(), 1)
            agent._is_connected = True
            agent.store.acknowledge_result(agent.store.pending_results()[0]["resultId"])
            with patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
                with self.assertRaises(asyncio.CancelledError):
                    await agent._drain_monitor_loop()
            self.assertEqual(agent.store.server_command_status("drain-1"), "SUCCESS")
            self.assertEqual(agent.store.remote_execution_state(), "DRAINED")
            update = await agent.outbound_queue.get()
            self.assertEqual(update["status"], "SUCCESS")
            self.assertEqual(update["result"], {"drained": True, "activeTaskCount": 0, "pendingOutboxCount": 0})

    async def test_reload_config_applies_and_persists_only_valid_increasing_versions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=root / "agent"))
            config = {"maxConcurrentInputs": 3, "heartbeatIntervalSeconds": 10,
                "clientOfflineAfterSeconds": 30, "leaseSeconds": 60,
                "limits": {"productThreads": 4, "variantThreads": 8, "urllibThreads": 12,
                    "browserProfiles": 4, "browserTabs": 2, "headless": False}}
            command = {"commandId": "config-1", "sequence": 1, "type": "RELOAD_CONFIG",
                "payload": {"configVersion": 1, "config": config}, "createdAt": utc_now().isoformat(),
                "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}
            await agent._process_command_batch({"commands": [command], "latestCommandSequence": 1})
            self.assertEqual(agent._agent_config_version, 1)
            self.assertEqual(agent._agent_runtime_config.maxConcurrentInputs, 3)
            self.assertEqual(agent._available_slots(), 0)
            self.assertEqual(ClientStore(root / "agent" / "agent.sqlite3").agent_runtime_config()[0], 1)
            self.assertEqual(agent.store.server_command_status("config-1"), "SUCCESS")
            update = agent.outbound_queue.get_nowait()
            self.assertEqual(update["status"], "ACKED")
            self.assertEqual(agent.outbound_queue.get_nowait()["status"], "RUNNING")
            success = agent.outbound_queue.get_nowait()
            self.assertEqual(success["result"], {"appliedConfigVersion": 1})

            invalid = {**command, "commandId": "config-2", "sequence": 2,
                "payload": {"configVersion": 2, "config": {**config, "leaseSeconds": 40}}}
            await agent._process_command_batch({"commands": [invalid], "latestCommandSequence": 2})
            self.assertEqual(agent._agent_config_version, 1)
            self.assertEqual(agent._agent_runtime_config.maxConcurrentInputs, 3)
            self.assertEqual(agent.store.server_command_status("config-2"), "FAILED")

    async def test_restart_workers_resets_only_worker_health_after_idle_pause(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=root / "agent"))
            agent._remote_execution_state = "PAUSED"
            agent.store.reconcile_remote_execution_state("PAUSED")
            for index in range(5):
                agent.worker_health.record_failure(f"fixture-{index}")
            command = {"commandId": "restart-workers-1", "sequence": 1, "type": "RESTART_WORKERS",
                "payload": {"scope": "worker-processes", "reason": "reset test worker circuit"},
                "createdAt": utc_now().isoformat(), "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}

            await agent._process_command_batch({"commands": [command], "latestCommandSequence": 1,
                "desiredExecutionState": "PAUSED", "appliedExecutionState": "PAUSED",
                "serverLastProcessedCommandSequence": 0})

            updates = []
            while not agent.outbound_queue.empty():
                updates.append(agent.outbound_queue.get_nowait())
            self.assertEqual(agent.worker_health.snapshot(2)["state"], "healthy")
            self.assertEqual(updates[-1]["status"], "SUCCESS")
            self.assertEqual(updates[-1]["result"], {"restartedWorkers": 0, "clearedWorkerFailures": 5})

    async def test_restart_agent_is_completed_only_by_replacement_boot_and_preserves_identity_outbox(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = AgentConfig(server_url="http://127.0.0.1:9999", display_name="fixture",
                max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent")
            old_agent = DistributedCrawlerAgent(project_root=root, config=config)
            old_agent.store.reconcile_remote_execution_state("PAUSED")
            old_agent._remote_execution_state = "PAUSED"
            old_agent.store.spool_result(task_id="task-outbox", lease_id="lease-outbox",
                checksum="sha256-fixture", payload={"products": [{"id": "fixture"}]})
            identity = old_agent.client_id
            command = {"commandId": "restart-agent-1", "sequence": 1, "type": "RESTART_AGENT",
                "payload": {"scope": "agent-process", "reason": "planned test restart"},
                "createdAt": utc_now().isoformat(), "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}
            old_agent.store.begin_server_command(command)
            old_agent.store.set_server_command_running(command["commandId"])

            replacement = DistributedCrawlerAgent(project_root=root, config=config,
                restart_command_id=command["commandId"])
            replacement._remote_execution_state = "PAUSED"
            await replacement._process_command_batch({"commands": [command], "latestCommandSequence": 1,
                "desiredExecutionState": "PAUSED", "appliedExecutionState": "PAUSED",
                "serverLastProcessedCommandSequence": 0})

            update = replacement.outbound_queue.get_nowait()
            self.assertEqual(update["status"], "SUCCESS")
            self.assertEqual(update["result"]["bootId"], replacement._boot_id)
            self.assertTrue(update["result"]["identityRetained"])
            self.assertEqual(update["result"]["pendingOutboxCount"], 1)
            self.assertEqual(replacement.client_id, identity)
            self.assertEqual(replacement.store.pending_results()[0]["taskId"], "task-outbox")
            self.assertEqual(replacement.store.last_processed_command_sequence(), 1)

    async def test_restart_agent_requires_paused_idle_agent_and_persists_running_before_spawn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = AgentConfig(server_url="http://127.0.0.1:9999", display_name="fixture",
                max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent")
            launches: list[str] = []
            requested_exit: list[bool] = []
            agent = DistributedCrawlerAgent(project_root=root, config=config,
                restart_launcher=lambda command_id, _root: launches.append(command_id) is None,
                on_restart_requested=lambda: requested_exit.append(True))
            agent.store.reconcile_remote_execution_state("PAUSED")
            agent._remote_execution_state = "PAUSED"
            command = {"commandId": "restart-agent-2", "sequence": 1, "type": "RESTART_AGENT",
                "payload": {"scope": "agent-process", "reason": "planned test restart"},
                "createdAt": utc_now().isoformat(), "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}

            await agent._process_command_batch({"commands": [command], "latestCommandSequence": 1,
                "desiredExecutionState": "PAUSED", "appliedExecutionState": "PAUSED",
                "serverLastProcessedCommandSequence": 0})

            self.assertEqual(launches, [command["commandId"]])
            self.assertEqual(requested_exit, [True])
            self.assertTrue(agent.stop_event.is_set())
            self.assertEqual(agent.store.server_command_status(command["commandId"]), "RUNNING")

    async def test_restart_agent_refuses_running_task_without_spawning(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            launches: list[str] = []
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=1,
                limits=AgentLimits(), data_directory=root / "agent"),
                restart_launcher=lambda command_id, _root: launches.append(command_id) is None)
            agent._remote_execution_state = "PAUSED"
            agent.executing_task_ids.add("running-task")
            command = {"commandId": "restart-agent-3", "sequence": 1, "type": "RESTART_AGENT",
                "payload": {"scope": "agent-process", "reason": "planned test restart"},
                "createdAt": utc_now().isoformat(), "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}

            await agent._process_command_batch({"commands": [command], "latestCommandSequence": 1,
                "desiredExecutionState": "PAUSED", "appliedExecutionState": "PAUSED",
                "serverLastProcessedCommandSequence": 0})

            self.assertEqual(launches, [])
            self.assertEqual(agent.store.server_command_status(command["commandId"]), "FAILED")
            self.assertFalse(agent.stop_event.is_set())

    async def test_pending_purge_preserves_running_assignment_and_outbox(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=root / "agent"))
            pending = {"taskId": "pending-task", "jobId": "job-1", "leaseId": "lease-pending",
                "settingsFingerprint": "fixture"}
            running = {"taskId": "running-task", "jobId": "job-1", "leaseId": "lease-running",
                "settingsFingerprint": "fixture"}
            agent.store.save_assignment(pending)
            agent.store.save_assignment(running)
            agent.store.mark_running(["running-task"])
            agent.active.update({"pending-task": pending, "running-task": running})
            agent.executing_task_ids.add("running-task")
            agent.assignment_queue.put_nowait(pending)
            agent.store.spool_result(task_id="outbox-task", lease_id="lease-outbox",
                checksum="sha256-fixture", payload={"products": [{"id": "fixture"}]})
            agent._remote_execution_state = "PAUSED"
            agent.store.reconcile_remote_execution_state("PAUSED")

            await agent._process_command_batch({
                "commands": [{"commandId": "purge-1", "sequence": 1, "type": "PURGE_PENDING_TASKS",
                    "payload": {"taskIds": ["pending-task"], "expectedPendingCount": 1,
                        "reason": "Remove an unstarted test assignment"},
                    "createdAt": utc_now().isoformat(),
                    "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}],
                "latestCommandSequence": 1, "desiredExecutionState": "PAUSED",
                "appliedExecutionState": "PAUSED", "serverLastProcessedCommandSequence": 0,
            })

            local_tasks = {task["taskId"]: task for task in agent.store.local_tasks()}
            self.assertNotIn("pending-task", local_tasks)
            self.assertEqual(local_tasks["running-task"]["status"], "running")
            self.assertEqual(agent.active["running-task"], running)
            self.assertEqual(agent.executing_task_ids, {"running-task"})
            self.assertEqual(agent.assignment_queue.qsize(), 0)
            self.assertEqual(agent.store.upload_counts()["results"], 1)
            history = agent.store.server_command_history()
            self.assertEqual(history[0]["status"], "SUCCESS")

    async def test_pending_purge_rejects_running_scope_without_removing_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=1,
                limits=AgentLimits(), data_directory=root / "agent"))
            running = {"taskId": "running-task", "jobId": "job-1", "leaseId": "lease-running",
                "settingsFingerprint": "fixture"}
            agent.store.save_assignment(running)
            agent.store.mark_running(["running-task"])
            agent.active["running-task"] = running
            agent.executing_task_ids.add("running-task")
            agent._remote_execution_state = "PAUSED"

            result, error = await agent._purge_pending_assignments({"taskIds": ["running-task"]})

            self.assertIsNone(result)
            self.assertIn("running task", str(error))
            self.assertEqual(agent.store.local_tasks()[0]["status"], "running")

    async def test_global_soft_stop_persists_without_cancelling_running_or_queued_work(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = AgentConfig(server_url="http://127.0.0.1:9999", display_name="fixture",
                max_concurrent_inputs=2, limits=AgentLimits(), data_directory=root / "agent")
            agent = DistributedCrawlerAgent(project_root=root, config=config)
            running_assignment = {"taskId": "running-task", "jobId": "job-1", "leaseId": "lease-1"}
            queued_assignment = {"taskId": "queued-task", "jobId": "job-1", "leaseId": "lease-2"}
            agent.active["running-task"] = running_assignment
            agent.executing_task_ids.add("running-task")
            agent.assignment_queue.put_nowait(queued_assignment)
            agent.store.spool_result(task_id="completed-task", lease_id="lease-result",
                checksum="sha256-fixture", payload={"products": [{"id": "fixture"}]})
            cancellation = threading.Event()
            agent.cancel_events["job-1"] = {cancellation}

            await agent._apply_global_admission_gate(1, "STOPPED")
            self.assertTrue(agent._paused)
            self.assertEqual(agent.active["running-task"], running_assignment)
            self.assertEqual(agent.assignment_queue.qsize(), 1)
            self.assertEqual(agent.store.upload_counts()["results"], 1)
            self.assertFalse(cancellation.is_set())
            self.assertEqual(ClientStore(config.data_directory / "agent.sqlite3").global_admission_gate(),
                {"revision": 1, "state": "STOPPED"})

            await agent._apply_global_admission_gate(2, "OPEN")
            self.assertFalse(agent._paused)
            self.assertIn("running-task", agent.executing_task_ids)
            self.assertFalse(cancellation.is_set())
            self.assertEqual(agent.store.upload_counts()["results"], 1)

    async def test_resume_command_does_not_clear_local_operator_pause(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(project_root=root, config=AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="fixture", max_concurrent_inputs=1,
                limits=AgentLimits(), data_directory=root / "agent"))
            agent.set_paused(True)
            await agent._process_command_batch({
                "commands": [{"commandId": "resume-1", "sequence": 1, "type": "RESUME",
                    "payload": {"desiredExecutionState": "RUNNING"},
                    "createdAt": utc_now().isoformat(),
                    "expiresAt": (utc_now() + timedelta(minutes=5)).isoformat()}],
                "latestCommandSequence": 1, "desiredExecutionState": "RUNNING",
                "appliedExecutionState": "RUNNING", "serverLastProcessedCommandSequence": 0,
            })
            self.assertEqual(agent.store.remote_execution_state(), "RUNNING")
            self.assertTrue(agent._locally_paused)
            self.assertTrue(agent._paused)
            self.assertFalse(agent._available_slots())
            agent.set_paused(False)
            self.assertFalse(agent._paused)
            self.assertEqual(agent.store.last_processed_command_sequence(), 1)


class AgentCommandWebSocketTests(unittest.TestCase):
    def test_update_command_is_rejected_until_a_successful_drain(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'update.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
            client = stack.enter_context(TestClient(app))
            auth = ("operator", "fixture")
            key = client.post("/api/v1/agent-keys", auth=auth, json={
                "requestId": uuid.uuid4().hex, "name": "update fixture", "maxWorkers": 1,
                "crawlers": ["amazon"], "environment": "test",
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            }).json()["key"]
            agent_id = client.post("/api/v1/worker/register", headers={"Authorization": "Bearer " + key},
                json={"requestId": uuid.uuid4().hex, "displayName": "update fixture"}).json()["agentId"]
            with app.state.store.sessions.begin() as session:
                session.get(ClientRecord, agent_id).agent_version = "5.2.2"
            rejected = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "UPDATE_AGENT", "targetVersion": "99.0.0",
                "reason": "approved test update",
            })
            self.assertEqual(rejected.status_code, 409)
            self.assertIn("DRAINED", rejected.json()["detail"])

    def test_self_test_requires_audited_reason_and_is_queued_as_read_only(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'self-test.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
            client = stack.enter_context(TestClient(app))
            auth = ("operator", "fixture")
            key = client.post("/api/v1/agent-keys", auth=auth, json={
                "requestId": uuid.uuid4().hex, "name": "self-test fixture", "maxWorkers": 1,
                "crawlers": ["amazon"], "environment": "test",
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            }).json()["key"]
            agent_id = client.post("/api/v1/worker/register", headers={"Authorization": "Bearer " + key},
                json={"requestId": uuid.uuid4().hex, "displayName": "self-test fixture"}).json()["agentId"]
            rejected = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "RUN_SELF_TEST", "reason": "short",
            })
            self.assertEqual(rejected.status_code, 422)
            accepted = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "RUN_SELF_TEST", "reason": "verify agent readiness",
            })
            self.assertEqual(accepted.status_code, 202, accepted.text)
            self.assertEqual(accepted.json()["payload"]["scope"], "read-only")

    def test_drain_operator_command_is_audited_and_closes_admission_without_purging(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'drain.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
            client = stack.enter_context(TestClient(app))
            auth = ("operator", "fixture")
            key = client.post("/api/v1/agent-keys", auth=auth, json={
                "requestId": uuid.uuid4().hex, "name": "drain fixture", "maxWorkers": 1,
                "crawlers": ["amazon"], "environment": "test",
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            }).json()["key"]
            agent_id = client.post("/api/v1/worker/register", headers={"Authorization": "Bearer " + key},
                json={"requestId": uuid.uuid4().hex, "displayName": "drain fixture"}).json()["agentId"]
            rejected = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "DRAIN", "reason": "short",
            })
            self.assertEqual(rejected.status_code, 422)
            accepted = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "DRAIN", "reason": "planned safe updater rollout",
            })
            self.assertEqual(accepted.status_code, 202, accepted.text)
            self.assertEqual(accepted.json()["payload"]["waitForOutboxAck"], True)
            state = app.state.store.list_clients()[0]
            self.assertEqual(state["desiredExecutionState"], "DRAINING")
            self.assertEqual(state["appliedExecutionState"], "RUNNING")

    def test_restart_agent_requires_paused_connected_idle_agent_and_exact_confirmation(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'restart.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
            client = stack.enter_context(TestClient(app))
            auth = ("operator", "fixture")
            key = client.post("/api/v1/agent-keys", auth=auth, json={
                "requestId": uuid.uuid4().hex, "name": "restart fixture", "maxWorkers": 1,
                "crawlers": ["amazon"], "environment": "test",
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            }).json()["key"]
            agent_id = client.post("/api/v1/worker/register", headers={"Authorization": f"Bearer {key}"},
                json={"requestId": uuid.uuid4().hex, "displayName": "restart fixture"}).json()["agentId"]
            with app.state.store.sessions.begin() as session:
                record = session.get(ClientRecord, agent_id)
                record.applied_execution_state = "PAUSED"
                record.desired_execution_state = "PAUSED"
                record.capabilities = {"durableRestartV1": True}
            with client.websocket_connect("/api/v1/worker/connect",
                    headers={"Authorization": f"Bearer {key}"}) as socket:
                socket.send_json({"type": "hello", "protocolVersion": "5", "authProtocol": 1,
                    "clientId": agent_id, "displayName": "restart fixture", "maxConcurrentInputs": 1,
                    "availableSlots": 0, "lastProcessedCommandSequence": 0,
                    "desiredExecutionState": "PAUSED", "appliedExecutionState": "PAUSED",
                    "executingTaskIds": [], "capabilities": {"amazon": True, "mediaGalleryV2": True,
                        "durablePendingPurgeV1": True, "durableRestartV1": True},
                    "localTasks": []})
                self.assertEqual(socket.receive_json()["type"], "hello_ack")
                bad = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                    "requestId": uuid.uuid4().hex, "type": "RESTART_AGENT", "reason": "planned test restart",
                    "confirmation": "RESTART_AGENT:other-agent",
                })
                self.assertEqual(bad.status_code, 409, bad.text)
                restart_body = {
                    "requestId": uuid.uuid4().hex, "type": "RESTART_AGENT", "reason": "planned test restart",
                    "confirmation": f"RESTART_AGENT:{agent_id}", "expiresInSeconds": 600,
                }
                accepted = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json=restart_body)
                self.assertEqual(accepted.status_code, 202, accepted.text)
                batch = socket.receive_json()
                self.assertEqual(batch["type"], "command_batch")
                self.assertEqual(batch["commands"][0]["type"], "RESTART_AGENT")
                duplicate = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json=restart_body)
                self.assertEqual(duplicate.status_code, 202, duplicate.text)
                self.assertEqual(duplicate.json()["commandId"], accepted.json()["commandId"])
                self.assertEqual(socket.receive_json()["type"], "command_batch")

    def test_pending_purge_requires_paused_agent_exact_preview_and_is_idempotent(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'purge.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
            client = stack.enter_context(TestClient(app))
            auth = ("operator", "fixture")
            key = client.post("/api/v1/agent-keys", auth=auth, json={
                "requestId": uuid.uuid4().hex, "name": "purge fixture", "maxWorkers": 1,
                "crawlers": ["amazon"], "environment": "test",
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            }).json()["key"]
            agent_id = client.post("/api/v1/worker/register", headers={"Authorization": f"Bearer {key}"},
                json={"requestId": uuid.uuid4().hex, "displayName": "purge fixture"}).json()["agentId"]
            job = app.state.store.create_job({"urls": ["B0FR4MSS2H"]})
            task_id = app.state.store.lease_tasks(agent_id, 1)[0]["taskId"]
            denied = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "PURGE_PENDING_TASKS",
                "taskIds": [task_id], "dryRun": True,
            })
            self.assertEqual(denied.status_code, 409, denied.text)
            with app.state.store.sessions.begin() as session:
                session.get(ClientRecord, agent_id).applied_execution_state = "PAUSED"
                session.get(ClientRecord, agent_id).desired_execution_state = "PAUSED"
                session.get(ClientRecord, agent_id).capabilities = {"durablePendingPurgeV1": True}
            request_id = uuid.uuid4().hex
            dry_run = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "PURGE_PENDING_TASKS",
                "taskIds": [task_id], "dryRun": True,
            })
            self.assertEqual(dry_run.status_code, 200, dry_run.text)
            self.assertEqual(dry_run.json()["pendingCount"], 1)
            self.assertEqual(dry_run.json()["eligibleTaskIds"], [task_id])
            body = {"requestId": request_id, "type": "PURGE_PENDING_TASKS", "taskIds": [task_id],
                "expectedPendingCount": 1, "confirmation": "PURGE_PENDING_TASKS:1",
                "reason": "Remove an unstarted test assignment"}
            rejected = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth,
                json={**body, "expectedPendingCount": 2, "confirmation": "PURGE_PENDING_TASKS:2"})
            self.assertEqual(rejected.status_code, 409, rejected.text)
            with app.state.store.sessions() as session:
                self.assertEqual(session.get(CrawlTask, task_id).status, "leased")
            accepted = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json=body)
            self.assertEqual(accepted.status_code, 202, accepted.text)
            self.assertEqual(accepted.json()["type"], "PURGE_PENDING_TASKS")
            with app.state.store.sessions() as session:
                self.assertEqual(session.get(CrawlTask, task_id).status, "cancelled")
            with client.websocket_connect("/api/v1/worker/connect",
                    headers={"Authorization": f"Bearer {key}"}) as socket:
                socket.send_json({"type": "hello", "protocolVersion": "5", "authProtocol": 1,
                    "clientId": agent_id, "displayName": "purge fixture", "maxConcurrentInputs": 1,
                    "availableSlots": 0, "lastProcessedCommandSequence": 0,
                    "desiredExecutionState": "PAUSED", "appliedExecutionState": "PAUSED",
                    "executingTaskIds": [], "capabilities": {"amazon": True, "mediaGalleryV2": True,
                        "durablePendingPurgeV1": True},
                    "localTasks": [{"taskId": task_id, "jobId": str(job["id"]),
                        "leaseId": "offline-lease", "status": "leased"}]})
                acknowledgement = socket.receive_json()
                self.assertEqual(acknowledgement["type"], "hello_ack")
                self.assertIn(task_id, acknowledgement["discardTaskIds"])
                command = acknowledgement["commands"][0]
                self.assertEqual(command["commandId"], accepted.json()["commandId"])
                for status in ("ACKED", "RUNNING", "SUCCESS"):
                    socket.send_json({"type": "command_update", "commandId": command["commandId"],
                        "sequence": command["sequence"], "status": status,
                        **({"result": {"beforeCount": 1, "purgedCount": 1, "afterCount": 0},
                            "runningTaskIds": []} if status == "SUCCESS" else {})})
                self.assertEqual(socket.receive_json()["type"], "command_batch")
            history = client.get(f"/api/v1/clients/{agent_id}/commands", auth=auth).json()["commands"]
            result_event = next(event for event in history[0]["events"] if event["status"] == "SUCCESS")
            self.assertEqual(result_event["detail"]["result"], {
                "scope": "pending", "beforeCount": 1, "purgedCount": 1, "afterCount": 0,
            })
            repeated = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json=body)
            self.assertEqual(repeated.status_code, 202, repeated.text)
            self.assertEqual(repeated.json()["commandId"], accepted.json()["commandId"])

            all_job = app.state.store.create_job({"urls": ["B0FR4MSS3H"]})
            all_task_id = app.state.store.lease_tasks(agent_id, 1)[0]["taskId"]
            all_preview = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "PURGE_ALL_LOCAL_TASKS", "dryRun": True,
            })
            self.assertEqual(all_preview.status_code, 200, all_preview.text)
            self.assertEqual(all_preview.json()["scope"], "all-local")
            self.assertEqual(all_preview.json()["eligibleTaskIds"], [all_task_id])
            all_request_id = uuid.uuid4().hex
            all_body = {"requestId": all_request_id, "type": "PURGE_ALL_LOCAL_TASKS",
                "expectedPendingCount": 1, "confirmation": "PURGE_ALL_LOCAL_TASKS:1",
                "reason": "Clear all queued assignments for test"}
            all_rejected = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth,
                json={**all_body, "confirmation": "PURGE_ALL_LOCAL_TASKS:2", "expectedPendingCount": 2})
            self.assertEqual(all_rejected.status_code, 409, all_rejected.text)
            all_accepted = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json=all_body)
            self.assertEqual(all_accepted.status_code, 202, all_accepted.text)
            self.assertEqual(all_accepted.json()["type"], "PURGE_ALL_LOCAL_TASKS")
            self.assertEqual(all_accepted.json()["payload"]["taskIds"], [all_task_id])
            with app.state.store.sessions() as session:
                self.assertEqual(session.get(CrawlTask, all_task_id).status, "cancelled")
            all_repeated = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json=all_body)
            self.assertEqual(all_repeated.status_code, 202, all_repeated.text)
            self.assertEqual(all_repeated.json()["commandId"], all_accepted.json()["commandId"])

    def test_offline_command_is_replayed_before_secure_agent_can_become_ready(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'commands.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
            client = stack.enter_context(TestClient(app))
            auth = ("operator", "fixture")
            key_response = client.post("/api/v1/agent-keys", auth=auth, json={
                "requestId": uuid.uuid4().hex, "name": "fixture", "maxWorkers": 1,
                "crawlers": ["amazon"], "environment": "test",
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            })
            self.assertEqual(key_response.status_code, 201, key_response.text)
            self.assertEqual(client.get("/api/v1/clients/unregistered/commands").status_code, 401)
            self.assertEqual(client.post("/api/v1/clients/unregistered/commands", json={}).status_code, 401)
            agent_id = client.post("/api/v1/worker/register",
                headers={"Authorization": "Bearer " + key_response.json()["key"]},
                json={"requestId": uuid.uuid4().hex, "displayName": "fixture"}).json()["agentId"]
            command_response = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth,
                json={"requestId": uuid.uuid4().hex, "type": "PAUSE"})
            self.assertEqual(command_response.status_code, 202, command_response.text)
            command = command_response.json()
            with client.websocket_connect("/api/v1/worker/connect",
                    headers={"Authorization": "Bearer " + key_response.json()["key"]}) as socket:
                socket.send_json({"type": "hello", "protocolVersion": "5", "authProtocol": 1,
                    "clientId": agent_id, "displayName": "fixture", "maxConcurrentInputs": 1,
                    "availableSlots": 1, "lastProcessedCommandSequence": 0,
                    "desiredExecutionState": "RUNNING", "capabilities": {"mediaGalleryV2": True, "amazon": True}})
                acknowledgement = socket.receive_json()
                self.assertEqual(acknowledgement["type"], "hello_ack")
                self.assertEqual(acknowledgement["commands"][0]["commandId"], command["commandId"])
                self.assertEqual(acknowledgement["commands"][0]["sequence"], 1)
                for status in ("ACKED", "RUNNING", "SUCCESS"):
                    socket.send_json({"type": "command_update", "commandId": command["commandId"],
                        "sequence": 1, "status": status,
                        **({"appliedExecutionState": "PAUSED"} if status == "SUCCESS" else {})})
                sync = socket.receive_json()
                self.assertEqual(sync["type"], "command_batch")
                self.assertEqual(sync["commands"], [])
            history = client.get(f"/api/v1/clients/{agent_id}/commands", auth=auth)
            self.assertEqual(history.status_code, 200, history.text)
            self.assertEqual(history.json()["commands"][0]["status"], "SUCCESS")
            self.assertEqual(len(history.json()["commands"][0]["events"]), 5)
            self.assertEqual(client.get("/api/v1/clients", auth=auth).json()[0]["appliedExecutionState"], "PAUSED")

    def test_reload_config_is_validated_persisted_and_acknowledged_by_version(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'config.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
            client = stack.enter_context(TestClient(app))
            auth = ("operator", "fixture")
            key_response = client.post("/api/v1/agent-keys", auth=auth, json={
                "requestId": uuid.uuid4().hex, "name": "config fixture", "maxWorkers": 1,
                "crawlers": ["amazon"], "environment": "test",
                "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            })
            key = key_response.json()["key"]
            agent_id = client.post("/api/v1/worker/register", headers={"Authorization": "Bearer " + key},
                json={"requestId": uuid.uuid4().hex, "displayName": "config fixture"}).json()["agentId"]
            invalid = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "RELOAD_CONFIG",
                "config": {"heartbeatIntervalSeconds": 20, "clientOfflineAfterSeconds": 30, "leaseSeconds": 60},
            })
            self.assertEqual(invalid.status_code, 422, invalid.text)
            self.assertEqual(app.state.store.list_clients()[0]["desiredConfigVersion"], 0)

            config = {"maxConcurrentInputs": 3, "heartbeatIntervalSeconds": 10,
                "clientOfflineAfterSeconds": 30, "leaseSeconds": 90,
                "limits": {"productThreads": 4, "variantThreads": 8, "urllibThreads": 12,
                    "browserProfiles": 4, "browserTabs": 2, "headless": False}}
            response = client.post(f"/api/v1/clients/{agent_id}/commands", auth=auth, json={
                "requestId": uuid.uuid4().hex, "type": "RELOAD_CONFIG", "config": config,
            })
            self.assertEqual(response.status_code, 202, response.text)
            command = response.json()
            self.assertEqual(command["payload"]["configVersion"], 1)

            with client.websocket_connect("/api/v1/worker/connect", headers={"Authorization": "Bearer " + key}) as socket:
                socket.send_json({"type": "hello", "protocolVersion": "5", "authProtocol": 1,
                    "clientId": agent_id, "displayName": "config fixture", "maxConcurrentInputs": 1,
                    "availableSlots": 1, "lastProcessedCommandSequence": 0,
                    "capabilities": {"mediaGalleryV2": True, "amazon": True}})
                acknowledgement = socket.receive_json()
                self.assertEqual(acknowledgement["heartbeatIntervalSeconds"], 10)
                self.assertEqual(acknowledgement["leaseSeconds"], 60)
                self.assertEqual(acknowledgement["desiredConfigVersion"], 1)
                self.assertEqual(acknowledgement["appliedConfigVersion"], 0)
                self.assertEqual(acknowledgement["commands"][0]["commandId"], command["commandId"])
                for status in ("ACKED", "RUNNING", "SUCCESS"):
                    socket.send_json({"type": "command_update", "commandId": command["commandId"],
                        "sequence": 1, "status": status,
                        **({"result": {"appliedConfigVersion": 1}} if status == "SUCCESS" else {})})
                self.assertEqual(socket.receive_json()["type"], "command_batch")

            state = app.state.store.list_clients()[0]
            self.assertEqual(state["desiredConfigVersion"], 1)
            self.assertEqual(state["appliedConfigVersion"], 1)
            self.assertEqual(state["appliedAgentConfig"], config)
            history = client.get(f"/api/v1/clients/{agent_id}/commands", auth=auth).json()["commands"]
            self.assertEqual(history[0]["status"], "SUCCESS")


if __name__ == "__main__":
    unittest.main()
