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
            patch.object(server, "suggest_pinterest_themes", return_value={"ok": True, "source": "internal_suggestions"}),
            patch.object(server, "create_pod_job", return_value={"ok": True, "jobId": "job_1"}),
            patch.object(server, "produce_pod_job", return_value={"ok": True, "jobId": "job_2"}),
            patch.object(server, "get_pod_job_status", return_value={"ok": True, "status": "completed"}),
            patch.object(server, "cancel_pod_job", return_value={"ok": True, "status": "cancelled"}),
        ):
            self.assertEqual(self.request_json("/api/pinterest-pod/trends/discover", {"niche": "rug"})[0], 200)
            suggestion_status, suggestion = self.request_json("/api/pinterest-pod/trends/suggestions", {"niche": "rug"})
            self.assertEqual(suggestion_status, 200)
            self.assertEqual(suggestion["source"], "internal_suggestions")
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

    def test_operator_session_guards_jobs_assets_and_logout(self) -> None:
        with patch.dict("os.environ", {"PINTEREST_OPERATOR_USERNAME": "fixture", "PINTEREST_OPERATOR_PASSWORD": "secret"}), \
             patch.object(server, "check_pinterest_coordinator_ready", return_value=True), \
             patch.object(server, "create_pod_job", return_value={"jobId": "fixture"}) as create:
            self.assertEqual(self.request_json("/api/pinterest-pod/jobs", {"niche": "rug"})[0], 401)
            self.assertEqual(self.request_json("/api/pinterest-pod/assets/fixture/image.png")[0], 401)
            create.assert_not_called()
            self.assertEqual(self.request_json("/api/pinterest-pod/operator-session", {"username": "fixture", "password": "wrong"})[0], 401)
            request = urllib.request.Request(self.base_url + "/api/pinterest-pod/operator-session",
                data=json.dumps({"username": "fixture", "password": "secret"}).encode(),
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request) as response:
                cookie = response.headers["Set-Cookie"]
                self.assertIn("HttpOnly", cookie)
                self.assertIn("SameSite=Strict", cookie)
                cookie = cookie.split(";", 1)[0]
            def post(path, origin=None):
                headers = {"Cookie": cookie, "Content-Type": "application/json"}
                if origin:
                    headers["Origin"] = origin
                request = urllib.request.Request(self.base_url + path, data=b"{}", headers=headers)
                try:
                    with urllib.request.urlopen(request) as response:
                        return response.status
                except urllib.error.HTTPError as error:
                    return error.code
            self.assertEqual(post("/api/pinterest-pod/jobs", "https://evil.invalid"), 403)
            create.assert_not_called()
            self.assertEqual(post("/api/pinterest-pod/jobs", self.base_url), 201)
            self.assertEqual(post("/api/pinterest-pod/operator-session/logout"), 200)
            self.assertEqual(post("/api/pinterest-pod/jobs"), 401)

    def test_secure_oauth_callback_requires_valid_state_without_operator_cookie(self) -> None:
        with patch.dict("os.environ", {"PINTEREST_OPERATOR_USERNAME": "fixture", "PINTEREST_OPERATOR_PASSWORD": "secret"}), \
             patch.object(server, "validate_pinterest_oauth_state", return_value=False), \
             patch.object(server, "exchange_pinterest_oauth_code") as exchange:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.base_url + "/api/pinterest-pod/oauth/callback?code=fixture&state=invalid")
            self.assertEqual(caught.exception.code, 400)
            exchange.assert_not_called()


if __name__ == "__main__":
    unittest.main()
