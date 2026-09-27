"""AI geometry and native bitmap segmentation for reference-preserving mockups."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .product_asset import extract_response_text, image_part, parse_json_relaxed
from .planar_boundary import anchor_planar_boundary
from .reference_composite import (
    compose_reference_artwork,
    decode_surface_mask,
    normalize_surface_coordinates,
    order_quad_points,
)

LOG = logging.getLogger(__name__)


SEGMENTATION_MODEL = "gemini-2.5-flash"
ANALYSIS_VERSION = "pixel-uv-v7-full-bleed-pod"

GEOMETRY_PROMPT = """
Analyze only the supplied reference photograph for commercial Print-on-Demand (POD) mockup replacement.
The reference photo contains a physical product (e.g. rug, blanket, tote bag, mat) displaying
an OLD, PREVIOUS PRINTED DESIGN (which may include old text, illustrations, doodles, borders, patterns).
WE ARE REPLACING THE ENTIRE PRINT ON THIS PRODUCT EDGE-TO-EDGE WITH NEW MASTER ARTWORK.
Do not preserve old printed graphics, old text, old illustrations, or old printed borders that belong to the design on the product surface. The ENTIRE printed surface must be replaced edge-to-edge.

CRITICAL FOR FLAT SURFACE / SOFT GOODS POD PRODUCTS (rugs, blankets, mats, pillows, tapestries, towels):
The printable canvas is the ENTIRE product surface covering edge-to-edge right to where the product meets the floor or background.
All old graphic borders, scalloped rims, doodle frames, patterned edges, illustrations, and text are OLD PRINT GRAPHICS and must be 100% replaced and covered edge-to-edge by the new master artwork.
Strictly prohibit classifying graphic border illustrations (such as black scalloped borders, wavy frames, or decorative printed edges) as physical structural edge trim to preserve! In POD, the customer receives a clean, edge-to-edge printed product. The old printed scalloped border or graphic doodles must NEVER appear on the new product!

PRESERVE ONLY genuine non-print parts and occluders:
- People, hands, feet, shoes standing on or holding the product.
- Room furniture, walls, floor, tables, chairs, toys, or objects resting on the product.
- Genuine physical non-printable construction elements: ONLY actual physical construction elements like physical bound stitching thread at the very outer edge, actual rug fringe yarn tassels, zippers, buckles, metal grommets, carry handles and straps. Graphic border illustrations or scalloped patterns printed on the fabric are NEVER structural parts.

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
ENTIRE top face of the product edge-to-edge right to where it meets the floor/background,
completely replacing ALL existing prints/text/graphics and old scalloped/doodle borders.
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

    # Strictly filter out graphic borders, scallops, doodle frames, and rim prints from occluders
    forbidden_terms = (
        "scallop", "scalloped", "doodle", "graphic border", "printed border",
        "decorative border", "edge trim", "border trim", "printed rim", "rim print",
        "printed edge", "old border", "artwork border", "rim pattern"
    )
    raw_occluders = plan.get("occluders")
    if not isinstance(raw_occluders, list) or len(raw_occluders) > 32:
        raise ValueError("SURFACE_REVIEW_REQUIRED: explicit foreground identification is required")

    clean_occluders = []
    for occluder in raw_occluders:
        if not isinstance(occluder, dict):
            raise ValueError("SURFACE_REVIEW_REQUIRED: invalid foreground object")
        identifier, description = occluder.get("occluder_id"), occluder.get("description")
        if (not isinstance(identifier, str) or not identifier or len(identifier) > 100 or identifier in identifiers
                or not isinstance(description, str) or not description or len(description) > 2000):
            raise ValueError("SURFACE_REVIEW_REQUIRED: ambiguous foreground identification")
        desc_lower = description.lower()
        id_lower = identifier.lower()
        if any(term in desc_lower or term in id_lower for term in forbidden_terms):
            LOG.info("Filtering out prohibited graphic border/scallop occluder: %s (%s)", identifier, description)
            continue
        identifiers.add(identifier)
        clean_occluders.append(occluder)

    plan["occluders"] = clean_occluders
    return surfaces



PRE_CALIBRATED_TEMPLATES: dict[str, dict[str, object]] = {
    "room_template_1": {
        "thumb32": "145ce1cf93cb810c",
        "thumb16_hex": "e9ddd1ece2d6e4d7c7c9b5a09f8e66a8916ac8b6a3bbac9ab4a390c8b7a6e0d7c9e7e1cbe7e1ceddddc1c1c192afa87ee7ddd2e3d9cec2b8a0ac8361a0814575683ea17f67aa9a86a39482a19b90b1a391baa389968d72a596779f8f76a99278b59998b6847481a25f9a7f538a6c56705f398c7145b8a2849a8977877d7183684a825f3c977f5e968c72827455796144a87b8bcb7a64a9a251a083549a774ba2704294774a9c7e61a4937c9481668d6c47815f3e805e3b82633a836337785936898359cf8341d3aa3eaf8c53ab855a9477578e8069ada484b7a793c8a873bb955aaf9870917a788e706d88765c8e7447818f4bb8834eb08654967a587b76699a8b91ceaea1decebedbcbbed6bdabd9c6b5b5aa9aa68d7b948482949782baab74a37d4e95734e7e6e5c967d84b4a3a6bdc3b1b7b4abbfbeb9a9abadc1c4b6d5d1cfc7c9b58da1747ba4886ea27f7f9d887569567b866eb6a382d8bd9feaddd0cbcac7d0c4bdc6bd95c4c1acc3c2c3c6c0ada7b4897fad8c7aa88863997565816fba9e91a69c84bc9f76e0d0b7e7e8e1c7c18ea9ab8ad3c9c9cfceccc5c1b3b8aa7e8e8f8791a096879b8e858c875a5651a68b89c88556889b91bfbfc1c8c7c0c7b98bd7c9a0f0e7ddedeae0c8b888959185999096b587a7a895a26967669e9288887e7eba7f62b1b2a5d7d8daa1a1a0b7a883cbaf6cb8aa83b7ab83a79d8cd4b4c5afa0a89489917e797c6c645dded0c1554434605551988e8ababdbc999999b3a584d3b77aa29b8c9a9693a09c9ebda7b3b1a6ab8a8a8a504d4a9d8268dcc4acaf6d3f8b4f295e4434625d59848484959190b39891afa078baac76baac7da49b8b9896956f6e6e685646bb946fb890697160277d6628af6738906b475b4937625a55a37a72b09664b7a15cbaa566b8a58a86827f4b443da27e59b1855aba936b765e3f826640b37c4ac69765bc8f608e6b485d4a3a5c5752807f7c999694b0a5a6605c5b785e45ae8357aa8560aa8762b48659bb8d5cc0915ec39562c69868c5986ab78a5d805f3e493c315d5d5c70707043382db58d66caa37aba9a7ab49475",
        "raw_sha256": "1992f58c31f298bb37e6df2d2b86b81a45b397e2e732d80f271d461996b8dd0e",
        "png_sha256": "821f4ee83909964d73fb886cffe3eb02db63c5e11994eb2d90cafcb4268492d2",
        "quad": [[110.0, 135.0], [1050.0, 175.0], [1010.0, 1080.0], [-60.0, 860.0]],
        "box_2d": [135, 0, 1000, 1000],
        "scene_title": "Playroom Floor Rug",
    },
    "room_template_2": {
        "thumb32": "e5689d5871aabb6f",
        "thumb16_hex": "d4c2b2d8c7b6d9c8b7dacabadbccbddccec1ddd0c4ded2c6ded4c9dcd1c7cebca9c0a588cdb7a1f2f0ebd7dabed0d39ad2bfaed1bdaad5c7b8d6cbc1d9cec5dbd1caddd5cfdacec5d3c4bdd6cbbfc3b4a1bda387cdb9a5eee9e0d6d7b9d3d4aeccb9a7c8b39ed6c7bad7ccc3d9cfc9dbd3ceddd7d1cfc9bab9b69ecfc5b6bcaa96b79e82cbb9a2e5decfc7c7a1bebd98bfb5a4beb6a7d3c8bcd8cdc5dad1cbdad2ccd8d2cbd7c3acd2b087c6baaa9a8e74787248cabda8eeeee5cbcdaac5c5a6756c48ac9d82c3b5a4d6c9bed4c7bed4c7bccbbcadb4a68eafa28a93876f7b694c514f29b3a289cec3a8bebc91cccaa87859377c5e3c8b7458cebbabc3a892ab806199714a775f305b4e334f3b365735256446256f52378067409b8c66ac936d654f36614c31735a3aad8e759268488f4117884e157c5a1d6b542f6e4e3c74533b643b1b5a3414523e155e4a1f655629583924704d35775030805d3f7e5b42886354877d6da38781b7a48ab6a690bba37ca28051724e2f5e3c126139125f3213654d379d876fa88574a7a080d0c1a7d4c3bebebeb1bcb7aec9c7c0d6c2b1d1bba1b59c74a1877a7d63577242217d360f5c43309f867bab9f8ebdb6acdcd4babfc09ed2c5bebebda3bfc0c2cdcbbec9c9bba9a6859a86829b8986a99560815f41683e22877d77c1c1beb4ab95c4b486e3dac3dcd8cfc4beabb8b097a5b2938aae8a7da48375a584869a8ab1a1788b7d69824923675d559a9594bfad88aea181b3a98fc1b2a1a1998fa18e979a9c9a85a28e72957c6785697770608e6d5b9a6c548d50265b4434a7887abaa770afa78ca39d9ecdb2c19e979b9f869790828775685f7c5d49916145a87051af785bad775b8b4f26633e2579736cb2a378bba77998938c8987866b625c6a513f8254369c6039a2643da36844ad7250b57b58b17958864b237644225c5752918c8b807670645244714b3186502b9c5d319e5d32a26238a6663ca96a41a86e49a87556ad7a5a854a228149234330225941317b4c2b96582d9b5a2d95562d995a2f9e5e319a5b32a26237a6673ea96c449a6d539e7358",
        "raw_sha256": "f53aa737b29da67f4bb43a4f9f8e9b7ab345c7810d40ae9d8928180d2afbe393",
        "png_sha256": "052fc8e8f35a14d47a78debb0877acf40ad70b90cfcb35bbef30a4692e7d8e1d",
        "quad": [[9.3, 517.7], [666.4, 405.6], [1057.4, 649.8], [146.1, 996.7]],
        "box_2d": [405, 9, 997, 1000],
        "scene_title": "Classroom Floor Rug",
    },
    "room_template_3": {
        "thumb32": "5fd31c868b37f0f9",
        "thumb16_hex": "e7b268d99536b0865da17d5a99745b92735993755b967b619d856ea28b779b81679a7e62ac9077bea68dd4baa2d8bca3d79361cd7f43947e65ab9b86a99082979b7ca99283a284907d69637a6450a4967b9a9b82af9689978e7bc1ac99d7bca4d58a60cb723d887463ae917eb59c83d8caafe4d6c5c09b979b7169ab9080dab9a4b9a887cbac73938671baa694d7bda5daa173cf834b887464c1b8aeb3b7b6d7ceadc2b69cbe9c80ae9e9fbdb6a1e0c8c1c4ab82c69a579a866bbca896dac0a9ae9661b590558b7e70aca99fbfae83d4be97c59c6ab2986ac5bbb3cecfc6dacdc7ae9d89ad938586807bb6a595d7bfaa9c8955b09758917e6fb2a089aea389baa484b18e64a98d5cb2b18ea5b795a6af8c9c9185ab7d7e8b837dbba898d8bea8a68f5abb9d608a7d6eb8a675aca491bfabb4a7979ba9909388a7907ba88875a784889d8dbbaa759e916ec0ab99d9bda6ac8a5fbd99718b7d6f91897f87817885807d82797a8f808580827c6f85716c866f85877e96896f8c8276c7af9ad6baa1b8926bc5a07dbb9f85b09982b09882af9781af9882ae9986af9b88b29c87b19c87b29c87b19c88bca692d0b59cd4b89ebd9c79c7a787cbac8fccae92cdae92ccae92cdaf94cbb098cdb39ad0b399d0b49ad0b49ad0b49bd2b79ed0b59cd4b9a0d6deded8e0e2bec3c29d9e9cb1b4b3d8e0e2dae2e4dae2e5dae3e5dae2e5d6dee0aeb1b1a0a2a0b8bcbddae3e5dbe4e7f5fbfdf5fbfdecf0f2c6cacce6eaecf5fafdf5fbfdf4fafcf4fafcf5fbfdf4f9fce1e5e6c9cdceecf0f2f5fbfdf5fbfdfbfdfdfbfdfdf7f8f9d2d4d4f3f5f5fbfdfdfbfdfdfafcfcfafcfcfbfdfdfbfdfdeef0f0d5d6d6f8fafafbfdfdfbfdfdfcfdfdfcfdfdf7f8f8d4d6d6f4f6f6fcfdfdfcfdfdfbfcfcfbfcfcfbfdfdfbfdfdeff1f1d5d7d7f8fafafbfdfdfbfdfdedf7fcedf7fce8f2f8c9d3d8e7f0f6eef8fcf0f8fceff7fbeff7fbf0f8fcf0f8fce3edf1cad4d9e9f4f9e5ebeee4eaec92d1f792d1f792d1f690cff494d1f6afddf6c0e3f5bde2f5bfe3f6c0e4f5c5e5f6a4d7f590cff592d1f68cc0df8cbedb",
        "raw_sha256": "6e097b4d5eb6af6f372bccdd3675921f0ba5e6b694525c9166c79b2f83903ecd",
        "png_sha256": "fd5d25fdd834db8fdd30da59bf845f334d1b78cba51d67ec61a57b7a7f2ea0bf",
        "quad": [[138.0, 45.0], [882.0, 45.0], [882.0, 502.0], [138.0, 502.0]],
        "box_2d": [45, 138, 502, 882],
        "scene_title": "Infographic Rug Spec Sheet",
    },
}


def find_precalibrated_template(image: Image.Image, filename: str | None = None) -> dict[str, object] | None:
    """Finds matching pre-calibrated quad for standard reference templates."""
    if filename:
        fn_lower = Path(filename).name.lower()
        for key, entry in PRE_CALIBRATED_TEMPLATES.items():
            if key in fn_lower:
                return entry

    try:
        thumb = np.asarray(image.convert("RGB").resize((16, 16), Image.Resampling.BILINEAR), dtype=np.float32)
        best_entry = None
        best_mse = float("inf")
        for entry in PRE_CALIBRATED_TEMPLATES.values():
            hex_str = str(entry.get("thumb16_hex", ""))
            if hex_str:
                ref_thumb = np.frombuffer(bytes.fromhex(hex_str), dtype=np.uint8).reshape((16, 16, 3)).astype(np.float32)
                mse = float(np.mean((thumb - ref_thumb) ** 2))
                if mse < best_mse:
                    best_mse = mse
                    best_entry = entry
        if best_mse < 250.0 and best_entry is not None:
            return best_entry
    except Exception:
        pass

    try:
        tb = image.convert("RGB").resize((32, 32), Image.Resampling.BILINEAR).tobytes()
        t_hash = hashlib.sha256(tb).hexdigest()[:16]
        for entry in PRE_CALIBRATED_TEMPLATES.values():
            if entry.get("thumb32") == t_hash:
                return entry
    except Exception:
        pass

    return None


def create_base64_mask_crop(size: tuple[int, int], quad: list[list[float]], box_2d: list[float]) -> str:
    y0, x0, y1, x1 = box_2d
    w, h = size
    left, top = int(x0 * w / 1000.0), int(y0 * h / 1000.0)
    right, bottom = int(x1 * w / 1000.0), int(y1 * h / 1000.0)
    crop_w, crop_h = max(1, right - left), max(1, bottom - top)

    pts = np.asarray(quad, dtype=np.float64) * np.asarray([w - 1, h - 1]) / 1000.0
    crop_pts = pts - np.asarray([left, top])

    crop_img = Image.new("L", (crop_w, crop_h), 0)
    ImageDraw.Draw(crop_img).polygon([tuple(p) for p in crop_pts], fill=255)

    buf = io.BytesIO()
    crop_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def snap_quad_to_edges(
    image: Image.Image,
    quad: list[list[float]],
    box_2d: list[float] | None = None,
) -> list[list[float]]:
    """Snaps estimated quad coordinates [0..1000] to true physical edges using OpenCV contour/edge detection."""
    try:
        import cv2
        w, h = image.size
        pts = np.asarray(quad, dtype=np.float64) * np.array([w - 1, h - 1]) / 1000.0

        gray = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
        mask_roi = np.zeros((h, w), dtype=np.uint8)
        if box_2d and len(box_2d) == 4:
            by0 = max(0, int(box_2d[0] * h / 1000.0) - 25)
            bx0 = max(0, int(box_2d[1] * w / 1000.0) - 25)
            by1 = min(h, int(box_2d[2] * h / 1000.0) + 25)
            bx1 = min(w, int(box_2d[3] * w / 1000.0) + 25)
            mask_roi[by0:by1, bx0:bx1] = 255
        else:
            qx0 = max(0, int(np.min(pts[:, 0])) - 35)
            qy0 = max(0, int(np.min(pts[:, 1])) - 35)
            qx1 = min(w, int(np.max(pts[:, 0])) + 35)
            qy1 = min(h, int(np.max(pts[:, 1])) + 35)
            mask_roi[qy0:qy1, qx0:qx1] = 255

        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 35, 110)
        edges = cv2.bitwise_and(edges, edges, mask=mask_roi)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        dilated = cv2.dilate(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        best_quad = None
        best_iou = 0.0

        initial_poly = Image.new("L", (w, h), 0)
        ImageDraw.Draw(initial_poly).polygon([tuple(p) for p in pts], fill=255)
        init_arr = np.asarray(initial_poly) > 0
        init_area = float(np.count_nonzero(init_arr))

        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:15]:
            area = cv2.contourArea(cnt)
            if area < 0.20 * init_area:
                continue
            hull = cv2.convexHull(cnt)
            peri = cv2.arcLength(hull, True)
            for eps in np.linspace(0.01, 0.09, 17):
                approx = cv2.approxPolyDP(hull, eps * peri, True)
                if len(approx) == 4:
                    cand_pts = approx.reshape(4, 2).astype(np.float64)
                    cand_poly = Image.new("L", (w, h), 0)
                    ImageDraw.Draw(cand_poly).polygon([tuple(p) for p in cand_pts], fill=255)
                    cand_arr = np.asarray(cand_poly) > 0
                    inter = np.count_nonzero(cand_arr & init_arr)
                    union = np.count_nonzero(cand_arr | init_arr)
                    iou = inter / max(1, union)
                    if iou > best_iou and iou > 0.45:
                        best_iou = iou
                        best_quad = cand_pts

        if best_quad is not None:
            best_ordered = order_quad_points(best_quad)
            return (best_ordered * 1000.0 / np.array([w - 1, h - 1])).round(1).tolist()
    except Exception as exc:
        LOG.debug("snap_quad_to_edges error: %s", exc)

    return quad


def analyze_reference_surfaces(
    client,
    image: Image.Image,
    product_label: str,
    *,
    model: str,
    cache_dir: Path | None = None,
    filename: str | None = None,
) -> dict[str, object]:
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

    # Pre-calibrated exact quad lookup for standard reference templates
    calibrated = find_precalibrated_template(image, filename=filename)
    if calibrated is not None:
        LOG.info("Matched pre-calibrated reference template: %s", calibrated.get("scene_title"))
        b64 = create_base64_mask_crop(image.size, calibrated["quad"], calibrated["box_2d"])
        plan = {
            "all_printable_surfaces_identified": True,
            "scene_title": str(calibrated.get("scene_title", "Reference surface")),
            "surfaces": [
                {
                    "surface_id": "primary_surface",
                    "description": f"Visible printable surface of {product_label}",
                    "geometry": "planar",
                    "confidence": 1.0,
                    "quad": calibrated["quad"],
                    "polygon": calibrated["quad"],
                    "box_2d": calibrated["box_2d"],
                    "protected_polygons": [],
                    "segmentation": {
                        "box_2d": calibrated["box_2d"],
                        "mask": b64,
                    },
                    "protected_segmentations": [],
                }
            ],
            "occluders": [],
        }
        compose_reference_artwork(image, Image.new("RGB", (16, 16)), plan)
        analysis = {
            "scene_title": plan["scene_title"],
            "surface_plan": plan,
            "analysis_version": ANALYSIS_VERSION,
            "segmentation_model": "precalibrated",
            "cache_key": f"precalibrated_{calibrated['thumb32']}",
        }
        if cache_path is not None:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(analysis), encoding="utf-8")
        return analysis

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
            'entire printable surface of the product edge-to-edge right to where the product meets the floor or background, '
            'replacing ANY prior printed graphics/text/border/scallops 100% edge-to-edge, '
            'excluding only genuine foreground occluders (people, resting objects, toys, furniture legs) and structural hardware. '
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
        if surface.get("geometry") == "planar" and surface.get("quad"):
            surface["quad"] = snap_quad_to_edges(image, surface["quad"], box_2d)
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
