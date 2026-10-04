import importlib
import time

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from starlette.websockets import WebSocketDisconnect

from test_review_image_service import image_data_url

create_app = importlib.import_module("src.modules.review-image.server").create_review_app
INTERNAL = "internal-fixture-credential-123456"
EXTENSION = "extension-fixture-credential-12345"
PIPELINE = "pipeline-fixture-credential-123456"
HEADERS = {"X-Bridge-Token": INTERNAL}


def make_app(root):
    return create_app(engine=create_engine(f"sqlite:///{root}/review.sqlite3", connect_args={"check_same_thread": False}),
                      runtime_root=root / "assets", internal_token=INTERNAL, extension_token=EXTENSION, pipeline_token=PIPELINE)


def test_full_image_flow_persists_approval_and_enqueues_only_once(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/review-images/health").status_code == 401
        assert client.get("/api/review-images/health", headers=HEADERS).json()["extensionConnected"] is False
        uploaded = client.post("/api/review-images/templates", headers=HEADERS, json={
            "storeId": "capozen", "fileName": "fixture.png", "imageDataUrl": image_data_url(),
        })
        assert uploaded.status_code == 201
        with client.websocket_connect("/api/review-images/extension", headers={"origin": "chrome-extension://fixture"}) as socket:
            socket.send_json({"type": "authenticate", "token": EXTENSION})
            assert socket.receive_json()["type"] == "hello"
            response = client.post("/api/review-images/jobs", headers=HEADERS, json={
                "storeId": "capozen", "productDataUrl": image_data_url(), "prompt": "Test replacement", "scope": "single",
            })
            assert response.status_code == 202
            job_id = response.json()["job"]["job_id"]
            task = socket.receive_json()
            socket.send_json({"type": "job_result", "job_id": task["job_id"], "image": {
                "mime_type": "image/png", "data": image_data_url().split(",", 1)[1],
            }})
            for _ in range(100):
                job = client.get(f"/api/review-images/jobs/{job_id}", headers=HEADERS).json()["job"]
                if job["status"] == "completed":
                    break
                time.sleep(0.01)
            assert job["status"] == "completed"
            assert client.post(f"/api/review-images/jobs/{job_id}/shopify", headers=HEADERS, json={"storeId": "capozen"}).status_code == 409
            assert client.post(f"/api/review-images/jobs/{job_id}/approve", headers=HEADERS).status_code == 200
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(f"/api/review-images/jobs/{job_id}", headers=HEADERS).json()["job"]["approved"] is True
        assert client.get(f"/api/review-images/jobs/{job_id}/download", headers=HEADERS).status_code == 200
        assert client.post(f"/api/review-images/jobs/{job_id}/shopify", headers=HEADERS, json={"storeId": "jeminise"}).status_code == 409
        for _ in range(2):
            assert client.post(f"/api/review-images/jobs/{job_id}/shopify", headers=HEADERS, json={"storeId": "capozen"}).status_code == 202
        endpoint = "/api/v1/internal/review-images/uploads/claim"
        assert client.post(endpoint).status_code == 401
        claim = client.post(endpoint, headers={"X-Pipeline-Key": PIPELINE}).json()["upload"]
        assert claim["jobId"] == job_id
        assert client.post(endpoint, headers={"X-Pipeline-Key": PIPELINE}).json()["upload"] is None


def test_extension_credentials_cannot_call_operator_api_or_replace_active_executor(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        assert client.get("/api/review-images/templates?storeId=capozen", headers={"X-Bridge-Token": EXTENSION}).status_code == 401
        with client.websocket_connect("/api/review-images/extension", headers={"origin": "chrome-extension://fixture"}) as invalid:
            invalid.send_json({"type": "authenticate", "token": INTERNAL})
            with pytest.raises(WebSocketDisconnect) as error:
                invalid.receive_json()
            assert error.value.code == 4401
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/api/review-images/extension?token={EXTENSION}"):
                pass
        with client.websocket_connect("/api/review-images/extension", headers={"origin": "chrome-extension://fixture"}) as first:
            first.send_json({"type": "authenticate", "token": EXTENSION})
            first.receive_json()
            with client.websocket_connect("/api/review-images/extension", headers={"origin": "chrome-extension://fixture"}) as second:
                second.send_json({"type": "authenticate", "token": EXTENSION})
                with pytest.raises(WebSocketDisconnect) as error:
                    second.receive_json()
                assert error.value.code == 4409
