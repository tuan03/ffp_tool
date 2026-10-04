"""Run inside staging server against client Nginx; never calls ChatGPT or Shopify."""
import base64
import io
import json
import os
import sys
import time
import urllib.request

from PIL import Image
from websockets.sync.client import connect


def request(path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request("http://client" + path, data=body, headers={
        "X-Gateway-Key": os.environ["GATEWAY_AUTH_TOKEN"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as response:
        raw = response.read()
        return json.loads(raw) if "json" in response.headers.get("Content-Type", "") else raw


if len(sys.argv) > 1:
    job_id = sys.argv[1]
    assert request(f"/api/review-images/jobs/{job_id}")["job"]["approved"] is True
    assert request(f"/api/review-images/jobs/{job_id}/download").startswith(b"\x89PNG")
    print("Restart persistence verified through Nginx")
else:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode()
    image = "data:image/png;base64," + encoded
    request("/api/review-images/templates", {"storeId": "review-smoke", "fileName": "smoke.png", "imageDataUrl": image})
    with connect("ws://client/api/review-images/extension", origin="chrome-extension://staging-fixture") as socket:
        socket.send(json.dumps({"type": "authenticate", "token": os.environ["REVIEW_IMAGE_EXTENSION_TOKEN"]}))
        assert json.loads(socket.recv(timeout=10))["type"] == "hello"
        job_id = request("/api/review-images/jobs", {"storeId": "review-smoke", "productDataUrl": image,
                         "prompt": "Fixture only", "scope": "single"})["job"]["job_id"]
        task = json.loads(socket.recv(timeout=10))
        socket.send(json.dumps({"type": "job_result", "job_id": task["job_id"], "image": {"mime_type": "image/png", "data": encoded}}))
        for _ in range(100):
            if request(f"/api/review-images/jobs/{job_id}")["job"]["status"] == "completed":
                break
            time.sleep(0.1)
        assert request(f"/api/review-images/jobs/{job_id}/approve", {})["job"]["approved"] is True
        print(job_id)
