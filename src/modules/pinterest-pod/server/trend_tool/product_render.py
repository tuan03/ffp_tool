from __future__ import annotations

import io
import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

from .config import ProductTarget, infer_product_type
from .product_asset import (
    create_gemini_client,
    extract_image_bytes,
    extract_response_text,
    image_part,
    parse_json_relaxed,
)

LOG = logging.getLogger("product_render")


def _normalize_box(raw_box: Any) -> list[int] | None:
    if isinstance(raw_box, dict):
        if "box_2d" in raw_box and isinstance(raw_box["box_2d"], (list, tuple)) and len(raw_box["box_2d"]) == 4:
            raw_box = raw_box["box_2d"]
        elif all(k in raw_box for k in ("ymin", "xmin", "ymax", "xmax")):
            raw_box = [raw_box["ymin"], raw_box["xmin"], raw_box["ymax"], raw_box["xmax"]]
        else:
            return None
    if isinstance(raw_box, (list, tuple)) and len(raw_box) == 4:
        try:
            raw_nums = [float(x) for x in raw_box]
            if max(raw_nums) <= 1.0 and any(x > 0 for x in raw_nums):
                raw_nums = [x * 1000.0 for x in raw_nums]
            y1, x1, y2, x2 = [int(round(x)) for x in raw_nums]
            ymin, ymax = max(0, min(y1, y2)), min(1000, max(y1, y2))
            xmin, xmax = max(0, min(x1, x2)), min(1000, max(x1, x2))
            if ymax > ymin + 16 and xmax > xmin + 16:
                return [ymin, xmin, ymax, xmax]
        except (ValueError, TypeError):
            pass
    return None


@dataclass(frozen=True)
class ProductRenderRecord:
    source_path: Path
    print_path: Path
    product_path: Path
    mask_path: Path
    product_name: str
    shape: str
    width: int
    height: int
    status: str
    notes: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class UniversalProductCanvas:
    carrier_image: Image.Image
    surface_box: tuple[int, int, int, int]  # (left, top, right, bottom)
    surface_mask: Image.Image
    luminance_map: np.ndarray | None
    material_type: str
    canvas_name: str


def render_product_from_print(
    *,
    source_path: Path,
    print_path: Path,
    product_path: Path,
    mask_path: Path,
    target: ProductTarget,
    max_long_edge: int = 1800,
    reference_templates: list[Path] | None = None,
    canvas_cache: dict[str, Any] | None = None,
    client: Any = None,
    backend: str = "auto",
    model: str = "gemini-2.5-flash",
) -> ProductRenderRecord:
    product_path.parent.mkdir(parents=True, exist_ok=True)
    mask_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(print_path) as opened:
        artwork = ImageOps.exif_transpose(opened).convert("RGBA")

    raw_name = (target.name or "").strip().lower()
    active_niche = (getattr(target, "niche", "") or "").strip().lower()
    inferred = infer_product_type(active_niche or raw_name)

    # When reference templates exist, prioritize universal product canvas extraction
    # from the uploaded physical product templates.
    if reference_templates:
        canvas = get_or_create_universal_product_canvas(
            target=target,
            reference_templates=reference_templates,
            canvas_cache=canvas_cache,
            client=client,
            backend=backend,
            model=model,
            max_long_edge=max_long_edge,
        )
        product, mask = render_universal_product(artwork, canvas, target, max_long_edge)
        notes = f"print artwork rendered as a universal {active_niche or target.name} product asset from reference templates"
        shape = canvas.canvas_name
    elif inferred == "blanket":
        product, mask = render_blanket_product(artwork, target, max_long_edge)
        notes = "print artwork rendered as a soft blanket product asset"
        shape = "rectangle"
    elif inferred == "rug":
        product, mask = render_rug_product(artwork, target, max_long_edge)
        notes = f"print artwork rendered as a {target.rug_shape} rug product asset"
        shape = target.rug_shape if target.name == "rug" else "rectangle"
    else:
        canvas = get_or_create_universal_product_canvas(
            target=target,
            reference_templates=reference_templates,
            canvas_cache=canvas_cache,
            client=client,
            backend=backend,
            model=model,
            max_long_edge=max_long_edge,
        )
        product, mask = render_universal_product(artwork, canvas, target, max_long_edge)
        notes = f"print artwork rendered as a universal {active_niche or target.name} product asset"
        shape = canvas.canvas_name

    product.save(product_path)
    mask.save(mask_path)
    return ProductRenderRecord(
        source_path=source_path,
        print_path=print_path,
        product_path=product_path,
        mask_path=mask_path,
        product_name=target.name,
        shape=shape,
        width=product.width,
        height=product.height,
        status="ok",
        notes=notes,
    )


def get_or_create_universal_product_canvas(
    *,
    target: ProductTarget,
    reference_templates: list[Path] | None = None,
    canvas_cache: dict[str, Any] | None = None,
    client: Any = None,
    backend: str = "auto",
    model: str = "gemini-2.5-flash",
    max_long_edge: int = 1800,
) -> UniversalProductCanvas:
    raw_name = (target.name or "").strip().lower()
    active_niche = (getattr(target, "niche", "") or "").strip().lower()
    cache_key = f"universal_canvas_{active_niche or raw_name}"

    if canvas_cache is not None and cache_key in canvas_cache:
        return canvas_cache[cache_key]

    carrier_canvas: UniversalProductCanvas | None = None

    # Step 1: If reference images exist, dynamically segment the physical carrier
    if reference_templates:
        for ref_file in reference_templates:
            if not ref_file.exists() or not ref_file.is_file():
                continue
            try:
                cached_box_info: tuple[list[int] | None, list[int] | None] = (None, None)
                ref_cache_path = ref_file.parent / "reference_analysis_cache.json"
                if ref_cache_path.exists() and ref_cache_path.is_file():
                    try:
                        cache_data = json.loads(ref_cache_path.read_text(encoding="utf-8"))
                        if isinstance(cache_data, dict):
                            for entry in cache_data.values():
                                if not isinstance(entry, dict):
                                    continue
                                instances = entry.get("product_instances") or []
                                p_boxes = entry.get("product_boxes_norm_0_1000") or []
                                hero_c_box: list[int] | None = None
                                for inst in instances:
                                    if isinstance(inst, dict):
                                        p_desc = str(inst.get("pose_and_presentation", "")).lower()
                                        if any(hw in p_desc for hw in ("zipper", "strap", "buckle", "open", "interior", "hardware")):
                                            continue
                                        hero_c_box = _normalize_box(inst.get("box_2d"))
                                        if hero_c_box:
                                            break
                                hero_s_box: list[int] | None = None
                                if p_boxes:
                                    hero_s_box = _normalize_box(p_boxes[0])
                                if hero_c_box or hero_s_box:
                                    cached_box_info = (hero_c_box, hero_s_box)
                                    break
                    except Exception:
                        pass

                with Image.open(ref_file) as opened_ref:
                    ref_img = ImageOps.exif_transpose(opened_ref).convert("RGB")
                carrier_canvas = extract_product_canvas_from_reference(
                    ref_img,
                    target=target,
                    client=client,
                    backend=backend,
                    model=model,
                    max_long_edge=max_long_edge,
                    cached_boxes=cached_box_info,
                )
                if carrier_canvas is not None:
                    LOG.info("Segmented universal product carrier from reference template %s", ref_file.name)
                    break
            except Exception as ref_exc:
                LOG.warning("Could not extract product carrier from %s: %s", ref_file.name, ref_exc)

    # Step 2: If no reference template exists, create universal dynamic product blank for niche
    if carrier_canvas is None:
        carrier_canvas = generate_universal_product_blank(
            target=target,
            client=client,
            backend=backend,
            model=model,
            max_long_edge=max_long_edge,
        )

    if canvas_cache is not None:
        canvas_cache[cache_key] = carrier_canvas

    return carrier_canvas


def extract_product_canvas_from_reference(
    template: Image.Image,
    *,
    target: ProductTarget,
    client: Any = None,
    backend: str = "auto",
    model: str = "gemini-2.5-flash",
    max_long_edge: int = 1800,
    cached_boxes: tuple[list[int] | None, list[int] | None] | None = None,
) -> UniversalProductCanvas | None:
    raw_name = (target.name or "").strip().lower()
    active_niche = (getattr(target, "niche", "") or "").strip().lower()
    niche_label = active_niche or raw_name or "product"
    is_bag = any(k in niche_label for k in ("bag", "handbag", "tote", "purse", "satchel", "backpack"))

    carrier_box_norm: list[int] | None = None
    surface_box_norm: list[int] | None = None

    if cached_boxes:
        c_box, s_box = cached_boxes
        if c_box:
            carrier_box_norm = c_box
        if s_box:
            surface_box_norm = s_box

    if carrier_box_norm is None:
        if client is None and backend and backend not in ("off", "none", "mock", "test"):
            try:
                client = create_gemini_client(backend)
            except Exception:
                client = None

        if client is not None:
            try:
                from google.genai import types

                prompt = (
                    f"Analyze this image to extract a clean commercial product asset for {niche_label}.\n"
                    f"Identify:\n"
                    f"1. 'carrier_box': normalized [ymin, xmin, ymax, xmax] in 0..1000 scale tightly bounding the primary physical product (including handles, straps, hardware, zippers).\n"
                    f"2. 'surface_box': normalized [ymin, xmin, ymax, xmax] in 0..1000 scale bounding the printable surface panel where custom artwork/patterns are mapped (e.g. front body leather/fabric panel, excluding handles, straps, and zippers).\n"
                    f"Return JSON only: {{\"carrier_box\": [ymin, xmin, ymax, xmax], \"surface_box\": [ymin, xmin, ymax, xmax]}}"
                )
                res = client.models.generate_content(
                    model=model,
                    contents=[
                        types.Content(
                            role="user",
                            parts=[
                                image_part(template, max_side=1024),
                                types.Part.from_text(text=prompt),
                            ],
                        )
                    ],
                    config=types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
                )
                raw_text = extract_response_text(res)
                data = parse_json_relaxed(raw_text)
                if isinstance(data, dict):
                    carrier_box_norm = _normalize_box(data.get("carrier_box"))
                    surface_box_norm = _normalize_box(data.get("surface_box"))
            except Exception as vision_exc:
                LOG.warning("Gemini Vision carrier detection fallback: %s", vision_exc)

    if carrier_box_norm is None:
        carrier_box_norm = [80, 80, 920, 920]

    w, h = template.size
    c_ymin, c_xmin, c_ymax, c_xmax = carrier_box_norm
    c_left = int(c_xmin * w / 1000.0)
    c_top = int(c_ymin * h / 1000.0)
    c_right = int(c_xmax * w / 1000.0)
    c_bottom = int(c_ymax * h / 1000.0)

    c_w = max(32, c_right - c_left)
    c_h = max(32, c_bottom - c_top)
    carrier_crop = template.crop((c_left, c_top, c_left + c_w, c_top + c_h))

    # Scale carrier if needed to maintain resolution
    scale = min(1.0, max_long_edge / max(c_w, c_h))
    if scale < 1.0:
        new_w, new_h = max(16, round(c_w * scale)), max(16, round(c_h * scale))
        carrier_crop = carrier_crop.resize((new_w, new_h), Image.Resampling.LANCZOS)
        c_w, c_h = new_w, new_h

    # Compute surface box relative to carrier crop
    if surface_box_norm is not None:
        s_ymin, s_xmin, s_ymax, s_xmax = surface_box_norm
        s_left_abs = int(s_xmin * w / 1000.0)
        s_top_abs = int(s_ymin * h / 1000.0)
        s_right_abs = int(s_xmax * w / 1000.0)
        s_bottom_abs = int(s_ymax * h / 1000.0)

        rel_left = max(0, min(c_w - 24, int((s_left_abs - c_left) * scale)))
        rel_top = max(0, min(c_h - 24, int((s_top_abs - c_top) * scale)))
        rel_right = max(rel_left + 20, min(c_w, int((s_right_abs - c_left) * scale)))
        rel_bottom = max(rel_top + 20, min(c_h, int((s_bottom_abs - c_top) * scale)))
        surface_box = (rel_left, rel_top, rel_right, rel_bottom)
    else:
        # Intelligently derive surface box inside carrier crop:
        # For bags: top handles occupy the upper ~20-25%; exclude them from surface box
        if is_bag:
            surface_box = (
                max(4, int(c_w * 0.06)),
                max(8, int(c_h * 0.20)),
                max(20, int(c_w * 0.94)),
                max(24, int(c_h * 0.94)),
            )
        else:
            surface_box = (
                max(4, int(c_w * 0.08)),
                max(4, int(c_h * 0.08)),
                max(20, int(c_w * 0.92)),
                max(20, int(c_h * 0.92)),
            )

    sb_w = surface_box[2] - surface_box[0]
    sb_h = surface_box[3] - surface_box[1]

    # Convert carrier to RGBA and remove plain studio background if present
    carrier_rgba = carrier_crop.convert("RGBA")
    arr = np.asarray(carrier_rgba)
    corners = np.concatenate([
        arr[:4, :4, :3].reshape(-1, 3),
        arr[:4, -4:, :3].reshape(-1, 3),
        arr[-4:, :4, :3].reshape(-1, 3),
        arr[-4:, -4:, :3].reshape(-1, 3),
    ], axis=0)
    mean_corner_rgb = float(np.mean(corners))
    std_corner_rgb = float(np.std(corners))
    if mean_corner_rgb > 215 and std_corner_rgb < 25:
        # Light studio background detected -> flood fill from 4 corners to make background transparent
        for pt in [(0, 0), (c_w - 1, 0), (0, c_h - 1), (c_w - 1, c_h - 1)]:
            ImageDraw.floodfill(carrier_rgba, pt, (255, 255, 255, 0), thresh=25)

    # Extract luminance map for lighting & folds transfer
    surface_crop = carrier_crop.crop(surface_box)
    rgb_arr = np.asarray(surface_crop.convert("RGB"), dtype=np.float32)
    lum = rgb_arr[..., 0] * 0.2126 + rgb_arr[..., 1] * 0.7152 + rgb_arr[..., 2] * 0.0722
    blur_r = max(4, min(sb_w, sb_h) // 30)
    blur_lum_img = Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=blur_r))
    blur_lum = np.asarray(blur_lum_img, dtype=np.float32)
    if blur_lum.size > 0 and not np.isnan(np.median(blur_lum)) and float(np.median(blur_lum)) > 0:
        median = float(np.median(blur_lum))
    else:
        median = 128.0
    shade = np.clip(blur_lum / max(1.0, median), 0.65, 1.35)

    # Soft feathered surface mask
    mask = Image.new("L", (sb_w, sb_h), 255)
    radius = max(8, min(sb_w, sb_h) // 25)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, sb_w, sb_h), radius=radius, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(2, min(sb_w, sb_h) // 60)))

    material = "leather" if "leather" in niche_label else ("fabric" if any(k in niche_label for k in ("textile", "fabric", "cloth", "canvas")) else "smooth")

    return UniversalProductCanvas(
        carrier_image=carrier_rgba,
        surface_box=surface_box,
        surface_mask=mask,
        luminance_map=shade,
        material_type=material,
        canvas_name=f"{niche_label}_carrier",
    )


def generate_universal_product_blank(
    *,
    target: ProductTarget,
    client: Any = None,
    backend: str = "auto",
    model: str = "gemini-2.5-flash",
    max_long_edge: int = 1800,
) -> UniversalProductCanvas:
    raw_name = (target.name or "").strip().lower()
    active_niche = (getattr(target, "niche", "") or "").strip().lower()
    niche_label = active_niche or raw_name or "commercial product"

    if client is None and backend and backend not in ("off", "none", "mock", "test"):
        try:
            client = create_gemini_client(backend)
        except Exception:
            client = None

    if client is not None:
        try:
            from google.genai import types

            blank_prompt = (
                f"A clean commercial studio e-commerce photograph of a plain neutral blank {niche_label} on solid white background. "
                f"Front three-quarter view, high resolution, soft studio lighting, sharp focus, no graphics, no prints, no logos, no text."
            )
            gen_res = client.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=[types.Content(role="user", parts=[types.Part.from_text(text=blank_prompt)])],
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    temperature=0.2,
                    image_config=types.ImageConfig(aspect_ratio="1:1", image_size="2K", output_mime_type="image/png"),
                ),
            )
            img_bytes, _ = extract_image_bytes(gen_res)
            if img_bytes:
                with Image.open(io.BytesIO(img_bytes)) as generated:
                    blank_img = generated.convert("RGB")
                extracted = extract_product_canvas_from_reference(
                    blank_img,
                    target=target,
                    client=client,
                    backend=backend,
                    model=model,
                    max_long_edge=max_long_edge,
                )
                if extracted is not None:
                    return extracted
        except Exception as gen_exc:
            LOG.warning("Dynamic product blank AI generation skipped: %s", gen_exc)

    return create_synthetic_carrier(target, max_long_edge, niche_label)


def create_synthetic_carrier(target: ProductTarget, max_long_edge: int, niche_label: str) -> UniversalProductCanvas:
    product_size = product_canvas_size(target, max_long_edge)
    carrier = Image.new("RGBA", product_size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(carrier)

    is_bag = any(k in niche_label for k in ("bag", "handbag", "tote", "purse", "satchel", "backpack"))

    if is_bag:
        body_box = inset_box(product_size, 0.08, 0.18)
        radius = max(28, min(product_size) // 20)
        # Handles on top
        handle_w = max(14, min(product_size) // 50)
        h_left = body_box[0] + (body_box[2] - body_box[0]) // 4
        h_right = body_box[2] - (body_box[2] - body_box[0]) // 4
        h_top = max(10, int(product_size[1] * 0.05))
        draw.arc((h_left, h_top, h_right, body_box[1] + 40), start=180, end=0, fill=(45, 35, 30, 255), width=handle_w)
        # Leather carrier base
        draw.rounded_rectangle(body_box, radius=radius, fill=(50, 40, 35, 255))
        # Metallic hardware accents (buckles)
        draw.rectangle((h_left - 6, body_box[1] - 4, h_left + 6, body_box[1] + 16), fill=(210, 175, 90, 255))
        draw.rectangle((h_right - 6, body_box[1] - 4, h_right + 6, body_box[1] + 16), fill=(210, 175, 90, 255))
        surface_box = inset_box((body_box[2] - body_box[0], body_box[3] - body_box[1]), 0.04, 0.05)
        surface_box = (
            body_box[0] + surface_box[0],
            body_box[1] + surface_box[1],
            body_box[0] + surface_box[2],
            body_box[1] + surface_box[3],
        )
    else:
        body_box = inset_box(product_size, 0.05, 0.05)
        radius = max(20, min(product_size) // 26)
        draw.rounded_rectangle(body_box, radius=radius, fill=(240, 240, 242, 255))
        surface_box = inset_box(product_size, 0.06, 0.06)

    sb_w = surface_box[2] - surface_box[0]
    sb_h = surface_box[3] - surface_box[1]
    mask = Image.new("L", (sb_w, sb_h), 255)
    draw_mask = ImageDraw.Draw(mask)
    draw_mask.rounded_rectangle((0, 0, sb_w, sb_h), radius=max(12, min(sb_w, sb_h) // 30), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=2))

    material = "leather" if ("leather" in niche_label or is_bag) else "smooth"

    return UniversalProductCanvas(
        carrier_image=carrier,
        surface_box=surface_box,
        surface_mask=mask,
        luminance_map=None,
        material_type=material,
        canvas_name=f"{niche_label}_carrier",
    )


def render_universal_product(
    artwork: Image.Image,
    canvas: UniversalProductCanvas,
    target: ProductTarget,
    max_long_edge: int,
) -> tuple[Image.Image, Image.Image]:
    carrier = canvas.carrier_image.copy()
    sb_left, sb_top, sb_right, sb_bottom = canvas.surface_box
    sb_w = max(16, sb_right - sb_left)
    sb_h = max(16, sb_bottom - sb_top)

    fitted = ImageOps.fit(artwork.convert("RGBA"), (sb_w, sb_h), Image.Resampling.LANCZOS)

    if canvas.luminance_map is not None:
        art_np = np.asarray(fitted.convert("RGB"), dtype=np.float32)
        lum_map = canvas.luminance_map
        if lum_map.shape[:2] != (sb_h, sb_w):
            lum_img = Image.fromarray(np.clip(lum_map * 128.0, 0, 255).astype(np.uint8))
            lum_resized = lum_img.resize((sb_w, sb_h), Image.Resampling.BILINEAR)
            lum_map = np.asarray(lum_resized, dtype=np.float32) / 128.0
        shaded_art = np.clip(art_np * lum_map[..., np.newaxis], 0, 255).astype(np.uint8)
        fitted = Image.fromarray(shaded_art).convert("RGBA")

    if canvas.material_type == "leather":
        fitted = add_leather_surface(fitted, strength=0.08)
    elif canvas.material_type in {"textile", "fabric", "canvas"}:
        fitted = add_textile_surface(fitted, strength=0.09)

    mask = canvas.surface_mask
    if mask.size != (sb_w, sb_h):
        mask = mask.resize((sb_w, sb_h), Image.Resampling.BILINEAR)

    carrier.paste(fitted, (sb_left, sb_top), mask)
    alpha = carrier.getchannel("A")
    return carrier, alpha


def add_leather_surface(image: Image.Image, *, strength: float = 0.08) -> Image.Image:
    """Adds subtle pebble grain and depth variation characteristic of genuine leather."""
    image = image.convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    alpha_high = max(4, round(255 * strength))
    alpha_low = max(2, alpha_high // 2)
    step = max(4, min(image.size) // 180)
    for y in range(0, image.height, step * 2):
        for x in range(0, image.width, step * 2):
            offset_x = (y // (step * 2) % 2) * step
            draw.point((x + offset_x, y), fill=(255, 255, 255, alpha_high))
            draw.point((x + offset_x + 1, y + 1), fill=(0, 0, 0, alpha_low))
    return Image.alpha_composite(image, overlay)



def render_rug_product(
    artwork: Image.Image,
    target: ProductTarget,
    max_long_edge: int,
) -> tuple[Image.Image, Image.Image]:
    shape = normalized_rug_shape(target.rug_shape)
    product_size = rug_canvas_size(shape, target, max_long_edge)
    body_box = inset_box(product_size, 0.045, 0.03)
    radius = max(18, min(product_size) // 28)

    canvas = Image.new("RGBA", product_size, (255, 255, 255, 0))
    mask = Image.new("L", product_size, 0)
    draw_mask = ImageDraw.Draw(mask)
    if shape in {"round", "oval"}:
        draw_mask.ellipse(body_box, fill=255)
    else:
        draw_mask.rounded_rectangle(body_box, radius=radius, fill=255)

    art = ImageOps.fit(artwork.convert("RGBA"), (body_box[2] - body_box[0], body_box[3] - body_box[1]), Image.Resampling.LANCZOS)
    art = add_textile_surface(art, strength=0.13)
    canvas.alpha_composite(art, (body_box[0], body_box[1]))
    canvas.putalpha(mask)

    canvas = add_edge_binding(canvas, body_box, radius, opacity=58, oval=shape in {"round", "oval"})
    if shape in {"rectangle", "runner"}:
        canvas = add_rug_fringe(canvas, body_box)
    mask = canvas.getchannel("A")
    return canvas, mask


def render_blanket_product(
    artwork: Image.Image,
    target: ProductTarget,
    max_long_edge: int,
) -> tuple[Image.Image, Image.Image]:
    product_size = product_canvas_size(target, max_long_edge)
    body_box = inset_box(product_size, 0.055, 0.045)
    radius = max(24, min(product_size) // 22)

    canvas = Image.new("RGBA", product_size, (255, 255, 255, 0))
    mask = Image.new("L", product_size, 0)
    draw_mask = ImageDraw.Draw(mask)
    draw_mask.rounded_rectangle(body_box, radius=radius, fill=255)

    art = ImageOps.fit(artwork.convert("RGBA"), (body_box[2] - body_box[0], body_box[3] - body_box[1]), Image.Resampling.LANCZOS)
    art = add_textile_surface(art, strength=0.09)
    art = add_blanket_folds(art)
    canvas.alpha_composite(art, (body_box[0], body_box[1]))
    canvas.putalpha(mask.filter(ImageFilter.GaussianBlur(0.6)))
    canvas = add_edge_binding(canvas, body_box, radius, opacity=46)
    mask = canvas.getchannel("A")
    return canvas, mask


def product_canvas_size(target: ProductTarget, max_long_edge: int) -> tuple[int, int]:
    ratio = max(0.1, target.width_px / max(1, target.height_px))
    long_edge = max(900, int(max_long_edge))
    if ratio >= 1:
        width = long_edge
        height = max(1, round(long_edge / ratio))
    else:
        height = long_edge
        width = max(1, round(long_edge * ratio))
    return width, height


def normalized_rug_shape(value: str) -> str:
    return value.strip().lower() if value.strip().lower() in {"rectangle", "square", "round", "oval", "runner"} else "rectangle"


def rug_canvas_size(shape: str, target: ProductTarget, max_long_edge: int) -> tuple[int, int]:
    long_edge = max(900, int(max_long_edge))
    if shape in {"round", "square"}:
        return long_edge, long_edge
    if shape == "oval":
        return long_edge, max(1, round(long_edge * 0.68))
    if shape == "runner":
        return max(1, round(long_edge * 0.42)), long_edge
    return product_canvas_size(target, long_edge)


def inset_box(size: tuple[int, int], x_ratio: float, y_ratio: float) -> tuple[int, int, int, int]:
    width, height = size
    x = max(2, round(width * x_ratio))
    y = max(2, round(height * y_ratio))
    return x, y, width - x, height - y


def add_textile_surface(image: Image.Image, *, strength: float) -> Image.Image:
    image = image.convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    line_alpha = max(5, round(255 * strength))
    for y in range(0, image.height, 12):
        draw.line((0, y, image.width, y), fill=(255, 255, 255, line_alpha), width=1)
    for x in range(0, image.width, 14):
        draw.line((x, 0, x, image.height), fill=(0, 0, 0, max(3, line_alpha // 3)), width=1)
    return Image.alpha_composite(image, overlay)


def add_blanket_folds(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    shade = Image.new("L", image.size, 128)
    draw = ImageDraw.Draw(shade)
    for x in range(max(24, image.width // 7), image.width, max(36, image.width // 5)):
        draw.line((x, 0, x - image.width // 18, image.height), fill=98, width=max(10, image.width // 55))
        draw.line((x + image.width // 34, 0, x - image.width // 30, image.height), fill=164, width=max(8, image.width // 70))
    shade = shade.filter(ImageFilter.GaussianBlur(radius=max(8, image.width // 70)))
    darker = ImageEnhance.Brightness(rgb).enhance(0.88)
    lighter = ImageEnhance.Brightness(rgb).enhance(1.08)
    folded = Image.composite(lighter, darker, shade)
    folded.putalpha(image.getchannel("A"))
    return folded


def add_edge_binding(
    image: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    *,
    opacity: int,
    oval: bool = False,
) -> Image.Image:
    border = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(border)
    draw_method = draw.ellipse if oval else draw.rounded_rectangle
    if oval:
        draw_method(box, outline=(255, 255, 255, opacity), width=max(3, min(image.size) // 70))
        draw_method(box, outline=(0, 0, 0, max(12, opacity // 3)), width=max(1, min(image.size) // 160))
    else:
        draw_method(box, radius=radius, outline=(255, 255, 255, opacity), width=max(3, min(image.size) // 70))
        draw_method(box, radius=radius, outline=(0, 0, 0, max(12, opacity // 3)), width=max(1, min(image.size) // 160))
    return Image.alpha_composite(image, border)


def add_rug_fringe(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    fringe = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(fringe)
    left, top, right, bottom = box
    length = max(10, image.height // 45)
    spacing = max(8, image.width // 90)
    for x in range(left + spacing, right - spacing, spacing):
        draw.line((x, top, x, max(0, top - length)), fill=(238, 232, 220, 210), width=2)
        draw.line((x, bottom, x, min(image.height - 1, bottom + length)), fill=(238, 232, 220, 210), width=2)
    combined = Image.alpha_composite(fringe, image)
    alpha = ImageChops.lighter(fringe.getchannel("A"), image.getchannel("A"))
    combined.putalpha(alpha)
    return combined
