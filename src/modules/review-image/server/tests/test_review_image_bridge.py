import base64
import time
import threading
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def test_image_edit_sends_two_ordered_images_and_returns_image():
    data = base64.b64encode(b"image-bytes").decode()
    with TestClient(server.app) as client:
        with client.websocket_connect(f"/ws/extension?token={server.BRIDGE_TOKEN}") as socket:
            socket.receive_json()
            with ThreadPoolExecutor(max_workers=1) as pool:
                request = pool.submit(
                    client.post,
                    "/image-edit",
                    json={
                        "prompt": "replace product",
                        "timeout_seconds": 10,
                        "images": [
                            {"name": "template", "mime_type": "image/png", "data": data},
                            {"name": "product", "mime_type": "image/png", "data": data},
                        ],
                    },
                    headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                )
                message = socket.receive_json()
                assert message["type"] == "job"
                assert message["kind"] == "image_edit"
                assert [image["name"] for image in message["images"]] == ["template", "product"]
                assert message["conversation_mode"] == "new"
                socket.send_json({
                    "type": "job_result",
                    "job_id": message["job_id"],
                    "image": {"mime_type": "image/png", "data": data},
                })
                response = request.result(timeout=3)
    assert response.status_code == 200
    assert response.json()["image"] == {"mime_type": "image/png", "data": data}
    assert server.jobs[message["job_id"]]["result"] is None


def test_image_edit_rejects_missing_or_unordered_images():
    with TestClient(server.app) as client:
        response = client.post(
            "/image-edit",
            json={"prompt": "x", "images": []},
            headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
        )
    assert response.status_code == 422


def test_image_edit_accepts_maximum_editable_prompt_with_scope_prefix():
    data = base64.b64encode(b"image-bytes").decode()
    request = server.ImageEditRequest(
        prompt="Required product selection: the main handbag only.\n\n" + "x" * 10_000,
        images=[
            server.ImagePart(name="template", mime_type="image/png", data=data),
            server.ImagePart(name="product", mime_type="image/png", data=data),
        ],
    )
    assert len(request.prompt) > 10_000


def test_image_edit_timeout_includes_time_waiting_for_tab():
    data = base64.b64encode(b"image-bytes").decode()
    with TestClient(server.app) as client:
        with client.websocket_connect(f"/ws/extension?token={server.BRIDGE_TOKEN}") as socket:
            socket.receive_json()
            client.portal.call(server.prompt_execution_lock.acquire)
            before = len(server.jobs)
            timer = threading.Timer(1.3, lambda: client.portal.call(server.prompt_execution_lock.release))
            timer.start()
            try:
                started = time.monotonic()
                response = client.post(
                    "/image-edit",
                    json={"prompt": "replace", "timeout_seconds": 1, "images": [
                        {"name": "template", "mime_type": "image/png", "data": data},
                        {"name": "product", "mime_type": "image/png", "data": data},
                    ]},
                    headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                )
                elapsed = time.monotonic() - started
            finally:
                timer.join(timeout=3)
                if server.prompt_execution_lock.locked():
                    client.portal.call(server.prompt_execution_lock.release)
    assert response.status_code == 504
    assert elapsed < 1.25
    assert len(server.jobs) == before

