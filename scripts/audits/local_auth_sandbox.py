"""Persistent, loopback-only HTTPS sandbox for manual real-agent acceptance.

No production credentials, external crawl, Docker rebuild or global TLS changes.
The existing local audit database receives one private schema, retained on stop.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from unittest.mock import patch

from sqlalchemy import create_engine, text
from fastapi import Request
import uvicorn

from audit_lease_baseline import local_test_url
from engine.distributed.client_credentials import store_credential, enroll_agent
from engine.distributed.client_store import ClientStore
from engine.distributed.operator_authorization import OperatorCredentials
from engine.distributed.protocol import payload_checksum

ROOT = Path(__file__).resolve().parents[2]
SANDBOX = ROOT / ".runtime" / "auth-sandbox"


def write_json(path, payload):
    temporary = path.with_suffix(".part")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    for attempt in range(20):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            # Windows readers/antivirus can briefly deny atomic replacement.
            time.sleep(0.05)


def certificate(directory):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "FFP local auth sandbox")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
        .sign(key, hashes.SHA256()))
    (directory / "tls.key").write_bytes(key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (directory / "tls.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def current_run():
    run_id = json.loads((SANDBOX / "latest.json").read_text())["runId"]
    if len(run_id) != 32 or any(char not in "0123456789abcdef" for char in run_id):
        raise ValueError("Invalid sandbox ID")
    return SANDBOX / run_id


def command(action):
    directory = current_run()
    if action == "status":
        print((directory / "status.json").read_text())
        return
    status = json.loads((directory / "status.json").read_text())
    if time.time() - status["updatedAt"] > 15 or status["state"] == "stopped":
        raise RuntimeError("Sandbox is not running; no command submitted")
    request_id = uuid.uuid4().hex
    write_json(directory / "commands" / (request_id + ".json"), {"action": action})
    reply = directory / "replies" / (request_id + ".json")
    for _ in range(120):
        if reply.exists():
            payload = json.loads(reply.read_text())
            print(json.dumps(payload, indent=2))
            if not payload["ok"]:
                raise RuntimeError("Sandbox command failed; inspect private logs")
            return
        time.sleep(0.25)
    raise TimeoutError("Sandbox command still pending; check status, do not blindly retry")


def serve(ui=False):
    SANDBOX.mkdir(parents=True, exist_ok=True)
    if (SANDBOX / "latest.json").exists():
        previous = current_run() / "status.json"
        if previous.exists():
            status = json.loads(previous.read_text())
            if status["state"] != "stopped" and time.time() - status["updatedAt"] < 15:
                raise RuntimeError("A sandbox is already running")
    run_id = uuid.uuid4().hex
    directory = SANDBOX / run_id
    directory.mkdir()
    for name in ("commands", "replies", "agent"):
        (directory / name).mkdir()
    # Protect private TLS material and the per-user command directory on Windows.
    account = subprocess.check_output(["whoami"], text=True).strip()
    subprocess.run(["icacls", str(directory), "/inheritance:r", "/grant:r", account + ":(OI)(CI)F"],
                   check=True, capture_output=True)
    certificate(directory)
    write_json(SANDBOX / "latest.json", {"runId": run_id})
    schema = "ffp_sandbox_" + run_id
    url = local_test_url()
    with create_engine(url, hide_parameters=True).begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, hide_parameters=True, connect_args={"options": "-csearch_path=" + schema})
    operator_password = secrets.token_urlsafe(32)
    if ui:
        write_json(directory / "operator-login.json", {"username": "sandbox", "password": operator_password})
    with patch.dict(os.environ, {"IMAGE_PROCESSING_CACHE_DIR": str(directory / "images"),
                               "PINTEREST_RUNTIME_ROOT": str(directory / "pinterest")}):
        with patch("engine.distributed.coordinator_models.create_database_engine", return_value=engine):
            from engine.distributed import coordinator_server
        with patch.object(coordinator_server, "create_database_engine", return_value=engine), \
             patch.object(coordinator_server, "find_project_root", return_value=directory):
            app = coordinator_server.create_coordinator_app(operator_credentials=OperatorCredentials("sandbox", operator_password),
                                                           agent_environment="test")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    origin = "https://127.0.0.1:" + str(listener.getsockname()[1])
    serving_app = app
    if ui:
        from fastapi import FastAPI
        from fastapi.responses import FileResponse, JSONResponse
        from fastapi.staticfiles import StaticFiles
        from contextlib import asynccontextmanager
        frontend = ROOT / ".runtime" / "auth-ui-dist"
        if not (frontend / "index.html").is_file():
            raise RuntimeError("Build the isolated auth UI first")
        @asynccontextmanager
        async def lifespan(_):
            async with app.router.lifespan_context(app):
                yield
        serving_app = FastAPI(lifespan=lifespan)
        serving_app.mount("/assets", StaticFiles(directory=frontend / "assets"))
        @serving_app.get("/")
        @serving_app.get("/amazon-crawler")
        async def frontend_page():
            return FileResponse(frontend / "index.html")
        @serving_app.post("/api/shopify")
        async def fixture_shopify(request: Request):
            payload = await request.json()
            if payload.get("operation") == "stores.list":
                return {"success": True, "data": {"stores": [{"storeId": "sandbox", "shopDomain": "sandbox.invalid"}]}}
            if payload.get("operation") == "products.preflightAmazonAsins":
                # Explicit test fixture, never a fallback in application code.
                return {"success": True, "data": {"ready": True, "matches": []}}
            return JSONResponse({"error": {"code": "SANDBOX_SHOPIFY_DISABLED"}}, status_code=503)
        serving_app.mount("/", app)
        # Admission-only UI testing: no leased task can reach a real crawler.
        app.state.store.lease_tasks = lambda *_args, **_kwargs: []
    server = uvicorn.Server(uvicorn.Config(serving_app, ssl_keyfile=str(directory / "tls.key"),
        ssl_certfile=str(directory / "tls.pem"), access_log=False, log_level="error"))
    thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
    thread.start()
    child = None
    log = (directory / "agent.log").open("a", encoding="utf-8")
    store = ClientStore(directory / "agent" / "agent.sqlite3")
    store.set_paused(not ui)
    config_path = directory / "agent.json"
    write_json(config_path, {"serverUrl": origin, "authMode": "key", "displayName": "FFP isolated auth test",
        "dataDirectory": str(directory / "agent"), "maxConcurrentInputs": 1})
    environment = {**os.environ, "SSL_CERT_FILE": str(directory / "tls.pem"),
        "PYTHONPATH": str(ROOT / "src/modules/amazon-crawler"), "AMAZON_COORDINATOR_URL": origin}
    context = ssl.create_default_context(cafile=str(directory / "tls.pem"))
    phase = "starting"
    agent_id = None
    key_id = None

    def api(path, payload):
        request = urllib.request.Request(origin + path, data=json.dumps(payload).encode(), headers={
            "Content-Type": "application/json", "Authorization": "Basic " + base64.b64encode(
                ("sandbox:" + operator_password).encode()).decode()})
        with urllib.request.urlopen(request, context=context, timeout=10) as response:
            return json.load(response)

    def stop_agent():
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait(timeout=15)

    def start_agent():
        return subprocess.Popen([sys.executable, "-m", "engine.distributed.client_main", "--config", str(config_path),
            "--project-root", str(directory / "agent"), "--no-tray"], cwd=ROOT, env=environment,
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)

    def key_payload():
        return {"requestId": uuid.uuid4().hex, "name": "Isolated manual test", "maxWorkers": 1,
            "crawlers": ["amazon"], "environment": "test",
            "expiresAt": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}

    def publish():
        write_json(directory / "status.json", {"state": phase, "updatedAt": time.time(), "origin": origin,
            "schema": schema, "agentId": agent_id, "agentPid": child.pid if child and child.poll() is None else None,
            "connected": agent_id in app.state.connection_manager.connections,
            "paused": store.is_paused(), "claimsDisabled": ui, "outbox": store.upload_counts(), "directory": str(directory)})

    try:
        for _ in range(200):
            if server.started:
                break
            time.sleep(0.05)
        if not server.started:
            raise RuntimeError("TLS Coordinator failed to start")
        created = api("/api/v1/agent-keys", key_payload())
        key_id = created["metadata"]["id"]
        store_credential(store, origin, created["key"])
        # Trust is scoped to this sandbox process and its own child only.
        os.environ["SSL_CERT_FILE"] = str(directory / "tls.pem")
        agent_id = enroll_agent(store, origin, "FFP isolated auth test")
        child = start_agent()
        phase = "running"
        while True:
            publish()
            for path in sorted((directory / "commands").glob("*.json")):
                reply = directory / "replies" / path.name
                if reply.exists():
                    continue
                action = json.loads(path.read_text())["action"]
                try:
                    if action == "stop":
                        write_json(reply, {"ok": True, "action": action})
                        return
                    if action == "revoke":
                        api(f"/api/v1/agent-keys/{key_id}/revoke", {})
                        phase = "revoked"
                    elif action in {"rotate", "rebind"}:
                        stop_agent()
                        created = api(f"/api/v1/agent-keys/{key_id}/rotate", {**key_payload(), "rebind": action == "rebind"})
                        key_id = created["metadata"]["id"]
                        store_credential(store, origin, created["key"])
                        child = start_agent()
                        phase = "running"
                    elif action == "restart-agent":
                        stop_agent()
                        child = start_agent()
                    elif action == "test-outbox":
                        if ui:
                            raise ValueError("Outbox fixture requires the non-UI sandbox")
                        stop_agent()
                        backend = app.state.store
                        backend.register_client({"clientId": agent_id, "displayName": "FFP isolated auth test", "maxConcurrentInputs": 1})
                        job = backend.create_job({"urls": ["B0FR4MSS2H"]})
                        lease = backend.lease_tasks(agent_id, 1)[0]
                        store.save_assignment(lease)
                        payload = {"taskId": lease["taskId"], "leaseId": lease["leaseId"], "clientId": agent_id,
                                   "jobId": job["id"], "products": [], "marker": "sandbox-synthetic-result"}
                        store.spool_result(task_id=lease["taskId"], lease_id=lease["leaseId"],
                                           checksum=payload_checksum(payload), payload=payload)
                        child = start_agent()
                    else:
                        raise ValueError("Unknown command")
                    write_json(reply, {"ok": True, "action": action, "agentId": agent_id})
                except Exception as error:
                    write_json(reply, {"ok": False, "action": action, "errorType": type(error).__name__})
            time.sleep(1)
    finally:
        stop_agent()
        server.should_exit = True
        thread.join(timeout=15)
        listener.close()
        phase = "stopped"
        publish()
        log.close()
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["serve", "status", "restart-agent", "rotate", "revoke", "rebind", "test-outbox", "stop"])
    parser.add_argument("--ui", action="store_true", help="Serve isolated built UI; disable all real leases")
    arguments = parser.parse_args()
    action = arguments.action
    if action == "serve":
        serve(ui=arguments.ui)
    else:
        command(action)
