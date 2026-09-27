"""Lossless reference preservation and deterministic master-artwork projection.

Planar homographies and curved/folded UV meshes share the same preservation gate.
AI estimates are not verified segmentation: callers must review against the source.
"""
from __future__ import annotations

import base64
import binascii
import io
import logging

import numpy as np
from PIL import Image, ImageDraw

from .surface_mesh import project_surface_mesh

LOG = logging.getLogger("reference_composite")


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


def _extract_surface_mask(surface: dict[str, object], size: tuple[int, int]) -> np.ndarray:
    """Extract boolean mask from bitmap segmentation, polygon, quad, or box_2d."""
    seg = surface.get("segmentation")
    if isinstance(seg, dict):
        try:
            return np.asarray(decode_surface_mask(seg, size)) > 0
        except Exception as exc:
            LOG.info("Segmentation bitmap decode failed (%s); falling back to polygon mask", exc)

    poly = surface.get("polygon") or surface.get("quad")
    if poly:
        try:
            pts = _points(poly, size)
            return np.asarray(_polygon_mask(size, pts)) > 0
        except Exception as poly_exc:
            LOG.info("Polygon extraction failed (%s); checking box_2d", poly_exc)

    box = surface.get("box_2d")
    if box and isinstance(box, (list, tuple)) and len(box) == 4:
        try:
            y0, x0, y1, x1 = [float(v) for v in box]
            mask = np.zeros((size[1], size[0]), dtype=bool)
            py0 = max(0, min(size[1] - 1, int(round(y0 * (size[1] - 1) / 1000.0))))
            px0 = max(0, min(size[0] - 1, int(round(x0 * (size[0] - 1) / 1000.0))))
            py1 = max(0, min(size[1], int(round(y1 * (size[1] - 1) / 1000.0)) + 1))
            px1 = max(0, min(size[0], int(round(x1 * (size[0] - 1) / 1000.0)) + 1))
            if px1 > px0 and py1 > py0:
                mask[py0:py1, px0:px1] = True
                return mask
        except Exception:
            pass

    raise ValueError("SURFACE_REVIEW_REQUIRED: no usable segmentation, polygon, or quad provided")


def _visible_segmentation(surface: dict[str, object], size: tuple[int, int]) -> np.ndarray:
    visible = _extract_surface_mask(surface, size)
    protected = surface.get("protected_segmentations", [])
    if not isinstance(protected, list):
        raise ValueError("SURFACE_REVIEW_REQUIRED: invalid foreground segmentations")
    for payload in protected:
        if isinstance(payload, dict):
            try:
                visible &= np.asarray(decode_surface_mask(payload, size)) == 0
            except Exception:
                pass
    protected_polys = surface.get("protected_polygons", [])
    if isinstance(protected_polys, list):
        for poly_val in protected_polys:
            if poly_val:
                try:
                    poly_pts = _points(poly_val, size)
                    visible &= np.asarray(_polygon_mask(size, poly_pts)) == 0
                except Exception:
                    pass
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


def _normalize_points(
    points: object,
    box_2d: object = None,
    *,
    is_quad: bool = False,
) -> tuple[list[list[float]] | object, bool]:
    if not isinstance(points, (list, tuple, np.ndarray)):
        return points, False
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or len(pts) == 0:
        return points, False

    should_swap = False
    valid_box = None
    if isinstance(box_2d, (list, tuple, np.ndarray)) and len(box_2d) == 4:
        try:
            b = [float(v) for v in box_2d]
            if all(np.isfinite(b)):
                valid_box = b
        except (ValueError, TypeError):
            pass

    if valid_box is not None:
        ymin, xmin, ymax, xmax = valid_box
        box_w = max(1.0, xmax - xmin)
        box_h = max(1.0, ymax - ymin)
        box_aspect = box_w / box_h  # > 1.0 for horizontal/wide, < 1.0 for vertical/tall

        c0 = pts[:, 0]
        c1 = pts[:, 1]
        c0_min, c0_max = float(np.min(c0)), float(np.max(c0))
        c1_min, c1_max = float(np.min(c1)), float(np.max(c1))
        c0_span = max(1.0, c0_max - c0_min)
        c1_span = max(1.0, c1_max - c1_min)
        pts_aspect = c0_span / c1_span

        err_as_xy = abs(c0_min - xmin) + abs(c0_max - xmax) + abs(c1_min - ymin) + abs(c1_max - ymax)
        err_as_yx = abs(c0_min - ymin) + abs(c0_max - ymax) + abs(c1_min - xmin) + abs(c1_max - xmax)

        # 0. Definitive XY match: if [x, y] is already significantly better, never swap
        if err_as_xy + 15.0 < err_as_yx:
            should_swap = False
        # 1. Component alignment: does component 0 match y and component 1 match x significantly better?
        elif err_as_yx + 15.0 < err_as_xy:
            should_swap = True
        # 2. Aspect ratio inversion check: e.g. horizontal rug (box_aspect > 1.05) but points are vertical (pts_aspect < 0.95)
        elif (box_aspect > 1.05 and pts_aspect < 0.95) or (box_aspect < 0.95 and pts_aspect > 1.05):
            should_swap = True
        # 3. Containment check: points clearly fall within [ymin, ymax] for c0 and [xmin, xmax] for c1
        elif (ymin - 40 <= c0_min and c0_max <= ymax + 40 and xmin - 40 <= c1_min and c1_max <= xmax + 40) and not (
            xmin - 40 <= c0_min and c0_max <= xmax + 40 and ymin - 40 <= c1_min and c1_max <= ymax + 40
        ):
            should_swap = True

    if should_swap:
        pts = pts[:, [1, 0]]

    if is_quad and len(pts) == 4:
        pts = order_quad_points(pts)

    return pts.tolist(), should_swap


def _swap_points(points: object) -> object:
    if not isinstance(points, (list, tuple, np.ndarray)):
        return points
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim == 2 and pts.shape[1] == 2:
        return pts[:, [1, 0]].tolist()
    return points


def normalize_coordinates(
    points: object,
    box_2d: object = None,
    *,
    is_quad: bool = False,
) -> list[list[float]] | object:
    """Detect and normalize [y, x] vs [x, y] coordinates.

    Gemini Vision models naturally return coordinates in [ymin, xmin, ymax, xmax] ([row, col] / [y, x]).
    If component 0 aligns with [ymin, ymax] and component 1 aligns with [xmin, xmax],
    or if the quad aspect ratio is inverted compared to box_2d, swap [coord[1], coord[0]] to [x, y].
    For quads, order points TL -> TR -> BR -> BL.
    """
    res, _ = _normalize_points(points, box_2d, is_quad=is_quad)
    return res


def normalize_surface_coordinates(surface: dict[str, object], box_2d: object = None) -> None:
    """Normalize quad, polygon, and protected_polygons on a surface dict."""
    if not isinstance(surface, dict):
        return
    b2d = box_2d
    if not b2d and surface.get("box_2d"):
        b2d = surface.get("box_2d")
    elif not b2d and isinstance(surface.get("segmentation"), dict) and surface["segmentation"].get("box_2d"):
        b2d = surface["segmentation"]["box_2d"]
    if b2d and not surface.get("box_2d"):
        surface["box_2d"] = b2d

    is_inverted = False
    if "quad" in surface and surface["quad"]:
        norm_q, swapped = _normalize_points(surface["quad"], b2d, is_quad=True)
        surface["quad"] = norm_q
        if swapped:
            is_inverted = True

    if "polygon" in surface and surface["polygon"]:
        if is_inverted:
            surface["polygon"] = _swap_points(surface["polygon"])
        else:
            norm_p, swapped = _normalize_points(surface["polygon"], b2d, is_quad=False)
            surface["polygon"] = norm_p
            if swapped:
                is_inverted = True

    if "protected_polygons" in surface and isinstance(surface["protected_polygons"], list):
        if is_inverted:
            surface["protected_polygons"] = [
                _swap_points(poly) for poly in surface["protected_polygons"] if poly
            ]
        else:
            surface["protected_polygons"] = [
                _normalize_points(poly, b2d, is_quad=False)[0]
                for poly in surface["protected_polygons"]
                if poly
            ]


def _points(value: object, size: tuple[int, int], *, quad: bool = False) -> np.ndarray:
    if not isinstance(value, list) or len(value) < 3 or (quad and len(value) != 4):
        raise ValueError("SURFACE_REVIEW_REQUIRED: missing polygon or four-corner mapping")
    minimum, maximum = (-1000, 2000)
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
    reference: Image.Image,
    artwork: Image.Image,
    plan: dict[str, object],
    *,
    photorealistic: bool = False,
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
                or not isinstance(confidence, (int, float)) or not 0.85 <= confidence <= 1):
            raise ValueError("SURFACE_REVIEW_REQUIRED: uncertain or unsupported geometry")

        # Pillar 1: Ensure surface coordinates are normalized [x, y]
        b2d = surface.get("box_2d")
        if not b2d and isinstance(surface.get("segmentation"), dict):
            b2d = surface["segmentation"].get("box_2d")
        if not b2d and isinstance(plan.get("box_2d"), list):
            b2d = plan["box_2d"]
        if not b2d and isinstance(plan.get("product_boxes_norm_0_1000"), list) and plan["product_boxes_norm_0_1000"]:
            b2d = plan["product_boxes_norm_0_1000"][0]
        normalize_surface_coordinates(surface, b2d)

        # Pillar 2: Build exclusion zone mask from plan and surface exclusion zones
        exclusion_mask = np.zeros(reference.size[::-1], dtype=bool)
        all_exclusions = []
        if isinstance(plan.get("exclusion_zones"), list):
            all_exclusions.extend(plan["exclusion_zones"])
        if isinstance(surface.get("exclusion_zones"), list):
            all_exclusions.extend(surface["exclusion_zones"])
        for excl in all_exclusions:
            if isinstance(excl, (list, tuple)) and len(excl) == 4:
                try:
                    ey0, ex0, ey1, ex1 = [float(v) for v in excl]
                    py0 = max(0, min(reference.height - 1, int(round(ey0 * (reference.height - 1) / 1000.0))))
                    px0 = max(0, min(reference.width - 1, int(round(ex0 * (reference.width - 1) / 1000.0))))
                    py1 = max(0, min(reference.height, int(round(ey1 * (reference.height - 1) / 1000.0)) + 1))
                    px1 = max(0, min(reference.width, int(round(ex1 * (reference.width - 1) / 1000.0)) + 1))
                    if px1 > px0 and py1 > py0:
                        exclusion_mask[py0:py1, px0:px1] = True
                except (ValueError, TypeError):
                    pass

        has_mesh = (
            (geometry in {"curved", "folded"} or "vertices" in surface)
            and isinstance(surface.get("vertices"), list)
            and len(surface.get("vertices", [])) >= 3
            and isinstance(surface.get("triangles"), list)
            and len(surface.get("triangles", [])) >= 1
        )
        if has_mesh:
            visible = _visible_segmentation(surface, reference.size)
            if np.any(visible & exclusion_mask):
                visible = visible & ~exclusion_mask
            if not np.any(visible):
                raise ValueError("SURFACE_REVIEW_REQUIRED: no visible print remains after exclusion zone protection")
            mask = Image.fromarray(visible.astype(np.uint8) * 255)
            if np.any(union & visible):
                raise ValueError("SURFACE_REVIEW_REQUIRED: overlapping printable surfaces")
            projected = project_surface_mesh(artwork, reference.size, surface, visible)
            output.paste(projected, (0, 0), mask)
            union |= visible
            continue

        quad_raw = surface.get("quad")
        if not quad_raw and surface.get("box_2d"):
            b = surface["box_2d"]
            if isinstance(b, (list, tuple)) and len(b) == 4:
                quad_raw = [[b[1], b[0]], [b[3], b[0]], [b[3], b[2]], [b[1], b[2]]]
        elif not quad_raw and surface.get("polygon"):
            poly = surface["polygon"]
            if isinstance(poly, list) and len(poly) >= 3:
                xs = [p[0] for p in poly if isinstance(p, list) and len(p) >= 2]
                ys = [p[1] for p in poly if isinstance(p, list) and len(p) >= 2]
                if xs and ys:
                    min_x, max_x = min(xs), max(xs)
                    min_y, max_y = min(ys), max(ys)
                    quad_raw = [[min_x, min_y], [max_x, min_y], [max_x, max_y], [min_x, max_y]]
        quad = _points(quad_raw, reference.size, quad=True)
        if surface.get("segmentation") or surface.get("polygon"):
            visible = _visible_segmentation(surface, reference.size)
        else:
            visible = np.asarray(_polygon_mask(reference.size, quad)) > 0

        dilation_pixels = int(surface.get("dilation_pixels", 0))
        if dilation_pixels > 0:
            try:
                import cv2
                k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilation_pixels + 1, 2 * dilation_pixels + 1))
                visible = cv2.dilate(visible.astype(np.uint8), k) > 0
            except Exception:
                from PIL import ImageFilter
                dilated_img = Image.fromarray(visible.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * dilation_pixels + 1))
                visible = np.asarray(dilated_img) > 0

        # Protected polygons
        protected = surface.get("protected_polygons", [] if "segmentation" in surface else None)
        if not isinstance(protected, list):
            raise ValueError("SURFACE_REVIEW_REQUIRED: explicit occlusion review is required")
        for polygon_value in protected:
            poly_norm = normalize_coordinates(polygon_value, b2d, is_quad=False)
            poly_m = np.asarray(_polygon_mask(reference.size, _points(poly_norm, reference.size))) > 0
            exclusion_mask |= poly_m

        # Pillar 2: Exclusion Zone Collision Check & Clipping
        if np.any(visible & exclusion_mask):
            collided_px = int(np.count_nonzero(visible & exclusion_mask))
            LOG.info("Printable area collided with %d exclusion zone pixels; clipping printable surface.", collided_px)
            visible = visible & ~exclusion_mask

        if not np.any(visible):
            raise ValueError("SURFACE_REVIEW_REQUIRED: no visible print remains after exclusion zone protection")

        quad_mask = np.asarray(_polygon_mask(reference.size, quad)) > 0
        outside_pixels = np.count_nonzero(visible & ~quad_mask)

        if outside_pixels > 0:
            if dilation_pixels > 0:
                visible = visible & quad_mask
            else:
                mask_area = np.count_nonzero(visible)
                overlap_area = np.count_nonzero(visible & quad_mask)
                coverage_ratio = overlap_area / max(1, mask_area)
                if coverage_ratio >= 0.88:
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
                                        if refit_overlap / max(1, mask_area) >= 0.88:
                                            quad = refit_quad
                                            quad_mask = refit_mask
                                            visible = visible & quad_mask
                                            repaired = True
                                            break
                    except Exception:
                        pass
                    if not repaired:
                        if coverage_ratio >= 0.88:
                            visible = visible & quad_mask
                        else:
                            raise ValueError(f"SURFACE_REVIEW_REQUIRED: print mask extends outside mapping (coverage={coverage_ratio:.3f})")
        else:
            visible = visible & quad_mask

        visible = visible & ~exclusion_mask

        if not np.any(visible):
            raise ValueError("SURFACE_REVIEW_REQUIRED: no visible print remains after exclusion zone protection")

        try:
            surface["quad"] = (quad * 1000.0 / np.asarray([reference.size[0] - 1, reference.size[1] - 1])).round().astype(int).tolist()
        except Exception:
            pass

        if not np.any(visible) or np.any(union & visible):
            raise ValueError("SURFACE_REVIEW_REQUIRED: empty or overlapping printable surfaces")

        # Pillar 3: Precision Homography Projection using cv2.warpPerspective
        src_pts = np.float32([
            [0, 0],
            [artwork.width - 1, 0],
            [artwork.width - 1, artwork.height - 1],
            [0, artwork.height - 1],
        ])
        dst_pts = np.float32(quad)
        try:
            import cv2
            M = cv2.getPerspectiveTransform(src_pts, dst_pts)
            art_np = np.asarray(artwork.convert("RGB"))
            projected_cv = cv2.warpPerspective(
                art_np,
                M,
                (reference.width, reference.height),
                flags=cv2.INTER_LANCZOS4,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=(0, 0, 0),
            )
            projected = Image.fromarray(projected_cv)
        except Exception:
            matrix, values = [], []
            for (x, y), (u, v) in zip(quad, source):
                matrix.extend([[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]])
                values.extend([u, v])
            coefficients = np.linalg.solve(np.asarray(matrix), np.asarray(values))
            projected = artwork.convert("RGB").transform(
                reference.size, Image.Transform.PERSPECTIVE, coefficients.tolist(), Image.Resampling.BICUBIC,
            )

        should_shade = photorealistic or (min(reference.size) >= 512 and bool(plan.get("photorealistic", True)))
        if should_shade:
            from PIL import ImageFilter
            from .product_render import add_textile_surface

            # Pillar 3: Natural Ambient Lighting & Room Floor Tone Sampling
            # Sample ambient illumination and room tone strictly from the surrounding floor/room outside visible mask.
            vis_u8 = visible.astype(np.uint8) * 255
            try:
                import cv2
                dilated_surround = cv2.dilate(vis_u8, np.ones((25, 25), np.uint8), iterations=2) > 0
            except Exception:
                dilated_surround = np.asarray(Image.fromarray(vis_u8).filter(ImageFilter.MaxFilter(size=51))) > 0

            surround_mask = dilated_surround & ~visible & ~exclusion_mask
            ref_rgb = np.asarray(reference.convert("RGB"), dtype=np.float32)
            gray_ref = ref_rgb[..., 0] * 0.2126 + ref_rgb[..., 1] * 0.7152 + ref_rgb[..., 2] * 0.0722

            light_map = np.ones((reference.height, reference.width), dtype=np.float32)
            y_indices, x_indices = np.nonzero(surround_mask)

            # Sample room floor/ambient color tone to naturally grade white areas
            room_tint = np.array([1.0, 1.0, 1.0], dtype=np.float32)
            if len(y_indices) > 100:
                surround_lum = gray_ref[surround_mask]
                mean_lum = float(np.mean(surround_lum))
                surround_colors = ref_rgb[surround_mask]
                mean_room_rgb = np.mean(surround_colors, axis=0)
                max_channel = float(np.max(mean_room_rgb))
                if max_channel > 10.0:
                    room_tint = (mean_room_rgb / max_channel).astype(np.float32)

                if mean_lum > 10.0:
                    # Directional ambient lighting falloff matching room's light source
                    try:
                        A = np.column_stack([x_indices, y_indices, np.ones_like(x_indices)])
                        coeffs, _, _, _ = np.linalg.lstsq(A, surround_lum, rcond=None)
                        x_coords = np.arange(reference.width, dtype=np.float32)[np.newaxis, :]
                        y_coords = np.arange(reference.height, dtype=np.float32)[:, np.newaxis]
                        fitted_plane = (coeffs[0] * x_coords + coeffs[1] * y_coords + coeffs[2]) / mean_lum
                        # Directional modulation matching the room's light source
                        light_map = np.clip(fitted_plane, 0.90, 1.10).astype(np.float32)
                    except Exception:
                        light_map = np.ones((reference.height, reference.width), dtype=np.float32)

            # Color-grade white areas to natural soft ivory under warm room light (~232-238 RGB)
            # Avoid raw blinding RGB (255, 255, 255) 'paper sticker' look while preserving vibrant colors
            proj_arr = np.asarray(projected, dtype=np.float32)
            lum_proj = proj_arr[..., 0] * 0.2126 + proj_arr[..., 1] * 0.7152 + proj_arr[..., 2] * 0.0722
            white_factor = np.clip((lum_proj - 170.0) / 85.0, 0.0, 1.0)[..., np.newaxis]

            # Soft ivory tone blending ambient room temperature (~232-238 RGB)
            room_white_point = 235.0 * (0.60 + 0.40 * room_tint)
            color_graded = proj_arr * (1.0 - white_factor * (1.0 - room_white_point / 255.0))
            color_graded = color_graded * (1.0 - white_factor * 0.08 * (1.0 - room_tint))

            shaded = np.clip(color_graded * light_map[..., np.newaxis], 0, 255)
            # Ensure white areas remain soft ivory and never blow out to blinding 255 white
            shaded = np.where(white_factor > 0.75, np.minimum(shaded, 240.0), shaded).astype(np.uint8)
            shaded_img = Image.fromarray(shaded)

            # Apply subtle micro-texture / textile pile grain (for rugs/blankets) or leather grain (for bags)
            desc = (str(surface.get("description", "")) + " " + str(plan.get("scene_title", ""))).lower()
            if any(k in desc for k in ("bag", "leather", "purse", "satchel")):
                from .product_render import add_leather_surface
                shaded_img = add_leather_surface(shaded_img, strength=0.06)
            else:
                shaded_img = add_textile_surface(shaded_img, strength=0.06)

            # Subtle 2-3px soft contact shadow & edge feathering where product touches floor/base
            try:
                import cv2
                dist = cv2.distanceTransform(vis_u8, cv2.DIST_L2, 3)
                feather_radius = 1.6
                feather_alpha = np.clip(dist / feather_radius, 0.0, 1.0)
                # 2-3px contact shadow ambient occlusion darkening at the outer perimeter of the product
                edge_ao = np.clip(0.85 + 0.15 * (dist / 3.0), 0.85, 1.0)[..., np.newaxis]
                shaded_arr = np.asarray(shaded_img, dtype=np.float32)
                shaded_ao = np.clip(shaded_arr * edge_ao, 0, 255).astype(np.uint8)
                shaded_img = Image.fromarray(shaded_ao)

                feather_u8 = (feather_alpha * 255.0).astype(np.uint8)
                feather_u8[~visible] = 0
                mask = Image.fromarray(feather_u8)
            except Exception:
                blurred = Image.fromarray(vis_u8).filter(ImageFilter.GaussianBlur(radius=1.0))
                feather_u8 = np.where(visible, np.asarray(blurred), 0).astype(np.uint8)
                mask = Image.fromarray(feather_u8)
            output.paste(shaded_img, (0, 0), mask)
        else:
            mask = Image.fromarray(visible.astype(np.uint8) * 255)
            output.paste(projected, (0, 0), mask)
        union |= visible
    # Strict preservation: restore bit-for-bit identity for all pixels outside union
    out_arr = np.array(output)
    ref_arr = np.asarray(reference.convert("RGB"))
    out_arr[~union] = ref_arr[~union]
    output = Image.fromarray(out_arr)
    return output, Image.fromarray(union.astype(np.uint8) * 255)
