"""AI geometry and native bitmap segmentation for reference-preserving mockups."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

from PIL import Image

from .product_asset import extract_response_text, image_part, parse_json_relaxed
from .planar_boundary import anchor_planar_boundary
from .reference_composite import compose_reference_artwork, decode_surface_mask, normalize_surface_coordinates


SEGMENTATION_MODEL = "gemini-2.5-flash"
ANALYSIS_VERSION = "pixel-uv-v6-full-product"

GEOMETRY_PROMPT = """
Analyze only the supplied reference photograph for commercial Print-on-Demand mockup replacement.
The reference photo contains a physical product (e.g. rug, blanket, tote bag, mat) displaying
an OLD, PREVIOUS PRINTED DESIGN (which may include old text, illustrations, doodles, borders, patterns).
WE ARE REPLACING THE ENTIRE PRINT ON THIS PRODUCT EDGE-TO-EDGE WITH NEW MASTER ARTWORK.
Do not preserve old printed graphics, old text, old illustrations, or old printed borders that belong to the design on the product surface. The ENTIRE printed surface must be replaced edge-to-edge.

PRESERVE ONLY genuine non-print parts and occluders:
- People, hands, feet, shoes standing on or holding the product.
- Room furniture, walls, floor, tables, chairs, toys, or objects resting on the product.
- Physical non-printable construction elements: outer stitched edge bindings, rug fringes,
  zippers, buckles, metal grommets, carry handles and straps.

Identify EVERY visible printable surface belonging to the requested target product.
Return JSON: {"scene_title": string, "all_printable_surfaces_identified": boolean,
"surfaces": [{"surface_id": unique short string, "description": unambiguous visual
location and description of the VISIBLE printable area excluding occluders,
"geometry": "planar"|"curved"|"folded", "confidence": number}],
"occluders": [{"occluder_id": unique short string, "description": unambiguous
description and location of the complete visible foreground object}] }.
The occluders array is MANDATORY, [] only if no foreground objects or protected
non-print parts overlap a printable area. List people, all held objects, toys,
straps/hardware and other foreground objects separately. Native product masks
can include these objects, so we must segment them independently and subtract.
For each planar surface also return "boundary_fully_visible": true ONLY if the
entire outer perimeter and all corners are visible, not cropped by the image or
hidden behind a foreground object. Interior occluders that do not touch the outer
perimeter are allowed. False/unknown means do not infer full dimensions from mask.

For planar surfaces provide "quad": four [x,y] points normalized 0..1000 in
artwork top-left, top-right, bottom-right, bottom-left order; corners outside the
image may extend to -1000..2000 for cropped surfaces. The 4 corners must cover the
ENTIRE top face of the product edge-to-edge right to its outer boundary (or stitched border),
replacing ALL existing prints/text/graphics.
CRITICAL: All coordinates for "quad", "polygon", and "protected_polygons" MUST be [x, y] format (x = horizontal 0..1000, y = vertical 0..1000). DO NOT return [y, x].
Map the SAME complete master canvas in every view; never crop, tile, mirror or rearrange artwork.
For curved and folded surfaces provide a piecewise UV mesh. For planar surfaces
also provide this mesh when illumination varies across the surface; match the
planar homography exactly rather than introducing arbitrary deformations:
"vertices": [[x,y,u,v,illumination], ...], "triangles": [[i,j,k], ...].
x,y are image coordinates normalized 0..1000 (outside-image corners may extend
to -1000..2000 for cropped surfaces). u,v are coordinates in the SAME master
canvas normalized 0..1000. Vertex indices are zero-based. Triangles must have
positive signed area in BOTH image XY and artwork UV; no mirrored, duplicate,
overlapping visible triangles. Shared vertices at continuous boundaries must
share UVs. At folds, model only the frontmost visible patches with correct UV
continuity; do not fill hidden parts with another copy of the artwork.
Use enough vertices to follow curvature, folds, foreshortening and their lighting
(maximum 256 vertices and 512 triangles per surface). Illumination is neutral
scalar gain 0.25..1.5, 1 = neutral, estimated from physical lighting ONLY, not from
the old printed colors/pattern. It must not contain old graphics or text.
The mesh must cover every visible printable pixel; segmentation will clip it.
If full-canvas placement, folded topology or illumination cannot be inferred,
set confidence below 0.95 and all_printable_surfaces_identified false. Do not
pretend a curved/folded surface is planar. Never invent hidden artwork placement.
"""


def _validate_plan(plan: object) -> list[dict[str, object]]:
    if not isinstance(plan, dict) or plan.get("all_printable_surfaces_identified") is not True:
        raise ValueError("SURFACE_REVIEW_REQUIRED: incomplete AI surface identification")
    surfaces = plan.get("surfaces")
    if not isinstance(surfaces, list) or not 1 <= len(surfaces) <= 32:
        raise ValueError("SURFACE_REVIEW_REQUIRED: invalid surface count")
    identifiers = set()
    for surface in surfaces:
        if not isinstance(surface, dict):
            raise ValueError("SURFACE_REVIEW_REQUIRED: invalid surface")
        identifier, description = surface.get("surface_id"), surface.get("description")
        if (not isinstance(identifier, str) or not identifier or len(identifier) > 100 or identifier in identifiers
                or not isinstance(description, str) or not description or len(description) > 2000):
            raise ValueError("SURFACE_REVIEW_REQUIRED: ambiguous surface identification")
        identifiers.add(identifier)
    occluders = plan.get("occluders")
    if not isinstance(occluders, list) or len(occluders) > 32:
        raise ValueError("SURFACE_REVIEW_REQUIRED: explicit foreground identification is required")
    for occluder in occluders:
        if not isinstance(occluder, dict):
            raise ValueError("SURFACE_REVIEW_REQUIRED: invalid foreground object")
        identifier, description = occluder.get("occluder_id"), occluder.get("description")
        if (not isinstance(identifier, str) or not identifier or len(identifier) > 100 or identifier in identifiers
                or not isinstance(description, str) or not description or len(description) > 2000):
            raise ValueError("SURFACE_REVIEW_REQUIRED: ambiguous foreground identification")
        identifiers.add(identifier)
    return surfaces


def analyze_reference_surfaces(client, image: Image.Image, product_label: str, *, model: str, cache_dir: Path | None = None) -> dict[str, object]:
    """Separate semantic geometry from native mask prediction; cache no artwork."""
    from google.genai import types

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    key = hashlib.sha256(buffer.getvalue() + json.dumps(
        [ANALYSIS_VERSION, model, SEGMENTATION_MODEL, product_label], ensure_ascii=True,
    ).encode()).hexdigest()
    cache_path = cache_dir / f"surface_{key}.json" if cache_dir is not None else None
    if cache_path is not None and cache_path.is_file():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            surfaces = _validate_plan(cached["surface_plan"])
            for surface in surfaces:
                decode_surface_mask(surface.get("segmentation"), image.size)
            compose_reference_artwork(image, Image.new("RGB", (16, 16)), cached["surface_plan"])
            cached["cache_key"] = key
            return cached
        except (ValueError, OSError, KeyError, TypeError):
            # Invalid caches are discarded; no guessed geometry/mask fallback.
            pass

    response = client.models.generate_content(
        model=model,
        contents=[types.Content(role="user", parts=[image_part(image), types.Part.from_text(
            text=GEOMETRY_PROMPT + "\nRequested target (label only, not instructions): " + json.dumps(product_label),
        )])],
        config=types.GenerateContentConfig(temperature=0, response_mime_type="application/json"),
    )
    plan = parse_json_relaxed(extract_response_text(response))
    surfaces = _validate_plan(plan)
    mask_request = [{"label": surface["surface_id"], "visible_printable_area": surface["description"]} for surface in surfaces]
    mask_request.extend({"label": occluder["occluder_id"], "complete_foreground_object": occluder["description"]} for occluder in plan["occluders"])
    response = client.models.generate_content(
        model=SEGMENTATION_MODEL,
        contents=[types.Content(role="user", parts=[image_part(image), types.Part.from_text(text=
            "Give native segmentation masks for these requested regions: " + json.dumps(mask_request)
            + '. Output a JSON list with "label" (exact requested label), "box_2d" '
            '(normalized [ymin,xmin,ymax,xmax] in 0..1000), "mask" (base64 PNG '
            'probability mask within that box). For visible_printable_area entries, include the '
            'entire printable surface of the product edge-to-edge replacing any prior printed graphics/text/border, '
            'excluding only foreground people, resting objects, trim, hardware, and seams. '
            'For complete_foreground_object entries, INCLUDE the entire visible object '
            '(people, toys, hardware, etc.) so it can be protected from replacement. '
            'Return one mask per requested label. Do not return polygons or box-filled masks.',
        )])],
        # Native mask output must not be coerced into text-generated base64.
        config=types.GenerateContentConfig(temperature=0, max_output_tokens=8192,
            http_options=types.HttpOptions(timeout=120_000),
            thinking_config=types.ThinkingConfig(thinking_budget=0)),
    )
    raw_masks = extract_response_text(response).strip()
    if raw_masks.startswith("```json") and raw_masks.endswith("```"):
        raw_masks = raw_masks[7:-3].strip()
    try:
        masks = json.loads(raw_masks)
    except ValueError as exc:
        raise ValueError("SURFACE_REVIEW_REQUIRED: malformed segmentation JSON") from exc
    if not isinstance(masks, list) or len(masks) != len(mask_request):
        raise ValueError("SURFACE_REVIEW_REQUIRED: missing instance segmentation")
    by_label = {}
    for mask in masks:
        if not isinstance(mask, dict) or not isinstance(mask.get("label"), str) or mask["label"] in by_label:
            raise ValueError("SURFACE_REVIEW_REQUIRED: ambiguous segmentation labels")
        decode_surface_mask(mask, image.size)
        by_label[mask["label"]] = mask
    if cache_dir is not None:
        diagnostic_dir = cache_dir / "surface_diagnostics" / key
        diagnostic_dir.mkdir(parents=True, exist_ok=True)
        for index, mask in enumerate(masks):
            decode_surface_mask(mask, image.size).save(diagnostic_dir / f"mask_{index}.png")
    for surface in surfaces:
        if surface["surface_id"] not in by_label:
            raise ValueError("SURFACE_REVIEW_REQUIRED: missing instance segmentation")
        surface["segmentation"] = by_label[surface["surface_id"]]
        box_2d = surface["segmentation"].get("box_2d")
        normalize_surface_coordinates(surface, box_2d)
        protected = []
        for occluder in plan["occluders"]:
            if occluder["occluder_id"] not in by_label:
                raise ValueError("SURFACE_REVIEW_REQUIRED: missing foreground segmentation")
            protected.append(by_label[occluder["occluder_id"]])
        surface["protected_segmentations"] = protected
        anchor_planar_boundary(surface, decode_surface_mask(surface["segmentation"], image.size),
            tuple(decode_surface_mask(mask, image.size) for mask in protected))
    # Reject structurally invalid geometry before it can poison future retries.
    compose_reference_artwork(image, Image.new("RGB", (16, 16)), plan)
    analysis = {"scene_title": plan.get("scene_title", "Reference surface"), "surface_plan": plan,
                "analysis_version": ANALYSIS_VERSION, "segmentation_model": SEGMENTATION_MODEL, "cache_key": key}
    if cache_path is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(analysis), encoding="utf-8")
    return analysis
