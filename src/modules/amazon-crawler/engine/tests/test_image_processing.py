from __future__ import annotations

import base64
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from engine.image_processing import ImageProcessingService, ImageProfileStore, process_image_bytes


def image_bytes(size: tuple[int, int] = (400, 200), color: str = "#336699") -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color).save(output, format="PNG")
    return output.getvalue()


class ImageProcessingTests(unittest.TestCase):
    def test_processes_to_configured_jpeg_canvas_deterministically(self) -> None:
        profile = {
            "slug": "test", "enabled": True, "randomPixels": 25,
            "output": {"width": 300, "height": 300, "fit": "contain", "background": "#ffffff"},
        }

        first = process_image_bytes(image_bytes(), profile, seed="same")
        second = process_image_bytes(image_bytes(), profile, seed="same")

        self.assertEqual(first, second)
        with Image.open(BytesIO(first)) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.size, (300, 300))

    def test_profile_logo_is_stored_outside_json_and_changes_revision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ImageProfileStore(Path(directory))
            before = store.save({"slug": "brand", "name": "Brand", "enabled": True})
            data_url = "data:image/png;base64," + base64.b64encode(image_bytes((20, 20))).decode("ascii")

            after = store.save_logo("brand", data_url)

            self.assertNotEqual(before["revision"], after["revision"])
            raw = json.loads((Path(directory) / "profiles" / "brand.json").read_text(encoding="utf-8"))
            self.assertNotIn("dataUrl", json.dumps(raw))

    def test_saving_a_loaded_profile_keeps_the_same_revision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ImageProfileStore(Path(directory))
            first = store.save({"slug": "stable", "name": "Stable", "enabled": True})

            second = store.save(first, "stable")

            self.assertEqual(second["revision"], first["revision"])
            raw = json.loads((Path(directory) / "profiles" / "stable.json").read_text(encoding="utf-8"))
            self.assertNotIn("revision", raw)
            self.assertNotIn("hasLogo", raw)

    def test_disabled_profile_drops_video_without_modifying_customize_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service = ImageProcessingService(Path(directory), workers=2)
            product = {
                "media": [
                    {"url": "https://example.test/image.jpg", "kind": "image"},
                    {"url": "https://example.test/video.mp4", "kind": "video"},
                ],
                "customization": {"assets": [{"url": "https://example.test/custom.png"}]},
            }

            result = service.process_product(product, "default")["product"]

            self.assertEqual(len(result["media"]), 1)
            self.assertEqual(result["customization"], product["customization"])
            service.close()

    def test_enabled_profile_deduplicates_visually_identical_images(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service = ImageProcessingService(Path(directory), workers=2)
            service.profiles.save({"slug": "enabled", "name": "Enabled", "enabled": True}, "enabled")
            product = {
                "media": [
                    {"url": "https://example.test/one.jpg", "kind": "image"},
                    {"url": "https://example.test/two.jpg", "kind": "image"},
                ],
                "customization": {"assets": [{"url": "https://example.test/custom.png"}]},
            }

            with patch("engine.image_processing._download_image", return_value=image_bytes()):
                result = service.process_product(product, "enabled")

            self.assertEqual(result["processed"], 1)
            self.assertEqual(result["product"]["customization"], product["customization"])
            service.close()


if __name__ == "__main__":
    unittest.main()
