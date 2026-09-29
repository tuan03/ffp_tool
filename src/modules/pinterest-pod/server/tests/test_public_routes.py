from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

import server


class PinterestPublicRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.PinterestPodHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def request_json(self, path: str, payload: dict | None = None) -> tuple[int, dict]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST" if payload is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_liveness_and_readiness_are_public(self) -> None:
        health_status, health = self.request_json("/api/pinterest-pod/health")
        repository = Mock()
        repository.is_ready.return_value = True
        with (
            patch.object(server, "get_job_repository", return_value=repository),
            patch.object(server, "check_pinterest_coordinator_ready", return_value=True),
        ):
            ready_status, ready = self.request_json("/api/pinterest-pod/ready")

        self.assertEqual(health_status, 200)
        self.assertTrue(health["ok"])
        self.assertEqual(ready_status, 200)
        self.assertTrue(ready["ok"])
        self.assertTrue(ready["coordinator"])

    def test_discovery_create_production_status_and_cancel_routes(self) -> None:
        with (
            patch.object(server, "discover_pinterest_trends", return_value={"ok": True, "trends": []}),
            patch.object(server, "create_pod_job", return_value={"ok": True, "jobId": "job_1"}),
            patch.object(server, "produce_pod_job", return_value={"ok": True, "jobId": "job_2"}),
            patch.object(server, "get_pod_job_status", return_value={"ok": True, "status": "completed"}),
            patch.object(server, "cancel_pod_job", return_value={"ok": True, "status": "cancelled"}),
        ):
            self.assertEqual(self.request_json("/api/pinterest-pod/trends/discover", {"niche": "rug"})[0], 200)
            self.assertEqual(self.request_json("/api/pinterest-pod/jobs", {"niche": "rug"})[0], 201)
            self.assertEqual(self.request_json("/api/pinterest-pod/jobs/produce", {"jobId": "job_1"})[0], 201)
            self.assertEqual(self.request_json("/api/pinterest-pod/jobs/job_1")[0], 200)
            self.assertEqual(self.request_json("/api/pinterest-pod/jobs/job_1/cancel", {})[0], 200)

    def test_assets_are_downloaded_through_public_route(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            asset_path = Path(temporary_directory) / "preview.png"
            asset_path.write_bytes(b"png-data")
            with patch.object(server, "get_cached_asset_file", return_value=(asset_path, "image/png")):
                with urllib.request.urlopen(
                    f"{self.base_url}/api/pinterest-pod/assets/job_1/preview.png", timeout=3
                ) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers.get_content_type(), "image/png")
                    self.assertEqual(response.read(), b"png-data")


if __name__ == "__main__":
    unittest.main()
