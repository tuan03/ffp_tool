"""Persistent, crawler-only global admission gate tests."""
from __future__ import annotations

import tempfile
import os
import threading
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import make_url

from engine.distributed.coordinator_migrations import migrate_coordinator
from engine.distributed.coordinator_models import ClientRecord, CrawlProductItem, CrawlTask, create_database_engine, create_session_factory
from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.operator_authorization import OperatorCredentials


class GlobalAdmissionGateStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "coordinator.sqlite3"
        self.engine = create_database_engine(f"sqlite:///{self.database_path.as_posix()}")
        migrate_coordinator(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)
        self.job = self.store.create_job({"urls": ["B0FR4MSS2H", "B0HG4NRG98"]})
        with self.sessions.begin() as session:
            session.add(ClientRecord(
                id="agent-1", display_name="Agent 1", status="online",
                max_concurrent_inputs=2, capabilities={"amazon": True},
            ))

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temporary_directory.cleanup()

    def test_stop_is_durable_blocks_new_leases_and_preserves_running_lease(self) -> None:
        prior_lease = self.store.lease_tasks("agent-1", 1)
        self.assertEqual(len(prior_lease), 1)

        stopped = self.store.set_global_admission_gate(
            "STOPPED", request_id=uuid.uuid4().hex, actor="operator", reason="planned maintenance",
        )
        self.assertEqual(stopped["state"], "STOPPED")
        self.assertEqual(stopped["scope"], "crawler")
        self.assertEqual(self.store.lease_tasks("agent-1", 1), [])

        with self.sessions() as session:
            existing = session.get(CrawlTask, prior_lease[0]["taskId"])
            queued = list(session.scalars(select(CrawlTask).where(CrawlTask.status == "queued")))
            self.assertEqual(existing.status, "leased")
            self.assertEqual(len(queued), 1)

        self.engine.dispose()
        restarted_engine = create_database_engine(f"sqlite:///{self.database_path.as_posix()}")
        try:
            migrate_coordinator(restarted_engine)
            restarted_store = CoordinatorStore(create_session_factory(restarted_engine))
            self.assertEqual(restarted_store.get_global_admission_gate()["state"], "STOPPED")
            self.assertEqual(restarted_store.lease_tasks("agent-1", 1), [])
            opened = restarted_store.set_global_admission_gate(
                "OPEN", request_id=uuid.uuid4().hex, actor="operator", reason="maintenance complete",
            )
            self.assertEqual(opened["state"], "OPEN")
            self.assertEqual(len(restarted_store.lease_tasks("agent-1", 1)), 1)
        finally:
            restarted_engine.dispose()

    def test_gate_request_replay_is_idempotent_and_payload_conflicts_fail(self) -> None:
        request_id = uuid.uuid4().hex
        stopped = self.store.set_global_admission_gate(
            "STOPPED", request_id=request_id, actor="operator", reason="maintenance",
        )
        replay = self.store.set_global_admission_gate(
            "STOPPED", request_id=request_id, actor="operator", reason="maintenance",
        )
        self.assertEqual(replay["revision"], stopped["revision"])
        with self.assertRaises(ValueError):
            self.store.set_global_admission_gate(
                "OPEN", request_id=request_id, actor="operator", reason="different request",
            )

    def test_postgres_lease_gate_lock_is_shared_so_agents_do_not_serialize_each_other(self) -> None:
        from engine.distributed.global_admission_gate import GlobalAdmissionGate, GLOBAL_ADMISSION_GATE_ID

        statement = select(GlobalAdmissionGate).where(
            GlobalAdmissionGate.id == GLOBAL_ADMISSION_GATE_ID,
        ).with_for_update(read=True)
        self.assertIn("FOR SHARE", str(statement.compile(dialect=postgresql.dialect())))

    def test_crawler_gate_does_not_cancel_an_existing_shopify_write(self) -> None:
        source_key = "amazon:B0FR4MSS2H:design:gate-scope"
        product = {"id": "product-gate-scope", "sourceKey": source_key, "title": "Gate scope"}
        lease = self.store.lease_tasks("agent-1", 1)
        self.assertEqual(len(lease), 1)
        self.store.accept_product(
            lease[0]["taskId"], "agent-1", lease[0]["leaseId"], source_key, "product-checksum",
            {"jobId": self.job["id"], "product": product, "productChecksum": "product-checksum"},
        )
        self.store.accept_result(
            lease[0]["taskId"], "agent-1", lease[0]["leaseId"], "result-checksum",
            {"jobId": self.job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.assertTrue(self.store.mark_product_syncing(
            claim["id"], worker_id="worker-1", normalized_payload=product, proxy_profile="direct",
        ))
        self.assertTrue(self.store.mark_shopify_write_started(claim["id"], worker_id="worker-1"))

        self.store.set_global_admission_gate(
            "STOPPED", request_id=uuid.uuid4().hex, actor="operator", reason="crawler-only stop",
        )

        with self.sessions() as session:
            item = session.get(CrawlProductItem, claim["id"])
            self.assertEqual(item.status, "shopify_writing")


class GlobalAdmissionGateHttpTests(unittest.TestCase):
    def test_operator_auth_and_gate_routes(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(
                database_url=f"sqlite:///{(root / 'gate.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"),
            )
            client = stack.enter_context(TestClient(app))
            self.assertEqual(client.get("/api/v1/admission-gate").status_code, 401)
            self.assertEqual(client.post("/api/v1/admission-gate", json={}).status_code, 401)

            auth = ("operator", "fixture")
            current = client.get("/api/v1/admission-gate", auth=auth)
            self.assertEqual(current.status_code, 200, current.text)
            self.assertEqual(current.json()["state"], "OPEN")

            response = client.post("/api/v1/admission-gate", auth=auth, json={
                "requestId": uuid.uuid4().hex, "state": "STOPPED", "reason": "operator maintenance",
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["actor"], "operator")
            self.assertEqual(response.json()["state"], "STOPPED")
            self.assertEqual(client.get("/api/v1/admission-gate", auth=auth).json()["state"], "STOPPED")


@unittest.skipUnless(os.environ.get("CRAWLER_TEST_DATABASE_URL"), "Requires isolated audit PostgreSQL")
class GlobalAdmissionGatePostgresRaceTests(unittest.TestCase):
    def test_stop_serializes_against_lease_commit(self) -> None:
        schema = f"crawler_gate_{uuid.uuid4().hex}"
        database_url = make_url(os.environ["CRAWLER_TEST_DATABASE_URL"])
        if database_url.get_backend_name() != "postgresql":
            self.fail("CRAWLER_TEST_DATABASE_URL must point to PostgreSQL")
        admin_engine = create_engine(database_url)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        isolated_url = database_url.update_query_dict({"options": f"-csearch_path={schema}"})
        engine = create_database_engine(isolated_url.render_as_string(hide_password=False))
        try:
            migrate_coordinator(engine)
            store = CoordinatorStore(create_session_factory(engine))
            store.create_job({"urls": ["B0FR4MSS2H", "B0HG4NRG98"]})
            store.register_client({"clientId": "race-agent", "displayName": "Race agent", "availableSlots": 1})

            lease_has_shared_gate_lock = threading.Event()
            stop_is_requesting_exclusive_lock = threading.Event()
            release_lease = threading.Event()
            results: dict[str, object] = {}

            def hold_lease_gate_lock(connection, cursor, statement, _parameters, _context, _executemany):
                normalized = statement.upper()
                if "CRAWLER_GLOBAL_ADMISSION_GATE" not in normalized:
                    return
                if "FOR SHARE" in normalized and threading.current_thread().name == "lease-thread":
                    lease_has_shared_gate_lock.set()
                    if not release_lease.wait(timeout=10):
                        raise TimeoutError("test did not release the lease transaction")

            def mark_stop_lock_request(_connection, _cursor, statement, _parameters, _context, _executemany):
                if ("CRAWLER_GLOBAL_ADMISSION_GATE" in statement.upper()
                        and "FOR UPDATE" in statement.upper()
                        and threading.current_thread().name == "stop-thread"):
                    stop_is_requesting_exclusive_lock.set()

            event.listen(engine, "after_cursor_execute", hold_lease_gate_lock)
            event.listen(engine, "before_cursor_execute", mark_stop_lock_request)
            def acquire_lease() -> None:
                results["leases"] = store.lease_tasks("race-agent", 1)

            def stop_admission() -> None:
                results["gate"] = store.set_global_admission_gate(
                    "STOPPED", request_id=uuid.uuid4().hex, actor="operator", reason="race test",
                )

            lease_thread = threading.Thread(target=acquire_lease, name="lease-thread")
            stop_thread = threading.Thread(target=stop_admission, name="stop-thread")
            lease_thread.start()
            self.assertTrue(lease_has_shared_gate_lock.wait(timeout=5), "lease must lock the open gate")
            stop_thread.start()
            self.assertTrue(stop_is_requesting_exclusive_lock.wait(timeout=5), "stop must request the same gate lock")
            release_lease.set()
            lease_thread.join(timeout=10)
            stop_thread.join(timeout=10)
            self.assertFalse(lease_thread.is_alive())
            self.assertFalse(stop_thread.is_alive())
            self.assertEqual(len(results.get("leases", [])), 1)
            self.assertEqual(results["gate"]["state"], "STOPPED")
            engine.dispose()
            engine = create_database_engine(isolated_url.render_as_string(hide_password=False))
            migrate_coordinator(engine)
            restarted_store = CoordinatorStore(create_session_factory(engine))
            self.assertEqual(restarted_store.get_global_admission_gate()["state"], "STOPPED")
            self.assertEqual(restarted_store.lease_tasks("race-agent", 1), [])
        finally:
            engine.dispose()
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()


if __name__ == "__main__":
    unittest.main()
