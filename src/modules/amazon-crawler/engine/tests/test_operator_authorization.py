"""Operator boundary must not trust worker or proxy identity headers."""
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select, delete, inspect, create_engine

from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.operator_authorization import OperatorCredentials, OperatorAudit
from engine.distributed.coordinator_migrations import MIGRATIONS, migrate_coordinator
from engine.distributed.coordinator_models import ClientRecord, create_session_factory


class OperatorAuthorizationTests(unittest.TestCase):
    def test_job_cancel_route_requires_operator_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("engine.distributed.coordinator_server.find_project_root", return_value=root):
                app = create_coordinator_app(
                    database_url=f"sqlite:///{(root / 'cancel-auth.db').as_posix()}",
                    operator_credentials=OperatorCredentials("operator", "fixture-secret"),
                )
            with TestClient(app) as client:
                created = client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]},
                    auth=("operator", "fixture-secret"))
                self.assertEqual(created.status_code, 202, created.text)
                job_id = created.json()["id"]

                self.assertEqual(client.post(f"/api/v1/crawl-jobs/{job_id}/cancel").status_code, 401)
                self.assertEqual(app.state.store.get_job(job_id)["status"], "queued")
                cancelled = client.post(f"/api/v1/crawl-jobs/{job_id}/cancel",
                    auth=("operator", "fixture-secret"))
                self.assertEqual(cancelled.status_code, 200, cancelled.text)
                self.assertIn(cancelled.json()["status"], {"cancelled", "cancelling"})

    def test_operator_allowed_anonymous_and_agent_denied_with_safe_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = getattr(self, "external_engine", None)
            with patch("engine.distributed.coordinator_server.find_project_root", return_value=root), (
                patch("engine.distributed.coordinator_server.create_database_engine", return_value=engine) if engine is not None else nullcontext()
            ):
                app = create_coordinator_app(database_url=f"sqlite:///{(root / 'test.db').as_posix()}",
                    operator_credentials=OperatorCredentials("operator", "fixture-secret"))
            with TestClient(app) as client:
                self.assertEqual(client.get("/api/v1/clients").status_code, 401)
                self.assertEqual(client.get("/api/v1/clients", headers={"Authorization": "Bearer agent-secret", "X-Gateway-Key": "forged", "X-Operator-Id": "operator"}).status_code, 401)
                self.assertEqual(client.get("/api/v1/clients", auth=("operator", "wrong")).status_code, 401)
                self.assertEqual(client.get("/api/v1/clients?token=never-store", auth=("operator", "fixture-secret")).status_code, 200)
                self.assertEqual(client.get("/api/v1/health").status_code, 200)
                self.assertEqual(client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}).status_code, 401)
                self.assertEqual(client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}, auth=("operator", "fixture-secret")).status_code, 202)
                with app.state.store.sessions() as session:
                    audits = list(session.scalars(select(OperatorAudit).order_by(OperatorAudit.created_at)))
                    self.assertEqual(len(audits), 6)
                    self.assertEqual([row.outcome for row in audits], ["denied", "denied", "denied", "completed", "denied", "completed"])
                    self.assertNotIn("secret", repr([row.__dict__ for row in audits]))
                    self.assertNotIn("never-store", repr([row.__dict__ for row in audits]))
                with patch.object(app.state.store, "create_job") as create_job:
                    response = client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]},
                        auth=("operator", "fixture-secret"), headers={"Origin": "https://untrusted.invalid"})
                    self.assertEqual(response.status_code, 403)
                    create_job.assert_not_called()
                with patch.object(app.state.store.sessions, "begin", side_effect=OSError("fixture outage")), patch.object(app.state.store, "create_job") as create_job:
                    self.assertEqual(client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}, auth=("operator", "fixture-secret")).status_code, 503)
                    create_job.assert_not_called()
                original_begin = app.state.store.sessions.begin
                calls = 0
                def fail_outcome():
                    nonlocal calls
                    calls += 1
                    if calls == 2:
                        raise OSError("fixture outcome outage")
                    return original_begin()
                with patch.object(app.state.store.sessions, "begin", side_effect=fail_outcome):
                    response = client.get("/api/v1/clients", auth=("operator", "fixture-secret"))
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()["error"]["code"], "OPERATOR_OUTCOME_UNKNOWN")

    def test_v2_upgrade_adds_audit_and_preserves_existing_rows(self):
        engine = getattr(self, "external_engine", None)
        owns_engine = engine is None
        if owns_engine:
            engine = create_engine("sqlite:///:memory:")
        try:
            migrate_coordinator(engine)
            sessions = create_session_factory(engine)
            with sessions.begin() as session:
                session.add(ClientRecord(id="operator-migration-fixture", display_name="fixture"))
            with engine.begin() as connection:
                connection.execute(delete(MIGRATIONS).where(MIGRATIONS.c.version == 3))
                OperatorAudit.__table__.drop(connection)
            migrate_coordinator(engine)
            migrate_coordinator(engine)
            self.assertIn("crawler_operator_audit", inspect(engine).get_table_names())
            with sessions() as session:
                self.assertEqual(session.get(ClientRecord, "operator-migration-fixture").display_name, "fixture")
            with engine.connect() as connection:
                from engine.distributed.coordinator_migrations import MIGRATION_VERSION
                self.assertEqual(sorted(connection.scalars(select(MIGRATIONS.c.version))), list(range(1, MIGRATION_VERSION + 1)))
        finally:
            if owns_engine:
                engine.dispose()

    def test_malformed_auth_and_secret_repr(self):
        credentials = OperatorCredentials("operator", "fixture-secret")
        self.assertNotIn("fixture-secret", repr(credentials))
        for header in ("", "Basic !!!", "Bearer fixture-secret", "Basic " + "A" * 9000):
            self.assertFalse(credentials.accepts(header))

    def test_empty_credentials_are_rejected(self):
        with self.assertRaises(ValueError):
            OperatorCredentials("operator", "")
