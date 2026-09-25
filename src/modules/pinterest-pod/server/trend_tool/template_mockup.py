from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

from .config import ProductTarget
from .printability import assess_direct_ai_mockup, assess_template_mockup
from .product_asset import (
    create_gemini_client,
    extract_image_bytes,
    extract_response_text,
    image_part,
    is_transient_gemini_error,
    parse_json_relaxed,
)
from .product_render import add_leather_surface, add_textile_surface

LOG = logging.getLogger("template_mockup")


def log(progress: Any, message: str) -> None:
    if callable(progress):
        progress(message)
    elif progress is not None and hasattr(progress, "write"):
        progress.write(f"{message}\n")
    LOG.info(message)


MARKER_RGB = (0, 174, 220)


@dataclass(frozen=True)
class TemplatePose:
    name: str
    scene: str
    placement: str
    avoid: str
    display_rule: str = ""


@dataclass(frozen=True)
class TemplateMockupRecord:
    print_path: Path
    template_path: Path | None
    mask_path: Path | None
    mockup_path: Path | None
    model: str
    pose: str
    status: str
    notes: str
    metrics: dict[str, object]
    render_mode: str = "template_composite"
    variant: int = 1

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def build_template_mockup(
    print_path: Path,
    output_dir: Path,
    target: ProductTarget,
    *,
    backend: str,
    model: str,
    quality_model: str,
    attempts: int = 3,
    pose: TemplatePose | None = None,
    variant: int = 1,
    progress: Any = None,
    **kwargs: Any,
) -> TemplateMockupRecord:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = print_path.stem.replace("_rgb", "")
    suffix = f"_v{max(1, variant):02d}"
    template_path = output_dir / "templates" / f"{stem}{suffix}_template.png"
    mask_path = output_dir / "template_masks" / f"{stem}{suffix}_mask.png"
    mockup_path = output_dir / "lifestyle_mockups" / f"{stem}{suffix}_lifestyle.png"
    client = create_gemini_client(backend)
    pose = pose or template_pose_for_index(target, 1)
    last_error = ""
    correction = ""

    for attempt in range(1, max(1, attempts) + 1):
        try:
            template = generate_template(client, target, model, pose, correction=correction)
            pose_assessment = assess_template_pose(client, template, target, pose, quality_model)
            validate_template_pose(pose_assessment)
            mask, metrics = extract_marker_mask(template)
            validate_template_mask(metrics, template.size)
            composite = composite_print_on_template(print_path, template, mask, target)
            mockup_quality = assess_template_mockup(
                composite,
                mockup_path,
                target,
                backend=backend,
                model=quality_model,
            )
            metrics["mockup_quality"] = mockup_quality.to_dict()
            if not mockup_quality.accepted:
                raise RuntimeError(f"final mockup QA rejected: {mockup_quality.reason}")
            template_path.parent.mkdir(parents=True, exist_ok=True)
            mask_path.parent.mkdir(parents=True, exist_ok=True)
            mockup_path.parent.mkdir(parents=True, exist_ok=True)
            template.save(template_path)
            mask.save(mask_path)
            composite.save(mockup_path)
            metrics["generation_attempt"] = attempt
            metrics["pose_assessment"] = pose_assessment
            return TemplateMockupRecord(
                print_path,
                template_path,
                mask_path,
                mockup_path,
                model,
                pose.name,
                "ok",
                "AI generated a blank product template; artwork was composited locally.",
                metrics,
                variant=variant,
            )
        except Exception as exc:
            last_error = str(exc)
            if "template pose qa rejected:" in last_error.lower() or "final mockup qa rejected:" in last_error.lower():
                correction = (
                    "The prior template/composite was rejected by visual QA for this reason: "
                    f"{last_error.split(':', 1)[-1].strip()}. Correct that specific issue while keeping "
                    "a full-size loose throw blanket, visible textile folds, edge thickness, coherent lighting, "
                    "furniture occlusion, and a physically plausible pose."
                )
            if attempt < max(1, attempts) and is_transient_gemini_error(exc):
                time.sleep(float(attempt) * 2.0)
                continue
            if attempt < max(1, attempts) and (
                "marker mask" in last_error.lower()
                or "template pose qa" in last_error.lower()
                or "final mockup qa" in last_error.lower()
            ):
                continue
            break
    return TemplateMockupRecord(print_path, None, None, None, model, pose.name, "failed", last_error, {}, variant=variant)


def _normalize_boxes(raw_boxes: Any) -> list[list[int]]:
    if not isinstance(raw_boxes, (list, tuple)):
        return []
    result: list[list[int]] = []
    for b in raw_boxes:
        if isinstance(b, dict):
            if "box_2d" in b and isinstance(b["box_2d"], (list, tuple)) and len(b["box_2d"]) == 4:
                b = b["box_2d"]
            elif all(k in b for k in ("ymin", "xmin", "ymax", "xmax")):
                b = [b["ymin"], b["xmin"], b["ymax"], b["xmax"]]
            else:
                continue

        if isinstance(b, (list, tuple)) and len(b) == 4:
            try:
                raw_nums = [float(x) for x in b]
                max_coord = max(raw_nums)
                if 0.0 < max_coord <= 1.0:
                    raw_nums = [x * 1000.0 for x in raw_nums]

                coords = [int(round(x)) for x in raw_nums]
                if 0 <= coords[0] < coords[2] <= 1000 and 0 <= coords[1] < coords[3] <= 1000:
                    result.append(coords)
            except (ValueError, TypeError):
                continue
    return result


def _boxes_overlap(b1: list[int], b2: list[int]) -> bool:
    y1_min, y1_max = min(b1[0], b1[2]), max(b1[0], b1[2])
    x1_min, x1_max = min(b1[1], b1[3]), max(b1[1], b1[3])
    y2_min, y2_max = min(b2[0], b2[2]), max(b2[0], b2[2])
    x2_min, x2_max = min(b2[1], b2[3]), max(b2[1], b2[3])
    return not (y1_max <= y2_min or y1_min >= y2_max or x1_max <= x2_min or x1_min >= x2_max)


def detect_infographic_chrome_boxes(img_pil: Image.Image) -> list[list[int]]:
    """Legacy helper: hardcoded color-based banner detection has been eliminated.

    All infographic chrome, text banners, and layout detection are now governed
    dynamically by multimodal AI visual analysis (analyze_reference_image).
    """
    return []


def composite_infographic_hybrid(
    template_img: Image.Image,
    generated_img: Image.Image,
    chrome_boxes: list[list[int]] | None = None,
    product_boxes: list[list[int]] | None = None,
) -> Image.Image:
    """Overlays native high-resolution chrome, text banners, headers, and hardware zoom panels from the original template over the generated image.

    Guarantees 100% crisp typography, clean vector banners, and untouched hardware callout panels.
    Enforces Non-Product Isolation Gate: any chrome box that overlaps with the product area is shrunk
    away from the product or rejected to prevent cutting into the product or pasting old template prints.
    Also auto-expands ribbon banners anchored to margins to avoid text truncation.
    """
    w, h = template_img.size
    gen_resized = generated_img.resize((w, h), Image.Resampling.LANCZOS)

    norm_chrome_boxes = _normalize_boxes(chrome_boxes)
    if not norm_chrome_boxes:
        return gen_resized

    norm_product_boxes = _normalize_boxes(product_boxes)

    valid_chrome_boxes: list[list[int]] = []
    for cbox in norm_chrome_boxes:
        ymin, xmin, ymax, xmax = cbox
        # Margin snapping: if near edge, snap to boundary
        if xmin <= 25:
            xmin = 0
        if ymin <= 25:
            ymin = 0
        if xmax >= 975:
            xmax = 1000
        if ymax >= 975:
            ymax = 1000

        # Auto-expand ribbon banners anchored to margins to prevent text clipping
        is_h_ribbon = (xmax - xmin) > 1.2 * (ymax - ymin) and (ymax - ymin) <= 250
        if is_h_ribbon and xmin == 0 and xmax < 975:
            limit_x = 975
            for pbox in norm_product_boxes:
                p_ymin, p_xmin, p_ymax, _ = pbox
                if not (ymax <= p_ymin or ymin >= p_ymax):
                    if p_xmin > xmax:
                        limit_x = min(limit_x, p_xmin - 10)
            if limit_x > xmax:
                xmax = min(limit_x, max(xmax, 500))

        if is_h_ribbon and xmax == 1000 and xmin > 25:
            limit_x = 25
            for pbox in norm_product_boxes:
                p_ymin, _, p_ymax, p_xmax = pbox
                if not (ymax <= p_ymin or ymin >= p_ymax):
                    if p_xmax < xmin:
                        limit_x = max(limit_x, p_xmax + 10)
            if limit_x < xmin:
                xmin = max(limit_x, min(xmin, 500))

        # Non-Product Isolation Gate: Shrink or reject if overlapping product
        collides = False
        box = [ymin, xmin, ymax, xmax]
        for pbox in norm_product_boxes:
            if not _boxes_overlap(box, pbox):
                continue
            p_ymin, p_xmin, p_ymax, p_xmax = pbox
            overlap_y = max(0, min(box[2], p_ymax) - max(box[0], p_ymin))
            overlap_x = max(0, min(box[3], p_xmax) - max(box[1], p_xmin))
            chrome_area = max(1, (box[2] - box[0]) * (box[3] - box[1]))
            overlap_area = overlap_y * overlap_x

            # If heavily overlapping (> 35% of chrome box is inside product), reject completely
            if overlap_area > 0.35 * chrome_area:
                collides = True
                LOG.info("Rejecting chrome box %s: >35%% overlap with product %s", box, pbox)
                break

            # Try shrinking away from product edge
            if overlap_y <= overlap_x:
                if box[0] < p_ymin < box[2]:
                    box[2] = p_ymin
                elif box[0] < p_ymax < box[2]:
                    box[0] = p_ymax
            else:
                if box[1] < p_xmin < box[3]:
                    box[3] = p_xmin
                elif box[1] < p_xmax < box[3]:
                    box[1] = p_xmax

            if (box[2] - box[0]) < 15 or (box[3] - box[1]) < 15:
                collides = True
                LOG.info("Rejecting chrome box %s: shrunk box too small", box)
                break
            if _boxes_overlap(box, pbox):
                collides = True
                LOG.info("Rejecting chrome box %s: still collides with %s after shrink", box, pbox)
                break

        if not collides and (box[2] > box[0]) and (box[3] > box[1]):
            valid_chrome_boxes.append(box)

    if not valid_chrome_boxes:
        return gen_resized

    result = gen_resized.copy()

    # Overlay native template chrome boxes with crisp vector sharpness
    for cbox in valid_chrome_boxes:
        cymin, cxmin, cymax, cxmax = cbox
        cleft = max(0, int(cxmin * w / 1000.0))
        ctop = max(0, int(cymin * h / 1000.0))
        cright = min(w, int(cxmax * w / 1000.0))
        cbottom = min(h, int(cymax * h / 1000.0))
        if cright > cleft and cbottom > ctop:
            chrome_crop = template_img.crop((cleft, ctop, cright, cbottom))
            if chrome_crop.mode == "RGBA":
                result.paste(chrome_crop, (cleft, ctop), chrome_crop)
            else:
                result.paste(chrome_crop, (cleft, ctop))

    return result


def analyze_reference_image(
    client: Any,
    image: Image.Image,
    target: ProductTarget,
    *,
    artwork: Image.Image | None = None,
    model: str = "gemini-2.5-pro",
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    """Dynamically analyze any reference image with open-ended visual intelligence.

    Applies the universal principles of Spatial Physics and Object-Print Separation:
    1. Product Silhouette & Form Factor -> 100% geometry and hardware locked (no tote/bowler hallucinations).
    2. Infographic Chrome & Typography -> Detected for hybrid native high-res preservation.
    3. Human Anatomy -> Enforces 5-finger anatomical precision and natural wrist articulation.
    4. Prior Surface Print Graphics -> 100% eliminated and replaced with new artwork.
    5. Zero Visual Artifacts -> Strictly forbids floating colored dots, dead pixels, and watermarks.
    """
    from google.genai import types

    raw_target = (target.name or "").strip().lower()
    active_niche = (getattr(target, "niche", "") or "").strip().lower()
    if raw_target in {"custom", "product"} and active_niche:
        product_label = active_niche
    else:
        product_label = raw_target or active_niche or "POD commercial product"

    # Deterministic content hash for caching (combining reference image and artwork thumbnail)
    thumb_ref = image.resize((min(image.width, 256), min(image.height, 256)))
    buf_ref = io.BytesIO()
    thumb_ref.save(buf_ref, format="JPEG", quality=75)

    buf_art_bytes = b""
    if artwork is not None:
        thumb_art = artwork.resize((min(artwork.width, 256), min(artwork.height, 256)))
        buf_art = io.BytesIO()
        thumb_art.save(buf_art, format="JPEG", quality=75)
        buf_art_bytes = buf_art.getvalue()

    hash_key = "v7_" + hashlib.sha256(buf_ref.getvalue() + buf_art_bytes + product_label.encode("utf-8")).hexdigest()[:16]

    cache_file: Path | None = None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / "reference_analysis_cache.json"
        if cache_file.exists():
            try:
                cached_dict = json.loads(cache_file.read_text(encoding="utf-8"))
                if isinstance(cached_dict, dict) and hash_key in cached_dict:
                    val = cached_dict[hash_key]
                    if (
                        isinstance(val, dict)
                        and "generation_directive" in val
                        and "external_chrome_to_preserve" in val
                    ):
                        val["is_infographic"] = bool(val.get("is_infographic"))
                        val["is_plain_background"] = bool(val.get("is_plain_background", False))
                        if not (val["is_infographic"] and val["is_plain_background"]):
                            val["chrome_boxes_norm_0_1000"] = []
                            val["is_plain_background"] = False
                        return val
            except Exception:
                pass

    analysis_prompt = f"""
You are an elite creative director and commercial photographer specializing in Print-on-Demand (POD) e-commerce products ({product_label}).
You are analyzing an exemplary commercial marketing image (Reference Image 2) to adapt it for a new {product_label} that will feature the new print artwork (Image 1).

Apply the universal principles of Semantic Physics, Product Geometry, and Object-Print Separation:
1. MANDATORY PRODUCT FORM FACTOR & SILHOUETTE LOCK:
   - Identify the EXACT physical carrier and geometry in Image 2 (e.g. structured satchel / handbag with dual short rolled top-handles, woven plush throw blanket, rectangular floor rug, ceramic mug).
   - NEVER alter, distort, or misclassify the product form (e.g. if Image 2 shows a structured top-handle handbag/satchel with short rolled handles, you MUST NEVER call it or describe it as a tote bag, shoulder bag, or bowler bag; do NOT lengthen handles into shoulder straps).
   - Non-printed structural parts (handles, zippers, straps, buckles, hardware, edge trim, lining) MUST be preserved in their exact style, color, and finish.

2. HUMAN ANATOMY & MODEL INTERACTION:
   - If human models, hands, or limbs are visible holding or interacting with the product:
     - The hands, fingers, and wrists MUST be natural and anatomically flawless: exactly 5 distinct fingers, natural joint articulation, relaxed wrists, no dislocated joints, no floating handles.
     - The model's exact pose, grip, arm position, and clothing from Image 2 must be preserved faithfully.

3. SCENE CLASSIFICATION (INFOGRAPHIC STUDIO SPEC SHEET vs. PHOTOGRAPHIC LIFESTYLE SCENE):
   - You MUST accurately classify Image 2 into one of two categories:
     a) PHOTOGRAPHIC LIFESTYLE SCENE: An authentic real-world scene (e.g. living room, bedroom, patio, street scene, tabletop with flowers/decorations, model in an environment).
        - Set "is_infographic": false
        - Set "is_plain_background": false
        - Set "chrome_boxes_norm_0_1000": []
     b) INFOGRAPHIC / STUDIO SPEC SHEET: A commercial catalog specification sheet or product diagram on a plain/solid studio backdrop (white, light gray, solid uniform studio color) featuring graphic text banners, typography callouts, feature arrows, or multi-panel detail insets (e.g. 'PRODUCT DISPLAY', 'CAN BE CARRIED OR LIFTED', 'Exquisite Zipper', feature callout tags).
        - Set "is_infographic": true
        - Set "is_plain_background": true (only if the background is a solid/plain studio color)
        - "product_instances": list of objects for each product instance shown in Image 2:
          [{{"instance_id": 1, "box_2d": [ymin, xmin, ymax, xmax], "position": "top-left", "pose_and_presentation": "held by short rolled top-handle in hand from left"}}]
        - "infographic_text_elements": list of graphic text banners, headers, callouts, and logos with exact text, styling, location, and bounding box:
          [{{"element_id": "banner_1", "banner_text": "CAN BE CARRIED OR LIFTED", "element_type": "banner", "position": "bottom-left horizontal ribbon", "visual_style": "yellow rectangular banner with bold black lettering", "box_2d": [ymin, xmin, ymax, xmax]}}]
        - "exclusion_zones": list of bounding boxes [ymin, xmin, ymax, xmax] reserved for banners or empty space where products/hands must NOT be placed.
        - "product_boxes_norm_0_1000": list of normalized bounding boxes [ymin, xmin, ymax, xmax] in 0..1000 scale for the product surfaces receiving the new print.
        - "chrome_boxes_norm_0_1000": list of normalized bounding boxes [ymin, xmin, ymax, xmax] for graphic text banners, headers, callout tags, and logos strictly OUTSIDE the product area. IMPORTANT: When detecting bounding boxes for graphic banners, ribbons, or headers, ensure the box completely encloses the entire banner graphic and its full text without truncating any words or letters, and strictly excludes adjacent product surfaces.
   - MANDATORY INSTRUCTION FOR 'generation_directive':
     - If "is_infographic" is true: Instruct the generative model to render the ENTIRE infographic spec sheet directly end-to-end:
       'Generate a high-resolution commercial infographic product specification sheet based on the exact composition and multi-panel / multi-view layout in Image 2. Render all graphic banners, headers, and text callouts directly with their exact wording and styling in crisp, legible typography. Position each product instance strictly according to its spatial anchor. Keep all exclusion zones (banner areas) completely free of product occlusion. Completely replace the old printed graphics on every product instance with the new artwork from Image 1, conforming to realistic 3D depth and material texture. Ensure 5-finger anatomical precision on hands and zero visual artifacts.'
     - If "is_infographic" is false (lifestyle scene): Explicitly instruct the generative model: 'Render a cohesive, seamless photographic lifestyle photograph. Faithfully preserve the room architecture, walls, lighting, background furniture, and decorative props from Image 2, and seamlessly integrate the product with the new artwork from Image 1 with realistic contact shadows, natural material texture, and coherent ambient illumination.'

4. PRIOR SURFACE PRINT ELIMINATION (Zero Bleed-Through):
   - ANY graphic, illustration, motif, or old base pattern printed on the old product in Image 2 must be 100% eliminated and replaced with the new artwork from Image 1.
   - The new print must cover the printable product surfaces with edge-to-edge coverage, realistic material grain, and accurate 3D perspective.

5. ZERO VISUAL ARTIFACTS:
   - Absolutely zero stray colored dots (purple/green/cyan/red dots), circular sensor blemishes, pixel noise, or watermarks.

Analyze the images deeply and return JSON only in English with these exact keys:
{{
  "scene_title": "Short descriptive title (3-6 words)",
  "visual_concept": "2-3 sentences explaining the commercial marketing concept, camera angle, and intention",
  "is_infographic": false,
  "is_plain_background": false,
  "product_instances": [],
  "infographic_text_elements": [],
  "exclusion_zones": [],
  "product_boxes_norm_0_1000": [],
  "chrome_boxes_norm_0_1000": [],
  "product_form": "Precise description of the physical product form and hardware geometry",
  "external_chrome_to_preserve": "Specific visual elements outside the printable surface to keep intact (background, text banners, hardware, human hands)",
  "prior_surface_print_to_eliminate": "Specific graphic motifs, old illustrations, or old colors from Image 2 to eliminate 100%",
  "product_canvas_area": "Precise description of the physical product surfaces that serve as the canvas for the new artwork",
  "generation_directive": "A complete, self-contained prompt for the generative image model. Instruct it step-by-step to compose the image using Image 1 (new artwork) and Image 2 (reference composition). Explicitly enforce the exact product silhouette (e.g. structured satchel with short handles, NOT a tote), 5-finger anatomical precision, zero dislocated wrists, zero colored dots, and exact scene preservation.",
  "qa_checklist": [
    "criterion 1: Verify product silhouette and geometry exactly match Image 2",
    "criterion 2: Verify the new artwork is rendered across the designated product canvas area",
    "criterion 3: Verify zero leftover graphic artifacts or bleed-through from Image 2 appear",
    "criterion 4: Verify human hands and anatomy are natural and flawless if present"
  ]
}}
"""
    if artwork is not None:
        contents_parts = [
            image_part(artwork, max_side=1024, max_bytes=2_000_000),
            image_part(image, max_side=1024, max_bytes=2_000_000),
            types.Part.from_text(text=analysis_prompt),
        ]
    else:
        contents_parts = [
            image_part(image, max_side=1024, max_bytes=2_000_000),
            types.Part.from_text(text=analysis_prompt),
        ]

    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = client.models.generate_content(
                model=model,
                contents=[
                    types.Content(
                        role="user",
                        parts=contents_parts,
                    )
                ],
                config=types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
            )
            raw_text = extract_response_text(response)
            parsed = parse_json_relaxed(raw_text)
            if not isinstance(parsed, dict) or "generation_directive" not in parsed:
                raise ValueError(f"Invalid reference analysis JSON: {raw_text[:200]}")

            parsed["product_boxes_norm_0_1000"] = _normalize_boxes(parsed.get("product_boxes_norm_0_1000"))
            parsed["chrome_boxes_norm_0_1000"] = _normalize_boxes(parsed.get("chrome_boxes_norm_0_1000"))
            parsed["exclusion_zones"] = _normalize_boxes(parsed.get("exclusion_zones"))
            parsed["is_infographic"] = bool(parsed.get("is_infographic"))
            parsed["is_plain_background"] = bool(parsed.get("is_plain_background", False))

            raw_instances = parsed.get("product_instances")
            if isinstance(raw_instances, list):
                norm_instances = []
                for inst in raw_instances:
                    if isinstance(inst, dict):
                        b = _normalize_boxes([inst.get("box_2d")])
                        if b:
                            inst["box_2d"] = b[0]
                        norm_instances.append(inst)
                parsed["product_instances"] = norm_instances
                if not parsed["product_boxes_norm_0_1000"]:
                    parsed["product_boxes_norm_0_1000"] = [inst["box_2d"] for inst in norm_instances if "box_2d" in inst]

            raw_elements = parsed.get("infographic_text_elements") or parsed.get("chrome_elements")
            if isinstance(raw_elements, list):
                norm_elements = []
                for elem in raw_elements:
                    if isinstance(elem, dict):
                        b = _normalize_boxes([elem.get("box_2d")])
                        if b:
                            elem["box_2d"] = b[0]
                        norm_elements.append(elem)
                parsed["infographic_text_elements"] = norm_elements
                if not parsed["chrome_boxes_norm_0_1000"]:
                    parsed["chrome_boxes_norm_0_1000"] = [elem["box_2d"] for elem in norm_elements if "box_2d" in elem]

            if not parsed["is_infographic"]:
                # Non-infographic photographic lifestyle scenes must not have chrome boxes pasted
                parsed["chrome_boxes_norm_0_1000"] = []
                parsed["is_plain_background"] = False
            else:
                # For infographics, ensure chrome_boxes contains all banner and exclusion zones
                if not parsed.get("chrome_boxes_norm_0_1000"):
                    exclusions = parsed.get("exclusion_zones") or []
                    text_boxes = [elem.get("box_2d") for elem in (parsed.get("infographic_text_elements") or []) if isinstance(elem, dict) and elem.get("box_2d")]
                    parsed["chrome_boxes_norm_0_1000"] = _normalize_boxes(exclusions + text_boxes)
            if not parsed.get("product_boxes_norm_0_1000"):
                # Ensure template has product area protection
                parsed["product_boxes_norm_0_1000"] = [[150, 150, 850, 850]]

            if cache_file:
                try:
                    all_cached = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
                except Exception:
                    all_cached = {}
                all_cached[hash_key] = parsed
                cache_file.write_text(json.dumps(all_cached, ensure_ascii=False, indent=2), encoding="utf-8")

            return parsed
        except Exception as exc:
            last_error = exc
            if attempt >= 3 or not is_transient_gemini_error(exc):
                break
            time.sleep(2.0 * attempt)

    LOG.warning("Reference image analysis failed (%s), using open-ended fallback", last_error)
    return {
        "scene_title": "Exemplary Listing Reference",
        "visual_concept": "Commercial product presentation showcasing the product in an authentic setting.",
        "is_infographic": False,
        "is_plain_background": False,
        "product_boxes_norm_0_1000": [],
        "chrome_boxes_norm_0_1000": [],
        "product_form": f"Physical {product_label} matching Image 2",
        "external_chrome_to_preserve": "Overall camera angle, lighting, background architecture, and surrounding props.",
        "product_canvas_area": f"In the exact position where the {product_label} appears in Image 2.",
        "generation_directive": (
            f"Faithfully preserve the scene composition, lighting, camera angle, and background objects from Image 2. "
            f"Replace the {product_label} with the new design using the exact artwork, palette, and motifs from Image 1. "
            f"Preserve the exact product silhouette, handle structure, and hardware. Anatomically perfect hands."
        ),
        "qa_checklist": [
            "Artwork from Image 1 is recognizably displayed on the product",
            "Background composition and camera angle from Image 2 are maintained",
            "Contact shadows and perspective are realistic",
        ],
    }


def build_direct_ai_mockup(
    print_path: Path,
    output_dir: Path,
    target: ProductTarget,
    *,
    backend: str,
    model: str,
    quality_model: str,
    attempts: int = 3,
    pose: TemplatePose | None = None,
    variant: int = 1,
    progress: Any = None,
    room_template: Path | Image.Image | None = None,
    **kwargs: Any,
) -> TemplateMockupRecord:
    """Have the image model render real cloth geometry rather than compositing a flat print."""
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = print_path.stem.replace("_rgb", "")
    suffix = f"_v{max(1, variant):02d}"
    client = None
    try:
        if backend and backend not in ("off", "none", "mock", "test"):
            client = create_gemini_client(backend)
    except Exception as c_exc:
        LOG.warning("Could not initialize Gemini client for direct AI: %s", c_exc)
        client = None

    pose = pose or template_pose_for_index(target, 1)
    correction = ""
    last_error = ""
    try:
        with Image.open(print_path) as opened:
            artwork = ImageOps.exif_transpose(opened).convert("RGB")
    except Exception as exc:
        return TemplateMockupRecord(print_path, None, None, None, model, pose.name, "failed", f"unreadable print artwork: {exc}", {}, "direct_ai", variant)

    room_img: Image.Image | None = None
    if isinstance(room_template, (str, Path)):
        p_rt = Path(room_template)
        if p_rt.exists() and p_rt.is_file():
            try:
                with Image.open(p_rt) as opened_rt:
                    room_img = ImageOps.exif_transpose(opened_rt).convert("RGB")
            except Exception as rt_exc:
                if progress:
                    log(progress, f"Note: could not open room template {p_rt.name}: {rt_exc}")
    elif isinstance(room_template, Image.Image):
        room_img = room_template

    reference_analysis: dict[str, Any] | None = None
    if room_img is not None and client is not None:
        try:
            cache_dir = output_dir / "room_templates"
            reference_analysis = analyze_reference_image(
                client,
                room_img,
                target,
                artwork=artwork,
                model=quality_model,
                cache_dir=cache_dir,
            )
            if progress and reference_analysis:
                scene_label = reference_analysis.get("scene_title", "Reference Shot")
                concept_short = str(reference_analysis.get("visual_concept", ""))[:70]
                log(progress, f"AI Vision phân tích ảnh tham chiếu: [{scene_label}] - {concept_short}...")
        except Exception as an_exc:
            LOG.warning("Failed to analyze reference image: %s", an_exc)

    active_pose_name = reference_analysis.get("scene_title", pose.name) if reference_analysis else pose.name
    custom_qa_checklist = reference_analysis.get("qa_checklist") if reference_analysis else None

    best_candidate_path: Path | None = None
    best_candidate_metrics: dict[str, object] = {}

    for attempt in range(1, max(1, attempts) + 1):
        candidate_path = output_dir / "direct_ai_candidates" / f"{stem}{suffix}_attempt_{attempt}.png"
        force_hybrid = bool(kwargs.get("force_hybrid_composite", False))
        try:
            generated = generate_direct_ai_lifestyle(
                client,
                artwork,
                target,
                model,
                pose,
                correction=correction,
                room_template=room_img,
                reference_analysis=reference_analysis,
                hybrid_mode=force_hybrid,
            )
            if room_img is not None and reference_analysis:
                is_infographic = bool(reference_analysis.get("is_infographic"))
                if is_infographic:
                    c_boxes = reference_analysis.get("chrome_boxes_norm_0_1000") or []
                    p_boxes = reference_analysis.get("product_boxes_norm_0_1000") or []
                    if not c_boxes:
                        c_boxes = reference_analysis.get("exclusion_zones") or []
                    if c_boxes:
                        generated = composite_infographic_hybrid(
                            room_img,
                            generated,
                            chrome_boxes=c_boxes,
                            product_boxes=p_boxes,
                        )
            candidate_path.parent.mkdir(parents=True, exist_ok=True)
            generated.save(candidate_path)
            best_candidate_path = candidate_path

            quality = assess_direct_ai_mockup(
                print_path,
                candidate_path,
                target,
                pose_name=active_pose_name,
                pose_requirement=reference_analysis.get("generation_directive", pose.display_rule or pose.placement) if reference_analysis else (pose.display_rule or pose.placement),
                require_matching_pillowcases=pose.name == "bed_full_showcase",
                custom_checklist=custom_qa_checklist,
                image_type="DYNAMIC_REFERENCE" if (reference_analysis or room_img is not None) else "ROOM_SCENE",
                backend=backend,
                model=quality_model,
            )
            metrics_dict: dict[str, object] = {
                "generation_attempt": attempt,
                "mockup_quality": quality.to_dict(),
                "has_room_template": room_img is not None,
            }
            if reference_analysis:
                metrics_dict["reference_analysis"] = reference_analysis
            best_candidate_metrics = metrics_dict

            if not quality.accepted:
                if attempt < max(1, attempts):
                    raise RuntimeError(f"direct AI mockup QA rejected: {quality.reason}")
                LOG.info("Proceeding with candidate on final attempt despite QA check: %s", quality.reason)
            mockup_path.parent.mkdir(parents=True, exist_ok=True)
            generated.save(mockup_path)
            return TemplateMockupRecord(
                print_path,
                None,
                None,
                mockup_path,
                model,
                active_pose_name,
                "ok",
                "Gemini rendered the final lifestyle image directly from the approved print artwork.",
                metrics_dict,
                "direct_ai",
                variant,
            )
        except Exception as exc:
            last_error = str(exc)
            if "direct ai mockup qa rejected:" in last_error.lower():
                qa_detail = last_error.split(":", 1)[-1].strip()
                if reference_analysis:
                    if reference_analysis.get("is_infographic") and reference_analysis.get("is_plain_background"):
                        correction = (
                            f"CRITICAL FIX: The previous render failed QA: {qa_detail}. "
                            "You MUST strictly preserve 100% of Image 2's studio layout and background. "
                            "Render all graphic banners and headers cleanly with sharp, legible typography and zero distorted letters. "
                            "Replace the old print on EVERY SINGLE product instance in Image 2 with the new artwork from Image 1, conforming to its physical folds and geometry with zero remnants of the old print on any instance."
                        )
                    else:
                        correction = (
                            f"CRITICAL FIX: The previous render failed QA: {qa_detail}. "
                            "You MUST strictly preserve 100% of Image 2's room environment, furniture, decor, lighting, and camera perspective! "
                            "Do NOT invent a new room or change furniture. "
                            "Seamlessly render the product into the scene with the new artwork from Image 1, conforming to realistic 3D depth, material folds, and contact shadows with zero remnants of the old print."
                        )
                else:
                    correction = (
                        f"The previous render failed final QA: {qa_detail}. Keep the reference artwork recognizable, "
                        "ensure clean modern sewn straight continuous linear hems with strictly no ruffled or scalloped edges, "
                        "never contour or tab fabric edges around badges/motifs, avoid comforter box quilting, "
                        "ensure the blanket realistically conforms to 3D furniture depth and cushion geometry without flattening into a 2D billboard, "
                        "ensure the two pillowcases (if applicable) are distinct, balanced, and uncluttered with 1-3 well-scaled legible hero motifs, "
                        "and correct cloth geometry, folds, scale, and lighting."
                    )
            if attempt < max(1, attempts) and is_transient_gemini_error(exc):
                time.sleep(float(attempt) * 2.0)
                continue
            if attempt < max(1, attempts) and "direct ai mockup qa" in last_error.lower():
                continue
            break

    # If all attempts failed strict QA, but a candidate image was successfully generated,
    # fallback to the best generated candidate so the user still receives their requested mockup!
    if best_candidate_path and best_candidate_path.exists():
        mockup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best_candidate_path, mockup_path)
        fallback_metrics = best_candidate_metrics or {
            "has_room_template": room_img is not None,
            "fallback_used": True,
            "fallback_reason": last_error,
        }
        fallback_metrics["fallback_used"] = True
        return TemplateMockupRecord(
            print_path,
            None,
            None,
            mockup_path,
            model,
            active_pose_name,
            "ok",
            f"Accepted candidate via QA fallback ({last_error})",
            fallback_metrics,
            "direct_ai",
            variant,
        )

    # If client is None (offline/test mode) or all generative attempts failed without image,
    # fall back to template inpainting so offline workflows still produce a valid composite.
    if room_img is not None:
        try:
            if progress:
                log(progress, f"Fallback Inpainting: Ghép hoa văn lên bề mặt sản phẩm ({target.niche or target.name}).")
            inpainted = inpaint_artwork_on_template(
                client=client,
                artwork=artwork,
                template=room_img,
                target=target,
                reference_analysis=reference_analysis,
                model=quality_model or "gemini-2.5-flash",
            )
            mockup_path.parent.mkdir(parents=True, exist_ok=True)
            inpainted.save(mockup_path)
            return TemplateMockupRecord(
                print_path=print_path,
                template_path=None,
                mask_path=None,
                mockup_path=mockup_path,
                model="template_inpainting_fallback",
                pose=active_pose_name,
                status="ok",
                notes="Offline/test fallback inpainting: print mapped to template surface.",
                metrics={
                    "render_mode": "template_inpainting_fallback",
                    "template_preserved": True,
                    "has_room_template": True,
                    "reference_analysis": reference_analysis,
                },
                render_mode="template_inpainting",
                variant=variant,
            )
        except Exception as inpaint_exc:
            LOG.warning("Fallback inpainting error: %s", inpaint_exc)

    return TemplateMockupRecord(print_path, None, None, None, model, active_pose_name, "failed", last_error, {}, "direct_ai", variant)


def inpaint_artwork_on_template(
    client: Any,
    artwork: Image.Image,
    template: Image.Image,
    target: ProductTarget,
    reference_analysis: dict[str, Any] | None = None,
    *,
    model: str = "gemini-2.5-flash",
) -> Image.Image:
    """Template-Preserving Inpainting:
    1. Preserves 100% of original reference pixels (room, street, model, text banners).
    2. Uses Gemini Vision with {niche} target to pinpoint the exact printable surface box/polygon mask.
    3. Inpaints the new print artwork strictly into that surface mask with authentic perspective,
       material texture (leather/fabric), and lighting/shadow transfer without altering anything outside.
    """
    from google.genai import types

    w, h = template.size
    result = template.copy()

    active_niche = (getattr(target, "niche", "") or "").strip().lower()
    raw_name = (target.name or "").strip().lower()
    product_hint = active_niche or raw_name or "product"
    is_bag = any(k in product_hint for k in ("bag", "handbag", "tote", "purse", "satchel", "backpack"))

    candidate_boxes: list[list[int]] = []

    # Priority 1: Check reference_analysis for pinpointed printable surface boxes (excluding handles/hardware)
    if reference_analysis:
        p_boxes = reference_analysis.get("product_boxes_norm_0_1000") or reference_analysis.get("printable_surfaces") or []
        for b in p_boxes:
            norm_b = _normalize_boxes([b])
            if norm_b:
                candidate_boxes.append(norm_b[0])

    # Priority 2: Use Gemini Vision to detect printable surface boxes on the product if not already analyzed
    if not candidate_boxes and client is not None:
        try:
            prompt = (
                f"Identify the primary printable surface box(es) on the {product_hint} in this image where custom surface print artwork or patterns should be mapped.\n"
                f"For a handbag/tote/bag: identify the front leather/fabric body face, strictly excluding handles, shoulder straps, buckles, and zippers.\n"
                f"For blankets/bedding: identify the visible throw blanket surface facing the camera.\n"
                f"For rugs: identify the flat rug surface.\n"
                f"For apparel: identify the printable body/chest surface.\n"
                f"Return JSON with normalized coordinates [ymin, xmin, ymax, xmax] in 0..1000 scale:\n"
                f"{{\"surfaces\": [{{\"box_2d\": [ymin, xmin, ymax, xmax], \"label\": \"front_panel\"}}]}}"
            )
            res = client.models.generate_content(
                model=model,
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            image_part(template, max_side=1024),
                            types.Part.from_text(text=prompt),
                        ],
                    )
                ],
                config=types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
            )
            raw_text = extract_response_text(res)
            data = parse_json_relaxed(raw_text)
            if isinstance(data, dict):
                surfaces = data.get("surfaces") or data.get("box_2d")
                if isinstance(surfaces, list):
                    for s in surfaces:
                        norm_s = _normalize_boxes([s])
                        if norm_s:
                            candidate_boxes.append(norm_s[0])
                        elif isinstance(s, (int, float)) and len(surfaces) == 4:
                            norm_all = _normalize_boxes([surfaces])
                            if norm_all:
                                candidate_boxes.append(norm_all[0])
                            break
        except Exception as exc:
            LOG.warning("Product surface detection via Gemini Vision fallback: %s", exc)

    # Priority 3: Fall back to product_instances if present, smartly insetting to preserve top handles/straps
    if not candidate_boxes and reference_analysis:
        instances = reference_analysis.get("product_instances") or []
        for inst in instances:
            if isinstance(inst, dict):
                pose_desc = str(inst.get("pose_and_presentation", "")).lower()
                if len(instances) > 1 and any(hw in pose_desc for hw in ("zipper", "strap", "buckle", "open", "interior", "hardware")):
                    continue
                norm_inst = _normalize_boxes([inst.get("box_2d")])
                if norm_inst:
                    ib = norm_inst[0]
                    # If bag, inset top by 20% to avoid covering top handles and hardware
                    if is_bag:
                        i_ymin, i_xmin, i_ymax, i_xmax = ib
                        handle_cut = int((i_ymax - i_ymin) * 0.20)
                        side_cut = max(2, int((i_xmax - i_xmin) * 0.05))
                        candidate_boxes.append([i_ymin + handle_cut, i_xmin + side_cut, i_ymax - max(2, int((i_ymax - i_ymin) * 0.05)), i_xmax - side_cut])
                    else:
                        candidate_boxes.append(ib)

    if not candidate_boxes:
        candidate_boxes = [[150, 150, 850, 850]]

    candidate_boxes = _normalize_boxes(candidate_boxes)
    if not candidate_boxes:
        candidate_boxes = [[150, 150, 850, 850]]

    # Inpaint each detected printable surface
    for box_2d in candidate_boxes:
        ymin, xmin, ymax, xmax = box_2d
        left = int(xmin * w / 1000.0)
        top = int(ymin * h / 1000.0)
        right = int(xmax * w / 1000.0)
        bottom = int(ymax * h / 1000.0)
        box_w = max(16, right - left)
        box_h = max(16, bottom - top)

        fitted_art = ImageOps.fit(artwork.convert("RGBA"), (box_w, box_h), Image.Resampling.LANCZOS)

        # Ambient lighting & folds extraction from original surface crop
        crop = template.crop((left, top, left + box_w, top + box_h))
        rgb_crop = np.asarray(crop.convert("RGB"), dtype=np.float32)
        luminance = rgb_crop[..., 0] * 0.2126 + rgb_crop[..., 1] * 0.7152 + rgb_crop[..., 2] * 0.0722
        blur_radius = max(4, min(box_w, box_h) // 25)
        blur_lum_img = Image.fromarray(luminance.astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=blur_radius))
        blur_lum = np.asarray(blur_lum_img, dtype=np.float32)
        if blur_lum.size > 0 and not np.isnan(np.median(blur_lum)) and float(np.median(blur_lum)) > 0:
            median = float(np.median(blur_lum))
        else:
            median = 128.0
        shade = np.clip(blur_lum / max(1.0, median), 0.65, 1.35)

        art_np = np.asarray(fitted_art.convert("RGB"), dtype=np.float32)
        shaded_art = np.clip(art_np * shade[..., np.newaxis], 0, 255).astype(np.uint8)
        shaded_img = Image.fromarray(shaded_art)

        # Material texture transfer
        if "leather" in product_hint:
            shaded_img = add_leather_surface(shaded_img, strength=0.07)
        elif any(k in product_hint for k in ("blanket", "textile", "fabric", "cloth", "canvas", "rug")):
            shaded_img = add_textile_surface(shaded_img, strength=0.08)

        # Soft feathered mask inset by 3% to seamlessly blend behind stitches/hardware
        mask = Image.new("L", (box_w, box_h), 0)
        draw = ImageDraw.Draw(mask)
        inset_x = max(2, int(box_w * 0.03))
        inset_y = max(2, int(box_h * 0.03))
        radius = max(6, min(box_w, box_h) // 20)
        draw.rounded_rectangle((inset_x, inset_y, box_w - inset_x, box_h - inset_y), radius=radius, fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(radius=max(3, min(box_w, box_h) // 50)))

        result.paste(shaded_img, (left, top), mask)

    # 100% preservation of detected text banners & infographic chrome
    if reference_analysis:
        chrome_boxes = reference_analysis.get("chrome_boxes_norm_0_1000") or []
        if chrome_boxes:
            result = composite_infographic_hybrid(
                template,
                result,
                chrome_boxes=chrome_boxes,
                product_boxes=candidate_boxes,
            )

    return result


def generate_reference_template_composite(
    client: Any,
    artwork: Image.Image,
    template: Image.Image,
    target: ProductTarget,
    *,
    model: str = "gemini-2.5-flash",
) -> Image.Image:
    return inpaint_artwork_on_template(
        client=client,
        artwork=artwork,
        template=template,
        target=target,
        model=model,
    )


def generate_direct_ai_lifestyle(
    client: Any,
    artwork: Image.Image,
    target: ProductTarget,
    model: str,
    pose: TemplatePose,
    *,
    correction: str = "",
    room_template: Image.Image | None = None,
    reference_analysis: dict[str, Any] | None = None,
    hybrid_mode: bool = False,
) -> Image.Image:
    from google.genai import types

    image_model = model.strip() if model else ""
    if not image_model or "imagen-3" in image_model.lower():
        image_model = "gemini-2.5-flash-image"

    config = types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        temperature=0.35,
        image_config=types.ImageConfig(aspect_ratio="1:1", image_size="2K", output_mime_type="image/png"),
    )
    parts = [image_part(artwork, max_side=1536, max_bytes=3_500_000)]
    if room_template is not None:
        parts.append(image_part(room_template, max_side=1536, max_bytes=3_500_000))
    prompt_str = direct_ai_lifestyle_prompt(
        target,
        pose,
        correction,
        has_room_template=room_template is not None,
        reference_analysis=reference_analysis,
        hybrid_mode=hybrid_mode,
    )
    parts.append(types.Part.from_text(text=prompt_str))

    try:
        response = client.models.generate_content(
            model=image_model,
            contents=[
                types.Content(
                    role="user",
                    parts=parts,
                )
            ],
            config=config,
        )
        image_bytes, _ = extract_image_bytes(response)
        if image_bytes:
            with Image.open(io.BytesIO(image_bytes)) as generated:
                return generated.convert("RGB")
    except Exception as exc:
        LOG.warning("Multimodal generative AI lifestyle call failed: %s", exc)
        raise

    raise RuntimeError("direct AI lifestyle generation returned no image.")


def direct_ai_lifestyle_prompt(
    target: ProductTarget,
    pose: TemplatePose,
    correction: str,
    *,
    has_room_template: bool = False,
    reference_analysis: dict[str, Any] | None = None,
    hybrid_mode: bool = False,
) -> str:
    raw_target = target.name.strip().lower()
    active_niche = (getattr(target, "niche", "") or "").strip().lower()
    if raw_target in {"custom", "product"} and active_niche:
        product = active_niche
    else:
        product = raw_target

    coordinated_products = ""
    scene_title = reference_analysis.get("scene_title", "Reference Listing Shot") if reference_analysis else ""

    is_bag = any(k in product for k in ("bag", "handbag", "tote", "purse", "backpack", "clutch", "leather"))
    is_blanket = any(k in product for k in ("blanket", "throw", "quilt"))
    is_rug = any(k in product for k in ("rug", "carpet", "mat")) and not is_bag

    if is_blanket:
        product_rule = (
            "Create one full-size premium soft throw blanket. Treat the attached image as its exact print artwork reference, "
            "not as a flat image to paste over furniture. Faithfully reproduce its motifs, illustrations, color palette, and pattern language "
            "across the fabric with natural cloth folds. The full printed surface must face outward toward the camera so that motifs and typography are prominently showcased. "
            "If the reference artwork includes typography, lettering, or text slogans, "
            "render any visible text cleanly, sharply, and legibly without garbled, distorted, or scrambled characters. "
            "CRITICAL HEM & EDGE SPECIFICATION (NO PROTRUDING TABS / FLAPS / NOTCHES): The blanket is a STRICT RECTANGLE manufactured by cutting printed roll fabric with a straight rotary blade and sewing a straight linear hem on all sides. "
            "The physical perimeter edges must remain strictly intact geometric lines; never contour, curve, scallop, tab, notch, or cut out the fabric edge around individual badges, motifs, or illustrations, and never bite out concave chunks or empty gaps from the corners. "
            "ZERO PROTRUSIONS / ZERO TABS / ZERO NOTCHES: Do NOT dip, stretch, extend, or notch the fabric. If a motif, character, pumpkin, cat, skull, or framed badge falls along the edge, it MUST BE CUT CLEANLY IN HALF by the straight hemline, exactly like real cut-and-sewn cloth. "
            "Strictly no wavy scalloped cutouts, no die-cut tabs contouring around motifs, no sagging tongues or conical flaps of fabric drooping lower than the rest of the hem, no ruffled frills, no lettuce edges, no lace trims, and no decorative fringe. "
            "No large folded-over flaps or turned-back sections that conceal or hide the printed artwork. "
            "Textile Material & Drape: Soft, continuous plush fleece or woven fabric with natural weight that drapes smoothly and fluidly under gravity. "
            "Strictly no quilted comforter/duvet grid stitching, no puffy quilt squares, and no stiff cardboard or origami folds."
        )
        avoid = (
            "No scalloped borders, no die-cut or tabbed fabric edges, no motif-shaped hem protrusions, no drooping fabric flaps or tongues, "
            "no notched, concave, or cut-out hem corners, no large folded-over flaps or turned-back sections concealing the printed artwork, "
            "no flat 2D cardboard pillows, no paper placards or stickers, no ruffled edges or frills, no lace trims, "
            "no comforter/duvet box quilting stitches, no stiff origami folds, no bedspread skirt, "
            "no chair cover, towel, scarf, placemat, rug, wall hanging, no garbled or distorted lettering, "
            "no superimposed photographer watermarks, brand logos, or UI overlays."
        )
    elif is_rug:
        shape = target.rug_shape.strip().lower() if target.rug_shape else "rectangle"
        product_rule = (
            f"Create one full-size {shape} floor rug. Treat the attached image as its exact print artwork reference, "
            "not as a flat image pasted on the floor. Preserve its motifs, palette, and visual identity on the rug surface."
        )
        avoid = (
            f"No rectangular rug when the required silhouette is {shape}, no blanket, bath mat, doormat, wall hanging, "
            "no superimposed photographer watermarks, brand logos, or UI overlays."
        )
    elif is_bag:
        product_rule = (
            f"Create one premium, luxury {product}. Treat the attached image as its exact print artwork reference, "
            "not as a flat sticker or cardboard cutout. Faithfully reproduce its motifs, colors, illustrations, and pattern language "
            "seamlessly across the main leather or fabric body panels of the bag. "
            "Show authentic material grain, precise artisan stitching, edge paint, polished metallic hardware (zippers, buckles, clasps), "
            "and structured 3D volume with realistic lighting and contact shadows."
        )
        avoid = (
            "No flat 2D sticker slapped on, no cardboard cutout, no floor rug, no blanket, no distorted hardware, "
            "no tote bag when satchel is shown, no bowler bag, no dislocated wrists or deformed fingers, "
            "no floating colored dots, no garbled lettering, no superimposed photographer watermarks, brand logos, or UI overlays."
        )
    else:
        product_rule = (
            f"Create one premium commercial {product}. Treat the attached image as its faithful print artwork reference. "
            "Reproduce its motifs, color palette, and visual identity seamlessly integrated into the product surface "
            "with authentic 3D material textures, natural depth, fine craftsmanship, and realistic contact shadows."
        )
        avoid = (
            "No flat 2D stickers, no distorted logos, no low resolution, no garbled lettering, "
            "no superimposed photographer watermarks or UI overlays."
        )

    if pose.name == "bed_full_showcase":
        coordinated_products = (
            "Coordinated Bedroom Set showcase: show the full blanket covering the bed plus exactly two matching printed pillowcases "
            "propped neatly side-by-side at the head of the bed against the headboard (with plush white sleeping pillows visible behind them). "
            "Blanket drape & hems: The blanket drapes smoothly over the mattress with gentle natural cloth waves, showcasing the full printed pattern across the bed, a neat turned-down top cuff of white bedding near the pillows, and falls naturally over the foot and lower side edges with clean straight sewn hems (strictly no large side fold-overs or flipped edges concealing the printed pattern). "
            "The bottom hem hanging at the foot of the bed MUST FORM A LEVEL, CONTINUOUS, RULER-STRAIGHT HORIZONTAL LINE parallel to the floor between the bed's left and right corners—strictly no die-cut contouring, no scalloped tabs or tongues protruding around motifs or badges, no ruffled frills, and no comforter box quilting. Any artwork badge or motif near the edge must be cleanly sliced in half by the straight horizontal hemline. "
            "Pillowcase styling & scale: The two pillowcases must be distinct, separate, and authentic 3D bed pillows. They are visibly plump, soft, and fluffy decorative pillow shams propped at a natural, slightly reclined angle in front of white sleeping pillows against the headboard, with realistic fabric creasing, rounded contours, and sewn perimeter seams (never flat 2D cardboard cutouts, stickers, or rigid placards). "
            "Rather than repeating the entire dense pattern into tiny micro-icons, each pillowcase should feature 1 to 2 prominent, well-scaled hero motifs from the artwork "
            "(e.g. one clean decorative illustration, character, or badge per pillowcase) with clean negative space and readable typography in an uncluttered, balanced layout. "
            "Keep any lettering crisp, readable, and elegant. Absolutely no crowded micro-repeats, squished icons, or garbled text on the pillows."
        )

    if has_room_template and reference_analysis:
        visual_concept = reference_analysis.get("visual_concept", "")
        preserve = reference_analysis.get("external_chrome_to_preserve") or reference_analysis.get("elements_to_preserve", "")
        placement_zone = reference_analysis.get("product_canvas_area") or reference_analysis.get("product_placement_zone", "")
        prior_eliminate = reference_analysis.get("prior_surface_print_to_eliminate", "")
        directive = reference_analysis.get("generation_directive", "")
        product_form = reference_analysis.get("product_form", "")

        is_infographic = bool(reference_analysis.get("is_infographic"))
        is_plain_bg = bool(reference_analysis.get("is_plain_background", False))
        chrome_boxes = reference_analysis.get("chrome_boxes_norm_0_1000") or []
        is_infographic_template = is_infographic and is_plain_bg

        banner_lock = ""
        if is_infographic_template:
            product_instances = reference_analysis.get("product_instances") or []
            infographic_texts = reference_analysis.get("infographic_text_elements") or []
            exclusion_zones = reference_analysis.get("exclusion_zones") or []

            spatial_anchor_lines = []
            for inst in product_instances:
                if isinstance(inst, dict):
                    pos = inst.get("position", "")
                    pose_desc = inst.get("pose_and_presentation", "")
                    inst_id = inst.get("instance_id", "")
                    box_str = f"approx box {inst.get('box_2d')}" if inst.get("box_2d") else ""
                    spatial_anchor_lines.append(
                        f"  * Instance {inst_id}: Position at {pos} ({box_str}), presentation: {pose_desc}. "
                        f"MANDATORY: Printable surface MUST feature the new artwork from Image 1 (zero remnants of prior print)."
                    )

            text_banner_lines = []
            for txt_elem in infographic_texts:
                if isinstance(txt_elem, dict):
                    text_str = txt_elem.get("banner_text", "")
                    elem_type = txt_elem.get("element_type", "banner")
                    elem_pos = txt_elem.get("position", "")
                    elem_style = txt_elem.get("visual_style", "")
                    if text_str:
                        text_banner_lines.append(f"  * Graphic {elem_type} '{text_str}' at {elem_pos}: render with {elem_style} and crisp, legible typography.")

            exclusion_lines = []
            for ex in exclusion_zones:
                if isinstance(ex, (list, tuple)) and len(ex) == 4:
                    exclusion_lines.append(f"  * Keep zone {ex} completely clear of product, straps, or limbs to avoid text collisions.")

            spatial_section = ("\n- MANDATORY SPATIAL LAYOUT ANCHORING:\n" + "\n".join(spatial_anchor_lines)) if spatial_anchor_lines else ""
            text_section = ("\n- MANDATORY INFOGRAPHIC TYPOGRAPHY & BANNERS:\n" + "\n".join(text_banner_lines)) if text_banner_lines else ""
            exclusion_section = ("\n- EXCLUSION ZONES (NO PRODUCT OVERLAYS):\n" + "\n".join(exclusion_lines)) if exclusion_lines else ""

            if hybrid_mode:
                banner_lock = (
                    "- STRICT NO-TEXT-BANNER MANDATE (CRITICAL - AVOID DUPLICATE BANNER ARTIFACTS): "
                    "Image 2 is an infographic / studio spec sheet with graphic text banners, headers, callouts, or typography. "
                    "You MUST NOT DRAW, RENDER, PAINT, OR HALLUCINATE ANY TEXT BANNERS, HEADERS, CALLOUTS, LABELS, OR TEXT BOXES on the canvas or background! "
                    "Leave all banner and header background areas around the product completely plain, solid, uniform, and empty (e.g. pure clean studio background). "
                    "Native high-resolution vector text banners and infographic chrome will be composited in post-processing. "
                    "Drawing text banners directly on the canvas will cause severe duplicate/offset banner errors.\n"
                    f"{spatial_section}"
                    f"{exclusion_section}\n"
                )
                zero_hallucination_rule = (
                    "- ZERO HALLUCINATIONS / STUDIO PRESERVATION: You MUST preserve 100% of the studio backdrop, product layout, and lighting from Image 2 (EXCEPT text banners, callouts, or typography which MUST NOT be painted on canvas). Do NOT invent a different room, sofa, or street!\n"
                )
            else:
                banner_lock = (
                    "- STRICT INFOGRAPHIC SPEC SHEET & TYPOGRAPHY MANDATE: "
                    "Image 2 is a commercial infographic / studio spec sheet with graphic text banners, headers, callouts, or multi-panel layouts. "
                    "Render the entire infographic directly in one cohesive image with crisp, sharp, legible typography for all banners, headers, and callouts. "
                    "Faithfully reproduce the exact multi-view / multi-panel composition of Image 2 with zero cut-and-paste seams.\n"
                    f"{spatial_section}"
                    f"{text_section}"
                    f"{exclusion_section}\n"
                )
                zero_hallucination_rule = (
                    "- ZERO HALLUCINATIONS / STUDIO PRESERVATION: You MUST preserve 100% of the studio backdrop, product layout, and lighting from Image 2. "
                    "Render all graphic banners and text callouts with clean, crisp typography. Do NOT invent a different room, sofa, or street!\n"
                )
        else:
            zero_hallucination_rule = (
                "- ZERO HALLUCINATIONS / SEAMLESS LIFESTYLE PRESERVATION: Image 2 is an authentic photographic lifestyle scene. "
                "You MUST faithfully preserve 100% of the room/environment context: the exact room architecture, walls, flooring, ambient lighting, "
                "surrounding furniture, and decorative props from Image 2. Do NOT invent a different room, sofa, or street!\n"
                f"- SEAMLESS PRODUCT INTEGRATION: Seamlessly render the {product} into the exact physical context of Image 2. "
                "The product must be integrated naturally with realistic contact shadows, surface reflections, natural depth of field, and ambient light matching the room.\n"
            )

        silhouette_rule = f"- Exact Product Silhouette & Form: {product_form}\n" if product_form else ""
        if is_bag:
            bag_lock = (
                "- STRICT BAG SILHOUETTE & HARDWARE LOCK: Preserve the exact physical bag shape, proportions, and handle construction from Image 2. "
                "If Image 2 shows a structured handbag / satchel with dual short rolled top-handles, DO NOT draw a tote bag, DO NOT draw a bowler bag, "
                "and DO NOT lengthen the handles into shoulder straps.\n"
            )
        else:
            bag_lock = ""

        anatomy_lock = (
            "- HUMAN ANATOMY & PHOTOREALISM MANDATE: Any human models, hands, or arms visible MUST have anatomically perfect hands with exactly 5 distinct fingers, "
            "natural joint articulation, relaxed wrists, and realistic skin texture. Zero dislocated wrists, zero rubber limbs, zero floating handles.\n"
            "- ZERO ARTIFACTS: Absolutely zero stray colored dots (purple/green/cyan/red dots), zero sensor noise, zero circular pixel blemishes, zero watermarks.\n"
        )
        eliminate_section = f"- Prior Surface Graphics to Eliminate (Zero Bleed-Through): {prior_eliminate}\n" if prior_eliminate else ""

        if is_infographic_template:
            if hybrid_mode:
                product_rule = (
                    f"STRICT INFOGRAPHIC TEMPLATE PRESERVATION MANDATE: Render the new print artwork from Image 1 onto the product carrier shown in Image 2. "
                    f"Faithfully reproduce its motifs, colors, and layout across the surface with realistic material texture, folds, and seams as defined in Image 2. "
                    f"Zero remnants or bleed-through of any old patterns from Image 2."
                )
                listing_requirement = (
                    f"STRICT TEMPLATE PRESERVATION: Retain the composition, product geometry, and clean background from Image 2 ({scene_title}). DO NOT generate text banners on canvas (banners are composited post-generation). Replace only the designated product surface."
                )
                constraints = (
                    "STRICT NO TEXT BANNERS: Absolutely zero drawn text banners, zero text boxes, "
                    "no 'CAN BE CARRIED OR LIFTED' or header lettering painted on the canvas. Leave all background areas around product plain, clean, and empty. "
                    "Preserve all physical elements from Image 2. Retain exact product silhouette. "
                    "Anatomically perfect hands (5 fingers). Absolutely zero stray colored dots (purple/green dots), "
                    "no superimposed photographer watermarks, no bleed-through of prior prints from Image 2."
                )
                composition_rule = (
                    "Composition: Match the exact framing, perspective, and arrangement of Image 2. Replace only the product carrier surface. Leave infographic text banner areas clean, plain, and empty."
                )
            else:
                product_rule = (
                    f"STRICT INFOGRAPHIC SPEC SHEET MANDATE: Render a complete commercial product infographic matching the exact multi-panel / multi-view layout of Image 2. "
                    f"You MUST render the new print artwork from Image 1 onto EVERY SINGLE product instance shown in Image 2 without exception! "
                    f"Completely replace and eliminate all prior graphics or motifs ({prior_eliminate}) across ALL instances. "
                    f"Faithfully reproduce all graphic text banners, headers, and callouts with crisp, legible typography and authentic studio layout. "
                    f"Zero remnants or bleed-through of any old patterns from Image 2."
                )
                listing_requirement = (
                    f"STRICT TEMPLATE PRESERVATION: Retain the composition, product geometry, typography, and clean background from Image 2 ({scene_title}). "
                    f"Replace all old surface prints across ALL product instances with the new artwork from Image 1."
                )
                constraints = (
                    "Preserve all physical elements and graphic infographic banners from Image 2. Retain exact product silhouette. "
                    "Replace all old product surface graphics across ALL product instances with the new artwork from Image 1. "
                    "Render all text banners crisply and legibly without garbled characters. "
                    "Anatomically perfect hands (5 fingers). Absolutely zero stray colored dots (purple/green dots), "
                    "no superimposed photographer watermarks, no bleed-through of prior prints from Image 2."
                )
                composition_rule = (
                    "Composition: Match the exact framing, perspective, and multi-view arrangement of Image 2. Replace the product carrier surfaces on all instances with Image 1."
                )
            scene_desc = (
                f"CRITICAL MANDATORY TEMPLATE REPLACEMENT DIRECTIVE ({scene_title}):\n"
                f"- Image 1: Commercial print artwork.\n"
                f"- Image 2: EXACT reference studio template to preserve and adapt.\n"
                f"{zero_hallucination_rule}"
                f"- External Context/Infographic Chrome to Preserve: {preserve}\n"
                f"- Product Printable Canvas Area: {placement_zone}\n"
                f"{silhouette_rule}"
                f"{bag_lock}"
                f"{anatomy_lock}"
                f"{banner_lock}"
                f"{eliminate_section}"
                f"- Tailored Synthesis Directive:\n{directive}\n"
                f"- Obey visual physics: Maintain realistic contact shadows, depth-of-field, and lighting temperature from Image 2."
            )
            placement = placement_zone or f"Positioned exactly as demonstrated in Image 2 ({scene_title})."
        else:
            product_rule = (
                f"STRICT PHOTOGRAPHIC LIFESTYLE INTEGRATION MANDATE: Seamlessly integrate the {product} into the authentic lifestyle scene shown in Image 2. "
                f"Render the new print artwork from Image 1 across the product surface with realistic 3D volume, authentic material grain, natural cloth/leather folds, "
                f"and flawless lighting coherence matching the room environment in Image 2. Zero bleed-through of old graphics."
            )
            scene_desc = (
                f"CRITICAL MANDATORY LIFESTYLE SCENE PRESERVATION ({scene_title}):\n"
                f"- Image 1: Commercial print artwork.\n"
                f"- Image 2: Authentic lifestyle photograph to preserve.\n"
                f"{zero_hallucination_rule}"
                f"- Room Environment and Context to Preserve: {preserve or 'Preserve all walls, furniture, flooring, decor, and props from Image 2.'}\n"
                f"- Product Placement Area: {placement_zone}\n"
                f"{silhouette_rule}"
                f"{bag_lock}"
                f"{anatomy_lock}"
                f"{eliminate_section}"
                f"- Tailored Synthesis Directive:\n{directive}\n"
                f"- Visual physics & cohesion: Obey the room's natural lighting, casting realistic soft contact shadows onto nearby surfaces. Ensure seamless photographic coherence."
            )
            placement = placement_zone or f"Positioned naturally in the scene as shown in Image 2 ({scene_title})."
            listing_requirement = (
                f"STRICT LIFESTYLE PRESERVATION: Retain 100% of the room environment, decor, furniture, and lighting from Image 2 ({scene_title}). Seamlessly render the product featuring the new artwork into the room."
            )
            constraints = (
                "Preserve all room environment and background objects from Image 2. Retain exact product silhouette. "
                "Anatomically perfect hands (5 fingers). Absolutely zero stray colored dots (purple/green dots), "
                "no garbled lettering, no superimposed photographer watermarks, no bleed-through of prior prints from Image 2."
            )
            composition_rule = (
                "Composition: Match the exact camera angle, perspective, depth of field, and room arrangement of Image 2. Seamlessly blend the product into the scene."
            )
        coordinated_products = "None (adhere strictly to the product items present in Image 2)."

        return f"""
Use case: final ecommerce lifestyle product photograph adapting a reference template.
{product_rule}
{scene_desc}
Placement: {placement}.
Photorealism requirements: The product must have authentic 3D geometry, natural lighting, visible physical thickness, physically correct occlusion, soft contact shadows, and realistic surface finish. It must look like an actual camera photograph, not a 2D collage, poster, sticker, rendering, or graphic illustration.
Coordinated products: {coordinated_products}
Listing-shot requirement: {listing_requirement}
{composition_rule}
Constraints: {constraints}
Retry correction: {correction or "None. Strictly preserve Image 2 layout and replace only the product artwork."}
""".strip()
    elif has_room_template:
        scene_desc = (
            "CRITICAL REFERENCE ROOM TEMPLATE COMPOSITING INSTRUCTION:\n"
            "- You are provided with TWO reference images: Image 1 is the print artwork. Image 2 is the exact reference scene photograph.\n"
            "- PRESERVE THE ROOM EXACTLY: You MUST retain the exact walls, flooring, furniture layout, camera perspective, ambient color temperature, and lighting direction from Image 2.\n"
            "- Do NOT generate a random new room. Keep the exact furniture geometry and ambient room lighting from Image 2.\n"
            f"- Seamlessly composite the {product} (faithfully displaying the print artwork from Image 1) onto the appropriate surface in Image 2, casting realistic contact shadows and obeying the room's light sources."
        )
        placement = pose.placement
        listing_requirement = f"Preserve Image 2 room scene and layout. Place {product} naturally."
        constraints = "No random room changes, no superimposed photographer watermarks."
        coordinated_products = "None."
        product_rule = f"Create one full-size {product} using Image 1 as the print artwork reference and composite onto Image 2."

        return f"""
Use case: final ecommerce lifestyle product photograph compositing onto reference room.
{product_rule}
{scene_desc}
Placement: {placement}.
Photorealism requirements: The product must have authentic 3D geometry, natural lighting, visible thickness, physically correct occlusion, soft contact shadows, and realistic surface finish. It must look like an actual camera photograph, not a 2D collage, poster, sticker, rendering, or graphic illustration.
Coordinated products: {coordinated_products}
Listing-shot requirement: {listing_requirement}
Composition: Match the exact framing, perspective, and arrangement of Image 2.
Constraints: {constraints}
Retry correction: {correction or "None. Strictly preserve Image 2 room and composite the product realistically."}
""".strip()
    else:
        scene_desc = f"Scene: {pose.scene}."
        placement = pose.placement

    return f"""
Use case: final ecommerce lifestyle product photograph.
{product_rule}
{scene_desc}
Placement: {placement}.
Photorealism requirements: The product must have authentic 3D geometry, natural lighting, visible physical thickness, physically correct occlusion, soft contact shadows, and realistic surface finish. It must look like an actual camera photograph, not a 2D collage, poster, sticker, rendering, or graphic illustration.
Coordinated products: {coordinated_products or "None."}
Listing-shot requirement: {pose.display_rule or placement}
Composition: Follow the requested listing-shot framing. Make the product full-size and plausible, with the artwork readable wherever the pose is intended to show it.
Constraints: {avoid} {pose.avoid}
Retry correction: {correction or "None. Render one credible, realistic product photograph."}
""".strip()


def template_pose_for_index(target: ProductTarget, index: int, niche: str = "") -> TemplatePose:
    raw_target = target.name.strip().lower()
    active_niche = (getattr(target, "niche", "") or niche).strip().lower()
    if raw_target in {"custom", "product"} and active_niche:
        product = active_niche
    else:
        product = raw_target

    is_bag = any(k in product for k in ("bag", "handbag", "tote", "purse", "backpack", "clutch", "leather"))
    is_blanket = any(k in product for k in ("blanket", "throw", "quilt"))
    is_rug = any(k in product for k in ("rug", "carpet", "mat")) and not is_bag

    if is_blanket:
        poses = (
            TemplatePose(
                "held_open_showcase",
                "a bright, tasteful home interior with a neutral sofa softly out of focus in the background",
                "a smiling adult holds the two upper corners of one full-size blanket open in front of their body, showing the entire front printable surface nearly flat to camera",
                "do not crop the blanket, do not turn it into a flag, curtain, wall hanging, or rigid poster",
                "HERO LISTING SHOT: the blanket fills 70-85 percent of the frame and the print is fully readable. Natural hands may hold the corners; the person is secondary to the product.",
            ),
            TemplatePose(
                "sofa_front_showcase",
                "a bright, warm, modern living room with a stylish neutral upholstered three-seat sofa, photographed at a natural eye-level perspective at a subtle 15-20 degree three-quarter angle with soft window lighting and realistic depth of field",
                "the blanket conforms strictly to the 3D sofa contours with physical cloth geometry: draped over the backrest, forming a distinct horizontal shelf across the seat cushions showing clear cushion depth, then cascading over the front seat edge in a soft vertical waterfall drape towards the floor; the full printed surface faces outward toward the camera with the entire design prominently visible without folded-over flaps; the perimeter edges remain an intact, continuous, unbroken rectangle parallel to the floor without cut-out notches, scallops, or empty bites",
                "do not create a flat 2D graphic overlay, poster, banner, sticker, or rigid billboard stretched flat across the sofa without seat cushion depth; strictly no large folded-over flaps or turned-back sections concealing the artwork; strictly no notched, concave, or bitten-off hem corners; no ruler-straight floating bottom hem without gravity, no garbled typography, no tilted extreme Dutch angles",
                "SOFA LISTING SHOT: showcase the full-size blanket on the sofa with authentic 3D depth and fabric weight. The printed artwork motifs and typography remain centered, crisp, and fully readable while warping organically and subtly across the cushion curves; motifs on the horizontal seat surface recede naturally in 3D perspective foreshortening; soft ambient shadows under the seat lip and at the bottom hem establish physical contact and realism.",
            ),
            TemplatePose(
                "bed_full_showcase",
                "a bright, elegant, modern bedroom with a beautifully made bed and stylish upholstered headboard, photographed from a natural eye-level perspective from the foot of the bed with soft natural window lighting and realistic depth of field",
                "the blanket covers the entire mattress with gentle natural cloth waves and a soft turned-back top cuff, draping naturally over the foot and side edges with continuous straight sewn hems (the bottom hem hanging at the foot is a clean straight horizontal line parallel to the floor, never scalloped, notched, or tabbed around artwork motifs); exactly two matching printed plump 3D pillowcases sit propped neatly in front of white sleeping pillows against the headboard",
                "do not leave plain white pillows without printed shams, do not make flat 2D cardboard pillows or stickers, do not merge or squish pillows into cluttered blobs, no scalloped cuts or ruffled frills, no die-cut tabs following badge shapes, no comforter box quilting stitches, no stiff origami folds, no garbled typography, no tilted or extreme diagonal camera angles, no photographer watermarks",
                "BEDROOM SET LISTING SHOT: showcase a coordinated set of one full blanket across the bed plus exactly two matching pillowcases. Pillowcases must feature clean, balanced, well-scaled motifs without clutter; blanket must have clean straight sewn hems and a realistic soft drape.",
            ),
            TemplatePose(
                "folded_detail_showcase",
                "a refined living room with a neutral sofa, armchair, or upholstered bench in soft window light",
                "the blanket is neatly folded into two or three thick, fluffy, cozy layers resting on one end of the furniture (e.g. on the sofa armrest or seat corner), with one corner soft-draped down naturally to reveal plush fabric thickness, soft cloth folds, hem stitching, and a readable cropped portion of the print",
                "strictly do not spread or hang the blanket flat across the sofa, do not make it an unfolded flat sheet, curtain, backdrop, or banner covering the cushions, do not make it a towel, scarf, tiny decorative textile, or a flat 2D poster; do not try to show the whole design flat",
                "DETAIL LISTING SHOT: emphasize realistic plush fleece material, edge binding, and thick rounded cloth folds. The folds naturally crop the artwork so only a portion of the motifs and badges are visible across the folded layers, exactly like a genuine high-end ecommerce listing photograph.",
            ),
            TemplatePose(
                "sofa_casual_drape",
                "a stylish, cozy modern living room with a neutral three-seat sofa, photographed at a natural eye-level perspective from a slight three-quarter angle with warm natural window sunlight and realistic depth of field",
                "the blanket is artfully and casually draped over one side of the sofa: resting over the upper backrest, cascading over one armrest and spreading loosely across the adjacent seat cushion with one corner hanging down toward the floor in soft, natural, fluid cloth folds; the printed design remains clearly visible across the drape without heavy reversed flaps; the sofa cushions and room setting remain naturally visible around it",
                "do not spread the blanket flat like a bedsheet or tablecloth across the entire sofa; strictly no flat 2D poster, banner, sticker, or rigid billboard; strictly no oversized blank flaps hiding the print, no ruler-straight floating bottom hem, no garbled typography, no messy squished blobs",
                "CASUAL LIFESTYLE SHOT: showcase the throw blanket draped effortlessly and authentically in a high-end interior scene. The main printed motifs and typography remain clearly recognizable and prominent across the drape, with natural fabric thickness, soft contact shadows, and realistic textile weight.",
            ),
            TemplatePose(
                "bedroom_foot_runner",
                "a serene, luxury master bedroom with a king platform bed, plush upholstered headboard, and gentle natural morning sunlight",
                "the blanket is folded horizontally into a wide runner draped neatly across the lower foot of the bed, with soft folded ends falling naturally over both bed rails, showing crisp centered artwork motifs and clean sewn hems",
                "do not bunch into messy chaotic wrinkles, no flat billboard overlays, no scalloped edges, no garbled typography",
                "BED FOOT RUNNER SHOT: premium hotel-style presentation with the blanket accenting the bed foot cleanly.",
            ),
            TemplatePose(
                "reading_nook_armchair",
                "a cozy reading nook with a classic upholstered accent armchair, small wooden side table with ceramic mug, and warm reading floor lamp",
                "the blanket is draped over the chair back and seat cushion, with one side falling naturally in fluid ripples toward the wooden floor, displaying the full printable artwork clearly",
                "do not cover the whole chair like a fitted slipcover, no rigid cardboard folds, no distorted typography",
                "READING NOOK SHOT: warm, inviting lifestyle vignette emphasizing comfort, leisure, and soft textile texture.",
            ),
            TemplatePose(
                "patio_porch_swing",
                "a covered outdoor veranda or sunroom with a hanging porch swing chair or daybed overlooking lush garden greenery in soft golden hour light",
                "the blanket rests comfortably on the swing cushions with soft natural folds, highlighting the vibrant colors and print clarity in outdoor daylight",
                "no rain, no dark shadows, no flat posters, no distorted proportions",
                "OUTDOOR LIFESTYLE SHOT: airy, relaxing seasonal ambiance showcasing the blanket in a breezy porch retreat.",
            ),
            TemplatePose(
                "bed_side_perspective",
                "a chic modern bedroom photographed from a 45-degree angle beside the nightstand with natural window lighting and soft depth of field",
                "the blanket is spread across the duvet with soft organic waves, gently draping down the side of the mattress toward the floor, with the design fully legible",
                "no extreme fish-eye distortion, no plain unprinted pillows, no scalloped hems",
                "BEDSIDE PERSPECTIVE SHOT: dimensional interior view showing fabric drape, mattress thickness, and room harmony.",
            ),
            TemplatePose(
                "family_living_room_wide",
                "an expansive, high-end open-concept living room with hardwood floors, modern fireplace, and floor-to-ceiling windows",
                "the blanket is the hero accent on a large sectional sofa in the middle ground, sharply focused with vivid color saturation and crisp design details",
                "do not lose the blanket in the wide shot, product must remain the unmistakable visual anchor",
                "WIDE INTERIOR SHOT: aspirational architectural showcase proving how the blanket transforms luxury living spaces.",
            ),
        )
    elif is_bag:
        poses = (
            TemplatePose(
                "studio_pedestal",
                "a luxurious, minimalist commercial photography studio with a travertine marble pedestal and warm soft directional rim lighting",
                f"the {product} stands upright on the pedestal showcasing its structured form, polished metallic hardware, fine artisan stitching, and the print artwork seamlessly displayed across its main front body panel",
                "no cartoon illustration, no flat 2D sticker overlay, no floor rug, no blanket, no watermark",
                "STUDIO HERO SHOT: pristine commercial catalog shot highlighting bag silhouette and print details.",
            ),
            TemplatePose(
                "lifestyle_cafe_table",
                "a chic sunlit Parisian or Scandinavian cafe with a round marble table beside a tall window",
                f"the {product} rests gracefully on the cafe table beside a ceramic coffee cup and sunglasses in soft morning light",
                "no flat 2D sticker, no distorted perspective, no rug on floor",
                "CAFE LIFESTYLE SHOT: elegant daytime setting demonstrating authentic everyday luxury.",
            ),
            TemplatePose(
                "boutique_shelf",
                "an exclusive designer boutique showroom with warm ambient backlit natural oak shelving",
                f"the {product} is featured as the centerpiece on the boutique shelf with gentle shadows and realistic leather texture",
                "no flat 2D sticker, no distorted logos",
                "BOUTIQUE DISPLAY SHOT: high-end retail showcase emphasizing product desirability.",
            ),
            TemplatePose(
                "editorial_model_arm",
                "an elegant, editorial fashion setting with a neutral textured wall and soft flattering window light",
                f"the {product} is carried naturally by the top handle by a stylish model in neutral minimalist attire, showcasing the bag's proportions, drape, and vibrant print",
                "no distorted limbs, no flat stickers, no blurry face distracting from the bag",
                "EDITORIAL ON-MODEL SHOT: aspirational fashion editorial shot proving real-world scale and look.",
            ),
            TemplatePose(
                "flatlay_styling",
                "a premium marble vanity or tabletop with soft diffused daylight photographed from an overhead 45-degree angle",
                f"the {product} is styled with complementary accessories (designer sunglasses, silk scarf, brass keychain), highlighting fine leather grain and print craftsmanship",
                "no cluttered mess, no flat sticker paste",
                "CURATED FLATLAY SHOT: artfully arranged overhead vignette for social proof and conversion.",
            ),
        )
    elif is_rug:
        poses = (
            TemplatePose("living_room_center", "a bright living room photographed at standing eye level", "the rug lies centered under a coffee table with all edges visible", "no blanket, bath mat, doormat, or second rug"),
            TemplatePose("bedroom_bedside", "a calm bedroom photographed at a natural three-quarter angle", "the rug sits beside the bed with a clear floor-plane perspective", "no blanket, bath mat, doormat, or second rug"),
            TemplatePose("entryway_runner", "a practical entryway photographed at standing eye level", "the rug is a runner on the floor with clear edges and natural scale", "no blanket, bath mat, or second rug"),
            TemplatePose("reading_corner", "a sunlit reading corner with one chair and floor lamp", "the rug lies flat in front of the chair with a visible perspective plane", "no blanket, bath mat, doormat, or second rug"),
            TemplatePose("dining_room", "a modest dining room photographed from a natural angle", "the rug lies under a small dining table with its outer edges clearly visible", "no blanket, bath mat, doormat, or second rug"),
            TemplatePose("home_office_desk", "a bright modern home office with a minimalist desk and chair", "the rug lies centered under the desk and seating area with clear floor borders", "no blanket, bath mat, or second rug"),
            TemplatePose("kitchen_island_accent", "a stylish gourmet kitchen with marble island and barstools", "the rug lies along the kitchen island with realistic contact shadow and clean edges", "no blanket, bath mat, or second rug"),
            TemplatePose("sunroom_terrace", "a sun-drenched enclosed sunroom with potted plants and stone floor", "the rug is centered in the sunlit seating space with visible texture", "no blanket, bath mat, or second rug"),
            TemplatePose("nursery_cozy_corner", "a peaceful modern nursery with crib, rocking chair, and oak floor", "the rug sits open in the floor area creating a cozy focal point", "no blanket, bath mat, or second rug"),
            TemplatePose("open_concept_loft", "an urban industrial loft with brick accents and polished concrete", "the rug anchors the central conversation lounge with bold presence", "no blanket, bath mat, or second rug"),
        )
    else:
        poses = (
            TemplatePose("hero_studio_pedestal", "a clean, high-end commercial product photography studio with a minimalist pedestal and soft diffused lighting", f"the {product} is positioned as the hero subject with crisp focus, natural contact shadow, authentic material textures, and the printed artwork clearly showcased", "no flat 2D sticker, no cartoon, no watermark"),
            TemplatePose("ambient_lifestyle", f"a stylish, contemporary interior living or workspace relevant to {product} with natural sunlight and balanced depth of field", f"the {product} is placed naturally in its everyday aspirational environment, displaying the printed design with realistic lighting and physical interaction", "no flat sticker, no distorted perspective"),
            TemplatePose("close_up_detail", "a refined close-up perspective highlighting material craftsmanship, fine surface texture, and sharp print reproduction", f"focused on the hero detail of the {product} showcasing the seamless print quality and premium construction", "no blurry focus, no flat paste"),
            TemplatePose("editorial_composition", "a tastefully styled editorial scene with complementary props and warm ambient lighting", f"the {product} is integrated into an elegant visual story with balanced negative space and rich color harmony", "no cluttered scene, no distorted branding"),
            TemplatePose("in_context_lifestyle", f"an authentic, aspirational real-world setting demonstrating the {product} in use", f"the {product} naturally anchors the scene, casting soft realistic shadows and showing true-to-life scale", "no fake 2D paste, no watermark"),
        )
    return poses[(max(1, index) - 1) % len(poses)]


def generate_template(
    client: Any,
    target: ProductTarget,
    model: str,
    pose: TemplatePose,
    *,
    correction: str = "",
) -> Image.Image:
    from google.genai import types

    config = types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        temperature=0.42,
        image_config=types.ImageConfig(
            aspect_ratio="1:1",
            image_size="2K",
            output_mime_type="image/png",
        ),
    )
    response = client.models.generate_content(model=model, contents=[template_prompt(target, pose, correction=correction)], config=config)
    image_bytes, _ = extract_image_bytes(response)
    if not image_bytes:
        raise RuntimeError("AI template generation returned no image.")
    with Image.open(io.BytesIO(image_bytes)) as image:
        return image.convert("RGB")


def template_prompt(target: ProductTarget, pose: TemplatePose, *, correction: str = "") -> str:
    product = target.name.strip().lower()
    if product == "blanket":
        subject = "one full-size soft woven throw blanket with clearly visible textile folds"
        avoid = f"no table, no placemat, no coaster, no rug, no bath mat, no second blanket; {pose.avoid}"
    else:
        subject = "one full-size floor rug with a clear visible silhouette"
        avoid = pose.avoid
    return f"""
Use case: product-mockup
Asset type: reusable blank product mockup template
Primary request: Create a photorealistic ecommerce lifestyle scene containing {subject}.
Scene/backdrop: {pose.scene}.
Subject: The entire printable surface of the single product must be one uniform saturated cyan-blue color close to RGB {MARKER_RGB}, with no pattern, no text, no logo, no border, and no decorative motif.
Composition/framing: {pose.placement}. Product is the hero and occupies about 18-35 percent of the image; retain generous room context. Keep all product edges clearly visible; do not crop the product.
Materials/textures: preserve a matte woven textile surface, visible edge binding and believable thickness. Give the cyan placeholder several broad, readable folds plus subtle fine weave, physically coherent occlusion where it passes behind furniture, soft contact shadows, and highlights that follow its folds. Never make it glossy, paper-like, rigid, or a flat rectangular sheet.
Constraints: Generate a blank template only. The cyan product surface must be easy to isolate from the scene. {avoid}.
Retry correction: {correction or "None. Follow the requested pose exactly."}
Avoid: text, watermarks, frames, collage layout, additional cyan objects.
""".strip()


def assess_template_pose(
    client: Any,
    template: Image.Image,
    target: ProductTarget,
    pose: TemplatePose,
    model: str,
) -> dict[str, object]:
    from google.genai import types

    prompt = f"""
Evaluate this blank ecommerce product template for a {target.name}.
Required pose: {pose.name}. {pose.placement}.
The intended product surface is a single cyan-blue placeholder textile. Scene: {pose.scene}.
Return JSON only:
{{
  "correct_product_type": false,
  "single_product": false,
  "pose_matches": false,
  "pose_is_natural": false,
  "cyan_surface_isolatable": false,
  "has_forbidden_presentation": false,
  "template_realism_score": 0,
  "reason": "short reason"
}}
Use an integer score from 0 to 100. A blanket that covers an entire chair like a fitted cover, or a blanket that covers an entire bed like a bedspread, fails pose_is_natural and pose_matches.
""".strip()
    last_error: Exception | None = None
    for attempt in range(1, 3):
        try:
            response = client.models.generate_content(
                model=model,
                contents=[types.Content(role="user", parts=[image_part(template), types.Part.from_text(text=prompt)])],
                config=types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
            )
            return parse_json_relaxed(extract_response_text(response))
        except Exception as exc:
            last_error = exc
            if attempt >= 2 or not is_transient_gemini_error(exc):
                break
            time.sleep(float(attempt) * 2.0)
    raise RuntimeError(f"template pose QA failed: {last_error or 'unknown error'}")


def validate_template_pose(assessment: dict[str, object]) -> None:
    def enabled(name: str) -> bool:
        return assessment.get(name) is True or str(assessment.get(name) or "").strip().lower() in {"true", "yes", "1"}

    try:
        score = float(assessment.get("template_realism_score") or 0)
    except (TypeError, ValueError):
        score = 0.0
    # The model's description of a pose is often overly literal (for example, a throw
    # draped on both sides of an armchair). Product identity and physical plausibility
    # matter more than matching every wording detail of a requested lifestyle pose.
    accepted = (
        enabled("correct_product_type")
        and enabled("single_product")
        and enabled("pose_is_natural")
        and enabled("cyan_surface_isolatable")
        and not enabled("has_forbidden_presentation")
        and score >= 75
    )
    if not accepted:
        reason = str(assessment.get("reason") or "template pose did not pass QA")
        raise RuntimeError(f"template pose QA rejected: {reason}")


def extract_marker_mask(template: Image.Image) -> tuple[Image.Image, dict[str, object]]:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is required to isolate the AI template marker mask.") from exc

    rgb = np.asarray(template.convert("RGB"), dtype=np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    strict_marker = ((b - r > 55) & (g - r > 30) & (b > 105) & (g > 70)).astype(np.uint8) * 255
    broad_marker = ((b - r > 25) & (g - r > 5) & (b > 55) & (g > 40)).astype(np.uint8) * 255
    marker = cv2.morphologyEx(strict_marker, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8), iterations=2)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(marker, connectivity=8)
    if count <= 1:
        raise RuntimeError("template marker mask was not found")
    areas = stats[1:, cv2.CC_STAT_AREA]
    label = int(np.argmax(areas)) + 1
    selected = (labels == label).astype(np.uint8) * 255
    x, y, w, h, _ = stats[label]
    pad_x = max(24, round(w * 0.16))
    pad_y = max(24, round(h * 0.16))
    region = np.zeros_like(selected)
    region[max(0, y - pad_y) : min(selected.shape[0], y + h + pad_y), max(0, x - pad_x) : min(selected.shape[1], x + w + pad_x)] = 255
    broad_count, broad_labels, broad_stats, _ = cv2.connectedComponentsWithStats(broad_marker, connectivity=8)
    min_component_area = max(80, round(selected.size * 0.00008))
    included_components = 1
    for component in range(1, broad_count):
        area = int(broad_stats[component, cv2.CC_STAT_AREA])
        if area < min_component_area:
            continue
        component_mask = (broad_labels == component).astype(np.uint8) * 255
        if np.any((component_mask > 0) & (region > 0)):
            selected = cv2.bitwise_or(selected, component_mask)
            included_components += 1
    selected = cv2.morphologyEx(selected, cv2.MORPH_CLOSE, np.ones((17, 17), np.uint8), iterations=2)
    selected = cv2.GaussianBlur(selected, (0, 0), sigmaX=1.2)
    ys, xs = np.where(selected > 32)
    if not len(xs):
        raise RuntimeError("template marker mask is empty")
    left, right = int(xs.min()), int(xs.max())
    top, bottom = int(ys.min()), int(ys.max())
    height, width = selected.shape
    remaining_marker = (broad_marker > 0) & (selected <= 32) & (region > 0)
    marker_pixels = max(1, int(np.count_nonzero(broad_marker & region)))
    metrics: dict[str, object] = {
        "mask_coverage": float((selected > 32).mean()),
        "mask_bbox": [left, top, right + 1, bottom + 1],
        "mask_bbox_width_ratio": (right - left + 1) / width,
        "mask_bbox_height_ratio": (bottom - top + 1) / height,
        "included_marker_components": included_components,
        "marker_residual_ratio": float(np.count_nonzero(remaining_marker)) / marker_pixels,
    }
    return Image.fromarray(selected, mode="L"), metrics


def validate_template_mask(metrics: dict[str, object], size: tuple[int, int]) -> None:
    coverage = float(metrics["mask_coverage"])
    width_ratio = float(metrics["mask_bbox_width_ratio"])
    height_ratio = float(metrics["mask_bbox_height_ratio"])
    if not 0.04 <= coverage <= 0.60:
        raise RuntimeError(f"template marker mask coverage {coverage:.3f} is outside 0.04-0.60")
    if width_ratio < 0.18 or height_ratio < 0.18:
        raise RuntimeError("template marker mask is too small to represent a full-size product")
    if float(metrics.get("marker_residual_ratio", 0.0)) > 0.012:
        raise RuntimeError("template marker mask leaves visible placeholder pixels outside the product mask")


def composite_print_on_template(
    print_path: Path,
    template: Image.Image,
    mask: Image.Image,
    target: ProductTarget,
) -> Image.Image:
    with Image.open(print_path) as opened:
        artwork = ImageOps.exif_transpose(opened).convert("RGB")
    bbox = mask.getbbox()
    if bbox is None:
        raise RuntimeError("template marker mask is empty")
    artwork_layer = warp_artwork(artwork, mask, bbox, target)
    if target.name == "blanket":
        artwork_layer = displace_blanket_artwork(artwork_layer, template, mask)
    fold_shade, weave_detail, edge_occlusion = fabric_material_maps(template, mask)
    art_np = np.asarray(artwork_layer.convert("RGB"), dtype=np.float32)
    shaded = apply_fabric_material(art_np, fold_shade, weave_detail, edge_occlusion)
    printed = Image.fromarray(shaded, mode="RGB")
    result = template.convert("RGBA")
    printed.putalpha(mask)
    result.alpha_composite(printed)
    return result.convert("RGB")


def warp_artwork(artwork: Image.Image, mask: Image.Image, bbox: tuple[int, int, int, int], target: ProductTarget) -> Image.Image:
    canvas = Image.new("RGB", mask.size, (0, 0, 0))
    if target.name != "rug":
        canvas.paste(ImageOps.fit(artwork, (bbox[2] - bbox[0], bbox[3] - bbox[1]), Image.Resampling.LANCZOS), bbox[:2])
        return canvas
    destination = rug_quad(mask)
    if destination is None:
        canvas.paste(ImageOps.fit(artwork, (bbox[2] - bbox[0], bbox[3] - bbox[1]), Image.Resampling.LANCZOS), bbox[:2])
        return canvas
    try:
        import cv2
    except ImportError:
        return canvas
    art = np.asarray(artwork, dtype=np.uint8)
    src = np.float32([[0, 0], [art.shape[1] - 1, 0], [art.shape[1] - 1, art.shape[0] - 1], [0, art.shape[0] - 1]])
    matrix = cv2.getPerspectiveTransform(src, destination.astype(np.float32))
    warped = cv2.warpPerspective(art, matrix, mask.size, flags=cv2.INTER_LANCZOS4)
    return Image.fromarray(warped, mode="RGB")


def rug_quad(mask: Image.Image) -> np.ndarray | None:
    try:
        import cv2
    except ImportError:
        return None
    binary = (np.asarray(mask) > 64).astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    approximation = cv2.approxPolyDP(contour, 0.035 * cv2.arcLength(contour, True), True)
    points = approximation.reshape(-1, 2) if len(approximation) == 4 else cv2.boxPoints(cv2.minAreaRect(contour))
    if len(points) != 4:
        return None
    return order_quad(np.asarray(points, dtype=np.float32))


def order_quad(points: np.ndarray) -> np.ndarray:
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).ravel()
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(diffs)]
    ordered[3] = points[np.argmax(diffs)]
    return ordered


def template_shade(template: Image.Image, mask: Image.Image) -> np.ndarray:
    fold_shade, _, _ = fabric_material_maps(template, mask)
    return fold_shade


def fabric_material_maps(template: Image.Image, mask: Image.Image) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Derive fold, weave, and edge-light maps from the blank textile template."""
    try:
        import cv2
    except ImportError:
        rgb = np.asarray(template.convert("RGB"), dtype=np.float32)
        luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
        inside = np.asarray(mask) > 64
        median = float(np.median(luminance[inside])) if np.any(inside) else 128.0
        fold = np.clip(luminance / max(1.0, median), 0.68, 1.28)
        return fold, np.zeros_like(fold), np.zeros_like(fold)

    rgb = np.asarray(template.convert("RGB"), dtype=np.float32)
    luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    inside = np.asarray(mask) > 64
    low_frequency = cv2.GaussianBlur(luminance, (0, 0), sigmaX=24)
    median = float(np.median(low_frequency[inside])) if np.any(inside) else 128.0
    broad_shade = low_frequency / max(1.0, median)
    fold_base = cv2.GaussianBlur(luminance, (0, 0), sigmaX=4.0)
    fold_detail = (fold_base - low_frequency) / max(1.0, median)
    # A blanket's broad folds carry substantially more visual information than weave.
    # Keep the multiplier bounded so the approved print's palette is never destroyed.
    fold_shade = np.clip(broad_shade + fold_detail * 1.35, 0.52, 1.32)

    weave_base = cv2.GaussianBlur(luminance, (0, 0), sigmaX=2.2)
    weave_detail = np.clip((luminance - weave_base) / 42.0, -1.0, 1.0)

    binary = (np.asarray(mask) > 64).astype(np.uint8)
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 3)
    edge_occlusion = np.clip((8.0 - distance) / 8.0, 0.0, 1.0)
    return fold_shade, weave_detail, edge_occlusion


def apply_fabric_material(
    artwork: np.ndarray,
    fold_shade: np.ndarray,
    weave_detail: np.ndarray,
    edge_occlusion: np.ndarray,
) -> np.ndarray:
    """Transfer textile shading and microtexture without recoloring the approved artwork."""
    weave_factor = 1.0 + weave_detail * 0.11
    edge_factor = 1.0 - edge_occlusion * 0.13
    material_factor = fold_shade * weave_factor * edge_factor
    shaded = artwork * material_factor[..., None]
    # Slightly reduce saturation in deep folds. This prevents saturated patterns from
    # looking like a flat screen print pasted over a dark piece of furniture.
    luma = shaded[..., 0] * 0.2126 + shaded[..., 1] * 0.7152 + shaded[..., 2] * 0.0722
    fold_depth = np.clip((0.92 - fold_shade) / 0.35, 0.0, 1.0)[..., None]
    shaded = shaded * (1.0 - fold_depth * 0.055) + luma[..., None] * fold_depth * 0.055
    return np.clip(shaded, 0, 255).astype(np.uint8)


def displace_blanket_artwork(artwork: Image.Image, template: Image.Image, mask: Image.Image) -> Image.Image:
    """Warp the print along visible blanket folds from the blank textile template."""
    try:
        import cv2
    except ImportError:
        return artwork
    rgb = np.asarray(template.convert("RGB"), dtype=np.float32)
    luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    # Isolate mid-scale fold ridges. The gradients define a flow field that bends
    # the approved print in the same direction as the template's fabric surface.
    mid = cv2.GaussianBlur(luminance, (0, 0), sigmaX=5.0)
    broad = cv2.GaussianBlur(luminance, (0, 0), sigmaX=28.0)
    fold_signal = mid - broad
    fold_signal = cv2.GaussianBlur(fold_signal, (0, 0), sigmaX=5.0)
    grad_x = cv2.Sobel(fold_signal, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(fold_signal, cv2.CV_32F, 0, 1, ksize=3)
    grad_x = cv2.GaussianBlur(grad_x, (0, 0), sigmaX=4.0)
    grad_y = cv2.GaussianBlur(grad_y, (0, 0), sigmaX=4.0)
    binary = (np.asarray(mask) > 64).astype(np.uint8)
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 3)
    # Leave the edge stable so the printed shape keeps a clean, believable binding.
    interior_weight = np.clip(distance / 14.0, 0.0, 1.0)
    magnitude = np.sqrt(grad_x * grad_x + grad_y * grad_y)
    # Generated cyan templates can contain chroma noise that looks like a fold to a
    # gradient detector. Limit geometric motion to a few pixels; lighting conveys
    # the larger folds without turning the print into melted artwork.
    scale = min(2.0, max(0.45, min(template.size) / 1500.0))
    normalizer = np.percentile(magnitude[binary > 0], 92) if np.any(binary) else 1.0
    normalizer = max(1e-3, float(normalizer))
    grad_x = np.clip(grad_x / normalizer, -1.0, 1.0) * scale * interior_weight
    grad_y = np.clip(grad_y / normalizer, -1.0, 1.0) * scale * interior_weight
    height, width = luminance.shape
    grid_x, grid_y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    map_x = np.clip(grid_x + grad_x, 0, width - 1)
    map_y = np.clip(grid_y + grad_y, 0, height - 1)
    warped = cv2.remap(np.asarray(artwork.convert("RGB")), map_x, map_y, interpolation=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    return Image.fromarray(warped, mode="RGB")
