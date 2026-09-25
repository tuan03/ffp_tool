from __future__ import annotations

import gc
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

# Disable decompression bomb limit for high-DPI factory production (e.g., 10000x11000 blanket)
Image.MAX_IMAGE_PIXELS = None

from .config import ProductTarget


def enhance_image(source: Path, destination: Path, min_long_edge: int) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGBA")
        scale = max(1, min_long_edge / max(image.size))
        if scale > 1:
            new_size = (round(image.width * scale), round(image.height * scale))
            image = image.resize(new_size, Image.Resampling.LANCZOS)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.6, percent=120, threshold=3))
        image.save(destination)
        del image
    gc.collect()
    return destination


def fit_to_target(
    source: Path,
    destination: Path,
    target: ProductTarget,
    mode: str,
    *,
    auto_semantic_scale: bool = True,
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGBA")
        if mode == "none":
            fitted = image.resize((target.width_px, target.height_px), Image.Resampling.LANCZOS)
        elif mode == "contain":
            fitted = contain_on_canvas(image, (target.width_px, target.height_px))
        else:
            if auto_semantic_scale and detect_artwork_layout_type(image) == "centric_illustration":
                fitted = fit_centric_on_canvas(image, (target.width_px, target.height_px))
            else:
                fitted = ImageOps.fit(image, (target.width_px, target.height_px), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        del image
        fitted.save(destination, dpi=(target.dpi, target.dpi))
        del fitted
    gc.collect()
    return destination


def detect_artwork_layout_type(image: Image.Image) -> str:
    """Detect whether artwork is a centric illustration (hero graphic) or repeat pattern.

    Centric illustrations typically have:
    - Relatively uniform border strips (high margin consistency / low border variance)
    - Or transparent border pixels
    - Or a distinct subject with background margins
    Repeat patterns have continuous motifs traversing across all four borders.
    """
    import numpy as np

    rgba = image.convert("RGBA")
    w, h = rgba.size
    if w < 16 or h < 16:
        return "repeat_pattern"

    arr = np.asarray(rgba, dtype=np.float32)
    alpha = arr[..., 3]
    border_w = max(2, int(w * 0.04))
    border_h = max(2, int(h * 0.04))

    border_alpha = np.concatenate([
        alpha[:border_h, :].flatten(),
        alpha[-border_h:, :].flatten(),
        alpha[:, :border_w].flatten(),
        alpha[:, -border_w:].flatten(),
    ])
    if np.mean(border_alpha < 128) > 0.35:
        return "centric_illustration"

    rgb = arr[..., :3]
    border_rgb = np.concatenate([
        rgb[:border_h, :, :].reshape(-1, 3),
        rgb[-border_h:, :, :].reshape(-1, 3),
        rgb[:, :border_w, :].reshape(-1, 3),
        rgb[:, -border_w:, :].reshape(-1, 3),
    ], axis=0)

    border_std = float(np.mean(np.std(border_rgb, axis=0)))
    if border_std < 24.0:
        return "centric_illustration"

    return "repeat_pattern"


def fit_centric_on_canvas(
    image: Image.Image,
    size: tuple[int, int],
    margin_ratio: float = 0.08,
) -> Image.Image:
    """Fit a centric illustration onto the target canvas with balanced margins so hero motifs are never cropped.

    Pads the canvas with the artwork's detected border color (or transparent/white).
    """
    import numpy as np

    target_w, target_h = size
    avail_w = max(10, int(target_w * (1.0 - 2 * margin_ratio)))
    avail_h = max(10, int(target_h * (1.0 - 2 * margin_ratio)))

    contained = ImageOps.contain(image, (avail_w, avail_h), Image.Resampling.LANCZOS)

    rgba = image.convert("RGBA")
    arr = np.asarray(rgba)
    corners = np.concatenate([
        arr[:5, :5, :].reshape(-1, 4),
        arr[:5, -5:, :].reshape(-1, 4),
        arr[-5:, :5, :].reshape(-1, 4),
        arr[-5:, -5:, :].reshape(-1, 4),
    ], axis=0)
    median_color = tuple(int(v) for v in np.median(corners, axis=0))
    if median_color[3] < 50:
        bg_color = (255, 255, 255, 0)
    else:
        bg_color = (median_color[0], median_color[1], median_color[2], 255)

    canvas = Image.new("RGBA", size, bg_color)
    offset = ((target_w - contained.width) // 2, (target_h - contained.height) // 2)
    canvas.alpha_composite(contained, offset)
    return canvas


def contain_on_canvas(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    contained = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (255, 255, 255, 0))
    offset = ((size[0] - contained.width) // 2, (size[1] - contained.height) // 2)
    canvas.alpha_composite(contained, offset)
    return canvas


def remove_near_white_background(source: Path, destination: Path, threshold: int = 245) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        rgba = ImageOps.exif_transpose(image).convert("RGBA")
        pixels = rgba.load()
        for y in range(rgba.height):
            for x in range(rgba.width):
                red, green, blue, alpha = pixels[x, y]
                if red >= threshold and green >= threshold and blue >= threshold:
                    pixels[x, y] = (red, green, blue, 0)
                else:
                    pixels[x, y] = (red, green, blue, alpha)
        rgba.save(destination)
        del pixels
        del rgba
    gc.collect()
    return destination


def export_cmyk_jpg(source: Path, destination: Path, dpi: int) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        flattened = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode == "RGBA":
            flattened.paste(image, mask=image.getchannel("A"))
        else:
            flattened.paste(image.convert("RGB"))
        del image
        cmyk = flattened.convert("CMYK")
        del flattened
        cmyk.save(destination, quality=95, dpi=(dpi, dpi))
        del cmyk
    gc.collect()
    return destination

