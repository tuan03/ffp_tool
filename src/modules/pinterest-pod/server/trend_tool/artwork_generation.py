from __future__ import annotations

import io
import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image

from .config import ProductTarget
from .product_asset import create_gemini_client, extract_image_bytes, image_part, is_transient_gemini_error


@dataclass(frozen=True)
class ArtworkGenerationRecord:
    source_path: Path
    output_path: Path | None
    model: str
    status: str
    notes: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def generate_flat_artwork(
    source: Path,
    destination: Path,
    target: ProductTarget,
    *,
    backend: str,
    model: str = "gemini-2.5-flash-image",
    image_size: str = "2K",
    attempts: int = 2,
    reference_brief: dict[str, object] | None = None,
    correction: str = "",
) -> ArtworkGenerationRecord:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if "imagen-3" in model.lower():
        model = "gemini-2.5-flash-image"
    try:
        client = create_gemini_client(backend)
        with Image.open(source) as opened:
            reference = opened.convert("RGB")
        from google.genai import types

        content = types.Content(
            role="user",
            parts=[image_part(reference, max_side=1536, max_bytes=3_500_000), types.Part.from_text(text=artwork_prompt(target, reference_brief, correction))],
        )
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            temperature=0.25,
            image_config=types.ImageConfig(
                aspect_ratio=artwork_aspect_ratio(target),
                image_size=image_size,
                output_mime_type="image/png",
            ),
        )
        last_error: Exception | None = None
        for attempt in range(1, max(1, attempts) + 1):
            try:
                response = client.models.generate_content(model=model, contents=[content], config=config)
                image_bytes, _ = extract_image_bytes(response)
                if not image_bytes:
                    raise RuntimeError("Gemini artwork generation returned no image.")
                with Image.open(io.BytesIO(image_bytes)) as generated:
                    generated.convert("RGBA").save(destination)
                return ArtworkGenerationRecord(source, destination, model, "ok", "Gemini generated flat printable artwork.")
            except Exception as exc:
                last_error = exc
                if attempt >= max(1, attempts) or not is_transient_gemini_error(exc):
                    break
                time.sleep(float(attempt) * 2.0)
        raise RuntimeError(str(last_error or "unknown Gemini error"))
    except Exception as exc:
        return ArtworkGenerationRecord(source, None, model, "failed", str(exc))


def artwork_prompt(target: ProductTarget, reference_brief: dict[str, object] | None = None, correction: str = "") -> str:
    product = (target.niche or target.name or "product").strip().lower()
    if "blanket" in product or "quilt" in product:
        item_desc = "soft woven blanket textile design"
        edge_rule = "Use a seamless repeat-safe composition with no border."
    elif "rug" in product or "carpet" in product or "mat" in product:
        item_desc = "flat printed rug artwork"
        edge_rule = "Use a full-bleed composition that reaches all four edges, with no white margin."
    elif any(b in product for b in ("bag", "tote", "backpack", "satchel", "clutch", "purse")):
        item_desc = f"flat 2D printable graphic artwork, surface pattern, or embroidery design for a {product}"
        edge_rule = "Use a full-bleed or centered high-resolution printable composition suitable for bags."
    elif any(m in product for m in ("mug", "cup", "tumbler")):
        item_desc = f"flat 2D printable wrap graphic artwork for a {product}"
        edge_rule = "Use a horizontal wrap composition with clean edges."
    else:
        item_desc = f"flat 2D printable surface artwork or graphic design for {product}"
        edge_rule = "Use a full-bleed or centered high-resolution printable composition."

    brief = json.dumps(reference_brief or {}, ensure_ascii=False)
    correction_rule = f"Previous attempt failed this quality check: {correction}\nCorrect that failure completely." if correction else ""
    return f"""
Create a new {item_desc} inspired by the attached reference image.
The reference is only a source of motif, palette, texture, and composition. Do not copy its product photography, background, or physical scene.
Use only these extracted visual cues: {brief}
{edge_rule}
Requirements:
- output one newly created 2D graphic artwork image for printing;
- do not return, reproduce, or merely retouch the reference photograph;
- reinterpret the motifs as clean illustrated shapes, graphic artwork, or surface pattern;
- remove room, floor, wall, furniture, props, handles, straps, zippers, product edges, perspective distortion, highlights, and camera shadows;
- preserve the useful visual aesthetic and color palette while creating a coherent original printable composition;
- fill the canvas or create a clean print-ready layout;
- no mockup, no physical product photograph, no frame, no text, no logo, no watermark;
- make details sharp, clean, and ready for high-resolution print reproduction.
{correction_rule}
""".strip()


def artwork_aspect_ratio(target: ProductTarget) -> str:
    ratio = target.width_px / max(1, target.height_px)
    if ratio < 0.72:
        return "9:16"
    if ratio > 1.35:
        return "16:9"
    return "1:1"
