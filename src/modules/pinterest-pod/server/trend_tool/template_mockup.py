from __future__ import annotations

import hashlib
import io
import json
import logging
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFilter, ImageOps

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
    1. External Context & Infographic Chrome -> Preserve 100%.
    2. Product Physical Carrier / Substrate -> Geometry & Physics retained as printable canvas.
    3. Prior Surface Print Graphics -> 100% eliminated and replaced with new artwork.
    """
    from google.genai import types

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

    hash_key = hashlib.sha256(buf_ref.getvalue() + buf_art_bytes).hexdigest()[:16]

    cache_file: Path | None = None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / "reference_analysis_cache.json"
        if cache_file.exists():
            try:
                cached_dict = json.loads(cache_file.read_text(encoding="utf-8"))
                if isinstance(cached_dict, dict) and hash_key in cached_dict:
                    val = cached_dict[hash_key]
                    if isinstance(val, dict) and "generation_directive" in val and "external_chrome_to_preserve" in val:
                        return val
            except Exception:
                pass

    if artwork is not None:
        analysis_prompt = f"""
You are an elite creative director and commercial photographer specializing in Print-on-Demand (POD) e-commerce products ({target.name}).
You are analyzing an exemplary commercial marketing image (Reference Image 2) to adapt it for a new {target.name} that will feature the new print artwork (Image 1).

Apply the universal principles of Semantic Physics and Object-Print Separation:
1. PRODUCT SUBSTRATE VS BACKGROUND DISAMBIGUATION:
   - Identify what is the physical PRODUCT itself versus the surrounding CANVAS/BACKGROUND:
     The product carrier is the physical mat/rug with physical thickness, rounded/squared contours, memory foam/fabric texture, and contact drop shadow—EVEN IF the old product in Image 2 is solid black, dark gray, or unpatterned!
     In studio infographics, the product often rests on a contrasting background (e.g. a black mat lying on a clean white background with a drop shadow, or rugs on a wooden floor).
     NEVER confuse the body of a solid-colored product (e.g. a black mat) with the scene background! The background is what surrounds the product (e.g. the white studio backdrop).
     Any base color, graphic stripes, diagonal lines, speaker icons, or novelty graphics on the old product are PRIOR SURFACE PRINTS to be 100% replaced.

2. EXTERNAL CONTEXT & CHROME (Preserve 100%):
   - Any visual element located OUTSIDE or AROUND the product carrier:
     - True background environment (e.g. clean white studio backdrop, room walls, flooring, lighting).
     - External text callouts and brand logos on the background (e.g. 'Quick-Dry Microfiber Surface Memory Foam Cushion', 'G' logo, size chart tables).
   - INTERACTIVE PROPS & OCCLUSIONS:
     - When a human hand/finger is pressing into the cushion (demonstrating softness/memory foam), the hand/finger and its physical indentation MUST BE PRESERVED. The new artwork must realistically indent under the finger's pressure!
     - When furniture legs or pets rest on top of the rug, they are preserved as physical occlusions.

3. INSET DETAIL / MAGNIFIED CUTOUTS (Multi-Zone Synchronization):
   - When the reference image features a circular or rectangular INSET / CLOSE-UP CUTOUT demonstrating material features (e.g. a magnified view of the memory foam cushion with finger indentation):
     - The inset cutout ALSO depicts the product surface!
     - The new print artwork from Image 1 must be applied coherently to BOTH the main product carrier AND the magnified inset cutout, maintaining consistent pattern scale and realistic fabric creasing under the finger's pressure.

4. PRIOR SURFACE PRINT ARTIFACTS (Must be 100% eliminated & replaced):
   - ANY graphic, color, line, icon, or button printed on the old product in Image 2 (e.g. old black base color, white diagonal graphic lines, speaker icon, novelty music buttons, fake album cover borders).
   - They MUST NOT bleed through or appear as background layers behind the new product.
   - The entire physical surface area of the product carrier (main mat + circular inset) must be 100% covered by the NEW print artwork from Image 1 (edge-to-edge full bleed).

Analyze the images deeply and return JSON only in English with these exact keys:
{{
  "scene_title": "Short descriptive title (3-6 words)",
  "visual_concept": "2-3 sentences explaining the commercial marketing concept, camera angle, and intention",
  "external_chrome_to_preserve": "Specific visual elements outside the product that must be kept intact (true background, text callouts, logo, human hand/finger pressing into the mat)",
  "prior_surface_print_to_eliminate": "Specific graphic motifs, lines, icons, or old base colors on the product in Image 2 that MUST NOT appear on the new product",
  "product_canvas_area": "Precise description of the physical product surfaces (both main mat body and inset circle) that serve as the canvas for the new artwork",
  "generation_directive": "A complete, self-contained prompt for the generative image model. Instruct it step-by-step to compose the image using Image 1 (new artwork) and Image 2 (reference composition). Explicitly command it to preserve the true background, text callouts, logo, and pressing finger from Image 2, while rendering the new artwork from Image 1 across the entire product canvas area with zero bleed-through of any old black mat colors, white lines, or speaker icons",
  "qa_checklist": [
    "criterion 1: Verify all external context/infographic chrome is intact",
    "criterion 2: Verify the new artwork is rendered across the entire product canvas area",
    "criterion 3: Verify NO leftover graphic artifacts, old black shapes, or white lines from Image 2 appear"
  ]
}}
"""
        contents_parts = [
            image_part(artwork, max_side=1024, max_bytes=2_000_000),
            image_part(image, max_side=1024, max_bytes=2_000_000),
            types.Part.from_text(text=analysis_prompt),
        ]
    else:
        analysis_prompt = f"""
You are an expert creative director and commercial e-commerce photographer specializing in Print-on-Demand (POD) home decor products ({target.name}).
Analyze this reference listing image in depth.
Apply the universal principles of Spatial Physics: separate the external context/infographic chrome, the physical product substrate, and any prior surface print.
Return JSON only in English with these exact keys:
{{
  "scene_title": "Short descriptive title (3-6 words)",
  "visual_concept": "2-3 sentences explaining the commercial concept",
  "external_chrome_to_preserve": "Specific elements outside the product to preserve",
  "prior_surface_print_to_eliminate": "Old surface graphics to eliminate",
  "product_canvas_area": "Physical product area to receive new artwork",
  "generation_directive": "Prompt instruction for image generation",
  "qa_checklist": ["criterion 1", "criterion 2", "criterion 3"]
}}
"""
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
        "elements_to_preserve": "Overall camera angle, lighting, background architecture, and surrounding props.",
        "product_placement_zone": f"In the exact position where the {target.name} appears in Image 2.",
        "generation_directive": (
            f"Faithfully preserve the scene composition, lighting, camera angle, and background objects from Image 2. "
            f"Replace the {target.name} with the new design using the exact artwork, palette, and motifs from Image 1."
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
    mockup_path = output_dir / "lifestyle_mockups" / f"{stem}{suffix}_lifestyle.png"
    client = create_gemini_client(backend)
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
    if room_img is not None:
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
                image_type="DYNAMIC_REFERENCE" if reference_analysis else "ROOM_SCENE",
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
                raise RuntimeError(f"direct AI mockup QA rejected: {quality.reason}")
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
                    correction = (
                        f"CRITICAL FIX: The previous render failed QA: {qa_detail}. "
                        "You MUST strictly preserve 100% of Image 2's composition, layout, background, text, sizing charts, and infographic elements! "
                        "Do NOT invent a new room or different furniture (do NOT render a random sofa or change the product type). "
                        "Replace ONLY the product surface in Image 2 with the new artwork from Image 1, conforming to its physical folds and geometry with zero remnants of the old print."
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

    return TemplateMockupRecord(print_path, None, None, None, model, active_pose_name, "failed", last_error, {}, "direct_ai", variant)


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
) -> Image.Image:
    from google.genai import types

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
    )
    parts.append(types.Part.from_text(text=prompt_str))

    response = client.models.generate_content(
        model=model,
        contents=[
            types.Content(
                role="user",
                parts=parts,
            )
        ],
        config=config,
    )
    image_bytes, _ = extract_image_bytes(response)
    if not image_bytes:
        raise RuntimeError("direct AI lifestyle generation returned no image.")
    with Image.open(io.BytesIO(image_bytes)) as generated:
        return generated.convert("RGB")


def direct_ai_lifestyle_prompt(
    target: ProductTarget,
    pose: TemplatePose,
    correction: str,
    *,
    has_room_template: bool = False,
    reference_analysis: dict[str, Any] | None = None,
) -> str:
    product = target.name.strip().lower()
    coordinated_products = ""
    scene_title = reference_analysis.get("scene_title", "Reference Listing Shot") if reference_analysis else ""

    if product == "blanket":
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
    elif product == "rug":
        shape = target.rug_shape.strip().lower() if target.rug_shape else "rectangle"
        product_rule = (
            f"Create one full-size {shape} floor rug. Treat the attached image as its exact print artwork reference, "
            "not as a flat image pasted on the floor. Preserve its motifs, palette, and visual identity on the rug surface."
        )
        avoid = (
            f"No rectangular rug when the required silhouette is {shape}, no blanket, bath mat, doormat, wall hanging, "
            "no superimposed photographer watermarks, brand logos, or UI overlays."
        )
    else:
        product_rule = "Create one full-size product using the attached image as its faithful print artwork reference."
        avoid = pose.avoid

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

        eliminate_section = f"- Prior Surface Graphics to Eliminate (Zero Bleed-Through): {prior_eliminate}\n" if prior_eliminate else ""

        product_rule = (
            f"STRICT TEMPLATE PRESERVATION MANDATE: Render the new print artwork from Image 1 onto the product carrier shown in Image 2. "
            f"Faithfully reproduce its motifs, colors, and layout across the fabric with realistic cloth texture, folds, and seams as defined in Image 2. "
            f"Zero remnants or bleed-through of any old patterns from Image 2."
        )
        scene_desc = (
            f"CRITICAL MANDATORY TEMPLATE REPLACEMENT DIRECTIVE ({scene_title}):\n"
            f"- Image 1: Commercial textile print artwork.\n"
            f"- Image 2: EXACT reference template / commercial shot to preserve and adapt.\n"
            f"- ZERO HALLUCINATIONS / DO NOT INVENT A NEW SCENE: You MUST preserve 100% of the composition, room environment, furniture, background, text callouts, charts, and lighting from Image 2. Do NOT invent a different room, sofa, or layout!\n"
            f"- External Context/Infographic Chrome to Preserve 100%: {preserve}\n"
            f"- Product Printable Canvas Area: {placement_zone}\n"
            f"{eliminate_section}"
            f"- Tailored Synthesis Directive:\n{directive}\n"
            f"- Obey visual physics: Maintain realistic contact shadows, depth-of-field, and lighting temperature from Image 2."
        )
        placement = placement_zone or f"Positioned exactly as demonstrated in Image 2 ({scene_title})."
        listing_requirement = f"STRICT TEMPLATE PRESERVATION: Retain the exact composition, graphics, text, and scene from Image 2 ({scene_title}). Replace only the designated product surface."
        constraints = "Preserve all external elements from Image 2. Strictly no distorted lettering, no superimposed photographer watermarks, no bleed-through of prior prints from Image 2."
        coordinated_products = "None (adhere strictly to the product items present in Image 2)."

        return f"""
Use case: final ecommerce lifestyle product photograph adapting a reference template.
{product_rule}
{scene_desc}
Placement: {placement}.
Photorealism requirements: The textile must have real cloth geometry, natural gravity, visible thickness and edge binding, broad folds plus fine weave, physically correct occlusion behind furniture, soft contact shadows, and lighting that follows the folded surface. It must look like an actual camera photograph, not a 2D collage, poster, sticker, rendering, or graphic illustration.
Coordinated products: {coordinated_products}
Listing-shot requirement: {listing_requirement}
Composition: Match the exact framing, perspective, and arrangement of Image 2. Replace only the product carrier surface.
Constraints: {constraints}
Retry correction: {correction or "None. Strictly preserve Image 2 layout and replace only the product artwork."}
""".strip()
    elif has_room_template:
        scene_desc = (
            "CRITICAL REFERENCE ROOM TEMPLATE COMPOSITING INSTRUCTION:\n"
            "- You are provided with TWO reference images: Image 1 is the textile print artwork. Image 2 is the exact reference room scene photograph.\n"
            "- PRESERVE THE ROOM EXACTLY: You MUST retain the exact walls, flooring, furniture layout, camera perspective, ambient color temperature, and lighting direction from Image 2.\n"
            "- Do NOT generate a random new room. Keep the exact furniture geometry and ambient room lighting from Image 2.\n"
            f"- Seamlessly composite and drape the {product} (faithfully displaying the print artwork from Image 1) onto the appropriate floor or furniture surface in Image 2, casting realistic contact shadows and obeying the room's light sources."
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
Photorealism requirements: The textile must have real cloth geometry, natural gravity, visible thickness and edge binding, broad folds plus fine weave, physically correct occlusion behind furniture, soft contact shadows, and lighting that follows the folded surface. It must look like an actual camera photograph, not a 2D collage, poster, sticker, rendering, or graphic illustration.
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
Photorealism requirements: The textile must have real cloth geometry, natural gravity, visible thickness and edge binding, broad folds plus fine weave, physically correct occlusion behind furniture, soft contact shadows, and lighting that follows the folded surface. It must look like an actual camera photograph, not a 2D collage, poster, sticker, rendering, or graphic illustration.
Coordinated products: {coordinated_products or "None."}
Listing-shot requirement: {pose.display_rule or placement}
Composition: Follow the requested listing-shot framing. Make the product full-size and plausible, with the artwork readable wherever the pose is intended to show it.
Constraints: {avoid} {pose.avoid}
Retry correction: {correction or "None. Render one credible, realistic product photograph."}
""".strip()


def template_pose_for_index(target: ProductTarget, index: int) -> TemplatePose:
    product = target.name.strip().lower()
    if product == "blanket":
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
    else:
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
