import base64
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
            templates, root / "outputs", lambda _prompt, _images: {"mime_type": "image/png", "data": output}
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
