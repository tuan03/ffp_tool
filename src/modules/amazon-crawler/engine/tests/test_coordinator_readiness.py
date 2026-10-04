import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from engine.distributed.coordinator_models import create_database_engine
from engine.distributed.coordinator_server import create_coordinator_app


class CoordinatorReadinessTests(unittest.TestCase):
    def test_production_rejects_sqlite(self):
        with patch.dict(os.environ, {"NODE_ENV": "production"}):
            with self.assertRaisesRegex(ValueError, "requires PostgreSQL"):
                create_database_engine("sqlite:///:memory:")

    def test_readiness_checks_schema_and_maintenance(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"IMAGE_PROCESSING_CACHE_DIR": directory}):
                app = create_coordinator_app(database_url=f"sqlite:///{directory}/test.sqlite3")
                with TestClient(app) as client:
                    self.assertEqual(client.get("/api/v1/ready").status_code, 200)
                    app.state.is_ready = False
                    self.assertEqual(client.get("/api/v1/ready").status_code, 503)
                    self.assertEqual(client.get("/api/v1/health").status_code, 200)

    def test_readiness_rejects_database_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"IMAGE_PROCESSING_CACHE_DIR": directory}):
                app = create_coordinator_app(database_url=f"sqlite:///{directory}/test.sqlite3")
                with TestClient(app) as client:
                    with patch("engine.distributed.coordinator_server.text", side_effect=RuntimeError("database unavailable")):
                        self.assertEqual(client.get("/api/v1/ready").status_code, 503)
