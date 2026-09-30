import base64
import threading
import sys
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api  # noqa: E402
from review_image_generator import ReviewImageService  # noqa: E402
from test_review_image_service import image_data_url  # noqa: E402


def test_http_flow_requires_approval_before_download():
    with tempfile.TemporaryDirectory() as workspace:
        root = Path(workspace)
        templates = root / "templates"
        templates.mkdir()
        template_bytes = base64.b64decode(image_data_url("red").split(",", 1)[1])
        (templates / "room.png").write_bytes(template_bytes)
        output = image_data_url().split(",", 1)[1]
        original_service = api.review_image_service
        api.review_image_service = ReviewImageService(
            templates, root / "outputs", lambda _prompt, _images, _session: {"mime_type": "image/png", "data": output}
        )
        headers = {"X-Bridge-Token": api.BRIDGE_TOKEN}
        try:
            with TestClient(api.app) as client:
                assert client.get("/api/review-images/templates/room.png", headers=headers).content == template_bytes
                created = client.post("/api/review-images/jobs", headers=headers, json={
                    "productDataUrl": image_data_url(), "prompt": "Replace bag", "scope": "main"
                })
                assert created.status_code == 202
                job_id = created.json()["job"]["job_id"]
                for _ in range(100):
                    job = client.get(f"/api/review-images/jobs/{job_id}", headers=headers).json()["job"]
                    if job["status"] == "completed":
                        break
                    time.sleep(0.01)
                assert job["status"] == "completed"
                assert client.get(f"/api/review-images/jobs/{job_id}/download", headers=headers).status_code == 409
                approved = client.post(f"/api/review-images/jobs/{job_id}/approve", headers=headers)
                assert approved.status_code == 200
                downloaded = client.get(f"/api/review-images/jobs/{job_id}/download", headers=headers)
                assert downloaded.status_code == 200
                assert downloaded.headers["content-type"] == "image/png"
                assert base64.b64decode(output) == downloaded.content
                assert "attachment" in downloaded.headers["content-disposition"]
                assert client.get(f"/api/review-images/jobs/{job_id}").status_code == 401
        finally:
            api.review_image_service = original_service


def test_http_rejects_job_when_bridge_queue_is_full():
    with tempfile.TemporaryDirectory() as workspace:
        root = Path(workspace)
        templates = root / "templates"
        templates.mkdir()
        (templates / "room.png").write_bytes(base64.b64decode(image_data_url().split(",", 1)[1]))
        gate = threading.Event()
        original_service = api.review_image_service
        api.review_image_service = ReviewImageService(
            templates, root / "outputs",
            lambda _prompt, _images, _session: (gate.wait(2), {"mime_type": "image/png", "data": image_data_url().split(",", 1)[1]})[1],
            max_pending_jobs=1,
        )
        headers = {"X-Bridge-Token": api.BRIDGE_TOKEN}
        payload = {"productDataUrl": image_data_url(), "prompt": "Replace bag", "scope": "main"}
        try:
            with TestClient(api.app) as client:
                created = client.post("/api/review-images/jobs", headers=headers, json=payload)
                assert created.status_code == 202
                assert client.post("/api/review-images/jobs", headers=headers, json=payload).status_code == 429
        finally:
            gate.set()
            job_id = created.json()["job"]["job_id"]
            for _ in range(100):
                if api.review_image_service.snapshot(job_id)["status"] == "completed":
                    break
                time.sleep(0.01)
            assert api.review_image_service.snapshot(job_id)["status"] == "completed"
            api.review_image_service = original_service


def test_template_gallery_lists_and_uploads_authenticated_images():
    with tempfile.TemporaryDirectory() as workspace:
        root = Path(workspace)
        original_service = api.review_image_service
        api.review_image_service = ReviewImageService(root / "templates", root / "outputs", lambda _prompt, _images, _session: {})
        headers = {"X-Bridge-Token": api.BRIDGE_TOKEN}
        try:
            with TestClient(api.app) as client:
                assert client.get("/api/review-images/templates").status_code == 401
                assert client.get("/api/review-images/templates", headers=headers).json()["templates"] == []
                created = client.post("/api/review-images/templates", headers=headers, json={
                    "fileName": "scene.png", "imageDataUrl": image_data_url("green")
                })
                assert created.status_code == 201
                name = created.json()["template"]["name"]
                assert client.get("/api/review-images/templates", headers=headers).json()["templates"] == [{"name": name}]
                assert client.get(f"/api/review-images/templates/{name}", headers=headers).status_code == 200
                deleted = client.delete(f"/api/review-images/templates/{name}", headers=headers)
                assert deleted.status_code == 200
                assert deleted.json()["template"] == {"name": name}
                assert client.get("/api/review-images/templates", headers=headers).json()["templates"] == []
                invalid = client.post("/api/review-images/templates", headers=headers, json={
                    "fileName": "bad.png", "imageDataUrl": "data:image/png;base64,Zm9v"
                })
                assert invalid.status_code == 400
                corrupt_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=="
                corrupt = client.post("/api/review-images/templates", headers=headers, json={
                    "fileName": "corrupt.png", "imageDataUrl": f"data:image/png;base64,{corrupt_png}"
                })
                assert corrupt.status_code == 400
                assert len(api.review_image_service.list_templates()) == 0
        finally:
            api.review_image_service = original_service


def test_template_gallery_is_store_scoped_and_bulk_delete_reports_partial_success():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        original_service = api.review_image_service
        api.review_image_service = ReviewImageService(root / "templates", root / "outputs", lambda _prompt, _images, _session: {})
        try:
            with TestClient(api.app) as client:
                headers = {"X-Bridge-Token": api.BRIDGE_TOKEN}
                first = client.post("/api/review-images/templates", headers=headers, json={
                    "storeId": "capozen", "fileName": "rug.png", "imageDataUrl": image_data_url()
                }).json()["template"]["name"]
                second = client.post("/api/review-images/templates", headers=headers, json={
                    "storeId": "capozen", "fileName": "rug-2.png", "imageDataUrl": image_data_url()
                }).json()["template"]["name"]
                assert client.get("/api/review-images/templates?storeId=preaureum", headers=headers).json()["templates"] == []
                listed = client.get("/api/review-images/templates?storeId=capozen", headers=headers).json()["templates"]
                assert {item["name"] for item in listed} == {first, second}
                deleted = client.request("DELETE", "/api/review-images/templates/batch", headers=headers, json={
                    "storeId": "capozen", "names": [first, "missing.png"]
                })
                assert deleted.status_code == 200
                assert deleted.json()["deleted"] == [first]
                assert deleted.json()["failures"][0]["name"] == "missing.png"
        finally:
            api.review_image_service = original_service
