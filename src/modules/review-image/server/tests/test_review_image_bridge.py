import asyncio
import base64
import time
import threading
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import pytest
from starlette.websockets import WebSocketDisconnect

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def test_extension_websocket_rejects_web_page_origin():
    with TestClient(server.app) as client:
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect(
                f"/ws/extension?token={server.BRIDGE_TOKEN}",
                headers={"origin": "https://untrusted.example"},
            ):
                pass
    assert rejected.value.code == 4403


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
                        "conversation_session_id": "preaureum-batch-1",
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
                assert message["conversation_mode"] == "session"
                assert message["conversation_session_id"] == "preaureum-batch-1"
                socket.send_json({
                    "type": "job_result",
                    "job_id": message["job_id"],
                    "image": {"mime_type": "image/png", "data": data},
                })
                response = request.result(timeout=3)
    assert response.status_code == 200
    assert response.json()["image"] == {"mime_type": "image/png", "data": data}
    assert server.jobs[message["job_id"]]["result"] is None


def test_image_edit_can_be_cancelled_by_conversation_session():
    data = base64.b64encode(b"image-bytes").decode()
    session_id = "jeminise-cancel-1"
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
                        "conversation_session_id": session_id,
                        "images": [
                            {"name": "template", "mime_type": "image/png", "data": data},
                            {"name": "product", "mime_type": "image/png", "data": data},
                        ],
                    },
                    headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                )
                job_message = socket.receive_json()
                cancelled = client.post(
                    "/image-edit/cancel",
                    json={"conversation_session_id": session_id},
                    headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                )
                cancel_message = socket.receive_json()
                socket.send_json({
                    "type": "job_result",
                    "job_id": job_message["job_id"],
                    "image": {"mime_type": "image/png", "data": data},
                })
                response = request.result(timeout=3)

    assert cancelled.status_code == 200
    assert cancelled.json()["cancelled_job_ids"] == [job_message["job_id"]]
    assert cancel_message == {"type": "cancel", "job_id": job_message["job_id"]}
    assert response.status_code == 502
    assert server.jobs[job_message["job_id"]]["status"] == "cancelled"


def test_image_edit_cancellation_before_bridge_job_registration(monkeypatch):
    data = base64.b64encode(b"image-bytes").decode()
    session_id = "jeminise-cancel-before-registration"
    monkeypatch.setattr(server, "prompt_execution_lock", asyncio.Lock())
    with TestClient(server.app) as client:
        with client.websocket_connect(f"/ws/extension?token={server.BRIDGE_TOKEN}") as socket:
            socket.receive_json()
            client.portal.call(server.prompt_execution_lock.acquire)
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    request = pool.submit(
                        client.post,
                        "/image-edit",
                        json={
                            "prompt": "replace product",
                            "timeout_seconds": 10,
                            "conversation_session_id": session_id,
                            "images": [
                                {"name": "template", "mime_type": "image/png", "data": data},
                                {"name": "product", "mime_type": "image/png", "data": data},
                            ],
                        },
                        headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                    )
                    time.sleep(0.05)
                    cancelled = client.post(
                        "/image-edit/cancel",
                        json={"conversation_session_id": session_id},
                        headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                    )
                    client.portal.call(server.prompt_execution_lock.release)
                    response = request.result(timeout=3)
            finally:
                if server.prompt_execution_lock.locked():
                    client.portal.call(server.prompt_execution_lock.release)

    assert cancelled.status_code == 200
    assert cancelled.json()["cancelled_job_ids"] == []
    assert response.status_code == 409


def test_extension_error_keeps_unicode_message_on_windows_console(monkeypatch):
    def print_to_windows_console(*values):
        " ".join(str(value) for value in values).encode("cp1252")

    monkeypatch.setattr(server, "print", print_to_windows_console, raising=False)
    data = base64.b64encode(b"image-bytes").decode()
    message_text = "Không tìm thấy nút gửi"
    with TestClient(server.app) as client:
        with client.websocket_connect(f"/ws/extension?token={server.BRIDGE_TOKEN}") as socket:
            socket.receive_json()
            with ThreadPoolExecutor(max_workers=1) as pool:
                request = pool.submit(
                    client.post,
                    "/image-edit",
                    json={"prompt": "replace product", "images": [
                        {"name": "template", "mime_type": "image/png", "data": data},
                        {"name": "product", "mime_type": "image/png", "data": data},
                    ]},
                    headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                )
                job = socket.receive_json()
                socket.send_json({"type": "job_error", "job_id": job["job_id"], "error": message_text})
                response = request.result(timeout=3)
    assert response.status_code == 502
    assert response.json()["detail"] == message_text


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


def test_image_edit_fails_promptly_when_last_extension_disconnects():
    data = base64.b64encode(b"image-bytes").decode()
    with ThreadPoolExecutor(max_workers=1) as pool:
        with TestClient(server.app) as client:
            with client.websocket_connect(f"/ws/extension?token={server.BRIDGE_TOKEN}") as socket:
                socket.receive_json()
                started = time.monotonic()
                request = pool.submit(
                    client.post,
                    "/image-edit",
                    json={"prompt": "replace", "timeout_seconds": 2, "images": [
                        {"name": "template", "mime_type": "image/png", "data": data},
                        {"name": "product", "mime_type": "image/png", "data": data},
                    ]},
                    headers={"X-Bridge-Token": server.BRIDGE_TOKEN},
                )
                socket.receive_json()
            response = request.result(timeout=4)
    assert response.status_code == 502
    assert time.monotonic() - started < 1.7
