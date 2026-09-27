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
from trend_tool.product_render import add_product_drop_shadow, extract_product_canvas_from_reference
from trend_tool.reference_composite import (
    compose_reference_artwork,
    normalize_coordinates,
    normalize_surface_coordinates,
    order_quad_points,
)
from trend_tool.reference_surfaces import (
    PRE_CALIBRATED_TEMPLATES,
    _validate_plan,
    find_precalibrated_template,
    snap_quad_to_edges,
)
from trend_tool.template_mockup import (
    _build_fallback_surface_plan,
    _refine_surface_plan_for_full_bleed,
    build_direct_ai_mockup,
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
        # White point is graded to natural soft ivory (~230-242 RGB): not forced down to 222 grey slab or left at blinding 255
        self.assertGreaterEqual(center_pixel[0], 230)
        self.assertLessEqual(center_pixel[0], 242)
        self.assertGreaterEqual(center_pixel[1], 225)
        self.assertLessEqual(center_pixel[1], 242)
        self.assertGreaterEqual(center_pixel[2], 220)
        self.assertLessEqual(center_pixel[2], 242)

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

    def test_unbiased_qa_accepts_string_booleans_from_gemini(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            # Gemini often returns booleans as lowercase strings in relaxed JSON
            mock_assessment = {
                "listing_realism_score": 90,
                "product_shape_and_orientation_matched": "true",
                "critical_content_preserved": "true",
                "no_artificial_lighting_artifacts": "true",
                "artwork_identity_preserved": "true",
                "all_print_surfaces_replaced": "true",
                "no_original_print_remaining": "true",
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
                self.assertTrue(decision.accepted, "QA must accept string booleans ('true') from Gemini")

    def test_unbiased_qa_rejects_furniture_overlap_or_misalignment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 48,
                "product_shape_and_orientation_matched": True,
                "no_furniture_overlap_or_misalignment": False,
                "critical_content_preserved": True,
                "realistic_shading_and_depth": True,
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
                self.assertFalse(decision.accepted, "QA must reject when product overlaps or clips background furniture")

    def test_unbiased_qa_rejects_unshaded_flat_paper_sticker(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 40,
                "product_shape_and_orientation_matched": True,
                "no_furniture_overlap_or_misalignment": True,
                "critical_content_preserved": True,
                "realistic_shading_and_depth": False,
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
                self.assertFalse(decision.accepted, "QA must reject when product lacks realistic shading and looks like a flat paper sticker")

    def test_ambient_lighting_strictly_excludes_infographic_exclusion_zones(self):
        # Floor is neutral grey (128, 128, 128)
        ref_img = Image.new("RGB", (500, 500), (128, 128, 128))
        draw = ImageDraw.Draw(ref_img)
        # Adjacent graphic text banner (exclusion zone) at y: 50..150, x: 50..450 is pure white (255, 255, 255)
        draw.rectangle([50, 50, 450, 150], fill=(255, 255, 255))
        # Product is at y: 150..400, x: 100..400
        plan = {
            "all_printable_surfaces_identified": True,
            "photorealistic": True,
            "exclusion_zones": [[100, 100, 300, 900]],  # banner in norm 0..1000
            "surfaces": [
                {
                    "surface_id": "rug",
                    "geometry": "planar",
                    "confidence": 0.98,
                    "quad": [[200, 300], [800, 300], [800, 800], [200, 800]],
                    "polygon": [[200, 300], [800, 300], [800, 800], [200, 800]],
                    "protected_polygons": [],
                }
            ],
        }
        # Artwork with neutral grey 160
        artwork = Image.new("RGB", (100, 100), (160, 160, 160))
        composite, _ = compose_reference_artwork(ref_img, artwork, plan, photorealistic=True)
        # Verify ambient modulation on the artwork does not get distorted by the white banner
        top_art_val = composite.getpixel((250, 180))[0]
        bottom_art_val = composite.getpixel((250, 380))[0]
        diff = abs(int(top_art_val) - int(bottom_art_val))
        self.assertLess(diff, 15, f"Exclusion zone corrupted ambient lighting: diff={diff}")

    def test_normalize_surface_coordinates_persists_box_2d(self):
        box_2d = [400, 100, 600, 800]
        surface = {
            "quad": [[400, 100], [400, 800], [600, 800], [600, 100]],
            "polygon": [[400, 100], [400, 800], [600, 800], [600, 100]],
            "protected_polygons": [],
        }
        normalize_surface_coordinates(surface, box_2d)
        self.assertIn("box_2d", surface)
        self.assertEqual(surface["box_2d"], box_2d)

    def test_validate_plan_filters_scalloped_border_occluders(self):
        plan = {
            "all_printable_surfaces_identified": True,
            "surfaces": [
                {
                    "surface_id": "rug_surface",
                    "description": "Entire printable surface of rug",
                }
            ],
            "occluders": [
                {
                    "occluder_id": "child_feet",
                    "description": "Child sitting on the rug playing with blocks",
                },
                {
                    "occluder_id": "scalloped_rim",
                    "description": "Black decorative scalloped border around the edges",
                },
                {
                    "occluder_id": "border_doodles",
                    "description": "Graphic printed doodle border on the rim",
                },
            ],
        }
        surfaces = _validate_plan(plan)
        self.assertEqual(len(surfaces), 1)
        # Only genuine occluders (child feet) must remain; scalloped and doodle borders must be stripped
        remaining_ids = [occ["occluder_id"] for occ in plan["occluders"]]
        self.assertEqual(remaining_ids, ["child_feet"])

    def test_compose_reference_artwork_dilation_pixels_expands_mask(self):
        ref_img = Image.new("RGB", (200, 200), (0, 0, 0))
        art_img = Image.new("RGB", (50, 50), (255, 0, 0))
        # Base polygon is 80..120 (40x40 px)
        plan_no_dilation = {
            "all_printable_surfaces_identified": True,
            "surfaces": [
                {
                    "surface_id": "s1",
                    "geometry": "planar",
                    "confidence": 0.95,
                    "quad": [[400, 400], [600, 400], [600, 600], [400, 600]],
                    "polygon": [[400, 400], [600, 400], [600, 600], [400, 600]],
                    "protected_polygons": [],
                }
            ],
        }
        comp_normal, mask_normal = compose_reference_artwork(ref_img, art_img, plan_no_dilation)
        count_normal = np.count_nonzero(np.asarray(mask_normal))

        plan_dilated = {
            "all_printable_surfaces_identified": True,
            "surfaces": [
                {
                    "surface_id": "s1",
                    "geometry": "planar",
                    "confidence": 0.95,
                    "quad": [[350, 350], [650, 350], [650, 650], [350, 650]],
                    "polygon": [[400, 400], [600, 400], [600, 600], [400, 600]],
                    "protected_polygons": [],
                    "dilation_pixels": 10,
                }
            ],
        }
        comp_dilated, mask_dilated = compose_reference_artwork(ref_img, art_img, plan_dilated)
        count_dilated = np.count_nonzero(np.asarray(mask_dilated))
        self.assertGreater(count_dilated, count_normal)

    def test_extract_product_canvas_full_bleed_flat_goods(self):
        tpl = Image.new("RGB", (500, 500), (250, 250, 250))
        target = ProductTarget(name="rug", width_px=500, height_px=500, niche="wildflower classroom rug")
        # Even if cached/Gemini boxes suggest an inset surface box, flat products MUST be full-bleed (0, 0, w, h)
        fake_boxes = ([100, 100, 900, 900], [200, 200, 800, 800])
        canvas = extract_product_canvas_from_reference(tpl, target=target, cached_boxes=fake_boxes, backend="off")
        self.assertIsNotNone(canvas)
        self.assertEqual(canvas.surface_box[0], 0)
        self.assertEqual(canvas.surface_box[1], 0)
        self.assertEqual(canvas.surface_box[2], canvas.carrier_image.width)
        self.assertEqual(canvas.surface_box[3], canvas.carrier_image.height)

    def test_build_direct_ai_mockup_fallback_surface_plan_preserves_background(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            td = Path(temp_dir)
            art_p = td / "art.png"
            ref_p = td / "room.png"
            Image.new("RGB", (50, 50), (255, 0, 255)).save(art_p)
            Image.new("RGB", (300, 300), (50, 100, 150)).save(ref_p)
            target = ProductTarget(name="rug", width_px=300, height_px=300, niche="rug")

            with patch("trend_tool.template_mockup.assess_direct_ai_mockup") as mock_qa:
                from trend_tool.printability import PrintabilityDecision
                mock_qa.return_value = PrintabilityDecision("direct_ai_mockup", art_p, True, "acceptable", {}, {})
                # Call without client or analysis -> tests _build_fallback_surface_plan integration
                rec = build_direct_ai_mockup(
                    art_p,
                    td,
                    target,
                    backend="off",
                    model="test",
                    quality_model="test",
                    room_template=ref_p,
                )
                self.assertEqual(rec.status, "ok")
                self.assertEqual(rec.render_mode, "reference_composite")
                self.assertIsNotNone(rec.mockup_path)
                self.assertTrue(rec.mockup_path.exists())

    def test_unbiased_qa_rejects_shelf_or_furniture_overlap(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 45,
                "product_shape_and_orientation_matched": True,
                "no_furniture_overlap_or_misalignment": False,  # Cuts through wooden shelves
                "critical_content_preserved": True,
                "realistic_shading_and_depth": True,
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
                self.assertFalse(decision.accepted, "QA must reject when product overlaps shelves or furniture")

    def test_unbiased_qa_rejects_flat_paper_sticker_look(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "mockup.png"
            Image.new("RGB", (32, 32), "red").save(path)

            mock_assessment = {
                "listing_realism_score": 40,
                "product_shape_and_orientation_matched": True,
                "no_furniture_overlap_or_misalignment": True,
                "critical_content_preserved": True,
                "realistic_shading_and_depth": False,  # Looks like flat unshaded paper sticker
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
                self.assertFalse(decision.accepted, "QA must reject when product looks like flat paper sticker")

    def test_precalibrated_template_matching(self):
        # Match by filename
        match1 = find_precalibrated_template(Image.new("RGB", (100, 100)), filename="room_template_2.jpg")
        self.assertIsNotNone(match1)
        self.assertEqual(match1["quad"][0], [348.0, 415.0])
        self.assertEqual(match1["quad"][1], [665.0, 415.0])
        self.assertEqual(match1["quad"][2], [1000.0, 675.0])
        self.assertEqual(match1["quad"][3], [135.0, 960.0])

        match3 = find_precalibrated_template(Image.new("RGB", (100, 100)), filename="room_template_3.jpg")
        self.assertIsNotNone(match3)
        self.assertEqual(match3["quad"][0], [138.0, 45.0])
        self.assertEqual(match3["quad"][2], [882.0, 502.0])

    def test_snap_quad_to_edges(self):
        test_img = Image.new("RGB", (1000, 1000), (80, 80, 80))
        draw = ImageDraw.Draw(test_img)
        draw.polygon([(200, 200), (800, 200), (800, 800), (200, 800)], fill=(240, 240, 240))

        rough_quad = [[210.0, 195.0], [790.0, 205.0], [805.0, 795.0], [195.0, 805.0]]
        snapped = snap_quad_to_edges(test_img, rough_quad, [190, 190, 810, 810])
        self.assertAlmostEqual(snapped[0][0], 200.0, delta=5.0)
        self.assertAlmostEqual(snapped[0][1], 200.0, delta=5.0)
        self.assertAlmostEqual(snapped[2][0], 800.0, delta=5.0)
        self.assertAlmostEqual(snapped[2][1], 800.0, delta=5.0)

    def test_refine_surface_plan_full_bleed_clamps_polygon(self):
        # When quad expands to negative values, polygon must be clamped to [0, 1000]
        # and compose_reference_artwork must NOT raise ValueError("invalid normalized coordinates")
        plan = {
            "all_printable_surfaces_identified": True,
            "surfaces": [
                {
                    "surface_id": "rug",
                    "geometry": "planar",
                    "confidence": 0.99,
                    "quad": [[5.0, 5.0], [995.0, 5.0], [995.0, 995.0], [5.0, 995.0]],
                    "polygon": [[5.0, 5.0], [995.0, 5.0], [995.0, 995.0], [5.0, 995.0]],
                    "protected_polygons": [],
                }
            ],
        }
        _refine_surface_plan_for_full_bleed(plan, (1000, 1000), expansion_percent=0.05)
        # Quad can expand into negative coordinates
        self.assertLess(plan["surfaces"][0]["quad"][0][0], 0.0)
        # Polygon must be clamped to [0, 1000]
        self.assertGreaterEqual(plan["surfaces"][0]["polygon"][0][0], 0.0)

        # compose_reference_artwork should succeed without ValueError
        ref_img = Image.new("RGB", (100, 100), (120, 120, 120))
        art_img = Image.new("RGB", (50, 50), (255, 0, 0))
        comp, mask = compose_reference_artwork(ref_img, art_img, plan)
        self.assertIsNotNone(comp)
        self.assertIsNotNone(mask)

    def test_product_cutout_drop_shadow_and_clean_white_point(self):
        prod = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
        draw = ImageDraw.Draw(prod)
        draw.rounded_rectangle((20, 20, 180, 180), radius=16, fill=(255, 255, 255, 255))

        with_shadow = add_product_drop_shadow(prod, offset=(0, 4), blur_radius=6.0, shadow_opacity=0.3)
        self.assertEqual(with_shadow.mode, "RGBA")
        # Corner outside rounded rectangle and shadow must be transparent
        self.assertEqual(with_shadow.getpixel((0, 0))[3], 0)
        # Product body must be 100% opaque
        self.assertEqual(with_shadow.getpixel((100, 100))[3], 255)

        # On white background, shadow is smoothly composited onto pure #FFFFFF
        white_bg = Image.new("RGBA", (200, 200), (255, 255, 255, 255))
        white_bg.alpha_composite(with_shadow)
        self.assertEqual(white_bg.getpixel((0, 0)), (255, 255, 255, 255))
        # Shadow underneath product edge (e.g. at (100, 184)) darkens the white background naturally
        shadow_px = white_bg.getpixel((100, 184))
        self.assertLess(shadow_px[0], 255)
        self.assertGreater(shadow_px[0], 180)

    def test_compose_reference_artwork_softened_coverage_threshold(self):
        # When visible mask has ~91% coverage of quad (spills slightly outside by ~9%),
        # compose_reference_artwork must accept it and clip to quad without raising SURFACE_REVIEW_REQUIRED.
        ref_img = Image.new("RGB", (200, 200), (120, 120, 120))
        art_img = Image.new("RGB", (50, 50), (255, 0, 0))
        # Quad is [40, 40] to [160, 160] (area = 120*120 = 14400)
        # Polygon is [35, 40] to [165, 160] (area = 130*120 = 15600, overlap = 14400/15600 = 0.923)
        plan = {
            "all_printable_surfaces_identified": True,
            "surfaces": [
                {
                    "surface_id": "rug_test",
                    "geometry": "planar",
                    "confidence": 0.96,
                    "quad": [[200, 200], [800, 200], [800, 800], [200, 800]],
                    "polygon": [[175, 200], [825, 200], [825, 800], [175, 800]],
                    "protected_polygons": [],
                }
            ],
        }
        comp, mask = compose_reference_artwork(ref_img, art_img, plan)
        self.assertIsNotNone(comp)
        self.assertIsNotNone(mask)
        # Visible mask must be cleanly clipped to quad
        mask_arr = np.asarray(mask) > 0
        self.assertFalse(mask_arr[:, :38].any())
        self.assertFalse(mask_arr[:, 162:].any())

    def test_refine_surface_plan_polygon_arbitrary_length_and_missing(self):
        # Surface with missing polygon key
        plan_missing = {
            "surfaces": [
                {
                    "quad": [[10.0, 10.0], [990.0, 10.0], [990.0, 990.0], [10.0, 990.0]],
                }
            ]
        }
        _refine_surface_plan_for_full_bleed(plan_missing, (500, 500), expansion_percent=0.05)
        self.assertIn("polygon", plan_missing["surfaces"][0])
        self.assertGreaterEqual(plan_missing["surfaces"][0]["polygon"][0][0], 0.0)

        # Surface with polygon having >4 points (e.g. 5 points)
        plan_5pts = {
            "surfaces": [
                {
                    "quad": [[10.0, 10.0], [990.0, 10.0], [990.0, 990.0], [10.0, 990.0]],
                    "polygon": [[-15.0, 10.0], [500.0, -10.0], [1015.0, 10.0], [990.0, 990.0], [10.0, 990.0]],
                }
            ]
        }
        _refine_surface_plan_for_full_bleed(plan_5pts, (500, 500), expansion_percent=0.05)
        for pt in plan_5pts["surfaces"][0]["polygon"]:
            self.assertGreaterEqual(pt[0], 0.0)
            self.assertLessEqual(pt[0], 1000.0)
            self.assertGreaterEqual(pt[1], 0.0)
            self.assertLessEqual(pt[1], 1000.0)


if __name__ == "__main__":
    unittest.main()
