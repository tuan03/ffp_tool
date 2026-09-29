"""Piecewise UV projection; samples master pixels, never generates print content."""
from __future__ import annotations

import numpy as np
from PIL import Image


def _intersection_area(first: np.ndarray, second: np.ndarray) -> float:
    """Clip two positively oriented triangles; shared edges have zero area."""
    if np.any(first.max(axis=0) <= second.min(axis=0)) or np.any(second.max(axis=0) <= first.min(axis=0)):
        return 0.0
    polygon = list(first)
    for start, end in zip(second, np.roll(second, -1, axis=0)):
        clipped = []
        edge = end - start
        for previous, current in zip(polygon[-1:] + polygon[:-1], polygon):
            prev_delta, delta = previous-start, current-start
            prev_side = edge[0]*prev_delta[1] - edge[1]*prev_delta[0]
            side = edge[0]*delta[1] - edge[1]*delta[0]
            if (prev_side >= 0) != (side >= 0):
                clipped.append(previous + (current-previous) * prev_side / (prev_side-side))
            if side >= 0:
                clipped.append(current)
        polygon = clipped
        if not polygon:
            return 0.0
    points = np.asarray(polygon)
    return abs(float(np.dot(points[:, 0], np.roll(points[:, 1], -1))
                     - np.dot(points[:, 1], np.roll(points[:, 0], -1)))) / 2


def project_surface_mesh(artwork: Image.Image, size: tuple[int, int], surface: dict[str, object], visible: np.ndarray) -> Image.Image:
    vertices, triangles = surface.get("vertices"), surface.get("triangles")
    if not isinstance(vertices, list) or not 3 <= len(vertices) <= 256:
        raise ValueError("SURFACE_REVIEW_REQUIRED: missing or oversized surface mesh")
    for vertex in vertices:
        if not isinstance(vertex, list) or len(vertex) != 5 or any(
            isinstance(v, bool) or not isinstance(v, (float, int)) or not np.isfinite(v) for v in vertex
        ):
            raise ValueError("SURFACE_REVIEW_REQUIRED: invalid mesh vertex")
        x, y, u, v, light = vertex
        if not (-1000 <= x <= 2000 and -1000 <= y <= 2000 and 0 <= u <= 1000 and 0 <= v <= 1000 and 0.25 <= light <= 1.5):
            raise ValueError("SURFACE_REVIEW_REQUIRED: mesh coordinate or illumination out of range")
    if not isinstance(triangles, list) or not 1 <= len(triangles) <= 512:
        raise ValueError("SURFACE_REVIEW_REQUIRED: missing or oversized mesh topology")
    points = np.asarray(vertices, dtype=np.float64)
    points[:, :2] *= np.asarray([size[0] - 1, size[1] - 1]) / 1000
    points[:, 2:4] *= np.asarray([artwork.width - 1, artwork.height - 1]) / 1000
    master = np.asarray(artwork.convert("RGB"), dtype=np.float64)
    rendered = np.zeros((size[1], size[0], 3), dtype=np.uint8)
    covered = np.zeros(visible.shape, dtype=bool)
    interior = np.zeros(visible.shape, dtype=bool)
    seen = set()
    mapped_triangles = []
    for triangle in triangles:
        if not isinstance(triangle, list) or len(triangle) != 3 or any(
            isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < len(points) for i in triangle
        ) or len(set(triangle)) != 3:
            raise ValueError("SURFACE_REVIEW_REQUIRED: invalid triangle indices")
        key = tuple(sorted(triangle))
        if key in seen:
            raise ValueError("SURFACE_REVIEW_REQUIRED: duplicate mesh triangle")
        seen.add(key)
        selected = points[triangle]
        a, b, c = selected[:, :2]
        determinant = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
        uv_a, uv_b, uv_c = selected[:, 2:4]
        uv_area = (uv_b[0]-uv_a[0])*(uv_c[1]-uv_a[1]) - (uv_b[1]-uv_a[1])*(uv_c[0]-uv_a[0])
        if determinant <= 1e-6 or uv_area <= 1e-6:
            raise ValueError("SURFACE_REVIEW_REQUIRED: degenerate or mirrored mesh triangle")
        # Positive winding alone still allows two panels to repeat the same art.
        normalized_uv = np.asarray(vertices, dtype=np.float64)[triangle, 2:4] / 1000
        if any(_intersection_area(normalized_uv, previous) > 1e-9 for previous in mapped_triangles):
            raise ValueError("SURFACE_REVIEW_REQUIRED: overlapping UV regions duplicate master artwork")
        mapped_triangles.append(normalized_uv)
        left, top = np.maximum(np.floor(selected[:, :2].min(axis=0)), 0).astype(int)
        right, bottom = np.minimum(np.ceil(selected[:, :2].max(axis=0)) + 1, size).astype(int)
        if left >= right or top >= bottom:
            continue
        yy, xx = np.mgrid[top:bottom, left:right]
        wb = ((xx-a[0])*(c[1]-a[1]) - (yy-a[1])*(c[0]-a[0])) / determinant
        wc = ((b[0]-a[0])*(yy-a[1]) - (b[1]-a[1])*(xx-a[0])) / determinant
        weights = np.stack((1-wb-wc, wb, wc), axis=-1)
        inside = np.all(weights >= -1e-8, axis=-1)
        strict_inside = np.all(weights > 1e-8, axis=-1)
        region = np.s_[top:bottom, left:right]
        if np.any(strict_inside & interior[region] & visible[region]):
            raise ValueError("SURFACE_REVIEW_REQUIRED: overlapping visible mesh triangles")
        interior[region] |= strict_inside
        covered[region] |= inside
        active = inside & visible[region]
        if not np.any(active):
            continue
        mapped = weights[active] @ selected[:, 2:]
        u = np.clip(mapped[:, 0], 0, artwork.width - 1)
        v = np.clip(mapped[:, 1], 0, artwork.height - 1)
        x0, y0 = np.floor(u).astype(int), np.floor(v).astype(int)
        x1, y1 = np.minimum(x0+1, artwork.width-1), np.minimum(y0+1, artwork.height-1)
        dx, dy = (u-x0)[:, None], (v-y0)[:, None]
        colors = ((master[y0, x0]*(1-dx) + master[y0, x1]*dx)*(1-dy)
                  + (master[y1, x0]*(1-dx) + master[y1, x1]*dx)*dy)
        # Illumination is independent of the old print; never multiply source-photo luminance.
        rendered[region][active] = np.rint(np.clip(colors * mapped[:, 2, None], 0, 255)).astype(np.uint8)
    if np.any(visible & ~covered):
        raise ValueError("SURFACE_REVIEW_REQUIRED: segmentation extends outside mesh mapping")
    return Image.fromarray(rendered)
