#!/usr/bin/env python3
"""Standalone Pinterest POD Studio Backend Server.

Dedicated lightweight HTTP service on port 8765 providing:
- Pinterest Trends discovery & AI scoring
- CMYK 300 DPI high-resolution rendering
- AI lifestyle mockup placement
- Pinterest persistent profile OAuth/login
- Asset serving & local disk caching
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

# Ensure server root directory is first in sys.path
SERVER_ROOT = Path(__file__).resolve().parent
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv(SERVER_ROOT / ".env")
except ImportError:
    pass

from pinterest_pod_bridge import (
    POD_SIZE_PRESETS,
    cancel_pod_job,
    check_service_health,
    create_pod_job,
    delete_pod_job,
    get_cached_asset_file,
    get_pinterest_auth_status,
    get_pod_job_status,
    launch_pinterest_login,
    list_recent_jobs_and_runs,
    produce_pod_job,
    send_windows_desktop_notification,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pinterest_pod_server")

PORT = int(os.getenv("UI_PORT", "8765"))
HOST = os.getenv("HOST", "127.0.0.1")


class PinterestPodHandler(BaseHTTPRequestHandler):
    server_version = "PinterestPodStudio/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("%s - - [%s] %s", self.client_address[0], self.log_date_time_string(), format % args)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url_parts = urllib.parse.urlsplit(self.path)
        path = url_parts.path.rstrip("/")
        if not path:
            path = "/"

        # Health check
        if path in {"/", "/health", "/api/pinterest-pod/health"}:
            self.send_json({"ok": True, "service": "pinterest-pod", "port": PORT, "status": "running"})
            return

        # Asset serving: /api/pinterest-pod/assets/:jobId/:filename
        pod_asset = re.fullmatch(r"/api/pinterest-pod/assets/([a-zA-Z0-9_-]+)/([^/]+)", path)
        if pod_asset:
            try:
                job_id = pod_asset.group(1)
                filename = urllib.parse.unquote(pod_asset.group(2))
                path_file, mime_type = get_cached_asset_file(job_id, filename)
                body = path_file.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(body)
            except (LookupError, ValueError) as exc:
                self.send_json({"ok": False, "message": str(exc)}, 404)
            except Exception as exc:
                logger.exception("Error serving asset %s", path)
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Auth status
        if path == "/api/pinterest-pod/auth-status":
            try:
                res = get_pinterest_auth_status()
                self.send_json(res)
            except Exception as exc:
                logger.exception("Error getting auth status")
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # General status & presets
        if path == "/api/pinterest-pod/status":
            try:
                query_params = urllib.parse.parse_qs(url_parts.query)
                api_url = (query_params.get("apiUrl") or [""])[0].strip() or None
                health = check_service_health(api_url) if api_url else check_service_health()
                recent = list_recent_jobs_and_runs()
                self.send_json({"ok": True, "service": health, "recent": recent, "presets": POD_SIZE_PRESETS})
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Job status: /api/pinterest-pod/jobs/:jobId
        pod_job_match = re.fullmatch(r"/api/pinterest-pod/jobs/([a-zA-Z0-9_-]+)", path)
        if pod_job_match:
            try:
                job_id = pod_job_match.group(1)
                host = self.headers.get("Host") or f"{HOST}:{PORT}"
                base_url = f"http://{host}"
                status_res = get_pod_job_status(job_id, base_url)
                self.send_json(status_res)
            except LookupError as exc:
                self.send_json({"ok": False, "message": str(exc)}, 404)
            except Exception as exc:
                logger.exception("Error getting job status for %s", job_id)
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Test notification
        if path == "/api/pinterest-pod/test-notification":
            try:
                query_params = urllib.parse.parse_qs(url_parts.query)
                delay_sec = int((query_params.get("delay") or ["0"])[0] or 0)
                ok = send_windows_desktop_notification(
                    "Pinterest POD Studio",
                    "Test thông báo nổi Desktop hoàn tất!",
                    delay_sec=delay_sec,
                )
                self.send_json({"ok": True, "windows_toast_sent": ok, "delay_sec": delay_sec})
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        self.send_json({"ok": False, "error": f"Endpoint not found: {path}"}, 404)

    def do_POST(self) -> None:
        url_parts = urllib.parse.urlsplit(self.path)
        path = url_parts.path.rstrip("/")

        length = int(self.headers.get("Content-Length", "0"))
        payload: dict[str, Any] = {}
        if length > 0:
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, json.JSONDecodeError):
                self.send_json({"ok": False, "message": "JSON body payload không hợp lệ."}, 400)
                return

        host = self.headers.get("Host") or f"{HOST}:{PORT}"
        base_url = f"http://{host}"

        # Create Job (Stage 1 Start): POST /api/pinterest-pod/jobs
        if path in {"/api/pinterest-pod/jobs", "/api/pinterest-pod/stage1/start"}:
            try:
                result = create_pod_job(payload, base_url)
                self.send_json(result, 201)
            except ValueError as exc:
                self.send_json({"ok": False, "message": str(exc)}, 400)
            except Exception as exc:
                logger.exception("Error starting stage 1 job")
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Produce Job (Stage 2 Start): POST /api/pinterest-pod/jobs/produce
        if path in {"/api/pinterest-pod/jobs/produce", "/api/pinterest-pod/produce", "/api/pinterest-pod/stage2/start"}:
            try:
                result = produce_pod_job(payload, base_url)
                self.send_json(result, 201)
            except ValueError as exc:
                self.send_json({"ok": False, "message": str(exc)}, 400)
            except Exception as exc:
                logger.exception("Error starting stage 2 production")
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Cancel Job: POST /api/pinterest-pod/jobs/:jobId/cancel
        cancel_match = re.fullmatch(r"/api/pinterest-pod/jobs/([a-zA-Z0-9_-]+)/cancel", path)
        if cancel_match:
            try:
                result = cancel_pod_job(cancel_match.group(1))
                self.send_json(result)
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Delete Job: POST /api/pinterest-pod/jobs/:jobId/delete
        delete_match = re.fullmatch(r"/api/pinterest-pod/jobs/([a-zA-Z0-9_-]+)/delete", path)
        if delete_match:
            try:
                result = delete_pod_job(delete_match.group(1))
                self.send_json(result)
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Launch Login: POST /api/pinterest-pod/launch-login
        if path == "/api/pinterest-pod/launch-login":
            try:
                timeout = int(payload.get("timeout") or 600)
                res = launch_pinterest_login(timeout=timeout)
                self.send_json(res)
            except Exception as exc:
                logger.exception("Error launching Pinterest login")
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Auth status via POST fallback
        if path == "/api/pinterest-pod/auth-status":
            try:
                res = get_pinterest_auth_status()
                self.send_json(res)
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        self.send_json({"ok": False, "error": f"Endpoint not found: {path}"}, 404)


def run_server() -> None:
    server_address = (HOST, PORT)
    httpd = ThreadingHTTPServer(server_address, PinterestPodHandler)
    logger.info("Pinterest POD Studio Backend listening on http://%s:%d", HOST, PORT)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server shutting down...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    run_server()
