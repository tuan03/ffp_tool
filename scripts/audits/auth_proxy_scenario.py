"""Real local Nginx/HTTP/WebSocket gate, never targets a public deployment."""
import json
import base64
from datetime import datetime, timedelta, timezone
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

import uvicorn
from websockets.sync.client import connect
from engine.tests.test_agent_identity import AgentIdentityTests


def verify_auth_proxy(engine):
    fixture = AgentIdentityTests("test_security_discovery_is_explicit")
    fixture.external_engine = engine
    fixture.setUp()
    server = None
    thread = None
    audit_id = uuid.uuid4().hex
    name = "ffp-auth-audit-" + audit_id
    created = False
    listener = socket.socket()
    try:
        with tempfile.TemporaryDirectory(prefix="ffp-auth-proxy-") as directory:
            listener.bind(("0.0.0.0", 0))
            listener.listen(128)
            port = listener.getsockname()[1]
            server = uvicorn.Server(uvicorn.Config(fixture.app, lifespan="off", access_log=False, log_level="error"))
            thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
            thread.start()
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.05)
            if not server.started:
                raise RuntimeError("Test Coordinator did not start")
            root = Path(__file__).resolve().parents[2]
            config = (root / "deploy/client/nginx.conf").read_text(encoding="utf-8")
            for backend in (3001, 8766, 8768):
                config = config.replace(f"http://server:{backend}", f"http://host.docker.internal:{port}")
            mounted = Path(directory) / "default.conf"
            mounted.write_text(config, encoding="utf-8", newline="\n")
            image = subprocess.check_output(["docker", "inspect", "ffp-client", "--format", "{{.Image}}"], text=True).strip()
            subprocess.run(["docker", "run", "--detach", "--name", name, "--label", "ffp.audit=" + audit_id,
                "--publish", "127.0.0.1::80", "--mount", f"type=bind,source={mounted},target=/etc/nginx/conf.d/default.conf,readonly",
                "--entrypoint", "nginx", image, "-g", "daemon off;"], check=True, capture_output=True)
            created = True
            mapping = subprocess.check_output(["docker", "port", name, "80/tcp"], text=True).strip()
            origin = "http://127.0.0.1:" + mapping.rsplit(":", 1)[1]

            def request(path, *, payload=None, authorization=None, browser=False):
                headers = {"Content-Type": "application/json"}
                if browser:
                    headers["Origin"] = origin
                if authorization:
                    headers["Authorization"] = authorization
                req = urllib.request.Request(origin + path, headers=headers,
                    data=json.dumps(payload).encode() if payload is not None else None)
                try:
                    with urllib.request.urlopen(req, timeout=5) as response:
                        return response.status, json.load(response)
                except urllib.error.HTTPError as error:
                    return error.code, json.load(error)

            for _ in range(100):
                try:
                    status, _ = request("/api/v1/worker/security")
                    if status == 200:
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Nginx could not reach the isolated Coordinator")
            assert request("/api/v1/agent-keys")[0] == 401
            assert request("/api/v1/agent-keys", browser=True,
                authorization="Basic " + base64.b64encode(b"operator:fixture").decode(),
                payload={"requestId": uuid.uuid4().hex, "name": "browser-fixture", "maxWorkers": 1,
                    "crawlers": ["amazon"], "environment": "test",
                    "expiresAt": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()})[0] == 201
            assert request("/api/v1/internal/fixture")[0] == 404
            status, registered = request("/api/v1/worker/register", authorization="Bearer " + fixture.key,
                payload={"requestId": uuid.uuid4().hex, "displayName": "proxy-fixture"})
            assert status == 200
            with connect(origin.replace("http://", "ws://") + "/api/v1/worker/connect",
                         additional_headers={"Authorization": "Bearer " + fixture.key}, proxy=None) as websocket:
                websocket.send(json.dumps({"type": "hello", "protocolVersion": "5", "authProtocol": 1,
                    "clientId": registered["agentId"], "displayName": "proxy-fixture", "availableSlots": 0,
                    "maxConcurrentInputs": 1, "capabilities": {"mediaGalleryV2": True, "amazon": True}}))
                assert json.loads(websocket.recv(timeout=5))["type"] == "hello_ack"
            print("Local real Nginx: enrollment, key route 401, private route 404, WebSocket upgrade PASS (HTTP only; public TLS pending)")
    finally:
        if created:
            label = subprocess.check_output(["docker", "inspect", name, "--format", '{{index .Config.Labels "ffp.audit"}}'], text=True).strip()
            if label != audit_id:
                raise RuntimeError("Refusing to remove an unowned test container")
            subprocess.run(["docker", "rm", "--force", name], check=True, capture_output=True)
        if server:
            server.should_exit = True
        if thread:
            thread.join(timeout=10)
        listener.close()
        fixture.doCleanups()
