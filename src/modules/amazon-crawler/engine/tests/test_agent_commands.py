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
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from engine.distributed.agent_command_ledger import AgentCommand, AgentCommandEvent, AgentCommandLedger
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

    def test_operator_pause_does_not_clear_local_pause(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.sqlite3")
            store.set_paused(True)
            self.assertTrue(store.is_paused())
            self.assertEqual(store.remote_execution_state(), "RUNNING")


class AgentCommandExecutionTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
