import base64
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from trend_tool import reference_composite
from trend_tool import template_mockup
from trend_tool.config import ProductTarget


def bitmap(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return {"box_2d": [0, 0, 1000, 1000], "mask": base64.b64encode(buffer.getvalue()).decode("ascii")}


def mesh_plan(geometry="folded"):
    mask = Image.new("L", (101, 101))
    # Two visible panels with a bent seam, not a global homography.
    from PIL import ImageDraw
    ImageDraw.Draw(mask).polygon([(10, 10), (90, 10), (90, 90), (10, 90)], fill=255)
    return {"all_printable_surfaces_identified": True, "occluders": [], "surfaces": [{
        "geometry": geometry, "confidence": 0.99, "segmentation": bitmap(mask),
        "vertices": [[100, 100, 0, 0, 1], [600, 100, 500, 0, 1], [900, 100, 1000, 0, 0.5],
                     [100, 900, 0, 1000, 1], [400, 900, 500, 1000, 1], [900, 900, 1000, 1000, 0.5]],
        "triangles": [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]],
    }]}


class SurfaceMappingTests(unittest.TestCase):
    def test_cropped_planar_surface_keeps_full_canvas_mapping_outside_frame(self):
        from PIL import ImageDraw
        mask = Image.new("L", (101, 101))
        ImageDraw.Draw(mask).rectangle((0, 10, 50, 90), fill=255)
        plan = {"all_printable_surfaces_identified": True, "surfaces": [{
            "confidence": 0.99, "geometry": "planar", "segmentation": bitmap(mask),
            "quad": [[-500, 100], [500, 100], [500, 900], [-500, 900]],
        }]}
        artwork = Image.new("RGB", (101, 101), "red")
        ImageDraw.Draw(artwork).rectangle((51, 0, 100, 100), fill="blue")
        output, _ = reference_composite.compose_reference_artwork(Image.new("RGB", (101, 101), "green"), artwork, plan)
        self.assertEqual(output.getpixel((20, 50)), (0, 0, 255))
        self.assertEqual(output.getpixel((80, 50)), (0, 128, 0))

    def test_folded_and_curved_surfaces_warp_master_and_preserve_background(self):
        art = Image.new("RGB", (101, 101), "red")
        for x in range(51, 101):
            for y in range(101):
                art.putpixel((x, y), (0, 0, 200))
        for geometry in ("planar", "curved", "folded"):
            with self.subTest(geometry=geometry):
                reference = Image.new("RGB", (101, 101), "green")
                output, mask = reference_composite.compose_reference_artwork(reference, art, mesh_plan(geometry))
                self.assertEqual(output.getpixel((20, 50)), (255, 0, 0))
                self.assertEqual(output.getpixel((90, 50)), (0, 0, 100))
                self.assertGreater(output.getpixel((50, 20))[0], 200)
                self.assertGreater(output.getpixel((50, 80))[2], 100)
                outside = np.asarray(mask) == 0
                np.testing.assert_array_equal(np.asarray(output)[outside], np.asarray(reference)[outside])

    def test_bitmap_hole_protects_foreground_without_polygon_guess(self):
        plan = mesh_plan()
        mask = Image.new("L", (101, 101))
        from PIL import ImageDraw
        draw = ImageDraw.Draw(mask)
        draw.rectangle((10, 10, 90, 90), fill=255)
        draw.ellipse((40, 30, 60, 70), fill=0)
        plan["surfaces"][0]["segmentation"] = bitmap(mask)
        output, _ = reference_composite.compose_reference_artwork(Image.new("RGB", (101, 101), "green"), Image.new("RGB", (20, 20), "red"), plan)
        self.assertEqual(output.getpixel((50, 50)), (0, 128, 0))
        self.assertEqual(output.getpixel((30, 50)), (255, 0, 0))

    def test_folded_surface_without_bitmap_cannot_use_polygon_fallback(self):
        plan = mesh_plan()
        del plan["surfaces"][0]["segmentation"]
        with self.assertRaisesRegex(ValueError, "segmentation"):
            reference_composite.compose_reference_artwork(Image.new("RGB", (101, 101)), Image.new("RGB", (20, 20)), plan)

    def test_mesh_rejects_mirrored_uv_and_uncovered_mask_and_bad_indices(self):
        for mutation in ("mirror", "uncovered", "index", "nan", "overlap"):
            plan = mesh_plan()
            surface = plan["surfaces"][0]
            if mutation == "mirror":
                for vertex in surface["vertices"]:
                    vertex[2] = 1000 - vertex[2]
            elif mutation == "uncovered":
                surface["triangles"].pop()
            elif mutation == "index":
                surface["triangles"][0][0] = 99
            elif mutation == "nan":
                surface["vertices"][0][4] = float("nan")
            else:
                surface["triangles"].append(copy.deepcopy(surface["triangles"][0]))
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                reference_composite.compose_reference_artwork(Image.new("RGB", (101, 101)), Image.new("RGB", (20, 20)), plan)

    def test_mesh_cannot_tile_the_master_into_two_visible_panels(self):
        plan = mesh_plan()
        surface = plan["surfaces"][0]
        surface["vertices"] = [
            [100, 100, 0, 0, 1], [500, 100, 1000, 0, 1],
            [500, 900, 1000, 1000, 1], [100, 900, 0, 1000, 1],
            [500, 100, 0, 0, 1], [900, 100, 1000, 0, 1],
            [900, 900, 1000, 1000, 1], [500, 900, 0, 1000, 1],
        ]
        surface["triangles"] = [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]]
        with self.assertRaisesRegex(ValueError, "UV"):
            reference_composite.compose_reference_artwork(Image.new("RGB", (101, 101)), Image.new("RGB", (20, 20)), plan)

    def test_bitmap_decoder_places_yx_box_and_rejects_invalid_payloads(self):
        self.assertTrue(hasattr(reference_composite, "decode_surface_mask"), "pixel segmentation decoder is missing")
        payload = bitmap(Image.new("L", (10, 10), 255))
        payload["box_2d"] = [100, 500, 300, 900]
        mask = reference_composite.decode_surface_mask(payload, (100, 100))
        for bad in ({"box_2d": [0, 0, 1000, 1000], "mask": "bad"}, {**payload, "box_2d": [300, 500, 100, 900]}, {**payload, "box_2d": [True, 0, 1000, 1000]}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                reference_composite.decode_surface_mask(bad, (100, 100))

    def test_order_quad_points_fixes_reversed_corners(self):
        # Coordinates in [TL, BL, BR, TR] order
        unordered = [[457, 107], [449, 892], [939, 980], [957, 24]]
        ordered = reference_composite.order_quad_points(np.array(unordered))
        edges = np.roll(ordered, -1, axis=0) - ordered
        crosses = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
        self.assertTrue(np.all(crosses > 0), "quad should be ordered clockwise TL TR BR BL")
        np.testing.assert_allclose(ordered[0], [457, 107])
        np.testing.assert_allclose(ordered[1], [957, 24])
        np.testing.assert_allclose(ordered[2], [939, 980])
        np.testing.assert_allclose(ordered[3], [449, 892])

    def test_high_coverage_mask_auto_repairs_minor_boundary_discretization(self):
        from PIL import ImageDraw
        # Quad (10..90, 10..90)
        # Polygon with a tiny 1-pixel protrusion at (9, 50)
        mask = Image.new("L", (101, 101))
        ImageDraw.Draw(mask).rectangle((10, 10, 90, 90), fill=255)
        mask.putpixel((9, 50), 255)
        plan = {"all_printable_surfaces_identified": True, "surfaces": [{
            "confidence": 0.99, "geometry": "planar", "segmentation": bitmap(mask),
            "quad": [[100, 100], [900, 100], [900, 900], [100, 900]],
        }]}
        output, edit_mask = reference_composite.compose_reference_artwork(
            Image.new("RGB", (101, 101), "green"), Image.new("RGB", (20, 20), "red"), plan
        )
        self.assertEqual(output.getpixel((50, 50)), (255, 0, 0))
        # Outside pixel (9, 50) should be clipped away to quad, leaving green background
        self.assertEqual(output.getpixel((9, 50)), (0, 128, 0))


class SurfaceAnalysisTests(unittest.TestCase):
    def test_planar_geometry_is_anchored_to_a_complete_quadrilateral_mask(self):
        mask = Image.new("L", (101, 101))
        from PIL import ImageDraw
        ImageDraw.Draw(mask).rectangle((10, 20, 90, 80), fill=255)
        plan = {"all_printable_surfaces_identified": True, "occluders": [], "surfaces": [{
            "surface_id": "front", "description": "front panel", "geometry": "planar", "confidence": 0.99, "boundary_fully_visible": True,
            "quad": [[200, 300], [800, 300], [800, 700], [200, 700]],
        }]}
        responses = [plan, [{"label": "front", **bitmap(mask)}]]
        client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=json.dumps(responses.pop(0)))))
        reference = Image.new("RGB", (101, 101), "green")
        analysis = template_mockup.analyze_reference_surfaces(client, reference, "custom", model="vision")
        output, _ = reference_composite.compose_reference_artwork(reference, Image.new("RGB", (20, 20), "red"), analysis["surface_plan"])
        self.assertEqual(output.getpixel((11, 21)), (255, 0, 0))
        self.assertEqual(output.getpixel((9, 19)), (0, 128, 0))

    def test_partial_visible_rectangle_does_not_shrink_the_master_mapping(self):
        from trend_tool.planar_boundary import anchor_planar_boundary
        from PIL import ImageDraw
        mask = Image.new("L", (101, 101))
        ImageDraw.Draw(mask).rectangle((50, 10, 90, 90), fill=255)
        surface = {"geometry": "planar", "boundary_fully_visible": False,
            "quad": [[100, 100], [900, 100], [900, 900], [100, 900]]}
        anchor_planar_boundary(surface, mask)
        self.assertEqual(surface["quad"], [[100, 100], [900, 100], [900, 900], [100, 900]])
        # A false AI claim of complete visibility cannot override an edge occluder.
        surface["boundary_fully_visible"] = True
        foreground = Image.new("L", (101, 101))
        ImageDraw.Draw(foreground).rectangle((10, 10, 55, 90), fill=255)
        anchor_planar_boundary(surface, mask, (foreground,))
        self.assertEqual(surface["quad"], [[100, 100], [900, 100], [900, 900], [100, 900]])

    def test_ai_occluder_masks_are_subtracted_even_when_product_mask_includes_them(self):
        plan = mesh_plan()
        surface = plan["surfaces"][0]
        mask = surface.pop("segmentation")
        surface.update({"surface_id": "front", "description": "front panel"})
        plan["occluders"] = [{"occluder_id": "person", "description": "person standing on the product"}]
        foreground = bitmap(Image.new("L", (10, 10), 255))
        foreground["box_2d"] = [400, 400, 600, 600]
        responses = [plan, [{"label": "front", **mask}, {"label": "person", **foreground}]]
        client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=json.dumps(responses.pop(0)))))
        analysis = template_mockup.analyze_reference_surfaces(client, Image.new("RGB", (101, 101), "green"), "custom", model="vision")
        output, _ = reference_composite.compose_reference_artwork(Image.new("RGB", (101, 101), "green"), Image.new("RGB", (20, 20), "red"), analysis["surface_plan"])
        self.assertEqual(output.getpixel((50, 50)), (0, 128, 0))
        self.assertEqual(output.getpixel((30, 50)), (255, 0, 0))

    def test_pipeline_renders_curved_master_and_discards_cache_after_qa_rejection(self):
        for approved in (True, False):
            with self.subTest(approved=approved), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                master = root / "master.png"
                Image.new("RGB", (32, 32), "red").save(master)
                plan = mesh_plan("curved")
                surface = plan["surfaces"][0]
                mask = surface.pop("segmentation")
                surface.update({"surface_id": "front", "description": "front panel"})
                responses = [plan, [{"label": "front", **mask}]]
                client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=json.dumps(responses.pop(0)))))
                assessment = {"listing_realism_score": 100, "artwork_identity_preserved": True,
                    "all_print_surfaces_replaced": True, "mask_respects_printable_boundaries": approved,
                    "protected_parts_preserved": True, "reference_geometry_preserved": True,
                    "no_original_print_remaining": True, "surface_lighting_preserved": True}
                with patch.object(template_mockup, "create_gemini_client", return_value=client), patch(
                    "trend_tool.printability._vision_pair_assessment", return_value=assessment,
                ), patch.object(template_mockup, "generate_direct_ai_lifestyle", side_effect=AssertionError("must not redraw artwork")):
                    record = template_mockup.build_direct_ai_mockup(master, root,
                        ProductTarget(name="custom", width_px=32, height_px=32), backend="auto",
                        model="image", quality_model="vision", room_template=Image.new("RGB", (101, 101), "green"))
                if approved:
                    self.assertEqual(record.status, "ok", record.notes)
                    with Image.open(record.mockup_path) as output:
                        self.assertEqual(output.getpixel((20, 50)), (255, 0, 0))
                        self.assertEqual(output.getpixel((90, 50)), (128, 0, 0))
                        self.assertEqual(output.getpixel((0, 0)), (0, 128, 0))
                else:
                    self.assertEqual(record.status, "failed")
                    self.assertIsNone(record.mockup_path)
                    self.assertEqual(list((root / "room_templates").glob("surface_*.json")), [])

    def test_invalid_geometry_is_not_cached(self):
        plan = mesh_plan()
        surface = plan["surfaces"][0]
        mask = surface.pop("segmentation")
        surface.update({"surface_id": "front", "description": "front panel"})
        surface["triangles"][0][0] = 99
        responses = [plan, [{"label": "front", **mask}]]
        client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=json.dumps(responses.pop(0)))))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                template_mockup.analyze_reference_surfaces(client, Image.new("RGB", (101, 101)), "custom", model="vision", cache_dir=Path(directory))
            self.assertEqual(list(Path(directory).glob("surface_*.json")), [])

    def test_ai_masks_are_attached_by_id_and_cached_by_reference_and_model(self):
        self.assertTrue(hasattr(template_mockup, "analyze_reference_surfaces"), "AI pixel-mask integration is missing")
        plan = mesh_plan()
        surface = plan["surfaces"][0]
        mask = surface.pop("segmentation")
        surface.update({"surface_id": "front", "description": "visible front printable panel"})
        responses = [plan, [{"label": "front", **mask}]]
        calls = []

        def generate_content(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(text=json.dumps(responses.pop(0)))

        client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
        with tempfile.TemporaryDirectory() as directory:
            reference = Image.new("RGB", (101, 101), "green")
            first = template_mockup.analyze_reference_surfaces(client, reference, "custom", model="vision", cache_dir=Path(directory))
            second = template_mockup.analyze_reference_surfaces(client, reference, "custom", model="vision", cache_dir=Path(directory))
            self.assertEqual(first, second)
            output, _ = reference_composite.compose_reference_artwork(reference, Image.new("RGB", (20, 20), "red"), second["surface_plan"])
            self.assertEqual(output.getpixel((20, 50)), (255, 0, 0))
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[1]["model"], "gemini-2.5-flash")
            self.assertIsNone(calls[1]["config"].response_mime_type)
            self.assertEqual(calls[1]["config"].thinking_config.thinking_budget, 0)
            # A model change must not reuse an earlier geometry estimate.
            responses.extend([plan, [{"label": "front", **mask}]])
            template_mockup.analyze_reference_surfaces(client, reference, "custom", model="other-vision", cache_dir=Path(directory))
            self.assertEqual(len(calls), 4)

    def test_missing_instance_mask_fails_without_rectangular_fallback(self):
        self.assertTrue(hasattr(template_mockup, "analyze_reference_surfaces"), "AI pixel-mask integration is missing")
        plan = mesh_plan()
        del plan["surfaces"][0]["segmentation"]
        plan["surfaces"][0].update({"surface_id": "front", "description": "front panel"})
        responses = [plan, []]
        client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=json.dumps(responses.pop(0)))))
        with self.assertRaisesRegex(ValueError, "segmentation"):
            template_mockup.analyze_reference_surfaces(client, Image.new("RGB", (101, 101)), "custom", model="vision")


if __name__ == "__main__":
    unittest.main()
