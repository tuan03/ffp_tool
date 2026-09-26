"""Lossless reference preservation and deterministic master-artwork projection.

Planar homographies and curved/folded UV meshes share the same preservation gate.
AI estimates are not verified segmentation: callers must review against the source.
"""
from __future__ import annotations

import base64
import binascii
import io

import numpy as np
from PIL import Image, ImageDraw

from .surface_mesh import project_surface_mesh


def decode_surface_mask(payload: object, size: tuple[int, int]) -> Image.Image:
    """Decode Gemini's crop-local PNG probabilities and [ymin,xmin,ymax,xmax] box."""
    if not isinstance(payload, dict):
        raise ValueError("SURFACE_REVIEW_REQUIRED: bitmap segmentation is required")
    box, encoded = payload.get("box_2d"), payload.get("mask")
    if not isinstance(box, list) or len(box) != 4 or any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not np.isfinite(v) or not 0 <= v <= 1000 for v in box
    ):
        raise ValueError("SURFACE_REVIEW_REQUIRED: invalid segmentation box")
    y0, x0, y1, x1 = box
    if x0 >= x1 or y0 >= y1 or not isinstance(encoded, str) or len(encoded) > 8_000_000:
        raise ValueError("SURFACE_REVIEW_REQUIRED: invalid segmentation payload")
    if encoded.startswith("data:image/png;base64,"):
        encoded = encoded.split(",", 1)[1]
    try:
        raw = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(raw)) as opened:
            if opened.format != "PNG" or opened.width * opened.height > 16_777_216:
                raise ValueError("unsupported mask format or dimensions")
            crop = opened.convert("L")
    except (ValueError, binascii.Error, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("SURFACE_REVIEW_REQUIRED: invalid segmentation PNG") from exc
    left, top = int(x0 * size[0] / 1000), int(y0 * size[1] / 1000)
    right, bottom = int(x1 * size[0] / 1000), int(y1 * size[1] / 1000)
    if right <= left or bottom <= top:
        raise ValueError("SURFACE_REVIEW_REQUIRED: empty segmentation crop")
    crop = crop.resize((right-left, bottom-top), Image.Resampling.BILINEAR)
    mask = Image.new("L", size)
    mask.paste(crop.point(lambda value: 255 if value >= 128 else 0), (left, top))
    if mask.getbbox() is None:
        raise ValueError("SURFACE_REVIEW_REQUIRED: empty segmentation")
    return mask


def _visible_segmentation(surface: dict[str, object], size: tuple[int, int]) -> np.ndarray:
    visible = np.asarray(decode_surface_mask(surface.get("segmentation"), size)) > 0
    protected = surface.get("protected_segmentations", [])
    if not isinstance(protected, list):
        raise ValueError("SURFACE_REVIEW_REQUIRED: invalid foreground segmentations")
    for payload in protected:
        visible &= np.asarray(decode_surface_mask(payload, size)) == 0
    if not np.any(visible):
        raise ValueError("SURFACE_REVIEW_REQUIRED: no visible print remains after foreground protection")
    return visible

def _points(value: object, size: tuple[int, int], *, quad: bool = False) -> np.ndarray:
    if not isinstance(value, list) or len(value) < 3 or (quad and len(value) != 4):
        raise ValueError("SURFACE_REVIEW_REQUIRED: missing polygon or four-corner mapping")
    minimum, maximum = (-1000, 2000) if quad else (0, 1000)
    for point in value:
        if not isinstance(point, list) or len(point) != 2 or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not np.isfinite(v) or not minimum <= v <= maximum
            for v in point
        ):
            raise ValueError("SURFACE_REVIEW_REQUIRED: invalid normalized coordinates")
    points = np.asarray(value, dtype=np.float64) * np.asarray([size[0] - 1, size[1] - 1]) / 1000
    area = abs(np.dot(points[:, 0], np.roll(points[:, 1], 1)) - np.dot(points[:, 1], np.roll(points[:, 0], 1))) / 2
    if area < 4:
        raise ValueError("SURFACE_REVIEW_REQUIRED: degenerate surface")
    if quad:
        edges = np.roll(points, -1, axis=0) - points
        crosses = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
        if not np.all(crosses > 0):
            raise ValueError("SURFACE_REVIEW_REQUIRED: quad must be convex and ordered TL TR BR BL")
    return points


def _polygon_mask(size: tuple[int, int], points: np.ndarray) -> Image.Image:
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).polygon([tuple(point) for point in points], fill=255)
    return mask


def compose_reference_artwork(
    reference: Image.Image, artwork: Image.Image, plan: dict[str, object],
) -> tuple[Image.Image, Image.Image]:
    """Return RGB composite and binary edit mask, without regenerating any pixels.

    Coordinates are [x,y] in 0..1000. Each quad maps the complete master canvas;
    polygon and protected_polygons control visibility, never crop/rearrange art.
    No source luminance is reused: it may contain the old printed design.
    """
    surfaces = plan.get("surfaces")
    if plan.get("all_printable_surfaces_identified") is not True or not isinstance(surfaces, list) or not surfaces:
        raise ValueError("SURFACE_REVIEW_REQUIRED: complete printable-surface plan is required")
    output = reference.convert("RGB").copy()
    union = np.zeros((reference.height, reference.width), dtype=bool)
    source = np.array([[0, 0], [artwork.width - 1, 0], [artwork.width - 1, artwork.height - 1], [0, artwork.height - 1]])
    for surface in surfaces:
        if not isinstance(surface, dict):
            raise ValueError("SURFACE_REVIEW_REQUIRED: invalid surface")
        confidence = surface.get("confidence")
        geometry = surface.get("geometry")
        if (geometry not in {"planar", "curved", "folded"} or isinstance(confidence, bool)
                or not isinstance(confidence, (int, float)) or not 0.95 <= confidence <= 1):
            raise ValueError("SURFACE_REVIEW_REQUIRED: uncertain or unsupported geometry")
        if geometry in {"curved", "folded"} or "vertices" in surface:
            visible = _visible_segmentation(surface, reference.size)
            mask = Image.fromarray(visible.astype(np.uint8) * 255)
            if np.any(union & visible):
                raise ValueError("SURFACE_REVIEW_REQUIRED: overlapping printable surfaces")
            projected = project_surface_mesh(artwork, reference.size, surface, visible)
            output.paste(projected, (0, 0), mask)
            union |= visible
            continue
        quad = _points(surface.get("quad"), reference.size, quad=True)
        if "segmentation" in surface:
            visible = _visible_segmentation(surface, reference.size)
        else:
            polygon = _points(surface.get("polygon"), reference.size)
            visible = np.asarray(_polygon_mask(reference.size, polygon)) > 0
        quad_mask = np.asarray(_polygon_mask(reference.size, quad)) > 0
        if np.any(visible & ~quad_mask):
            raise ValueError("SURFACE_REVIEW_REQUIRED: print mask extends outside mapping")
        protected = surface.get("protected_polygons", [] if "segmentation" in surface else None)
        if not isinstance(protected, list):
            raise ValueError("SURFACE_REVIEW_REQUIRED: explicit occlusion review is required")
        for polygon_value in protected:
            visible &= np.asarray(_polygon_mask(reference.size, _points(polygon_value, reference.size))) == 0
        if not np.any(visible) or np.any(union & visible):
            raise ValueError("SURFACE_REVIEW_REQUIRED: empty or overlapping printable surfaces")
        matrix, values = [], []
        for (x, y), (u, v) in zip(quad, source):
            matrix.extend([[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]])
            values.extend([u, v])
        try:
            coefficients = np.linalg.solve(np.asarray(matrix), np.asarray(values))
        except np.linalg.LinAlgError as exc:
            raise ValueError("SURFACE_REVIEW_REQUIRED: singular projection") from exc
        projected = artwork.convert("RGB").transform(
            reference.size, Image.Transform.PERSPECTIVE, coefficients.tolist(), Image.Resampling.BICUBIC,
        )
        mask = Image.fromarray(visible.astype(np.uint8) * 255)
        output.paste(projected, (0, 0), mask)
        union |= visible
    return output, Image.fromarray(union.astype(np.uint8) * 255)
