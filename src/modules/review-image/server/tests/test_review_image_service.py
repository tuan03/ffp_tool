import base64
import io
import sys
import tempfile
import time
import unittest
from pathlib import Path

from PIL import Image


SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from review_image_generator import ReviewImageService  # noqa: E402


def image_data_url(color: str = "blue") -> str:
    stream = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(stream, format="PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()


class ReviewImageServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.templates = self.root / "templates"
        self.templates.mkdir()
        self.outputs = self.root / "outputs"
        self.template_bytes = base64.b64decode(image_data_url("red").split(",", 1)[1])
        (self.templates / "room.png").write_bytes(self.template_bytes)
        self.calls = []

        def fake_bridge(prompt, images):
            self.calls.append((prompt, images))
            return {"mime_type": "image/png", "data": image_data_url().split(",", 1)[1]}

        self.service = ReviewImageService(self.templates, self.outputs, fake_bridge)

    def wait_for_job(self, job_id: str) -> dict:
        for _ in range(100):
            job = self.service.snapshot(job_id)
            if job["status"] in {"completed", "failed"}:
                return job
            time.sleep(0.01)
        self.fail("Review image job did not finish")

    def test_orders_template_then_product_and_gates_download_on_approval(self) -> None:
        created = self.service.submit(image_data_url(), "Replace old bag", "main")
        job_id = created["job_id"]
        self.assertEqual(self.wait_for_job(job_id)["status"], "completed")
        prompt, images = self.calls[0]
        self.assertIn("main handbag only", prompt)
        self.assertEqual([part["name"] for part in images], ["template", "product"])
        self.assertEqual(base64.b64decode(images[0]["data"]), self.template_bytes)
        with self.assertRaises(ValueError):
            self.service.image_path(job_id, approved_only=True)
        self.service.approve(job_id)
        self.assertTrue(self.service.image_path(job_id, approved_only=True).is_file())

    def test_retry_can_exclude_previous_template(self) -> None:
        (self.templates / "other.png").write_bytes(self.template_bytes)
        created = self.service.submit(image_data_url(), "Prompt", "set", exclude_template="room.png")
        self.assertEqual(created["template_name"], "other.png")
        self.assertEqual(self.wait_for_job(created["job_id"])["status"], "completed")
        self.assertIn("matching wallet", self.calls[0][0])

    def test_rejects_invalid_upload_and_path_escape(self) -> None:
        with self.assertRaises(ValueError):
            self.service.submit("data:image/png;base64,Zm9v", "Prompt", "main")
        with self.assertRaises(ValueError):
            self.service.template_path("../room.png")
        self.assertEqual(self.calls, [])

    def test_text_only_bridge_result_is_failure(self) -> None:
        service = ReviewImageService(self.templates, self.outputs, lambda _prompt, _images: {})
        created = service.submit(image_data_url(), "Prompt", "main")
        for _ in range(100):
            job = service.snapshot(created["job_id"])
            if job["status"] == "failed":
                break
            time.sleep(0.01)
        self.assertEqual(job["status"], "failed")
        self.assertFalse(self.outputs.exists())


if __name__ == "__main__":
    unittest.main()
