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
from engine.distributed.coordinator_models import (
    ClientRecord,
    CrawlJob,
    CrawlProductItem,
    CrawlTask,
    TaskResult,
    create_database_engine,
    create_session_factory,
)
from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.operator_authorization import OperatorCredentials
from engine.distributed.protocol import utc_now


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
            self.assertEqual(restarted_store.lease_tasks("agent-1", 1), [])
            self.assertTrue(restarted_store.acknowledge_global_admission_gate(
                "agent-1", opened["revision"], "OPEN",
            ))
            self.assertEqual(len(restarted_store.lease_tasks("agent-1", 1)), 1)
        finally:
            restarted_engine.dispose()

    def test_job_group_affinity_only_leases_to_agents_in_the_allowed_group(self) -> None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, self.job["id"])
            job.settings = {**job.settings, "allowedAgentGroup": "amazon-us"}
        group_job = self.store.get_job(self.job["id"])
        self.assertEqual(group_job["settings"]["allowedAgentGroup"], "amazon-us")
        self.assertEqual(self.store.lease_tasks("agent-1", 1), [])

        with self.sessions.begin() as session:
            client = session.get(ClientRecord, "agent-1")
            client.agent_group = "amazon-us"
        self.assertEqual(len(self.store.lease_tasks("agent-1", 1)), 1)

    def test_job_pause_waits_for_active_lease_then_resume_preserves_queued_work(self) -> None:
        leases = self.store.lease_tasks("agent-1", 1)
        self.assertEqual(len(leases), 1)
        task_id = leases[0]["taskId"]

        pausing = self.store.pause_job(self.job["id"])
        self.assertEqual(pausing["executionState"], "pausing")
        self.assertEqual(self.store.lease_tasks("agent-1", 2), [])

        with self.sessions.begin() as session:
            task = session.get(CrawlTask, task_id)
            task.status = "completed"
            task.lease_expires_at = None
            task.completed_at = utc_now()
            session.add(TaskResult(
                task_id=task_id, client_id="agent-1", lease_id=leases[0]["leaseId"],
                checksum="a" * 64, payload={"products": [{"id": "saved-product"}]},
            ))
            self.store._refresh_job(session, self.job["id"])

        paused = self.store.get_job(self.job["id"])
        self.assertEqual(paused["executionState"], "paused")
        self.assertEqual(paused["taskCounts"].get("completed"), 1)
        self.assertEqual(paused["taskCounts"].get("queued"), 1)
        with self.sessions() as session:
            self.assertEqual(session.get(TaskResult, task_id).payload["products"][0]["id"], "saved-product")
        self.assertEqual(self.store.lease_tasks("agent-1", 2), [])

        resumed = self.store.resume_job(self.job["id"])
        self.assertEqual(resumed["executionState"], "active")
        self.assertEqual(len(self.store.lease_tasks("agent-1", 1)), 1)

    def test_job_pause_survives_coordinator_reopen(self) -> None:
        paused = self.store.pause_job(self.job["id"])
        self.assertEqual(paused["executionState"], "paused")

        self.engine.dispose()
        restarted_engine = create_database_engine(f"sqlite:///{self.database_path.as_posix()}")
        try:
            restarted_store = CoordinatorStore(create_session_factory(restarted_engine))
            restored = restarted_store.get_job(self.job["id"])
            self.assertEqual(restored["executionState"], "paused")
            self.assertEqual(restarted_store.lease_tasks("agent-1", 1), [])
        finally:
            restarted_engine.dispose()

    def test_scheduler_balances_claims_across_ready_agents_in_the_same_capability_cohort(self) -> None:
        with self.sessions.begin() as session:
            session.get(ClientRecord, "agent-1").status = "offline"
            session.get(CrawlJob, self.job["id"]).status = "completed"
        self.store.create_job({"urls": ["B0FR4MSS2H", "B0HG4NRG98", "B0D2NRQ7Q5", "B0F9JY5Y1R"]})
        common = {"displayName": "fixture", "availableSlots": 2, "maxConcurrentInputs": 2,
                  "capabilities": {"amazon": True, "pinterest": False}}
        self.store.register_client({**common, "clientId": "fair-a"})
        self.store.register_client({**common, "clientId": "fair-b"})
        first = self.store.lease_tasks("fair-a", 2)
        self.assertEqual(len(first), 2)
        self.assertEqual(self.store.lease_tasks("fair-a", 1), [])
        second = self.store.lease_tasks("fair-b", 2)
        self.assertEqual(len(second), 2)
        self.assertTrue({row["taskId"] for row in first}.isdisjoint({row["taskId"] for row in second}))

    def test_job_rejects_invalid_agent_group_filter(self) -> None:
        with self.assertRaisesRegex(ValueError, "allowedAgentGroup"):
            self.store.create_job({"urls": ["B0FR4MSS2H"], "allowedAgentGroup": "two groups"})

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

    def test_reopening_waits_until_each_agent_confirms_the_new_revision(self) -> None:
        prior_lease = self.store.lease_tasks("agent-1", 1)
        stopped = self.store.set_global_admission_gate(
            "STOPPED", request_id=uuid.uuid4().hex, actor="operator", reason="soft stop",
        )
        self.assertFalse(self.store.acknowledge_global_admission_gate("agent-1", stopped["revision"] - 1, "OPEN"))
        self.assertTrue(self.store.acknowledge_global_admission_gate("agent-1", stopped["revision"], "STOPPED"))
        self.assertEqual(self.store.lease_tasks("agent-1", 1), [])

        opened = self.store.set_global_admission_gate(
            "OPEN", request_id=uuid.uuid4().hex, actor="operator", reason="resume intake",
        )
        self.assertEqual(self.store.lease_tasks("agent-1", 1), [])
        self.assertTrue(self.store.acknowledge_global_admission_gate("agent-1", opened["revision"], "OPEN"))
        next_lease = self.store.lease_tasks("agent-1", 1)
        self.assertEqual(len(next_lease), 1)
        with self.sessions() as session:
            still_leased = session.get(CrawlTask, prior_lease[0]["taskId"])
            self.assertEqual(still_leased.status, "leased")

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
    def test_job_pause_and_resume_routes_preserve_active_job_state(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(database_url=f"sqlite:///{(root / 'jobs.db').as_posix()}")
            client = stack.enter_context(TestClient(app))
            job = app.state.store.create_job({"urls": ["B0FR4MSS2H", "B0HG4NRG98"]})

            with client.websocket_connect("/api/v1/worker/connect") as socket:
                socket.send_json({"type": "hello", "protocolVersion": "5", "clientId": "online-agent",
                    "displayName": "Online agent", "maxConcurrentInputs": 1, "availableSlots": 0,
                    "capabilities": {"mediaGalleryV2": True, "amazon": True}})
                self.assertEqual(socket.receive_json()["type"], "hello_ack")

                paused = client.post(f"/api/v1/crawl-jobs/{job['id']}/pause")
                self.assertEqual(paused.status_code, 200, paused.text)
                self.assertEqual(paused.json()["executionState"], "paused")
                self.assertEqual(paused.json()["status"], "queued")

                repeated_pause = client.post(f"/api/v1/crawl-jobs/{job['id']}/pause")
                self.assertEqual(repeated_pause.status_code, 200, repeated_pause.text)
                self.assertEqual(repeated_pause.json()["executionState"], "paused")

                resumed = client.post(f"/api/v1/crawl-jobs/{job['id']}/resume")
                self.assertEqual(resumed.status_code, 200, resumed.text)
                self.assertEqual(resumed.json()["executionState"], "active")
                self.assertEqual(socket.receive_json()["type"], "work_available")
                self.assertEqual(client.get(f"/api/v1/crawl-jobs/{job['id']}").json()["executionState"], "active")

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

            with app.state.store.sessions.begin() as session:
                session.add(ClientRecord(id="offline-agent", display_name="Offline agent", status="offline"))

            response = client.post("/api/v1/admission-gate", auth=auth, json={
                "requestId": uuid.uuid4().hex, "state": "STOPPED", "reason": "operator maintenance",
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["actor"], "operator")
            self.assertEqual(response.json()["state"], "STOPPED")
            self.assertEqual(response.json()["pendingAgents"], 1)
            confirmation = response.json()["confirmations"][0]
            self.assertEqual(confirmation["status"], "pending_confirmation")
            self.assertFalse(confirmation["isConnected"])
            self.assertEqual(client.get("/api/v1/admission-gate", auth=auth).json()["state"], "STOPPED")

    def test_connected_agent_confirms_soft_stop_over_websocket(self) -> None:
        with ExitStack() as stack:
            root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            stack.enter_context(patch("engine.distributed.coordinator_server.find_project_root", return_value=root))
            app = create_coordinator_app(
                database_url=f"sqlite:///{(root / 'connected-gate.db').as_posix()}",
                operator_credentials=OperatorCredentials("operator", "fixture"),
            )
            client = stack.enter_context(TestClient(app))
            with client.websocket_connect("/api/v1/worker/connect") as socket:
                socket.send_json({"type": "hello", "protocolVersion": "5", "clientId": "online-agent",
                    "displayName": "Online agent", "maxConcurrentInputs": 1, "availableSlots": 1,
                    "capabilities": {"mediaGalleryV2": True, "amazon": True}})
                hello = socket.receive_json()
                self.assertEqual(hello["globalAdmissionGate"], {"revision": 0, "state": "OPEN"})

                response = client.post("/api/v1/admission-gate", auth=("operator", "fixture"), json={
                    "requestId": uuid.uuid4().hex, "state": "STOPPED", "reason": "soft stop test",
                })
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["pendingAgents"], 1)
                self.assertTrue(response.json()["confirmations"][0]["isConnected"])

                update = socket.receive_json()
                self.assertEqual(update["type"], "global_admission_gate")
                self.assertEqual(update["state"], "STOPPED")
                socket.send_json({"type": "global_gate_ack", "revision": update["revision"],
                    "state": update["state"], "availableSlots": 0})
                acknowledgement = socket.receive_json()
                self.assertEqual(acknowledgement["type"], "global_gate_ack_received")
                self.assertTrue(acknowledgement["accepted"])
                confirmed = client.get("/api/v1/admission-gate", auth=("operator", "fixture"))
                self.assertEqual(confirmed.status_code, 200, confirmed.text)
                self.assertEqual(confirmed.json()["pendingAgents"], 0)
                self.assertEqual(confirmed.json()["confirmedAgents"], 1)


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
            store.register_client({"clientId": "race-agent", "displayName": "Race agent", "availableSlots": 2})

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
            opened = restarted_store.set_global_admission_gate(
                "OPEN", request_id=uuid.uuid4().hex, actor="operator", reason="resume test",
            )
            self.assertEqual(restarted_store.lease_tasks("race-agent", 1), [])
            self.assertTrue(restarted_store.acknowledge_global_admission_gate(
                "race-agent", opened["revision"], "OPEN",
            ))
            self.assertEqual(len(restarted_store.lease_tasks("race-agent", 1)), 1)
        finally:
            engine.dispose()
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()


if __name__ == "__main__":
    unittest.main()
