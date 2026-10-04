"""One-time Agent Key creation under the operator boundary."""
import tempfile
import unittest
import uuid
import hashlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select, create_engine, delete, inspect

from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.operator_authorization import OperatorCredentials, OperatorAudit
from engine.distributed.agent_keys import AgentKey
from engine.distributed.protocol import utc_now
from engine.distributed.coordinator_migrations import MIGRATIONS, migrate_coordinator


class AgentKeyTests(unittest.TestCase):
    def test_create_once_list_metadata_and_reject_unauthorized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = getattr(self, "external_engine", None)
            with patch("engine.distributed.coordinator_server.find_project_root", return_value=root), (
                patch("engine.distributed.coordinator_server.create_database_engine", return_value=engine) if engine is not None else nullcontext()
            ):
                app = create_coordinator_app(database_url=f"sqlite:///{(root / 'keys.db').as_posix()}",
                    operator_credentials=OperatorCredentials("operator", "fixture-password"))
            with TestClient(app) as client:
                payload = {"requestId": uuid.uuid4().hex, "name": "fixture", "maxWorkers": 2,
                           "crawlers": ["amazon"], "environment": "test", "expiresAt": (utc_now() + timedelta(days=1)).isoformat()}
                url = "/api/v1/agent-keys"
                self.assertEqual(client.post(url, json=payload).status_code, 401)
                self.assertEqual(client.post(url, json=payload, headers={"Authorization": "Bearer agent"}).status_code, 401)
                auth = ("operator", "fixture-password")
                response = client.post(url, json=payload, auth=auth)
                self.assertEqual(response.status_code, 201, response.text)
                raw = response.json()["key"]
                key_id = response.json()["metadata"]["id"]
                self.assertEqual(response.headers["cache-control"], "no-store")
                retry = client.post(url, json=payload, auth=auth)
                self.assertEqual(retry.status_code, 409)
                self.assertNotIn(raw, retry.text)
                listing = client.get(url, auth=auth)
                self.assertNotIn(raw, listing.text)
                self.assertNotIn("verifier", listing.text)
                self.assertEqual(listing.json()["keys"][0]["id"], key_id)
                self.assertEqual(client.get(f"{url}/{key_id}", auth=auth).status_code, 404)
                with app.state.store.sessions() as session:
                    keys = list(session.scalars(select(AgentKey)))
                    self.assertEqual(len(keys), 1)
                    self.assertNotEqual(keys[0].verifier, raw)
                    self.assertEqual(len(keys[0].verifier), 64)
                    self.assertEqual(keys[0].verifier, hashlib.sha256(raw.encode("ascii")).hexdigest())
                    self.assertTrue(raw.startswith(f"ffp_agent_{key_id}_"))
                    self.assertEqual(len(raw), len(f"ffp_agent_{key_id}_") + 43)
                    self.assertNotIn(raw, repr([row.__dict__ for row in session.scalars(select(OperatorAudit))]))
                    self.assertEqual(session.scalar(select(OperatorAudit).where(OperatorAudit.reason == "AGENT_KEY_CREATED")).target_id, key_id)
                for changes in ({"maxWorkers": 0}, {"crawlers": []}, {"crawlers": ["admin"]}, {"expiresAt": "2000-01-01T00:00:00Z"}):
                    rejected = client.post(url, json={**payload, "requestId": uuid.uuid4().hex, **changes}, auth=auth)
                    self.assertIn(rejected.status_code, (400, 422))
                if engine is not None and engine.dialect.name == "postgresql":
                    concurrent = {**payload, "requestId": uuid.uuid4().hex}
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        responses = list(pool.map(lambda _: client.post(url, json=concurrent, auth=auth), range(2)))
                    self.assertEqual(sorted(reply.status_code for reply in responses), [201, 409])

    def test_legacy_app_does_not_expose_key_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("engine.distributed.coordinator_server.find_project_root", return_value=root):
                app = create_coordinator_app(database_url=f"sqlite:///{(root / 'legacy.db').as_posix()}")
            with TestClient(app) as client:
                self.assertEqual(client.post("/api/v1/agent-keys", json={}).status_code, 404)

    def test_v3_upgrade_is_repeatable_and_preserves_audit(self):
        engine = getattr(self, "external_engine", None)
        owns_engine = engine is None
        if owns_engine:
            engine = create_engine("sqlite:///:memory:")
        try:
            migrate_coordinator(engine)
            with engine.begin() as connection:
                connection.execute(OperatorAudit.__table__.insert().values(id="migration-fixture", actor="fixture",
                    method="POST", route="fixture", outcome="completed", reason="fixture"))
                connection.execute(delete(MIGRATIONS).where(MIGRATIONS.c.version == 4))
                AgentKey.__table__.drop(connection)
            migrate_coordinator(engine)
            migrate_coordinator(engine)
            self.assertIn("crawler_agent_keys", inspect(engine).get_table_names())
            with engine.connect() as connection:
                self.assertEqual(connection.execute(select(OperatorAudit.actor).where(OperatorAudit.id == "migration-fixture")).scalar(), "fixture")
                from engine.distributed.coordinator_migrations import MIGRATION_VERSION
                self.assertEqual(sorted(connection.scalars(select(MIGRATIONS.c.version))), list(range(1, MIGRATION_VERSION + 1)))
        finally:
            if owns_engine:
                engine.dispose()
