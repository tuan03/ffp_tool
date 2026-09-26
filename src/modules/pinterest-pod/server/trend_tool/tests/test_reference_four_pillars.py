import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from trend_tool.config import ProductTarget
from trend_tool.printability import assess_direct_ai_mockup
from trend_tool.reference_composite import (
    compose_reference_artwork,
    normalize_coordinates,
    normalize_surface_coordinates,
    order_quad_points,
)


class TestFourBestPracticePillars(unittest.TestCase):
    """Test suite verifying the 4 Best Practice pillars:

    1. Deterministic Coordinate Normalization ([y, x] vs [x, y]).
    2. Exclusion Zone Collision Check and bit-for-bit preservation.
    3. Natural Ambient Lighting (clean white point, no spotlight or vignette from old print).
    4. Direct, Unbiased QA Gate (orientation & critical content checks).
    """

    # --- PILLAR 1: DETERMINISTIC COORDINATE NORMALIZATION ---

    def test_coordinate_normalization_swaps_inverted_yx_to_xy(self):
        # A horizontal rug on the floor: box_2d is [ymin=400, xmin=100, ymax=600, xmax=800]
        # (width = 700, height = 200, aspect = 3.5 > 1)
        box_2d = [400, 100, 600, 800]

        # Gemini returned quad coordinates in [row, col] / [y, x] order:
        # component 0 is y (400..600), component 1 is x (100..800)
        inverted_quad = [
            [400, 100],  # y=400, x=100 (TL)
            [400, 800],  # y=400, x=800 (TR)
            [600, 800],  # y=600, x=800 (BR)
            [600, 100],  # y=600, x=100 (BL)
        ]

        normalized = normalize_coordinates(inverted_quad, box_2d, is_quad=True)

        # Expected: swapped to [x, y] and ordered TL, TR, BR, BL
        self.assertEqual(len(normalized), 4)
        tl, tr, br, bl = normalized
        self.assertAlmostEqual(tl[0], 100, delta=1.0)
        self.assertAlmostEqual(tl[1], 400, delta=1.0)
        self.assertAlmostEqual(tr[0], 800, delta=1.0)
        self.assertAlmostEqual(tr[1], 400, delta=1.0)
        self.assertAlmostEqual(br[0], 800, delta=1.0)
        self.assertAlmostEqual(br[1], 600, delta=1.0)
        self.assertAlmostEqual(bl[0], 100, delta=1.0)
        self.assertAlmostEqual(bl[1], 600, delta=1.0)

    def test_coordinate_normalization_preserves_valid_xy(self):
        box_2d = [400, 100, 600, 800]
        valid_quad = [
            [100, 400],
            [800, 400],
            [800, 600],
            [100, 600],
        ]

        normalized = normalize_coordinates(valid_quad, box_2d, is_quad=True)
        tl, tr, br, bl = normalized
        self.assertAlmostEqual(tl[0], 100, delta=1.0)
        self.assertAlmostEqual(tl[1], 400, delta=1.0)
        self.assertAlmostEqual(tr[0], 800, delta=1.0)
        self.assertAlmostEqual(tr[1], 400, delta=1.0)
        self.assertAlmostEqual(br[0], 800, delta=1.0)
        self.assertAlmostEqual(br[1], 600, delta=1.0)
        self.assertAlmostEqual(bl[0], 100, delta=1.0)
        self.assertAlmostEqual(bl[1], 600, delta=1.0)

    def test_normalize_surface_coordinates_applies_to_quad_polygon_and_protected(self):
        box_2d = [300, 100, 500, 900]  # horizontal product (w=800, h=200)
        surface = {
            "box_2d": box_2d,
            "quad": [[300, 100], [300, 900], [500, 900], [500, 100]],  # in [y, x]
            "polygon": [[300, 100], [300, 900], [500, 900], [500, 100]],
            "protected_polygons": [
                [[350, 400], [350, 500], [450, 500], [450, 400]]  # occluder in [y, x]
            ],
        }

        normalize_surface_coordinates(surface)

        # quad must be in [x, y]
        q_tl = surface["quad"][0]
        self.assertAlmostEqual(q_tl[0], 100, delta=1.0)
        self.assertAlmostEqual(q_tl[1], 300, delta=1.0)

        # polygon must be in [x, y]
        p_pt = surface["polygon"][0]
        self.assertAlmostEqual(p_pt[0], 100, delta=1.0)
        self.assertAlmostEqual(p_pt[1], 300, delta=1.0)

        # protected polygon must be in [x, y]
        prot_pt = surface["protected_polygons"][0][0]
        self.assertAlmostEqual(prot_pt[0], 400, delta=1.0)
        self.assertAlmostEqual(prot_pt[1], 350, delta=1.0)

    # --- PILLAR 2: EXCLUSION ZONE COLLISION CHECK & CLIPPING ---

    def test_exclusion_zone_collision_clips_printable_mask_and_preserves_pixels(self):
        # 500x500 reference image filled with distinctive green color (0, 180, 0)
        ref_color = (0, 180, 0)
        ref_img = Image.new("RGB", (500, 500), ref_color)

        # Draw a simulated size chart table / text banner at the top of the reference
        # y: 50..200, x: 100..400 (normalized: y 100..400, x 200..800)
        table_color = (240, 230, 200)
        ImageDraw.Draw(ref_img).rectangle([100, 50, 400, 200], fill=table_color)

        # Printable quad covers y: 50..450, x: 100..400 (norm: 100..900, 200..800)
        # Collision: quad overlaps with the size chart table at y: 50..200!
        plan = {
            "all_printable_surfaces_identified": True,
            "exclusion_zones": [
                [100, 200, 400, 800]  # size chart table [ymin, xmin, ymax, xmax]
            ],
            "surfaces": [
                {
                    "surface_id": "rug_surface",
                    "geometry": "planar",
                    "confidence": 0.99,
                    "quad": [[200, 100], [800, 100], [800, 900], [200, 900]],
                    "polygon": [[200, 100], [800, 100], [800, 900], [200, 900]],
                    "protected_polygons": [],
                }
            ],
        }

        # Master artwork is vibrant magenta (255, 0, 255)
        artwork = Image.new("RGB", (100, 100), (255, 0, 255))

        composite, edit_mask = compose_reference_artwork(ref_img, artwork, plan)

        # 1. The size chart table pixels must remain 100% untouched bit-for-bit!
        comp_arr = np.asarray(composite)
        ref_arr = np.asarray(ref_img)
        # Check inside the exclusion zone (e.g. at pixel x=250, y=100)
        np.testing.assert_array_equal(comp_arr[50:200, 100:400], ref_arr[50:200, 100:400])

        # 2. The non-colliding printable region below the exclusion zone (e.g. y=300, x=250)
        # must display the new artwork (magenta)
        self.assertEqual(composite.getpixel((250, 300)), (255, 0, 255))

        # 3. Edit mask must be 0 (False) inside the exclusion zone
        mask_arr = np.asarray(edit_mask)
        self.assertTrue(np.all(mask_arr[50:200, 100:400] == 0))

    # --- PILLAR 3: NATURAL AMBIENT LIGHTING ---

    def test_ambient_lighting_preserves_clean_white_point(self):
        # 600x600 reference with surrounding floor
        ref_img = Image.new("RGB", (600, 600), (140, 135, 130))
        # Surface occupies center
        plan = {
            "all_printable_surfaces_identified": True,
            "photorealistic": True,
            "surfaces": [
                {
                    "surface_id": "blanket",
                    "geometry": "planar",
                    "confidence": 0.98,
                    "quad": [[200, 200], [800, 200], [800, 800], [200, 800]],
                    "polygon": [[200, 200], [800, 200], [800, 800], [200, 800]],
                    "protected_polygons": [],
                }
            ],
        }

        # Pure white artwork (255, 255, 255)
        artwork = Image.new("RGB", (100, 100), (255, 255, 255))
        composite, _ = compose_reference_artwork(ref_img, artwork, plan, photorealistic=True)

        center_pixel = composite.getpixel((300, 300))
        # The clean white point must be preserved: must NOT be forced down to 222 grey slab
        self.assertGreater(center_pixel[0], 238)
        self.assertGreater(center_pixel[1], 238)
        self.assertGreater(center_pixel[2], 238)

    def test_ambient_lighting_does_not_create_spotlight_from_old_print(self):
        # Create a reference image where the old rug print has a bright white title box in the center
        # and dark black corners (the exact cause of the spotlight bug)
        ref_img = Image.new("RGB", (600, 600), (128, 128, 128))  # floor is neutral grey 128
        draw = ImageDraw.Draw(ref_img)
        # Old rug area (120..480, 120..480) is dark black
        draw.rectangle([120, 120, 480, 480], fill=(20, 20, 20))
        # Old white text box in center (240..360, 240..360)
        draw.rectangle([240, 240, 360, 360], fill=(255, 255, 255))

        plan = {
            "all_printable_surfaces_identified": True,
            "photorealistic": True,
            "surfaces": [
                {
                    "surface_id": "rug",
                    "geometry": "planar",
                    "confidence": 0.98,
                    "quad": [[200, 200], [800, 200], [800, 800], [200, 800]],
                    "polygon": [[200, 200], [800, 200], [800, 800], [200, 800]],
                    "protected_polygons": [],
                }
            ],
        }

        # Flat neutral grey artwork (160, 160, 160)
        artwork = Image.new("RGB", (100, 100), (160, 160, 160))
        composite, _ = compose_reference_artwork(ref_img, artwork, plan, photorealistic=True)

        center_val = composite.getpixel((300, 300))[0]
        corner_val = composite.getpixel((150, 150))[0]

        # In the old code, blurring the old print caused a huge luminance differential:
        # center would be bright white (~220+) and corners very dark (<120), diff > 80!
        # With the fix (sampling ambient from floor outside product), the variation must be subtle (< 18)
        lum_diff = abs(int(center_val) - int(corner_val))
        self.assertLess(lum_diff, 18, f"Artificial spotlight detected: center={center_val}, corner={corner_val}")

    # --- PILLAR 4: DIRECT, UNBIASED QA GATE ---

    def test_unbiased_qa_rejects_wrong_product_shape_or_orientation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 45,
                "product_shape_and_orientation_matched": False,  # Orientation violated
                "critical_content_preserved": True,
                "no_artificial_lighting_artifacts": True,
                "artwork_identity_preserved": True,
                "all_print_surfaces_replaced": True,
                "no_original_print_remaining": True,
            }

            with patch("trend_tool.printability._vision_pair_assessment", return_value=mock_assessment):
                decision = assess_direct_ai_mockup(
                    path,
                    path,
                    ProductTarget(name="rug", width_px=32, height_px=32),
                    backend="auto",
                    model="vision",
                    image_type="REFERENCE_TEMPLATE",
                    reference_template=Image.new("RGB", (32, 32), "green"),
                    edit_mask=Image.new("L", (32, 32), 255),
                )
                self.assertFalse(decision.accepted, "QA must reject when product shape/orientation is wrong")

    def test_unbiased_qa_rejects_covered_critical_content(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 40,
                "product_shape_and_orientation_matched": True,
                "critical_content_preserved": False,  # Child model / size chart covered
                "no_artificial_lighting_artifacts": True,
                "artwork_identity_preserved": True,
                "all_print_surfaces_replaced": True,
                "no_original_print_remaining": True,
            }

            with patch("trend_tool.printability._vision_pair_assessment", return_value=mock_assessment):
                decision = assess_direct_ai_mockup(
                    path,
                    path,
                    ProductTarget(name="rug", width_px=32, height_px=32),
                    backend="auto",
                    model="vision",
                    image_type="REFERENCE_TEMPLATE",
                    reference_template=Image.new("RGB", (32, 32), "green"),
                    edit_mask=Image.new("L", (32, 32), 255),
                )
                self.assertFalse(decision.accepted, "QA must reject when critical content is covered")

    def test_unbiased_qa_rejects_artificial_lighting_artifacts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 50,
                "product_shape_and_orientation_matched": True,
                "critical_content_preserved": True,
                "no_artificial_lighting_artifacts": False,  # Fake spotlight / vignette present
                "artwork_identity_preserved": True,
                "all_print_surfaces_replaced": True,
                "no_original_print_remaining": True,
            }

            with patch("trend_tool.printability._vision_pair_assessment", return_value=mock_assessment):
                decision = assess_direct_ai_mockup(
                    path,
                    path,
                    ProductTarget(name="rug", width_px=32, height_px=32),
                    backend="auto",
                    model="vision",
                    image_type="REFERENCE_TEMPLATE",
                    reference_template=Image.new("RGB", (32, 32), "green"),
                    edit_mask=Image.new("L", (32, 32), 255),
                )
                self.assertFalse(decision.accepted, "QA must reject when artificial lighting artifacts are present")

    def test_unbiased_qa_accepts_when_all_four_pillars_satisfied(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 95,
                "product_shape_and_orientation_matched": True,
                "critical_content_preserved": True,
                "no_artificial_lighting_artifacts": True,
                "artwork_identity_preserved": True,
                "all_print_surfaces_replaced": True,
                "no_original_print_remaining": True,
            }

            with patch("trend_tool.printability._vision_pair_assessment", return_value=mock_assessment):
                decision = assess_direct_ai_mockup(
                    path,
                    path,
                    ProductTarget(name="rug", width_px=32, height_px=32),
                    backend="auto",
                    model="vision",
                    image_type="REFERENCE_TEMPLATE",
                    reference_template=Image.new("RGB", (32, 32), "green"),
                    edit_mask=Image.new("L", (32, 32), 255),
                )
                self.assertTrue(decision.accepted, "QA must accept when all four pillars are satisfied")


if __name__ == "__main__":
    unittest.main()
