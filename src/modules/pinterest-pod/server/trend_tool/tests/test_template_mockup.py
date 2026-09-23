import unittest
from pathlib import Path
import sys

# Ensure trend_tool is importable
server_dir = Path(__file__).resolve().parent.parent.parent
if str(server_dir) not in sys.path:
    sys.path.insert(0, str(server_dir))

from PIL import Image
from trend_tool.config import ProductTarget
from trend_tool.template_mockup import (
    TemplatePose,
    _boxes_overlap,
    _normalize_boxes,
    composite_infographic_hybrid,
    detect_infographic_chrome_boxes,
    direct_ai_lifestyle_prompt,
)


class TestTemplateMockupRefactoring(unittest.TestCase):
    def setUp(self) -> None:
        self.target = ProductTarget(
            name="leather handbag",
            width_px=1000,
            height_px=1000,
            niche="handbag",
        )
        self.pose = TemplatePose(
            name="lifestyle_table",
            scene="wooden table with flowers",
            placement="on table",
            avoid="messy background",
        )
        self.product_box = [300, 200, 700, 800]  # ymin, xmin, ymax, xmax
        self.colliding_chrome = [250, 150, 350, 400]  # overlaps product
        self.safe_chrome = [50, 50, 150, 950]  # top header banner, no overlap

    def test_detect_infographic_chrome_boxes_returns_empty(self) -> None:
        """Requirement 1: Hardcoded yellow HSV detection must be eliminated."""
        yellow_img = Image.new("RGB", (300, 100), color=(255, 220, 0))
        result = detect_infographic_chrome_boxes(yellow_img)
        self.assertEqual(result, [])

    def test_boxes_overlap_detection(self) -> None:
        """Requirement 3: Bounding box collision detection must identify overlap correctly."""
        self.assertTrue(_boxes_overlap(self.product_box, self.colliding_chrome))
        self.assertFalse(_boxes_overlap(self.product_box, self.safe_chrome))

    def test_composite_infographic_hybrid_skips_colliding_boxes(self) -> None:
        """Requirement 3: Any chrome box overlapping with product area must be strictly skipped."""
        tpl = Image.new("RGB", (1000, 1000), color=(255, 255, 255))
        gen = Image.new("RGB", (1000, 1000), color=(0, 0, 0))

        result = composite_infographic_hybrid(
            tpl,
            gen,
            chrome_boxes=[self.colliding_chrome],
            product_boxes=[self.product_box],
        )

        # Since colliding_chrome overlaps with product_box, it must be skipped.
        # Generated image should remain untouched (black).
        px = result.getpixel((250, 300))
        self.assertEqual(px, (0, 0, 0))

    def test_composite_infographic_hybrid_allows_safe_boxes(self) -> None:
        """Safe non-colliding chrome boxes outside product area can be composited."""
        tpl = Image.new("RGB", (1000, 1000), color=(255, 255, 255))
        gen = Image.new("RGB", (1000, 1000), color=(0, 0, 0))

        result = composite_infographic_hybrid(
            tpl,
            gen,
            chrome_boxes=[self.safe_chrome],
            product_boxes=[self.product_box],
        )

        # Safe chrome box is at y=50..150, x=50..950. That region should have template white (255, 255, 255).
        px = result.getpixel((500, 100))
        self.assertEqual(px, (255, 255, 255))
        # Product area must remain original generated black (0, 0, 0)
        prod_px = result.getpixel((500, 500))
        self.assertEqual(prod_px, (0, 0, 0))

    def test_composite_infographic_hybrid_empty_boxes(self) -> None:
        """When chrome_boxes is empty or None, return resized generated image without modification."""
        tpl = Image.new("RGB", (1000, 1000), color=(255, 255, 255))
        gen = Image.new("RGB", (500, 500), color=(128, 128, 128))

        res1 = composite_infographic_hybrid(tpl, gen, chrome_boxes=[])
        self.assertEqual(res1.size, (1000, 1000))
        self.assertEqual(res1.getpixel((500, 500)), (128, 128, 128))

        res2 = composite_infographic_hybrid(tpl, gen, chrome_boxes=None)
        self.assertEqual(res2.size, (1000, 1000))
        self.assertEqual(res2.getpixel((500, 500)), (128, 128, 128))

    def test_direct_ai_lifestyle_prompt_lifestyle_room(self) -> None:
        """Requirement 4: For lifestyle rooms, ensure Imagen seamlessly renders product into room context."""
        analysis = {
            "scene_title": "Cozy Living Room Table",
            "visual_concept": "Handbag on oak coffee table with ceramic vase and flowers.",
            "is_infographic": False,
            "is_plain_background": False,
            "product_boxes_norm_0_1000": [self.product_box],
            "chrome_boxes_norm_0_1000": [],
            "product_form": "Structured leather satchel with rolled top handles",
            "external_chrome_to_preserve": "Oak table, vase, soft window light",
            "generation_directive": "Place the satchel naturally on the table.",
        }

        prompt = direct_ai_lifestyle_prompt(
            self.target,
            self.pose,
            "",
            has_room_template=True,
            reference_analysis=analysis,
        )

        self.assertIn("STRICT PHOTOGRAPHIC LIFESTYLE INTEGRATION MANDATE", prompt)
        self.assertIn("SEAMLESS LIFESTYLE PRESERVATION", prompt)
        self.assertIn("STRICT LIFESTYLE PRESERVATION", prompt)
        # Must NOT contain banner locks or text suppression
        self.assertNotIn("STRICT NO-TEXT-BANNER MANDATE", prompt)
        self.assertNotIn("DO NOT DRAW, RENDER, PAINT, OR HALLUCINATE ANY TEXT BANNERS", prompt)

    def test_direct_ai_lifestyle_prompt_infographic_template(self) -> None:
        """Requirement 4: For infographic templates, ensure instructions tell Imagen not to paint text in banner areas."""
        analysis = {
            "scene_title": "Handbag Spec Sheet",
            "visual_concept": "Handbag with feature callouts and banner on solid white background.",
            "is_infographic": True,
            "is_plain_background": True,
            "product_boxes_norm_0_1000": [self.product_box],
            "chrome_boxes_norm_0_1000": [self.safe_chrome],
            "product_form": "Structured leather satchel with rolled top handles",
            "external_chrome_to_preserve": "Clean white studio background",
            "generation_directive": "Display satchel on solid background.",
        }

        prompt = direct_ai_lifestyle_prompt(
            self.target,
            self.pose,
            "",
            has_room_template=True,
            reference_analysis=analysis,
        )

        self.assertIn("STRICT INFOGRAPHIC TEMPLATE PRESERVATION MANDATE", prompt)
        self.assertIn("STRICT NO-TEXT-BANNER MANDATE", prompt)
        self.assertIn("MUST NOT DRAW, RENDER, PAINT, OR HALLUCINATE ANY TEXT BANNERS", prompt)

    def test_normalize_boxes_edge_cases(self) -> None:
        """Test _normalize_boxes on invalid, empty, or boundary coordinates."""
        self.assertEqual(_normalize_boxes(None), [])
        self.assertEqual(_normalize_boxes([]), [])
        self.assertEqual(_normalize_boxes("invalid"), [])
        self.assertEqual(_normalize_boxes([1, 2, 3]), [])
        self.assertEqual(_normalize_boxes([[10, 20]]), [])
        # Out of bounds: coordinate > 1000 or negative
        self.assertEqual(_normalize_boxes([[-5, 0, 100, 200]]), [])
        self.assertEqual(_normalize_boxes([[0, 0, 1050, 500]]), [])
        # Inverted coordinates: ymin >= ymax or xmin >= xmax
        self.assertEqual(_normalize_boxes([[500, 100, 200, 800]]), [])
        self.assertEqual(_normalize_boxes([[100, 800, 500, 200]]), [])
        # Valid coords
        self.assertEqual(_normalize_boxes([[100, 200, 300, 400]]), [[100, 200, 300, 400]])

    def test_multiple_chrome_boxes_partial_collision(self) -> None:
        """When multiple chrome boxes exist, only the colliding ones are filtered out."""
        tpl = Image.new("RGB", (1000, 1000), color=(255, 255, 255))
        gen = Image.new("RGB", (1000, 1000), color=(0, 0, 0))

        safe_box_1 = [10, 10, 80, 990]  # top banner
        safe_box_2 = [920, 10, 990, 990]  # bottom footer
        colliding_box = [280, 190, 450, 500]  # collides with product [300, 200, 700, 800]

        result = composite_infographic_hybrid(
            tpl,
            gen,
            chrome_boxes=[safe_box_1, colliding_box, safe_box_2],
            product_boxes=[self.product_box],
        )

        # Both safe boxes should be composited (white)
        self.assertEqual(result.getpixel((500, 50)), (255, 255, 255))
        self.assertEqual(result.getpixel((500, 950)), (255, 255, 255))
        # Colliding box must NOT be composited (remains black)
        self.assertEqual(result.getpixel((250, 320)), (0, 0, 0))

    def test_lifestyle_scene_with_chromeboxes_remains_lifestyle(self) -> None:
        """If is_infographic is False, presence of chrome boxes does NOT trigger text banner suppression."""
        analysis = {
            "scene_title": "Street Style Handbag",
            "visual_concept": "Model holding handbag on city street.",
            "is_infographic": False,
            "is_plain_background": False,
            "product_boxes_norm_0_1000": [self.product_box],
            "chrome_boxes_norm_0_1000": [self.safe_chrome],  # e.g. accidental detection
            "product_form": "Structured leather satchel",
            "external_chrome_to_preserve": "Street background, sidewalk, natural daylight",
            "generation_directive": "Seamlessly render model holding bag on city street.",
        }

        prompt = direct_ai_lifestyle_prompt(
            self.target,
            self.pose,
            "",
            has_room_template=True,
            reference_analysis=analysis,
        )

        self.assertIn("STRICT PHOTOGRAPHIC LIFESTYLE INTEGRATION MANDATE", prompt)
        self.assertNotIn("STRICT NO-TEXT-BANNER MANDATE", prompt)

    def test_normalize_boxes_float_scale_0_to_1(self) -> None:
        """Normalized float coordinates in 0..1 must be scaled to 0..1000 integers."""
        float_boxes = [[0.27, 0.10, 0.55, 0.48], [0.63, 0.58, 0.91, 0.96]]
        normalized = _normalize_boxes(float_boxes)
        self.assertEqual(normalized, [[270, 100, 550, 480], [630, 580, 910, 960]])

    def test_normalize_boxes_dict_formats(self) -> None:
        """Dict formats with 'box_2d' or 'ymin/xmin/ymax/xmax' must be parsed and normalized."""
        dict_boxes = [
            {"box_2d": [100, 200, 300, 400]},
            {"ymin": 50, "xmin": 60, "ymax": 150, "xmax": 200},
            {"invalid": 123},
        ]
        normalized = _normalize_boxes(dict_boxes)
        self.assertEqual(normalized, [[100, 200, 300, 400], [50, 60, 150, 200]])

    def test_infographic_without_plain_bg_treated_as_lifestyle(self) -> None:
        """An image marked is_infographic=True on a non-plain background (e.g. room with circular swatch) must remain lifestyle."""
        analysis = {
            "scene_title": "Room Handbag with Swatch",
            "visual_concept": "Handbag on wooden table with circular swatch on wall.",
            "is_infographic": True,
            "is_plain_background": False,
            "product_boxes_norm_0_1000": [self.product_box],
            "chrome_boxes_norm_0_1000": [[40, 40, 240, 240]],
            "product_form": "Structured leather satchel",
            "external_chrome_to_preserve": "Wooden table, wall, circular swatch",
            "generation_directive": "Render handbag on table.",
        }
        prompt = direct_ai_lifestyle_prompt(
            self.target,
            self.pose,
            "",
            has_room_template=True,
            reference_analysis=analysis,
        )
        self.assertIn("STRICT PHOTOGRAPHIC LIFESTYLE INTEGRATION MANDATE", prompt)
        self.assertNotIn("STRICT NO-TEXT-BANNER MANDATE", prompt)

    def test_infographic_missing_plain_bg_defaults_to_false(self) -> None:
        """When is_plain_background is absent from reference_analysis, it must default to False (lifestyle scene)."""
        analysis = {
            "scene_title": "Table Handbag",
            "visual_concept": "Handbag on table.",
            "is_infographic": True,
            # is_plain_background omitted!
            "product_boxes_norm_0_1000": [self.product_box],
            "chrome_boxes_norm_0_1000": [self.safe_chrome],
            "product_form": "Structured leather satchel",
            "external_chrome_to_preserve": "Table",
            "generation_directive": "Render handbag on table.",
        }
        prompt = direct_ai_lifestyle_prompt(
            self.target,
            self.pose,
            "",
            has_room_template=True,
            reference_analysis=analysis,
        )
        self.assertIn("STRICT PHOTOGRAPHIC LIFESTYLE INTEGRATION MANDATE", prompt)
        self.assertNotIn("STRICT NO-TEXT-BANNER MANDATE", prompt)

    def test_infographic_empty_chrome_boxes_still_suppresses_text(self) -> None:
        """An infographic template with empty chrome_boxes still instructs Imagen not to paint text banners."""
        analysis = {
            "scene_title": "Clean Infographic Template",
            "visual_concept": "Product on solid white studio background.",
            "is_infographic": True,
            "is_plain_background": True,
            "product_boxes_norm_0_1000": [self.product_box],
            "chrome_boxes_norm_0_1000": [],  # no chrome boxes detected
            "product_form": "Structured leather satchel",
            "external_chrome_to_preserve": "Solid white studio background",
            "generation_directive": "Render product on solid white background.",
        }
        prompt = direct_ai_lifestyle_prompt(
            self.target,
            self.pose,
            "",
            has_room_template=True,
            reference_analysis=analysis,
        )
        self.assertIn("STRICT INFOGRAPHIC TEMPLATE PRESERVATION MANDATE", prompt)
        self.assertIn("STRICT NO-TEXT-BANNER MANDATE", prompt)
        self.assertIn("MUST NOT DRAW, RENDER, PAINT, OR HALLUCINATE ANY TEXT BANNERS", prompt)

    def test_composite_skips_colliding_with_float_product_boxes(self) -> None:
        """Collision detection works when product boxes are normalized floats in 0..1 scale."""
        tpl = Image.new("RGB", (1000, 1000), color=(255, 255, 255))
        gen = Image.new("RGB", (1000, 1000), color=(0, 0, 0))

        # Float product box: [0.3, 0.2, 0.7, 0.8] -> [300, 200, 700, 800]
        float_prod_box = [0.3, 0.2, 0.7, 0.8]
        result = composite_infographic_hybrid(
            tpl,
            gen,
            chrome_boxes=[self.colliding_chrome],  # [250, 150, 350, 400]
            product_boxes=[float_prod_box],
        )
        # Collision with float product box must be skipped (remain black)
        self.assertEqual(result.getpixel((250, 300)), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()

