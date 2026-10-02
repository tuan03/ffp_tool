import base64
import io
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from PIL import Image


SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from review_image_generator import ReviewImageBusyError, ReviewImageService  # noqa: E402


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

        def fake_bridge(prompt, images, conversation_session_id):
            self.calls.append((prompt, images, conversation_session_id))
            return {"mime_type": "image/png", "data": image_data_url().split(",", 1)[1]}

        self.service = ReviewImageService(self.templates, self.outputs, fake_bridge)

    def wait_for_job(self, job_id: str) -> dict:
        for _ in range(100):
            job = self.service.snapshot(job_id)
            if job["status"] in {"completed", "failed", "cancelled"}:
                return job
            time.sleep(0.01)
        self.fail("Review image job did not finish")

    def test_orders_template_then_product_and_gates_download_on_approval(self) -> None:
        created = self.service.submit(image_data_url(), "Replace old bag", "main")
        job_id = created["job_id"]
        self.assertEqual(self.wait_for_job(job_id)["status"], "completed")
        prompt, images, conversation_session_id = self.calls[0]
        self.assertIn("main handbag only", prompt)
        self.assertIn("two newest image attachments", prompt)
        self.assertTrue(conversation_session_id.startswith("single-"))
        self.assertEqual([part["name"] for part in images], ["template", "product"])
        self.assertEqual(base64.b64decode(images[0]["data"]), self.template_bytes)
        with self.assertRaises(ValueError):
            self.service.image_path(job_id, approved_only=True)
        self.service.approve(job_id)
        self.assertTrue(self.service.image_path(job_id, approved_only=True).is_file())

    def test_retry_can_exclude_previous_template(self) -> None:
        (self.templates / "preaureum" / "other.png").write_bytes(self.template_bytes)
        created = self.service.submit(image_data_url(), "Prompt", "set", exclude_template="room.png")
        self.assertEqual(created["template_name"], "other.png")
        self.assertEqual(self.wait_for_job(created["job_id"])["status"], "completed")
        self.assertIn("matching wallet", self.calls[0][0])

    def test_rug_jobs_enforce_reference_roles_even_with_a_custom_prompt(self) -> None:
        template_name = self.service.save_template("rug-scene.png", image_data_url("red"), store_id="capozen")
        product_data_url = image_data_url("green")
        created = self.service.submit(
            product_data_url, "Edit Image 1 and insert the product from Image 2. Keep the product geometry", "single",
            store_id="capozen", template_name=template_name,
        )
        self.assertEqual(self.wait_for_job(created["job_id"])["status"], "completed")
        prompt, images, _session_id = self.calls[0]
        self.assertIn("SCENE_BACKGROUND (template attachment) is the only scene source", prompt)
        self.assertIn("REPLACEMENT_PRODUCT (product attachment) is the only product source", prompt)
        self.assertIn("filename begins with template-", prompt)
        self.assertIn("filename begins with product-", prompt)
        self.assertIn("Edit SCENE_BACKGROUND and insert the product from REPLACEMENT_PRODUCT", prompt)
        self.assertNotRegex(prompt, r"(?i)\bImage\s*[12]\b")
        self.assertIn("ignore its background", prompt)
        self.assertIn("Do not just repaint the template rug", prompt)
        self.assertIn("Do not shrink the product to fit the cleared template footprint", prompt)
        self.assertIn("physical scale cues only", prompt)
        self.assertIn("allow the rug to extend beyond the frame", prompt)
        self.assertIn("Do not invent exact centimeter or inch measurements", prompt)
        self.assertIn("Keep the product geometry", prompt)
        self.assertEqual([part["name"] for part in images], ["template", "product"])
        self.assertEqual(base64.b64decode(images[0]["data"]), self.template_bytes)
        self.assertEqual(base64.b64decode(images[1]["data"]), base64.b64decode(product_data_url.split(",", 1)[1]))

    def test_forwards_a_shared_conversation_session_for_batch_jobs(self) -> None:
        first = self.service.submit(image_data_url(), "Prompt", "main", conversation_session_id="preaureum-batch-1")
        second = self.service.submit(image_data_url(), "Prompt", "main", conversation_session_id="preaureum-batch-1")
        self.assertEqual(self.wait_for_job(first["job_id"])["status"], "completed")
        self.assertEqual(self.wait_for_job(second["job_id"])["status"], "completed")
        self.assertEqual([call[2] for call in self.calls], ["preaureum-batch-1", "preaureum-batch-1"])
        self.assertEqual(first["conversation_session_id"], "preaureum-batch-1")

    def test_rejects_invalid_upload_and_path_escape(self) -> None:
        with self.assertRaises(ValueError):
            self.service.submit("data:image/png;base64,Zm9v", "Prompt", "main")
        with self.assertRaises(ValueError):
            self.service.template_path("../room.png")
        self.assertEqual(self.calls, [])

    def test_uploaded_templates_are_listed_without_overwriting_existing_files(self) -> None:
        uploaded = self.service.save_template("room.png", image_data_url("green"))
        self.assertNotEqual(uploaded, "room.png")
        self.assertEqual({item["name"] for item in self.service.list_templates()}, {"room.png", uploaded})
        self.assertEqual(self.service.template_path("room.png").read_bytes(), self.template_bytes)
        self.assertEqual(self.service.template_path(uploaded).read_bytes(), base64.b64decode(image_data_url("green").split(",", 1)[1]))

    def test_scopes_templates_by_store_and_migrates_legacy_templates_to_preaureum(self) -> None:
        self.assertTrue((self.templates / "preaureum" / "room.png").is_file())
        self.assertEqual(self.service.list_templates("preaureum"), [{"name": "room.png"}])
        self.assertEqual(self.service.list_templates("capozen"), [])
        uploaded = self.service.save_template("rug.png", image_data_url("green"), store_id="capozen")
        self.assertEqual(self.service.list_templates("capozen"), [{"name": uploaded}])
        with self.assertRaisesRegex(ValueError, "Store"):
            self.service.list_templates("../capozen")

    def test_template_upload_rejects_invalid_image_and_unsafe_name(self) -> None:
        with self.assertRaisesRegex(ValueError, "hợp lệ"):
            self.service.save_template("broken.png", "data:image/png;base64,Zm9v")
        corrupt_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=="
        with self.assertRaisesRegex(ValueError, "hợp lệ"):
            self.service.save_template("corrupt.png", f"data:image/png;base64,{corrupt_png}")
        (self.templates / "preaureum" / "corrupt.png").write_bytes(base64.b64decode(corrupt_png))
        self.assertEqual([item["name"] for item in self.service.list_templates()], ["room.png"])
        uploaded = self.service.save_template("../other\\scene.png", image_data_url())
        self.assertNotIn("/", uploaded)
        self.assertNotIn("\\", uploaded)
        self.assertEqual(len(self.service.list_templates()), 2)

    def test_deletes_a_template_without_allowing_path_escape(self) -> None:
        self.assertEqual(self.service.delete_template("room.png"), "room.png")
        self.assertEqual(self.service.list_templates(), [])
        self.assertFalse((self.templates / "preaureum" / "room.png").exists())
        with self.assertRaisesRegex(ValueError, "không tồn tại"):
            self.service.delete_template("../room.png")

    def test_does_not_delete_a_template_used_by_an_active_job(self) -> None:
        gate = __import__("threading").Event()
        service = ReviewImageService(
            self.templates,
            self.outputs,
            lambda _prompt, _images, _session: (gate.wait(2), {"mime_type": "image/png", "data": image_data_url().split(",", 1)[1]})[1],
        )
        created = service.submit(image_data_url(), "Prompt", "main", template_name="room.png")
        try:
            with self.assertRaisesRegex(ValueError, "đang được dùng"):
                service.delete_template("room.png")
            self.assertTrue((self.templates / "preaureum" / "room.png").is_file())
        finally:
            gate.set()
        self.assertEqual(self.wait_for_service_job(service, created["job_id"])["status"], "completed")

    def test_bulk_delete_removes_safe_templates_and_reports_active_templates(self) -> None:
        other = self.service.save_template("other.png", image_data_url("green"))
        gate = __import__("threading").Event()
        self.service.bridge_call = lambda _prompt, _images, _session: (gate.wait(2), {"mime_type": "image/png", "data": image_data_url().split(",", 1)[1]})[1]
        created = self.service.submit(image_data_url(), "Prompt", "main", template_name="room.png")
        try:
            outcome = self.service.delete_templates("preaureum", ["room.png", other, "missing.png"])
            self.assertEqual(outcome["deleted"], [other])
            self.assertEqual({failure["name"] for failure in outcome["failures"]}, {"room.png", "missing.png"})
        finally:
            gate.set()
        self.assertEqual(self.wait_for_job(created["job_id"])["status"], "completed")

    def test_rejects_prompt_that_exceeds_bridge_limit_after_scope_instruction(self) -> None:
        with self.assertRaisesRegex(ValueError, "quá dài"):
            self.service.submit(image_data_url(), "x" * 10_000, "main")
        self.assertEqual(self.calls, [])

    def test_text_only_bridge_result_is_failure(self) -> None:
        service = ReviewImageService(self.templates, self.outputs, lambda _prompt, _images, _session: {})
        created = service.submit(image_data_url(), "Prompt", "main")
        for _ in range(100):
            job = service.snapshot(created["job_id"])
            if job["status"] == "failed":
                break
            time.sleep(0.01)
        self.assertEqual(job["status"], "failed")
        self.assertFalse(self.outputs.exists())

    def test_cancelled_job_discards_a_late_bridge_result(self) -> None:
        gate = threading.Event()
        service = ReviewImageService(
            self.templates,
            self.outputs,
            lambda _prompt, _images, _session: (
                gate.wait(2),
                {"mime_type": "image/png", "data": image_data_url().split(",", 1)[1]},
            )[1],
        )
        created = service.submit(
            image_data_url(),
            "Prompt",
            "single",
            store_id="preaureum",
            conversation_session_id="preaureum-cancel-1",
        )
        try:
            cancelled = service.cancel(created["job_id"])
            self.assertEqual(cancelled["status"], "cancelled")
            self.assertIsNone(cancelled["output_name"])
        finally:
            gate.set()
        self.assertEqual(self.wait_for_service_job(service, created["job_id"])["status"], "cancelled")
        self.assertFalse(self.outputs.exists())

    def test_limits_pending_jobs_and_releases_capacity(self) -> None:
        gate = __import__("threading").Event()
        service = ReviewImageService(
            self.templates, self.outputs,
            lambda _prompt, _images, _session: (gate.wait(2), {"mime_type": "image/png", "data": image_data_url().split(",", 1)[1]})[1],
            max_pending_jobs=2,
        )
        try:
            first = service.submit(image_data_url(), "Prompt", "main")
            second = service.submit(image_data_url(), "Prompt", "main")
            with self.assertRaises(ReviewImageBusyError):
                service.submit(image_data_url(), "Prompt", "main")
        finally:
            gate.set()
        self.assertEqual(self.wait_for_service_job(service, first["job_id"])["status"], "completed")
        self.assertEqual(self.wait_for_service_job(service, second["job_id"])["status"], "completed")
        third = service.submit(image_data_url(), "Prompt", "main")
        self.assertEqual(self.wait_for_service_job(service, third["job_id"])["status"], "completed")

    def wait_for_service_job(self, service: ReviewImageService, job_id: str) -> dict:
        for _ in range(200):
            job = service.snapshot(job_id)
            if job["status"] in {"completed", "failed", "cancelled"} and "finished_at" in job:
                return job
            time.sleep(0.01)
        self.fail("Review image job did not finish")


if __name__ == "__main__":
    unittest.main()
