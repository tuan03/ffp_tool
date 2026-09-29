"""Anchor fully visible quadrilateral planes to pixel evidence, not niche presets."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter


def anchor_planar_boundary(surface: dict[str, object], mask: Image.Image, protected_masks: tuple[Image.Image, ...] = ()) -> None:
    if surface.get("geometry") != "planar" or surface.get("boundary_fully_visible") is not True:
        return
    visible = np.asarray(mask) > 0
    boundary_pixels = visible & (np.asarray(mask.filter(ImageFilter.MinFilter(3))) == 0)
    if any(np.any(boundary_pixels & (np.asarray(protected.filter(ImageFilter.MaxFilter(5))) > 0)) for protected in protected_masks):
        return
    # A clipped silhouette cannot tell us where the full master canvas ends.
    if np.any(visible[0]) or np.any(visible[-1]) or np.any(visible[:, 0]) or np.any(visible[:, -1]):
        return
    original = surface.get("quad")
    if not isinstance(original, list) or len(original) != 4:
        return
    try:
        original = np.asarray(original, dtype=float)
    except (ValueError, TypeError):
        return
    if original.shape != (4, 2) or not np.all(np.isfinite(original)):
        return
    rows = np.flatnonzero(visible.any(axis=1))
    if len(rows) < 4:
        return
    left = np.argmax(visible[rows], axis=1)
    right = mask.width - 1 - np.argmax(visible[rows, ::-1], axis=1)
    boundary = sorted(set(zip(left.tolist(), rows.tolist())) | set(zip(right.tolist(), rows.tolist())))

    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])

    lower, upper = [], []
    for chain, candidates in ((lower, boundary), (upper, reversed(boundary))):
        for point in candidates:
            while len(chain) >= 2 and cross(chain[-2], chain[-1], point) <= 0:
                chain.pop()
            chain.append(point)
    hull = np.asarray(lower[:-1] + upper[:-1], dtype=float)
    if len(hull) < 4:
        return
    corners = list(hull)
    while len(corners) > 4:
        losses = [abs(cross(corners[index-1], point, corners[(index+1) % len(corners)])) for index, point in enumerate(corners)]
        corners.pop(int(np.argmin(losses)))
    corners = np.asarray(corners)
    edges = np.roll(corners, -1, axis=0) - corners
    lengths = np.linalg.norm(edges, axis=1)
    if np.any(lengths < 3):
        return
    distances = np.abs((hull[:, None, 0]-corners[None, :, 0])*edges[None, :, 1]
                       - (hull[:, None, 1]-corners[None, :, 1])*edges[None, :, 0]) / lengths
    groups = np.argmin(distances, axis=1)
    normals, offsets = [], []
    for index, edge in enumerate(edges):
        samples = hull[groups == index]
        direction = edge
        if len(samples) >= 2:
            _, _, axes = np.linalg.svd(samples - samples.mean(axis=0), full_matrices=False)
            direction = axes[0]
            if np.dot(direction, edge) < 0:
                direction = -direction
        normal = np.array([direction[1], -direction[0]]) / np.linalg.norm(direction)
        normals.append(normal)
        offsets.append(float(np.max(hull @ normal)) + 0.5)
    try:
        fitted = np.asarray([np.linalg.solve(np.asarray([normals[index-1], normals[index]]),
                             np.asarray([offsets[index-1], offsets[index]])) for index in range(4)])
    except np.linalg.LinAlgError:
        return

    def area(points):
        return abs(float(np.dot(points[:, 0], np.roll(points[:, 1], -1)) - np.dot(points[:, 1], np.roll(points[:, 0], -1)))) / 2

    # Do not turn an arbitrary silhouette (circle, irregular product, etc.) into a quad.
    fitted_area = area(fitted)
    if fitted_area < 4 or area(hull) / fitted_area < 0.90:
        return
    normalized = fitted / np.asarray([mask.width-1, mask.height-1]) * 1000
    normalized = min((np.roll(normalized, shift, axis=0) for shift in range(4)),
                     key=lambda candidate: float(np.sum((candidate-original)**2)))
    surface["quad"] = normalized.tolist()
    surface["mapping_source"] = "segmentation_quadrilateral"
    vertices = surface.get("vertices")
    if isinstance(vertices, list) and all(isinstance(vertex, list) and len(vertex) == 5 for vertex in vertices):
        # Keep AI illumination, but align its planar grid with the measured plane.
        equations, values = [], []
        for (u, v), (x, y) in zip(((0, 0), (1, 0), (1, 1), (0, 1)), normalized):
            equations.extend([[u, v, 1, 0, 0, 0, -x*u, -x*v], [0, 0, 0, u, v, 1, -y*u, -y*v]])
            values.extend([x, y])
        coefficients = np.append(np.linalg.solve(equations, values), 1).reshape(3, 3)
        for vertex in vertices:
            if any(isinstance(value, bool) or not isinstance(value, (float, int)) or not np.isfinite(value) for value in vertex):
                continue
            mapped = coefficients @ np.array([vertex[2]/1000, vertex[3]/1000, 1])
            if abs(mapped[2]) > 1e-9:
                vertex[:2] = (mapped[:2]/mapped[2]).tolist()
