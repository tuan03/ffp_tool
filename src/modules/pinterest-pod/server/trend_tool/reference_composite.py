"""Lossless reference preservation and deterministic master-artwork projection.

Only planar surfaces are supported. A model's geometry estimate is not a verified
segmentation: the caller must additionally review the composite against its source.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw


def _points(value: object, size: tuple[int, int], *, quad: bool = False) -> np.ndarray:
    if not isinstance(value, list) or len(value) < 3 or (quad and len(value) != 4):
        raise ValueError("SURFACE_REVIEW_REQUIRED: missing polygon or four-corner mapping")
    for point in value:
        if not isinstance(point, list) or len(point) != 2 or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not np.isfinite(v) or not 0 <= v <= 1000
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
        if (surface.get("geometry") != "planar" or isinstance(confidence, bool)
                or not isinstance(confidence, (int, float)) or not 0.95 <= confidence <= 1):
            raise ValueError("SURFACE_REVIEW_REQUIRED: uncertain or non-planar geometry")
        quad = _points(surface.get("quad"), reference.size, quad=True)
        polygon = _points(surface.get("polygon"), reference.size)
        visible = np.asarray(_polygon_mask(reference.size, polygon)) > 0
        quad_mask = np.asarray(_polygon_mask(reference.size, quad)) > 0
        if np.any(visible & ~quad_mask):
            raise ValueError("SURFACE_REVIEW_REQUIRED: print mask extends outside mapping")
        protected = surface.get("protected_polygons")
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
