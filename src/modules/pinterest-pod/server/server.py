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
import time
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
    exchange_pinterest_oauth_code,
    generate_pinterest_oauth_url,
    get_cached_asset_file,
    get_pinterest_auth_status,
    get_pod_job_status,
    launch_pinterest_login,
    list_recent_jobs_and_runs,
    produce_pod_job,
    save_manual_pinterest_token,
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

    def send_html(self, html_content: str, status: int = 200) -> None:
        body = html_content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

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

        # OAuth Authorize URL: GET /api/pinterest-pod/oauth/authorize-url
        if path in {"/api/pinterest-pod/oauth/authorize-url", "/api/pinterest-pod/oauth/url"}:
            try:
                query_params = urllib.parse.parse_qs(url_parts.query)
                redirect_uri = (query_params.get("redirect_uri") or [""])[0].strip() or None
                self.send_json(generate_pinterest_oauth_url(redirect_uri))
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # OAuth Callback: GET /api/pinterest-pod/oauth/callback or /api/v1/oauth/pinterest/callback
        if path in {"/api/pinterest-pod/oauth/callback", "/api/v1/oauth/pinterest/callback"}:
            query_params = urllib.parse.parse_qs(url_parts.query)
            code = (query_params.get("code") or [""])[0].strip()
            error = (query_params.get("error") or query_params.get("error_description") or [""])[0].strip()
            if error:
                html_err = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Lỗi Kết Nối Pinterest</title></head>
<body style="font-family: sans-serif; background: #0f172a; color: #f87171; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #ef4444; max-width: 480px; text-align: center;">
    <h2>❌ Kết nối Pinterest thất bại</h2>
    <p style="color: #cbd5e1;">Lỗi phản hồi: {error}</p>
    <p style="color: #94a3b8; font-size: 13px;">Bạn có thể đóng cửa sổ này và thử lại từ FFP Tool.</p>
  </div>
</body>
</html>"""
                self.send_html(html_err, 400)
                return

            if not code:
                html_nocode = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Thiếu Mã Code</title></head>
<body style="font-family: sans-serif; background: #0f172a; color: #f59e0b; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #f59e0b; max-width: 480px; text-align: center;">
    <h2>⚠️ Không tìm thấy Authorization Code</h2>
    <p style="color: #cbd5e1;">Vui lòng kiểm tra lại URL chuyển hướng của Pinterest Developer App.</p>
  </div>
</body>
</html>"""
                self.send_html(html_nocode, 400)
                return

            try:
                host = self.headers.get("Host") or f"{HOST}:{PORT}"
                current_callback_url = f"http://{host}{path}"
                res = exchange_pinterest_oauth_code(code, redirect_uri=current_callback_url)
                html_ok = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kết Nối Pinterest Thành Công</title>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'PINTEREST_OAUTH_SUCCESS' }, '*');
    }
    setTimeout(() => {
      try { window.close(); } catch(e) {}
    }, 2500);
  </script>
</head>
<body style="font-family: sans-serif; background: #0f172a; color: #34d399; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="background: #1e293b; padding: 36px; border-radius: 16px; border: 1px solid #10b981; max-width: 480px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
    <h2 style="margin-top: 0; color: #10b981;">✅ Kết Nối Pinterest Thành Công!</h2>
    <p style="color: #e2e8f0; font-size: 15px;">Hệ thống đã nhận và lưu trữ API Token an toàn.</p>
    <p style="color: #94a3b8; font-size: 13px;">Cửa sổ này sẽ tự động đóng sau vài giây...</p>
    <button onclick="window.close()" style="margin-top: 12px; padding: 8px 20px; background: #10b981; color: #0f172a; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">Đóng Cửa Sổ</button>
  </div>
</body>
</html>"""
                self.send_html(html_ok, 200)
            except Exception as exc:
                logger.exception("Error exchanging Pinterest OAuth code on callback")
                html_exchange_err = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Lỗi Trao Đổi Token</title></head>
<body style="font-family: sans-serif; background: #0f172a; color: #f87171; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #ef4444; max-width: 520px; text-align: center;">
    <h2>❌ Trao đổi Access Token thất bại</h2>
    <p style="color: #cbd5e1; font-size: 14px;">{exc}</p>
    <p style="color: #94a3b8; font-size: 13px;">Gợi ý: Bạn có thể copy mã Code hoặc URL trên thanh địa chỉ và dán vào ô 'Dán Code Thủ Công' trên giao diện FFP Tool.</p>
  </div>
</body>
</html>"""
                self.send_html(html_exchange_err, 500)
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

        # OAuth Save Token: POST /api/pinterest-pod/oauth/save-token
        if path in {"/api/pinterest-pod/oauth/save-token", "/api/pinterest-pod/save-token"}:
            try:
                access_token = str(payload.get("access_token") or payload.get("token") or "").strip()
                refresh_token = str(payload.get("refresh_token") or "").strip()
                scopes = str(payload.get("scopes") or "").strip()
                code = str(payload.get("code") or payload.get("url") or "").strip()
                if code and not access_token:
                    redirect_uri = str(payload.get("redirect_uri") or "").strip() or None
                    res = exchange_pinterest_oauth_code(code, redirect_uri=redirect_uri)
                else:
                    res = save_manual_pinterest_token(access_token, refresh_token=refresh_token, scopes=scopes)
                self.send_json(res)
            except Exception as exc:
                logger.warning("Error saving Pinterest token: %s", exc)
                self.send_json({"ok": False, "message": str(exc)}, 400)
            return

        # OAuth Exchange Code: POST /api/pinterest-pod/oauth/exchange-code
        if path in {"/api/pinterest-pod/oauth/exchange-code", "/api/pinterest-pod/exchange-code"}:
            try:
                code = str(payload.get("code") or payload.get("url") or "").strip()
                redirect_uri = str(payload.get("redirect_uri") or "").strip() or None
                res = exchange_pinterest_oauth_code(code, redirect_uri=redirect_uri)
                self.send_json(res)
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 400)
            return

        # Auth status via POST fallback
        if path == "/api/pinterest-pod/auth-status":
            try:
                res = get_pinterest_auth_status()
                self.send_json(res)
            except Exception as exc:
                self.send_json({"ok": False, "message": str(exc)}, 500)
            return

        # Handover to SEO Module: POST /api/pinterest-pod/handover-seo or POST /api/seo/receive-deliverables
        if path in {"/api/pinterest-pod/handover-seo", "/api/seo/receive-deliverables"}:
            try:
                workflow_id = payload.get("workflowId") or payload.get("jobId") or "latest"
                handoff_dir = SERVER_ROOT / "data" / "pinterest_pod" / "output" / workflow_id
                handoff_dir.mkdir(parents=True, exist_ok=True)
                handoff_file = handoff_dir / "seo_handoff_payload.json"
                with open(handoff_file, "w", encoding="utf-8") as f:
                    json.dump(payload, f, ensure_ascii=False, indent=2)

                # Also write a copy to seo_handoffs directory inside data
                seo_inbox_dir = SERVER_ROOT / "data" / "seo_handoffs"
                try:
                    seo_inbox_dir.mkdir(parents=True, exist_ok=True)
                    with open(seo_inbox_dir / f"{workflow_id}_seo_payload.json", "w", encoding="utf-8") as f:
                        json.dump(payload, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass

                items = payload.get("items") or []
                print_master_count = sum(1 for item in items if item.get("printMaster"))
                approved_mockups_count = sum(len(item.get("composedMockups") or []) for item in items)

                logger.info(
                    "Handover to SEO received for workflow %s: %d print masters, %d approved mockups",
                    workflow_id,
                    print_master_count,
                    approved_mockups_count,
                )

                self.send_json({
                    "ok": True,
                    "success": True,
                    "message": f"Bàn giao sang SEO thành công: {print_master_count} file in xưởng (CMYK 300 DPI) và {approved_mockups_count} mockup AI đã duyệt.",
                    "receivedAt": int(time.time() * 1000),
                    "printMasterCount": print_master_count,
                    "approvedMockupCount": approved_mockups_count,
                    "savedPath": str(handoff_file),
                })
            except Exception as exc:
                logger.exception("Error during SEO handover")
                self.send_json({"ok": False, "success": False, "message": str(exc)}, 500)
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
