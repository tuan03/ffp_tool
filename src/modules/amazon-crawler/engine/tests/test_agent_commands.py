"""Durable command replay and remote pause state tests."""
from __future__ import annotations

import asyncio
import tempfile
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
from engine.distributed.coordinator_models import ClientRecord
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
