"""Isolated Pinterest HTTPS service/UI using the active no-lease Coordinator sandbox."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import sys
import threading
import time
from urllib.parse import urlsplit
from unittest.mock import patch

from local_auth_sandbox import current_run, write_json, ROOT


def serve():
    from http.server import ThreadingHTTPServer
    from sqlalchemy.engine import make_url
    from audit_lease_baseline import local_test_url
    directory = current_run()
    if (directory / "pinterest-ui.json").exists():
        previous = json.loads((directory / "pinterest-ui.json").read_text())
        if previous.get("state") == "running" and time.time() - previous.get("updatedAt", 0) < 15:
            raise RuntimeError("Pinterest sandbox already running")
    stop_file = directory / "pinterest-ui.stop"
    if stop_file.exists():
        raise RuntimeError("Previous sandbox stopped; remove only pinterest-ui.stop to start a new session")
    status = json.loads((directory / "status.json").read_text())
    assert status["state"] == "running" and status["claimsDisabled"]
    assert time.time() - status["updatedAt"] < 15
    assert re.fullmatch(r"ffp_sandbox_[a-f0-9]{32}", status["schema"])
    credentials = json.loads((directory / "operator-login.json").read_text())
    runtime = directory / "pinterest-ui"
    runtime.mkdir(exist_ok=True)
    os.environ.update({
        "PINTEREST_OPERATOR_USERNAME": credentials["username"],
        "PINTEREST_OPERATOR_PASSWORD": credentials["password"],
        "PINTEREST_COORDINATOR_URL": status["origin"],
        "SSL_CERT_FILE": str(directory / "tls.pem"),
        "PINTEREST_RUNTIME_ROOT": str(runtime),
        "TREND_PRODUCT_OUTPUT": str(runtime / "output"),
        "PINTEREST_DATABASE_URL": make_url(local_test_url()).update_query_dict({
            "options": "-csearch_path=" + status["schema"],
        }).render_as_string(hide_password=False),
    })
    sys.path.insert(0, str(ROOT / "src/modules/pinterest-pod/server"))
    import server
    import pinterest_pod_bridge as bridge
    bridge.ROOT = runtime  # Never inspect legacy operator files in the source tree.
    frontend = ROOT / ".runtime/auth-ui-dist"
    assert (frontend / "index.html").is_file()
    fixture = runtime / "jobs" / "audit-fixture"
    fixture.mkdir(parents=True, exist_ok=True)
    (fixture / "preview.png").write_bytes(base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="))

    class Handler(server.PinterestPodHandler):
        def _base_url(self):
            return "https://" + self.headers.get("Host", "")

        def do_GET(self):
            path = urlsplit(self.path).path
            if path in {"/", "/pinterest-pod"}:
                target, mime = frontend / "index.html", "text/html"
            elif path.startswith("/assets/"):
                target = (frontend / path.lstrip("/")).resolve()
                if not target.is_relative_to((frontend / "assets").resolve()) or not target.is_file():
                    self.send_json({"code": "NOT_FOUND"}, 404)
                    return
                mime = "text/css" if target.suffix == ".css" else "text/javascript"
            else:
                return super().do_GET()
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if urlsplit(self.path).path == "/api/shopify":
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                if payload.get("operation") == "stores.list":
                    self.send_json({"success": True, "data": {"stores": [{"storeId": "sandbox", "shopDomain": "sandbox.invalid"}]}})
                else:
                    self.send_json({"code": "SANDBOX_SHOPIFY_DISABLED"}, 503)
                return
            # Prevent every action that could call Pinterest/AI/Shopify externally.
            path = urlsplit(self.path).path
            if path not in {"/api/pinterest-pod/operator-session", "/api/pinterest-pod/operator-session/logout", "/api/pinterest-pod/jobs"} and not re.fullmatch(r"/api/pinterest-pod/jobs/[a-zA-Z0-9_-]+/cancel", path):
                self.send_json({"code": "SANDBOX_ACTION_DISABLED"}, 403)
                return
            super().do_POST()

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(directory / "tls.pem", directory / "tls.key")
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    origin = "https://127.0.0.1:" + str(httpd.server_port)
    metadata = {"origin": origin, "pid": os.getpid(), "state": "running", "updatedAt": time.time()}
    write_json(directory / "pinterest-ui.json", metadata)
    try:
        with patch.object(server, "get_pinterest_auth_status", return_value={"ok": True, "logged_in": False, "status_text": "Sandbox: no Pinterest account"}), \
             patch.object(server, "check_service_health", return_value={"ok": True, "sandbox": True}):
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            while not stop_file.exists():
                metadata["updatedAt"] = time.time()
                write_json(directory / "pinterest-ui.json", metadata)
                time.sleep(1)
    finally:
        httpd.shutdown()
        httpd.server_close()
        metadata["state"] = "stopped"
        write_json(directory / "pinterest-ui.json", metadata)


def browser(manual):
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization
    from playwright.sync_api import sync_playwright
    directory = current_run()
    origin = json.loads((directory / "pinterest-ui.json").read_text())["origin"]
    assert urlsplit(origin).hostname == "127.0.0.1"
    credentials = json.loads((directory / "operator-login.json").read_text())
    cert = x509.load_pem_x509_certificate((directory / "tls.pem").read_bytes())
    public_key = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    pin = base64.b64encode(hashlib.sha256(public_key).digest()).decode()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not manual, args=["--ignore-certificate-errors-spki-list=" + pin])
        context = browser.new_context()
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") else route.abort())
        page = context.new_page()
        page.goto(origin + "/pinterest-pod")
        page.get_by_role("heading", name="Đăng nhập Pinterest Operator").wait_for()
        def api(path, payload=None):
            return page.evaluate("""async ({path,payload}) => {
                const response = await fetch(path, payload === null ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
                return {status:response.status, body:await response.text()};
            }""", {"path": path, "payload": payload})
        assert api("/api/pinterest-pod/assets/audit-fixture/preview.png")["status"] == 401
        assert api("/api/pinterest-pod/jobs", {"niche": "audit rug"})["status"] == 401
        page.get_by_label("Operator", exact=True).fill(credentials["username"])
        page.get_by_label("Mật khẩu", exact=True).fill("incorrect")
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        page.get_by_role("alert").filter(has_text="Đăng nhập không thành công").wait_for()
        page.get_by_label("Mật khẩu", exact=True).fill(credentials["password"])
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        page.get_by_role("button", name="Đăng xuất Pinterest operator").wait_for()
        assert api("/api/pinterest-pod/clients")["status"] == 200
        assert api("/api/pinterest-pod/ready")["status"] == 200
        assert api("/api/pinterest-pod/assets/audit-fixture/preview.png")["status"] == 200
        cookie = next(cookie for cookie in context.cookies() if cookie["name"] == "ffp_pinterest_operator")
        assert cookie["httpOnly"] and cookie["secure"] and cookie["sameSite"] == "Strict"
        assert "ffp_pinterest_operator" not in page.evaluate("document.cookie")
        created = api("/api/pinterest-pod/jobs", {"niche": "audit rug", "product": "rug", "workflow_stage": "crawl_and_review"})
        assert created["status"] == 201, created["body"]
        job = json.loads(created["body"])
        job_id = job.get("jobId", job.get("id"))
        assert job_id
        assert api("/api/pinterest-pod/jobs/" + job_id)["status"] == 200
        page.reload()
        page.get_by_role("button", name="Đăng xuất Pinterest operator").wait_for()
        page.screenshot(path=str(directory / "pinterest-ui.png"), full_page=True)
        if manual:
            print("Pinterest sandbox ready; one queued fixture job, no real leases. Close the browser when finished.", flush=True)
            while context.pages:
                try:
                    page.wait_for_timeout(1000)
                except Exception:
                    if context.pages:
                        raise
        else:
            assert api("/api/pinterest-pod/jobs/" + job_id + "/cancel", {})["status"] == 200
            page.get_by_role("button", name="Đăng xuất Pinterest operator").click()
            page.get_by_role("heading", name="Đăng nhập Pinterest Operator").wait_for()
            assert api("/api/pinterest-pod/assets/audit-fixture/preview.png")["status"] == 401
            assert api("/api/pinterest-pod/clients")["status"] == 401
            print("PASS: real HTTPS Pinterest login, cookie, guarded assets, Coordinator clients/create/status/cancel and logout")
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["serve", "test", "manual", "stop"])
    args = parser.parse_args()
    if args.action == "stop":
        write_json(current_run() / "pinterest-ui.stop", {"stop": True})
    elif args.action == "serve":
        serve()
    else:
        browser(args.action == "manual")
