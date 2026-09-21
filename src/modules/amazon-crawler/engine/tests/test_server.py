from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from engine import server


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(server.app)

    def test_health_and_job_lifecycle(self) -> None:
        self.assertEqual(self.client.get("/api/amazon-crawler/health").json()["status"], "ok")
        with patch("engine.server.threading.Thread") as thread_class:
            response = self.client.post("/api/amazon-crawler/jobs", json={"urls": ["B012345678"]})
            self.assertEqual(response.status_code, 202)
            thread_class.return_value.start.assert_called_once()
        job_id = response.json()["jobId"]
        snapshot = self.client.get(f"/api/amazon-crawler/jobs/{job_id}")
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual(snapshot.json()["status"], "queued")
        cancelled = self.client.delete(f"/api/amazon-crawler/jobs/{job_id}")
        self.assertEqual(cancelled.json()["status"], "cancelled")

    def test_invalid_input_isolated_by_engine_not_request_validation(self) -> None:
        with patch("engine.server.threading.Thread"):
            response = self.client.post("/api/amazon-crawler/jobs", json={"urls": ["https://etsy.com/listing/1", "B012345678"]})
        self.assertEqual(response.status_code, 202)

    def test_export_download_and_filename_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(server, "PROJECT_ROOT", Path(directory)):
            exports = Path(directory) / "exports"
            exports.mkdir()
            (exports / "amazon-crawl-test.json").write_text("{}", encoding="utf-8")
            response = self.client.get("/api/amazon-crawler/exports/amazon-crawl-test.json")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {})
            self.assertEqual(self.client.get("/api/amazon-crawler/exports/not-allowed.json").status_code, 400)

    def test_cache_clear_does_not_remove_exports(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(server, "PROJECT_ROOT", Path(directory)):
            cache = server.RawFamilyCache(Path(directory) / ".runtime" / "cache")
            cache.save("B012345678", {"variantMatrix": {"complete": True}})
            exports = Path(directory) / "exports"
            exports.mkdir()
            export = exports / "amazon-crawl-keep.json"
            export.write_text("{}", encoding="utf-8")
            response = self.client.delete("/api/amazon-crawler/cache")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["removedFiles"], 1)
            self.assertTrue(export.is_file())


if __name__ == "__main__":
    unittest.main()
