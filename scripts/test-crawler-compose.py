"""Opt-in runtime smoke test. Only touches the isolated ffp-crawler-staging project.

Run after staging Compose is healthy: python scripts/test-crawler-compose.py
Uses fixture metadata only; never connects to Amazon or Shopify.
"""
import asyncio
import json
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import websockets


ORIGIN = "http://127.0.0.1:3011"
PROFILE = "/api/v1/image-profiles/compose-acceptance-fixture"


def request(path, method="GET", payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = Request(ORIGIN + path, data=body, method=method, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=10) as response:
        return json.load(response)


async def connect_fixture_agent():
    async with websockets.connect("ws://127.0.0.1:3011/api/v1/worker/connect", open_timeout=10) as socket:
        await socket.send(json.dumps({
            "type": "hello", "protocolVersion": "5", "agentVersion": "5.2.2",
            "clientId": "compose-acceptance-agent", "displayName": "Compose acceptance fixture",
            "maxConcurrentInputs": 1, "availableSlots": 0, "localTasks": [],
            "capabilities": {"mediaGalleryV2": True},
        }))
        response = json.loads(await asyncio.wait_for(socket.recv(), 10))
        assert response["type"] == "hello_ack", response


def main():
    inspected = json.loads(subprocess.check_output(
        ["docker", "inspect", "ffp-server", "ffp-client", "ffp-database"], text=True,
    ))
    for container in inspected:
        assert container["Config"]["Labels"]["com.docker.compose.project"] == "ffp-crawler-staging", "Refusing to touch a non-staging container"
        if container["Name"] != "/ffp-client":
            assert not any(container["NetworkSettings"]["Ports"].values()), "Backend port is published"
    assert request("/api/v1/ready")["status"] == "ready"
    for path in ("/api/not-a-route", "/api/not-a-route.png", "/api/v1/internal/jobs"):
        try:
            request(path)
            raise AssertionError("Expected JSON 404")
        except HTTPError as error:
            assert error.code == 404
            assert json.load(error)["error"]["code"] == "NOT_FOUND"
    before = request(PROFILE, "PUT", {"name": "Durable fixture"})
    asyncio.run(connect_fixture_agent())
    subprocess.run(["docker", "restart", "ffp-server"], check=True, capture_output=True)
    deadline = time.monotonic() + 90
    while True:
        try:
            assert request("/api/v1/ready")["status"] == "ready"
            break
        except (URLError, AssertionError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)
    after = request(PROFILE)
    assert before == after, "Profile changed after restart"
    asyncio.run(connect_fixture_agent())
    request(PROFILE, "DELETE")
    print("PASS: JSON routing, private API, WebSocket reconnect, PostgreSQL profile restart persistence, private backend ports")


if __name__ == "__main__":
    main()
