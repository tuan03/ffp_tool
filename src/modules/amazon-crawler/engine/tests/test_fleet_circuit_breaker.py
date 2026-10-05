from __future__ import annotations

import json
import os
import tempfile
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from engine.distributed.coordinator_migrations import migrate_coordinator
from engine.distributed.coordinator_models import CoordinatorState, TaskAttempt, create_database_engine, create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.fleet_circuit_breaker import STATE_KEY, record_failure, record_success, snapshot
from engine.tests.test_distributed import client_hello


class FleetCircuitBreakerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        path = Path(self.directory.name) / "fleet.sqlite3"
        self.engine = create_database_engine(f"sqlite:///{path.as_posix()}")
        migrate_coordinator(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)
        self.job = self.store.create_job({"urls": ["B012345678", "B012345679"]})
        self.store.register_client(client_hello(slots=2))

    def tearDown(self) -> None:
        self.engine.dispose()
        self.directory.cleanup()

    def test_parser_failure_threshold_opens_breaker_and_denies_new_leases(self) -> None:
        for _ in range(5):
            with self.sessions.begin() as session:
                current = record_failure(session, {"errorCode": "PARSER_ERROR"})
        self.assertEqual(current["state"], "OPEN")
        self.assertEqual(current["failureCount"], 5)
        self.assertEqual(self.store.lease_tasks("client-a", 2), [])

    def test_operator_stop_remains_authoritative_while_breaker_is_open(self) -> None:
        for _ in range(5):
            with self.sessions.begin() as session:
                record_failure(session, {"errorCode": "PARSER_ERROR"})
        self.store.set_global_admission_gate("STOPPED", request_id=uuid.uuid4().hex,
            actor="operator", reason="planned operator stop")
        self.assertEqual(self.store.lease_tasks("client-a", 2), [])
        with self.sessions() as session:
            self.assertEqual(snapshot(session)["state"], "OPEN")

    def test_half_open_allows_one_probe_then_success_closes_breaker(self) -> None:
        for _ in range(5):
            with self.sessions.begin() as session:
                record_failure(session, {"code": "PARSER_FAILED"})
        with self.sessions.begin() as session:
            state = session.get(CoordinatorState, STATE_KEY)
            payload = json.loads(state.value)
            payload["openUntil"] = "2000-01-01T00:00:00+00:00"
            state.value = json.dumps(payload)

        first_probe = self.store.lease_tasks("client-a", 2)
        self.assertEqual(len(first_probe), 1)
        self.assertEqual(self.store.lease_tasks("client-a", 1), [])
        with self.sessions.begin() as session:
            current = snapshot(session)
            self.assertEqual(current["state"], "HALF_OPEN")
            attempt = session.query(TaskAttempt).filter_by(lease_id=first_probe[0]["leaseId"]).one()
            record_success(session, attempt.started_at)
        self.assertEqual(self.store.lease_tasks("client-a", 1)[0]["asin"], "B012345679")
        with self.sessions() as session:
            self.assertEqual(snapshot(session)["state"], "CLOSED")


class FleetCircuitBreakerHttpTests(unittest.TestCase):
    def test_status_and_reset_require_operator_authentication_and_audited_reason(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch.dict(os.environ, {
                "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
                "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
            }))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            from engine.distributed.coordinator_server import create_coordinator_app
            from engine.distributed.operator_authorization import OperatorCredentials
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'breaker-http.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture-password"))
            client = stack.enter_context(TestClient(app))
            status_url = "/api/v1/fleet-circuit-breaker"
            reset_url = status_url + "/reset"
            self.assertEqual(client.get(status_url).status_code, 401)
            self.assertEqual(client.post(reset_url, json={"reason": "operator reset reason"}).status_code, 401)
            auth = ("operator", "fixture-password")
            self.assertEqual(client.get(status_url, auth=auth).json()["state"], "CLOSED")
            self.assertEqual(client.post(reset_url, auth=auth, json={"reason": "short"}).status_code, 422)
            response = client.post(reset_url, auth=auth, json={"reason": "approved parser recovery"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["state"], "CLOSED")


if __name__ == "__main__":
    unittest.main()
