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
    encoded = "".join(encoded.split())
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

def order_quad_points(points: np.ndarray) -> np.ndarray:
    """Normalize 4 points into clockwise convex quadrilateral: TL -> TR -> BR -> BL."""
    pts = np.asarray(points, dtype=np.float64)
    if pts.shape != (4, 2):
        return pts
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    pts = pts[np.argsort(angles)]
    tl_index = int(np.argmin(pts[:, 0] + pts[:, 1]))
    pts = np.roll(pts, -tl_index, axis=0)
    edges = np.roll(pts, -1, axis=0) - pts
    crosses = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
    if not np.all(crosses > 0):
        reversed_pts = np.array([pts[0], pts[3], pts[2], pts[1]])
        r_edges = np.roll(reversed_pts, -1, axis=0) - reversed_pts
        r_crosses = r_edges[:, 0] * np.roll(r_edges[:, 1], -1) - r_edges[:, 1] * np.roll(r_edges[:, 0], -1)
        if np.all(r_crosses > 0):
            pts = reversed_pts
    return pts


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
        points = order_quad_points(points)
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
        outside_pixels = np.count_nonzero(visible & ~quad_mask)
        if outside_pixels > 0:
            mask_area = np.count_nonzero(visible)
            overlap_area = np.count_nonzero(visible & quad_mask)
            coverage_ratio = overlap_area / max(1, mask_area)
            if coverage_ratio >= 0.985:
                # High coverage (>98.5%): boundary discretization fuzz is safely clipped to quad mapping
                visible = visible & quad_mask
            else:
                # Auto-repair: attempt refitting perspective quad from visible mask contour using cv2
                repaired = False
                try:
                    import cv2
                    contours, _ = cv2.findContours(visible.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    if contours:
                        cnt = max(contours, key=cv2.contourArea)
                        hull = cv2.convexHull(cnt)
                        peri = cv2.arcLength(hull, True)
                        for eps in np.linspace(0.01, 0.08, 15):
                            approx = cv2.approxPolyDP(hull, eps * peri, True)
                            if len(approx) == 4:
                                refit_quad = order_quad_points(approx.reshape(4, 2).astype(np.float64))
                                edges_r = np.roll(refit_quad, -1, axis=0) - refit_quad
                                crosses_r = edges_r[:, 0] * np.roll(edges_r[:, 1], -1) - edges_r[:, 1] * np.roll(edges_r[:, 0], -1)
                                if np.all(crosses_r > 0):
                                    refit_mask = np.asarray(_polygon_mask(reference.size, refit_quad)) > 0
                                    refit_overlap = np.count_nonzero(visible & refit_mask)
                                    if refit_overlap / max(1, mask_area) >= 0.985:
                                        quad = refit_quad
                                        quad_mask = refit_mask
                                        visible = visible & quad_mask
                                        repaired = True
                                        break
                except Exception:
                    pass
                if not repaired:
                    raise ValueError(f"SURFACE_REVIEW_REQUIRED: print mask extends outside mapping (coverage={coverage_ratio:.3f})")
        try:
            surface["quad"] = (quad * 1000.0 / np.asarray([reference.size[0] - 1, reference.size[1] - 1])).round().astype(int).tolist()
        except Exception:
            pass
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
