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
