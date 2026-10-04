"""Authenticated, idempotent enrollment; credentials never authorize rebind."""
import tempfile
import unittest
import uuid
from contextlib import ExitStack
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.operator_authorization import OperatorCredentials
from engine.distributed.protocol import utc_now


class AgentIdentityTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
        if getattr(self, "external_engine", None) is not None:
            self.stack.enter_context(patch("engine.distributed.coordinator_server.create_database_engine", return_value=self.external_engine))
        self.app = create_coordinator_app(database_url=f"sqlite:///{(root / 'test.db').as_posix()}",
            operator_credentials=OperatorCredentials("operator", "fixture"), agent_environment="test")
        self.client = self.stack.enter_context(TestClient(self.app))
        response = self.client.post("/api/v1/agent-keys", auth=("operator", "fixture"), json={
            "requestId": uuid.uuid4().hex, "name": "fixture", "maxWorkers": 2, "crawlers": ["amazon"],
            "environment": "test", "expiresAt": (utc_now() + timedelta(days=1)).isoformat()})
        self.assertEqual(response.status_code, 201)
        self.key = response.json()["key"]
        self.key_id = response.json()["metadata"]["id"]

    def register(self, request_id, key=None):
        return self.client.post("/api/v1/worker/register", headers={"Authorization": f"Bearer {key or self.key}"},
                                json={"requestId": request_id, "displayName": "fixture"})

    def test_lost_register_response_retries_same_identity(self):
        request_id = uuid.uuid4().hex
        first = self.register(request_id)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json(), self.register(request_id).json())
        self.assertEqual(self.register(uuid.uuid4().hex).status_code, 409)
        self.assertEqual(self.register(request_id, "invalid").status_code, 401)
        self.assertNotIn(self.key, first.text)

    def test_security_discovery_is_explicit(self):
        response = self.client.get("/api/v1/worker/security")
        self.assertEqual(response.json(), {"authRequired": True, "authProtocol": 1, "environment": "test"})

    def test_upload_requires_key_and_header_identity_matches_owner(self):
        self.register(uuid.uuid4().hex)
        for suffix in ("result", "products/example"):
            path = "/api/v1/worker/tasks/fixture/" + suffix
            response = self.client.put(path, content=b"{}", headers={"X-Client-Id": "other", "X-Lease-Id": "fixture"})
            self.assertEqual(response.status_code, 401)
            response = self.client.put(path, content=b"{}", headers={"Authorization": "Bearer " + self.key,
                "X-Client-Id": "other", "X-Lease-Id": "fixture"})
            self.assertEqual(response.status_code, 403)

    def test_websocket_rejects_missing_key_before_hello(self):
        from starlette.websockets import WebSocketDisconnect
        with self.client.websocket_connect("/api/v1/worker/connect") as socket:
            with self.assertRaises(WebSocketDisconnect) as closed:
                socket.receive_json()
            self.assertEqual(closed.exception.code, 4004)

    def test_idle_websocket_closes_after_revocation(self):
        from starlette.websockets import WebSocketDisconnect
        from engine.distributed.agent_keys import AgentKey
        agent_id = self.register(uuid.uuid4().hex).json()["agentId"]
        with self.client.websocket_connect("/api/v1/worker/connect", headers={"Authorization": "Bearer " + self.key}) as socket:
            socket.send_json({"type": "hello", "protocolVersion": "5", "authProtocol": 1,
                "clientId": agent_id, "displayName": "fixture", "maxConcurrentInputs": 16,
                "availableSlots": 0, "capabilities": {"mediaGalleryV2": True, "amazon": True, "pinterest": True}})
            self.assertEqual(socket.receive_json()["type"], "hello_ack")
            with self.app.state.agent_security.sessions.begin() as session:
                session.get(AgentKey, self.key_id).status = "revoked"
            with self.assertRaises(WebSocketDisconnect) as closed:
                socket.receive_json()
            self.assertEqual(closed.exception.code, 4004)

    def test_asset_namespace_is_fenced_by_task_and_expiry(self):
        from engine.distributed.agent_keys import AgentKey
        from engine.distributed.coordinator_models import CrawlTask
        agent_id = self.register(uuid.uuid4().hex).json()["agentId"]
        security = self.app.state.agent_security
        with security.sessions.begin() as session:
            session.get(AgentKey, self.key_id).crawlers = ["amazon", "pinterest"]
        store = self.app.state.store
        job = store.create_pinterest_job({"niche": "fixture", "stage": "production"})
        store.register_client({"clientId": agent_id, "displayName": "fixture", "availableSlots": 1,
            "maxConcurrentInputs": 1, "capabilities": {"pinterest": True}})
        lease = store.lease_tasks(agent_id, 1)[0]
        headers = {"Authorization": "Bearer " + self.key, "X-Task-Id": lease["taskId"], "X-Lease-Id": lease["leaseId"]}
        path = f"/api/v1/pinterest-assets/{job['id']}/fixture.png"
        response = self.client.post(path, headers=headers, content=b"fixture")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.post(path, headers={**headers, "X-Task-Id": "other"}, content=b"bad").status_code, 403)
        with security.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
        self.assertEqual(self.client.post(path, headers=headers, content=b"bad").status_code, 403)

    def test_rotation_preserves_identity_and_rebind_requires_operator(self):
        request_id = uuid.uuid4().hex
        agent_id = self.register(request_id).json()["agentId"]
        payload = {"requestId": uuid.uuid4().hex, "name": "replacement", "maxWorkers": 2,
            "crawlers": ["amazon"], "environment": "test", "expiresAt": (utc_now() + timedelta(days=1)).isoformat(),
            "rebind": False}
        path = f"/api/v1/agent-keys/{self.key_id}/rotate"
        self.assertEqual(self.client.post(path, headers={"Authorization": "Bearer " + self.key}, json=payload).status_code, 401)
        response = self.client.post(path, auth=("operator", "fixture"), json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        replacement = response.json()["key"]
        self.assertEqual(self.register(request_id).status_code, 401)
        self.assertEqual(self.register(request_id, replacement).json()["agentId"], agent_id)
        self.assertEqual(self.register(uuid.uuid4().hex, replacement).status_code, 409)
        retry = self.client.post(path, auth=("operator", "fixture"), json=payload)
        self.assertEqual(retry.status_code, 409)
        self.assertNotIn(replacement, retry.text)
        replacement_id = response.json()["metadata"]["id"]
        payload.update(requestId=uuid.uuid4().hex, rebind=True)
        rebound = self.client.post(f"/api/v1/agent-keys/{replacement_id}/rotate", auth=("operator", "fixture"), json=payload)
        self.assertEqual(rebound.status_code, 201)
        self.assertEqual(self.register(uuid.uuid4().hex, rebound.json()["key"]).json()["agentId"], agent_id)
        self.assertEqual(self.register(request_id, replacement).status_code, 401)
