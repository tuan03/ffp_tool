from __future__ import annotations

import io
import json
import logging
import sys
import time
from pathlib import Path
from PIL import Image, ImageOps

from trend_tool.config import ProductTarget
from trend_tool.product_asset import create_gemini_client
from trend_tool.template_mockup import (
    analyze_reference_image,
    composite_infographic_hybrid,
    direct_ai_lifestyle_prompt,
    generate_direct_ai_lifestyle,
    template_pose_for_index,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
LOG = logging.getLogger("compare_experiment")


def run_experiment() -> dict[str, object]:
    base_dir = Path("data/pinterest_pod/output/run_20260924_113706")
    template_1_path = base_dir / "room_templates" / "room_template_1.jpg"
    template_2_path = base_dir / "room_templates" / "room_template_2.jpg"
    artwork_path = base_dir / "artwork_designs" / "custom_001_design.png"

    if not template_1_path.exists():
        raise FileNotFoundError(f"Template 1 not found: {template_1_path}")
    if not template_2_path.exists():
        raise FileNotFoundError(f"Template 2 not found: {template_2_path}")
    if not artwork_path.exists():
        raise FileNotFoundError(f"Artwork not found: {artwork_path}")

    out_dir = Path("data/pinterest_pod/output/experiment_infographic_comparison")
    out_dir.mkdir(parents=True, exist_ok=True)

    client = create_gemini_client("gemini_vertex")

    with Image.open(artwork_path) as opened:
        artwork = ImageOps.exif_transpose(opened).convert("RGB")

    with Image.open(template_1_path) as opened:
        tpl1 = ImageOps.exif_transpose(opened).convert("RGB")

    with Image.open(template_2_path) as opened:
        tpl2 = ImageOps.exif_transpose(opened).convert("RGB")

    target = ProductTarget(
        name="custom",
        width_px=4000,
        height_px=4000,
        dpi=300,
        prefer_cmyk=True,
        allow_custom_shape=True,
        rug_shape="rectangle",
        niche="leather bag",
    )

    results: dict[str, object] = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "templates": {},
    }

    test_cases = [
        ("template_1", tpl1, 1),
        ("template_2", tpl2, 2),
    ]

    for name, tpl_img, var_idx in test_cases:
        LOG.info("=== Starting evaluation for %s ===", name)
        pose = template_pose_for_index(target, var_idx, niche="leather bag")

        # 1. Analyze reference image
        t0 = time.time()
        analysis = analyze_reference_image(
            client,
            tpl_img,
            target,
            artwork=artwork,
            model="gemini-2.5-pro",
            cache_dir=out_dir / "cache",
        )
        t_analysis = time.time() - t0
        LOG.info("Analyzed %s in %.2fs. Title: %s, is_infographic: %s, is_plain_bg: %s",
                 name, t_analysis, analysis.get("scene_title"), analysis.get("is_infographic"), analysis.get("is_plain_background"))

        case_record: dict[str, object] = {
            "scene_title": analysis.get("scene_title"),
            "is_infographic": analysis.get("is_infographic"),
            "is_plain_background": analysis.get("is_plain_background"),
            "product_instances": analysis.get("product_instances"),
            "infographic_text_elements": analysis.get("infographic_text_elements"),
            "exclusion_zones": analysis.get("exclusion_zones"),
            "product_boxes": analysis.get("product_boxes_norm_0_1000"),
            "chrome_boxes": analysis.get("chrome_boxes_norm_0_1000"),
        }

        # 2. Run Approach 1 (Intelligent Hybrid)
        LOG.info("[%s] Generating Approach 1 (Intelligent Hybrid)...", name)
        t0 = time.time()
        gen_hybrid_base = generate_direct_ai_lifestyle(
            client,
            artwork,
            target,
            "gemini-2.5-flash-image",
            pose,
            room_template=tpl_img,
            reference_analysis=analysis,
            hybrid_mode=True,
        )
        c_boxes = analysis.get("chrome_boxes_norm_0_1000") or []
        p_boxes = analysis.get("product_boxes_norm_0_1000") or []
        approach1_img = composite_infographic_hybrid(
            tpl_img,
            gen_hybrid_base,
            chrome_boxes=c_boxes,
            product_boxes=p_boxes,
        )
        t_app1 = time.time() - t0
        app1_path = out_dir / f"approach1_{name}.png"
        app1_base_path = out_dir / f"approach1_{name}_base_precomposite.png"
        gen_hybrid_base.save(app1_base_path)
        approach1_img.save(app1_path)
        LOG.info("[%s] Saved Approach 1 to %s in %.2fs", name, app1_path.name, t_app1)

        case_record["approach1"] = {
            "image_path": str(app1_path.resolve()),
            "precomposite_path": str(app1_base_path.resolve()),
            "generation_time_s": round(t_app1, 2),
            "size": approach1_img.size,
        }

        # 3. Run Approach 2 (Pure AI End-to-End)
        LOG.info("[%s] Generating Approach 2 (Pure AI End-to-End)...", name)
        t0 = time.time()
        approach2_img = generate_direct_ai_lifestyle(
            client,
            artwork,
            target,
            "gemini-2.5-flash-image",
            pose,
            room_template=tpl_img,
            reference_analysis=analysis,
            hybrid_mode=False,
        )
        t_app2 = time.time() - t0
        app2_path = out_dir / f"approach2_{name}.png"
        approach2_img.save(app2_path)
        LOG.info("[%s] Saved Approach 2 to %s in %.2fs", name, app2_path.name, t_app2)

        case_record["approach2"] = {
            "image_path": str(app2_path.resolve()),
            "generation_time_s": round(t_app2, 2),
            "size": approach2_img.size,
        }

        results["templates"][name] = case_record

    manifest_path = out_dir / "comparison_results.json"
    manifest_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    LOG.info("Saved complete comparison results to %s", manifest_path)
    return results


if __name__ == "__main__":
    run_experiment()
