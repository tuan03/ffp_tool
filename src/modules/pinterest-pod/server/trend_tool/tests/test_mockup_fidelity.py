import sys
import tempfile
import json
import hashlib
import unittest
from pathlib import Path
from unittest.mock import patch
from dataclasses import replace

from PIL import Image
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from trend_tool.config import ProductTarget, PipelineConfig
from trend_tool.printability import PrintabilityDecision, assess_direct_ai_mockup
from trend_tool.template_mockup import build_direct_ai_mockup
from trend_tool import template_mockup
from trend_tool.pipeline import run_production_from_candidates
import pinterest_pod_bridge as bridge


class ReferenceProjectionTests(unittest.TestCase):
    def test_projection_preserves_background_occlusion_and_master_colors(self):
        self.assertTrue(hasattr(template_mockup, "compose_reference_artwork"))
        reference = Image.new("RGB", (101, 101), "green")
        artwork = Image.new("RGB", (41, 41), "red")
        for x in range(21, 41):
            for y in range(41):
                artwork.putpixel((x, y), (0, 0, 255))
        plan = {
            "all_printable_surfaces_identified": True,
            "surfaces": [{
                "confidence": 0.99, "geometry": "planar",
                "quad": [[200, 200], [800, 200], [800, 800], [200, 800]],
                "polygon": [[200, 200], [800, 200], [800, 800], [200, 800]],
                "protected_polygons": [[[450, 450], [550, 450], [550, 550], [450, 550]]],
            }],
        }
        output, mask = template_mockup.compose_reference_artwork(reference, artwork, plan)
        self.assertEqual(output.size, reference.size)
        self.assertEqual(output.getpixel((30, 30)), (255, 0, 0))
        self.assertEqual(output.getpixel((70, 30)), (0, 0, 255))
        self.assertEqual(output.getpixel((50, 50)), (0, 128, 0))
        outside = np.asarray(mask) == 0
        np.testing.assert_array_equal(np.asarray(output)[outside], np.asarray(reference)[outside])

    def test_missing_or_uncertain_geometry_requires_review(self):
        self.assertTrue(hasattr(template_mockup, "compose_reference_artwork"))
        for plan in ({}, {"all_printable_surfaces_identified": True, "surfaces": []}, {
            "all_printable_surfaces_identified": True,
            "surfaces": [{"confidence": 0.5, "geometry": "curved"}],
        }):
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                template_mockup.compose_reference_artwork(Image.new("RGB", (32, 32)), Image.new("RGB", (32, 32)), plan)


class MockupPublicationTests(unittest.TestCase):
    def test_reference_import_rejects_missing_and_corrupt_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for refs in ([str(root / "missing.png")], ["data:image/png;base64,bm90LWFuLWltYWdl"]):
                with self.subTest(refs=refs), self.assertRaises(ValueError):
                    bridge.save_room_template_images(refs, root / "templates")

    def test_production_manifest_reports_rejected_mockup_as_incomplete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            Image.new("RGB", (64, 64), "red").save(source)
            config = PipelineConfig(
                target=ProductTarget(name="custom", width_px=64, height_px=64),
                output_root=root, design_mode="direct_print", gemini_backend="off",
                enhancement_mode="none", export_cmyk=False, task4_ai_limit=1,
                task4_variants_per_product=1,
            )
            with patch("trend_tool.pipeline.render_product_from_print", side_effect=RuntimeError("no canvas")), patch("trend_tool.pipeline.time.sleep"):
                result = run_production_from_candidates([source], config)
            manifest = json.loads((result.run_dir / "stage_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "failed")
            self.assertEqual(manifest["quality_summary"], {"expected": 1, "approved": 0, "failed": 1})
            master = result.final_images[0]
            self.assertEqual(manifest["master_artworks"][0]["sha256"], hashlib.sha256(master.read_bytes()).hexdigest())
            self.assertEqual(result.mockups, [])
            # A successful retry replaces this view's failure, not append beside it.
            def approved_view(print_path, output_dir, target, **kwargs):
                output = output_dir / "lifestyle_mockups" / "approved.png"
                output.parent.mkdir(exist_ok=True)
                Image.new("RGB", (64, 64), "red").save(output)
                return template_mockup.TemplateMockupRecord(print_path, None, None, output, "test", "test", "ok", "", {}, variant=1)
            with patch("trend_tool.pipeline.render_product_from_print", side_effect=RuntimeError("no canvas")), patch("trend_tool.pipeline.time.sleep"), patch("trend_tool.pipeline.build_direct_ai_mockup", side_effect=approved_view):
                run_production_from_candidates([source], config, run_dir=result.run_dir)
            retried = json.loads((result.run_dir / "stage_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(retried["status"], "completed")
            self.assertEqual(retried["quality_summary"], {"expected": 1, "approved": 1, "failed": 0})
            with patch("trend_tool.pipeline.render_product_from_print", side_effect=RuntimeError("no canvas")), patch("trend_tool.pipeline.time.sleep"):
                rejected_retry = run_production_from_candidates([source], config, run_dir=result.run_dir)
            self.assertEqual(rejected_retry.mockups, [])
            with patch.object(bridge, "LOCAL_OUTPUT_DIR", root), patch.object(bridge, "TEMP_DIR", root / "temp"), patch.object(bridge, "ACTIVE_JOBS", {}):
                reloaded = bridge.load_standalone_run(result.run_dir.name, "http://localhost")
                polled = bridge.get_pod_job_status(result.run_dir.name, "http://localhost")
            self.assertEqual(reloaded["deliverables"]["lifestyle_mockups"], [])
            self.assertEqual(polled["deliverables"]["lifestyle_mockups"], [])
            # A safety/cost cap must not report omitted requested views as complete.
            with patch("trend_tool.pipeline.render_product_from_print", side_effect=RuntimeError("no canvas")), patch("trend_tool.pipeline.time.sleep"), patch("trend_tool.pipeline.build_direct_ai_mockup", side_effect=approved_view):
                capped = run_production_from_candidates([source], replace(config, output_root=root / "capped", task4_variants_per_product=11))
            manifest = json.loads((capped.run_dir / "stage_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "failed")
            self.assertEqual(manifest["quality_summary"]["expected"], 11)


    def test_missing_configured_reference_cannot_turn_into_generated_scene(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            Image.new("RGB", (32, 32), "red").save(source)
            config = PipelineConfig(target=ProductTarget(name="custom", width_px=32, height_px=32), output_root=root,
                design_mode="direct_print", enhancement_mode="none", gemini_backend="off", export_cmyk=False,
                task4_room_templates=(root / "missing.png",), task4_variants_per_product=1)
            with patch("trend_tool.pipeline.render_product_from_print", side_effect=RuntimeError("no canvas")), patch("trend_tool.pipeline.time.sleep"):
                result = run_production_from_candidates([source], config)
            manifest = json.loads((result.run_dir / "stage_manifest.json").read_text(encoding="utf-8"))
            self.assertIn("REFERENCE_UNREADABLE", manifest["template_mockup_records"][0]["notes"])

    def test_partial_run_with_print_file_stays_failed_when_loaded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = root / "run_test"
            (run / "final_print").mkdir(parents=True)
            Image.new("RGB", (32, 32)).save(run / "final_print" / "custom_001_rgb.png")
            (run / "stage_manifest.json").write_text(json.dumps({
                "status": "failed", "message": "Mockup quality review required",
                "quality_summary": {"expected": 2, "approved": 1, "failed": 1},
            }), encoding="utf-8")
            with patch.object(bridge, "LOCAL_OUTPUT_DIR", root), patch.object(bridge, "TEMP_DIR", root / "temp"), patch.object(bridge, "ACTIVE_JOBS", {}):
                loaded = bridge.load_standalone_run("run_test", "http://localhost")
                polled = bridge.get_pod_job_status("run_test", "http://localhost")
                recent = bridge.list_recent_jobs_and_runs()
            self.assertEqual(loaded["status"], "failed")
            self.assertEqual(loaded["error"], "Mockup quality review required")
            self.assertEqual(polled["status"], "failed")
            self.assertEqual(next(item for item in recent if item["id"] == "run_test")["status"], "failed")

    def test_reference_qa_requires_explicit_surface_and_artwork_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            Image.new("RGB", (32, 32), "red").save(path)
            for assessment, expected in [
                ({"listing_realism_score": 100, "artwork_identity_preserved": True}, False),
                ({"listing_realism_score": 100, "artwork_identity_preserved": True,
                  "all_print_surfaces_replaced": True, "mask_respects_printable_boundaries": True,
                  "protected_parts_preserved": True, "reference_geometry_preserved": True,
                  "no_original_print_remaining": True}, True),
            ]:
                with self.subTest(expected=expected), patch("trend_tool.printability._vision_pair_assessment", return_value=assessment):
                    decision = assess_direct_ai_mockup(
                        path, path, ProductTarget(name="custom", width_px=32, height_px=32),
                        backend="auto", model="vision", image_type="REFERENCE_TEMPLATE",
                        reference_template=Image.new("RGB", (32, 32), "red"),
                        edit_mask=Image.new("L", (32, 32), 255),
                    )
                    self.assertEqual(decision.accepted, expected)

    def test_reference_uses_master_projection_not_scene_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artwork = root / "master.png"
            Image.new("RGB", (32, 32), "red").save(artwork)
            approved = PrintabilityDecision("direct_ai_mockup", artwork, True, "approved", {}, {})
            plan = {"all_printable_surfaces_identified": True, "surfaces": [{
                "confidence": 0.99, "geometry": "planar",
                "quad": [[200, 200], [800, 200], [800, 800], [200, 800]],
                "polygon": [[200, 200], [800, 200], [800, 800], [200, 800]],
                "protected_polygons": [],
            }]}
            with patch("trend_tool.template_mockup.create_gemini_client", return_value=object()), patch(
                "trend_tool.template_mockup.analyze_reference_image", return_value={"surface_plan": plan}
            ), patch("trend_tool.template_mockup.generate_direct_ai_lifestyle", side_effect=AssertionError("must not redraw reference")), patch(
                "trend_tool.template_mockup.assess_direct_ai_mockup", return_value=approved
            ):
                record = build_direct_ai_mockup(
                    artwork, root, ProductTarget(name="custom", width_px=32, height_px=32),
                    backend="auto", model="image", quality_model="vision", attempts=1,
                    room_template=Image.new("RGB", (101, 101), "green"),
                )
            self.assertEqual(record.status, "ok")
            with Image.open(record.mockup_path) as output:
                self.assertEqual(output.size, (101, 101))
                self.assertEqual(output.getpixel((0, 0)), (0, 128, 0))
                self.assertEqual(output.getpixel((50, 50)), (255, 0, 0))
            self.assertTrue(record.mask_path.is_file())
            self.assertEqual(len(record.metrics["master_artwork_sha256"]), 64)

    def test_rejected_last_attempt_is_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artwork = root / "master.png"
            Image.new("RGB", (32, 32), "red").save(artwork)
            rejected = PrintabilityDecision("direct_ai_mockup", artwork, False, "wrong artwork", {}, {})
            with patch("trend_tool.template_mockup.create_gemini_client", return_value=object()), patch(
                "trend_tool.template_mockup.generate_direct_ai_lifestyle", return_value=Image.new("RGB", (32, 32))
            ), patch("trend_tool.template_mockup.assess_direct_ai_mockup", return_value=rejected):
                record = build_direct_ai_mockup(
                    artwork, root, ProductTarget(name="custom", width_px=32, height_px=32),
                    backend="auto", model="image", quality_model="vision", attempts=1,
                )
            self.assertEqual(record.status, "failed")
            self.assertIsNone(record.mockup_path)
            self.assertFalse(list((root / "lifestyle_mockups").glob("*.png")))
            self.assertFalse(record.metrics["mockup_quality"]["accepted"])

    def test_api_failure_after_rejection_does_not_publish_previous_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artwork = root / "master.png"
            Image.new("RGB", (32, 32), "red").save(artwork)
            rejected = PrintabilityDecision("direct_ai_mockup", artwork, False, "wrong artwork", {}, {})
            with patch("trend_tool.template_mockup.create_gemini_client", return_value=object()), patch(
                "trend_tool.template_mockup.generate_direct_ai_lifestyle",
                side_effect=[Image.new("RGB", (32, 32)), RuntimeError("429 RESOURCE_EXHAUSTED")],
            ), patch("trend_tool.template_mockup.assess_direct_ai_mockup", return_value=rejected):
                record = build_direct_ai_mockup(
                    artwork, root, ProductTarget(name="custom", width_px=32, height_px=32),
                    backend="auto", model="image", quality_model="vision", attempts=2,
                )
            self.assertEqual(record.status, "failed")
            self.assertIsNone(record.mockup_path)
            self.assertFalse(list((root / "lifestyle_mockups").glob("*.png")))

    def test_offline_reference_does_not_publish_guessed_surface(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artwork = root / "master.png"
            Image.new("RGB", (32, 32), "red").save(artwork)
            record = build_direct_ai_mockup(
                artwork, root, ProductTarget(name="custom", width_px=32, height_px=32),
                backend="off", model="image", quality_model="vision",
                room_template=Image.new("RGB", (64, 64), "white"),
            )
            self.assertEqual(record.status, "failed")
            self.assertIsNone(record.mockup_path)


if __name__ == "__main__":
    unittest.main()
