import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from engine.distributed.coordinator_server import create_coordinator_app

from engine.distributed.pipeline_health import pipeline_health, attach_pipeline_health


class PipelineHealthTests(unittest.TestCase):
    def test_api_exposes_handoff_health_without_blocking_coordinator_readiness(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"FFP_PIPELINE_HEALTH_FILE": str(Path(root) / "missing.json")}):
            app = create_coordinator_app(database_url=f"sqlite:///{(Path(root) / 'state.db').as_posix()}")
            snapshot = {"id": "job", "seoQueueHandoff": {"pending": 24, "handedOver": 0}}
            with TestClient(app) as client, \
                patch.object(app.state.store, "get_job", return_value=snapshot), \
                patch.object(app.state.store, "job_summary", return_value=snapshot), \
                patch.object(app.state.store, "list_jobs", return_value=[snapshot]):
                for suffix in ("/job", "/job/summary", ""):
                    response = client.get(f"/api/v1/crawl-jobs{suffix}")
                    self.assertEqual(response.status_code, 200)
                    result = response.json()[0] if not suffix else response.json()
                    self.assertEqual(result["seoQueueHandoff"]["workerStatus"], "unavailable")
                self.assertEqual(client.get("/api/v1/ready").status_code, 200)

    def test_missing_stale_dead_and_valid_worker(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "health.json"
            self.assertEqual(pipeline_health(str(path), now=100), "unavailable")
            for record, expected in [
                ({"pid": os.getpid(), "status": "starting", "updatedAt": 100_000}, "starting"),
                ({"pid": os.getpid(), "status": "healthy", "updatedAt": 100_000}, "healthy"),
                ({"pid": os.getpid(), "status": "healthy", "updatedAt": 1}, "unavailable"),
                ({"pid": -1, "status": "healthy", "updatedAt": 100_000}, "unavailable"),
                ({"pid": os.getpid(), "status": "healthy", "updatedAt": 200_000}, "unavailable"),
            ]:
                path.write_text(json.dumps(record))
                self.assertEqual(pipeline_health(str(path), now=100, is_alive=lambda pid: pid == os.getpid()), expected)
            path.write_text("broken")
            self.assertEqual(pipeline_health(str(path), now=100), "unavailable")

    def test_optional_health_enriches_handoff_without_discarding_counts(self):
        snapshot = {"seoQueueHandoff": {"pending": 24, "handedOver": 0}}
        self.assertEqual(attach_pipeline_health(snapshot, file=None), snapshot)
        enriched = attach_pipeline_health(snapshot, file="/missing/pipeline-health.json")
        self.assertEqual(enriched["seoQueueHandoff"], {"pending": 24, "handedOver": 0, "workerStatus": "unavailable"})
        self.assertNotIn("workerStatus", snapshot["seoQueueHandoff"])
