from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys

server_dir = Path(__file__).resolve().parent.parent.parent
if str(server_dir) not in sys.path:
    sys.path.insert(0, str(server_dir))

import numpy as np
from PIL import Image, ImageDraw

from trend_tool.config import ProductTarget
from trend_tool.image_ops import (
    detect_artwork_layout_type,
    fit_centric_on_canvas,
    fit_to_target,
)
from trend_tool.product_render import (
    UniversalProductCanvas,
    add_leather_surface,
    extract_product_canvas_from_reference,
    get_or_create_universal_product_canvas,
    render_product_from_print,
    render_universal_product,
)
from trend_tool.template_mockup import inpaint_artwork_on_template


class TestUniversalPipeline(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    # --- Phase 1: Universal Semantic Product Canvas Tests ---

    def test_universal_product_canvas_leather_bag_no_rug_fringes(self) -> None:
        """Requirement: When niche='leather bag', product rendering must use UniversalProductCanvas,

        NOT falling back to a rug with rounded corners, fringe, or rug binding.
        """
        target = ProductTarget(
            name="custom",
            width_px=4000,
            height_px=4000,
            niche="leather bag",
        )
        print_path = self.work_dir / "artwork_print.png"
        prod_path = self.work_dir / "custom_001_product.png"
        mask_path = self.work_dir / "custom_001_mask.png"

        # Create dummy 1000x1000 artwork
        art = Image.new("RGBA", (1000, 1000), (200, 50, 50, 255))
        art.save(print_path)

        rec = render_product_from_print(
            source_path=print_path,
            print_path=print_path,
            product_path=prod_path,
            mask_path=mask_path,
            target=target,
            max_long_edge=900,
            backend="off",
        )

        self.assertEqual(rec.status, "ok")
        self.assertTrue(prod_path.exists())
        self.assertTrue(mask_path.exists())
        self.assertIn("leather bag", rec.notes)
        self.assertNotIn("rug", rec.notes)

        # Output shape should be custom carrier / synthetic bag, not rectangle or runner
        self.assertIn("carrier", rec.shape.lower())

    def test_universal_product_canvas_caching_and_carrier_reuse(self) -> None:
        """Requirement: Reuse this dynamic product canvas across all designs in the job so

        custom_001 through custom_005 share the exact same physical carrier, form factor, and resolution.
        """
        target = ProductTarget(
            name="custom",
            width_px=4000,
            height_px=4000,
            niche="leather bag",
        )
        canvas_cache: dict[str, object] = {}

        canvas1 = get_or_create_universal_product_canvas(
            target=target,
            reference_templates=None,
            canvas_cache=canvas_cache,
            max_long_edge=800,
            backend="off",
        )
        self.assertIsInstance(canvas1, UniversalProductCanvas)

        # Second call must retrieve the exact same cached canvas
        canvas2 = get_or_create_universal_product_canvas(
            target=target,
            reference_templates=None,
            canvas_cache=canvas_cache,
            max_long_edge=800,
            backend="off",
        )
        self.assertIs(canvas1, canvas2)

        # Rendering two different prints with the shared canvas
        art1 = Image.new("RGBA", (500, 500), (255, 0, 0, 255))
        art2 = Image.new("RGBA", (500, 500), (0, 0, 255, 255))

        prod1, mask1 = render_universal_product(art1, canvas1, target, max_long_edge=800)
        prod2, mask2 = render_universal_product(art2, canvas2, target, max_long_edge=800)

        # Carrier dimensions, mask size, and form factor must be identical
        self.assertEqual(prod1.size, prod2.size)
        self.assertEqual(mask1.size, mask2.size)

    def test_blanket_and_rug_rendering_preservation(self) -> None:
        """Blankets and rugs must preserve their specialized rendering behavior."""
        blanket_target = ProductTarget(name="blanket", width_px=2000, height_px=2000)
        rug_target = ProductTarget(name="rug", width_px=2000, height_px=2000, rug_shape="round")

        print_path = self.work_dir / "art.png"
        Image.new("RGBA", (500, 500), (100, 100, 100, 255)).save(print_path)

        rec_blanket = render_product_from_print(
            source_path=print_path,
            print_path=print_path,
            product_path=self.work_dir / "blanket_prod.png",
            mask_path=self.work_dir / "blanket_mask.png",
            target=blanket_target,
            max_long_edge=900,
        )
        self.assertIn("blanket", rec_blanket.notes)

        rec_rug = render_product_from_print(
            source_path=print_path,
            print_path=print_path,
            product_path=self.work_dir / "rug_prod.png",
            mask_path=self.work_dir / "rug_mask.png",
            target=rug_target,
            max_long_edge=900,
        )
        self.assertIn("rug", rec_rug.notes)

    # --- Phase 2: Template-Preserving Inpainting Tests ---

    def test_inpaint_artwork_on_template_preserves_background_and_banners(self) -> None:
        """Requirement: For reference templates, preserve 100% of the original image pixels

        (background, room, street, human model, text banners).
        Inpaint artwork strictly into the printable surface mask.
        """
        # Create a synthetic template (1000x1000):
        # - Top 150px: bright yellow banner with black text simulating "PRODUCT DISPLAY"
        # - Left margin 0..200: gray studio background
        # - Center 200..800: product area
        tpl = Image.new("RGB", (1000, 1000), (220, 220, 220))
        draw = ImageDraw.Draw(tpl)
        # Top banner: yellow (255, 215, 0)
        draw.rectangle((0, 0, 1000, 140), fill=(255, 215, 0))
        # Unique background pixel test in top-left banner
        tpl.putpixel((10, 10), (123, 45, 67))
        # Unique background pixel in outer margin
        tpl.putpixel((50, 500), (88, 99, 111))

        # New artwork: solid magenta
        artwork = Image.new("RGBA", (600, 600), (255, 0, 255, 255))
        target = ProductTarget(name="bag", width_px=1000, height_px=1000, niche="leather bag")

        # Mock reference analysis defining printable product surface box and chrome banner
        ref_analysis = {
            "product_boxes_norm_0_1000": [[200, 200, 800, 800]],
            "chrome_boxes_norm_0_1000": [[0, 0, 140, 1000]],
        }

        result = inpaint_artwork_on_template(
            client=None,
            artwork=artwork,
            template=tpl,
            target=target,
            reference_analysis=ref_analysis,
        )

        # 1. 100% pixel preservation of top banner outside product:
        self.assertEqual(result.getpixel((10, 10)), (123, 45, 67))
        self.assertEqual(result.getpixel((500, 70)), (255, 215, 0))

        # 2. 100% pixel preservation of background margin:
        self.assertEqual(result.getpixel((50, 500)), (88, 99, 111))

        # 3. Product printable surface center (x=500, y=500) has received the artwork:
        prod_pixel = result.getpixel((500, 500))
        # Shaded magenta: high R and B, low G
        self.assertGreater(prod_pixel[0], 100)
        self.assertLess(prod_pixel[1], 80)
        self.assertGreater(prod_pixel[2], 100)

    # --- Phase 3: Semantic Scale Normalization Tests ---

    def test_detect_artwork_layout_type_centric_vs_repeat(self) -> None:
        """Detect whether artwork is a centric illustration (hero graphic) or repeat pattern."""
        # 1. Centric illustration: solid white borders with graphic in the center
        centric_img = Image.new("RGB", (400, 400), (255, 255, 255))
        draw_c = ImageDraw.Draw(centric_img)
        draw_c.ellipse((100, 100, 300, 300), fill=(200, 20, 50))
        self.assertEqual(detect_artwork_layout_type(centric_img), "centric_illustration")

        # 2. Transparent border centric graphic
        trans_img = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
        draw_t = ImageDraw.Draw(trans_img)
        draw_t.rectangle((80, 80, 320, 320), fill=(50, 120, 200, 255))
        self.assertEqual(detect_artwork_layout_type(trans_img), "centric_illustration")

        # 3. Repeat pattern: noise/pattern running right through all borders
        np.random.seed(42)
        noise = np.random.randint(0, 256, (400, 400, 3), dtype=np.uint8)
        repeat_img = Image.fromarray(noise)
        self.assertEqual(detect_artwork_layout_type(repeat_img), "repeat_pattern")

    def test_fit_to_target_centric_illustration_preserves_motifs(self) -> None:
        """Requirement: Fitting a centric illustration onto target canvas with balanced margins

        so hero motifs are not arbitrarily cropped.
        """
        # A 400x800 portrait illustration (aspect ratio 1:2) with hero badge at (150, 100)
        img = Image.new("RGB", (400, 800), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        # Draw red badge near top edge (y=80..180)
        draw.ellipse((150, 80, 250, 180), fill=(255, 0, 0))
        src_path = self.work_dir / "centric_source.png"
        dst_path = self.work_dir / "fitted_centric.png"
        img.save(src_path)

        target = ProductTarget(name="bag", width_px=1000, height_px=1000)

        # In "cover" mode with auto_semantic_scale:
        fit_to_target(src_path, dst_path, target, mode="cover", auto_semantic_scale=True)

        with Image.open(dst_path) as fitted:
            # The canvas size is 1000x1000
            self.assertEqual(fitted.size, (1000, 1000))
            # The red badge must be preserved inside the canvas (not cropped out!)
            # In a contained 84% fit of 400x800 on 1000x1000:
            # height scales to ~840, width to ~420, centered at x=500, y=500
            # Red badge at relative y=80/800 = 0.10 -> canvas y ~ (500 - 420) + 84 = 164
            # We search for the red badge color:
            arr = np.asarray(fitted)
            red_pixels = (arr[..., 0] > 200) & (arr[..., 1] < 50) & (arr[..., 2] < 50)
            self.assertTrue(np.any(red_pixels), "Hero red motif was preserved and not cropped away!")

    def test_fit_centric_on_canvas_rgb_input_safe(self) -> None:
        """Regression test: Passing an RGB image to fit_centric_on_canvas must not raise ValueError: images do not match."""
        rgb_img = Image.new("RGB", (300, 300), (255, 255, 255))
        draw = ImageDraw.Draw(rgb_img)
        draw.ellipse((50, 50, 250, 250), fill=(20, 100, 220))
        result = fit_centric_on_canvas(rgb_img, (600, 600))
        self.assertEqual(result.size, (600, 600))
        self.assertEqual(result.mode, "RGBA")

    def test_inpaint_preserves_handles_when_instances_and_surfaces_present(self) -> None:
        """Requirement: Handles and hardware must not be painted over when inpainting on template."""
        tpl = Image.new("RGB", (1000, 1000), (200, 200, 200))
        ref_analysis = {
            "product_instances": [{"box_2d": [100, 100, 500, 500], "pose_and_presentation": "Front view"}],
            "product_boxes_norm_0_1000": [[200, 120, 480, 480]],
        }
        art = Image.new("RGBA", (500, 500), (0, 255, 0, 255))
        target = ProductTarget(name="custom", width_px=1000, height_px=1000, niche="leather bag")
        out = inpaint_artwork_on_template(None, art, tpl, target, ref_analysis)

        # Handle pixel at (x=300, y=150) must remain untouched background gray
        handle_pixel = out.getpixel((300, 150))
        self.assertEqual(handle_pixel, (200, 200, 200))

        # Surface pixel at (x=300, y=300) must receive the green artwork
        surface_pixel = out.getpixel((300, 300))
        self.assertGreater(surface_pixel[1], 150)

    def test_extract_product_canvas_handles_float_coordinates_robustly(self) -> None:
        """Regression test: Gemini Vision normalized float coordinates (0..1) must not collapse into a 0-size carrier."""
        import json

        tpl = Image.new("RGB", (1000, 1000), (240, 240, 240))
        target = ProductTarget(name="custom", width_px=1000, height_px=1000, niche="leather bag")

        class FakeClient:
            class models:
                @staticmethod
                def generate_content(*args, **kwargs):
                    class Res:
                        text = json.dumps({"carrier_box": [0.126, 0.01, 0.5, 0.498], "surface_box": [0.18, 0.04, 0.44, 0.46]})
                    return Res()

        canvas = extract_product_canvas_from_reference(tpl, target=target, client=FakeClient(), backend="mock")
        self.assertIsNotNone(canvas)
        self.assertGreater(canvas.carrier_image.width, 100)
        self.assertGreater(canvas.carrier_image.height, 100)
        self.assertGreater(canvas.surface_box[2], canvas.surface_box[0])
        self.assertGreater(canvas.surface_box[3], canvas.surface_box[1])

    def test_universal_product_canvas_reference_templates_override_rug_name(self) -> None:
        """Requirement: When reference templates exist, render_product_from_print must extract carrier from templates,

        even if target.name is 'rug' or 'blanket'.
        """
        art_p = self.work_dir / "art_rug_override.png"
        ref_p = self.work_dir / "ref_template.png"
        prod_p = self.work_dir / "prod_rug_override.png"
        mask_p = self.work_dir / "mask_rug_override.png"

        Image.new("RGBA", (500, 500), (255, 0, 0, 255)).save(art_p)
        Image.new("RGB", (1000, 1000), (240, 240, 240)).save(ref_p)
        target = ProductTarget(name="rug", width_px=1000, height_px=1000, niche="persian silk rug")

        rec = render_product_from_print(
            source_path=art_p,
            print_path=art_p,
            product_path=prod_p,
            mask_path=mask_p,
            target=target,
            reference_templates=[ref_p],
            backend="off",
        )
        self.assertIn("from reference templates", rec.notes)
        self.assertIn("carrier", rec.shape.lower())

    def test_extract_product_canvas_plain_background_transparency(self) -> None:
        """Requirement: Plain studio backgrounds should be made transparent so product cutout serves as clean standalone asset."""
        tpl = Image.new("RGB", (1000, 1000), (250, 250, 250))
        target = ProductTarget(name="custom", width_px=1000, height_px=1000, niche="leather bag")
        canvas = extract_product_canvas_from_reference(tpl, target=target, backend="off")
        self.assertIsNotNone(canvas)
        self.assertEqual(canvas.carrier_image.mode, "RGBA")
        corner_alpha = canvas.carrier_image.getpixel((0, 0))[3]
        self.assertEqual(corner_alpha, 0)


if __name__ == "__main__":
    unittest.main()
