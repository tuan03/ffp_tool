from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from ..shared.cache import JsonCache
from ..shared.models import ImageCandidate, VisionResult
from ..shared.product_policy import ProductPolicy, infer_product_policy
from ..shared.utils import clamp, clamp01, env, fingerprint, truncate_text


LOG = logging.getLogger("pinterest.vision")


class ProductVisionFilter:
    def __init__(
        self,
        *,
        niche: str,
        model: str | None = None,
        backend: str = "auto",
        batch_size: int = 5,
        cache: JsonCache | None = None,
        refresh_cache: bool = False,
        mode: str = "auto",
        product_focus: str = "auto",
        product_policy: ProductPolicy | None = None,
        crawl_purpose: str = "product",
    ):
        self.niche = niche
        self.model = model or env("GEMINI_VISION_MODEL", "gemini-2.5-flash")
        self.backend = backend
        self.batch_size = max(1, min(8, int(batch_size)))
        self.cache = cache
        self.refresh_cache = refresh_cache
        is_disabled = mode == "off" or env("DISABLE_VISION_FILTER", "").lower() in {"1", "true", "yes"}
        self.mode = "off" if is_disabled else mode
        self.crawl_purpose = (crawl_purpose or "product").strip().lower().replace("-", "_")
        self.product_policy = product_policy or infer_product_policy(niche, product_focus)
        self.client = None if self.mode == "off" else self._build_client()

    def _build_client(self) -> Any:
        try:
            from google import genai
        except Exception as exc:
            if self.mode == "required":
                raise
            LOG.warning("google-genai unavailable; Vision fallback will be used: %s", exc)
            return None
        api_key = env("GEMINI_API_KEY") or env("GOOGLE_API_KEY")
        project = env("GOOGLE_CLOUD_PROJECT")
        location = env("GOOGLE_CLOUD_LOCATION", "us-central1")
        use_enterprise = env("GOOGLE_GENAI_USE_ENTERPRISE", "").lower() in {"1", "true", "yes"}
        http_options = {"timeout": 60000}
        try:
            if self.backend == "api-key" or (self.backend == "auto" and api_key and not use_enterprise):
                return genai.Client(api_key=api_key, http_options=http_options)
            if self.backend in {"enterprise", "auto"} and project:
                return genai.Client(vertexai=True, project=project, location=location, http_options=http_options)
            if api_key:
                return genai.Client(api_key=api_key, http_options=http_options)
        except Exception:
            if self.mode == "required":
                raise
        return None

    @staticmethod
    def _parse_json(text: str) -> dict[str, Any]:
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?", "", text, flags=re.I).strip()
            text = re.sub(r"```$", "", text).strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.S)
            if match:
                parsed = json.loads(match.group(0))
            else:
                list_match = re.search(r"\[.*\]", text, re.S)
                if not list_match:
                    raise
                parsed = json.loads(list_match.group(0))
        if isinstance(parsed, list):
            return {"results": parsed}
        if isinstance(parsed, dict):
            if isinstance(parsed.get("results"), list):
                return parsed
            if parsed.get("image_id"):
                return {"results": [parsed]}
        raise ValueError("Gemini Vision response must be an object or a list of result objects.")

    def _fallback(self, candidate: ImageCandidate, reason: str = "Vision disabled/unavailable.") -> VisionResult:
        is_off = self.mode == "off" or env("DISABLE_VISION_FILTER", "").lower() in {"1", "true", "yes"}
        return VisionResult(
            image_id=candidate.image_id,
            accepted=True,
            product_present=True,
            product_role="PRIMARY",
            product_confidence=0.85,
            product_visibility=85.0,
            trend_relevance=80.0,
            commercial_quality=75.0,
            aesthetic="raw_crawled" if is_off else "unverified",
            detected_product="crawled_image" if is_off else "unverified_artwork",
            reason=reason if not is_off else "Ảnh cào trực tiếp từ Pinterest (Đã tắt AI lọc)",
            confidence=0.85,
            main_subject="pattern",
            target_product_type="printable_inspiration",
            is_single_product=True,
            is_physical_product=False,
            is_floor_textile=False,
            flat_artwork_score=0.85,
            printability_score=0.80,
            reject_reason_code="",
            error="",
            is_multi_panel_or_swatch=False,
            has_commercial_metadata_text=False,
            is_single_clean_artwork=True,
        )

    def _prompt(self, batch: list[ImageCandidate]) -> str:
        payload = [
            {
                "image_id": item.image_id,
                "trend_id": item.trend_id,
                "trend": item.trend,
                "query": item.query,
                "title": item.title,
                "source": item.source,
            }
            for item in batch
        ]
        if self.crawl_purpose == "inspiration":
            return f"""
You are a strict VISUAL INSPIRATION & DESIGN QUALITY gate for a Pinterest POD merchandise crawler.

Target product niche: '{self.niche}'
Downstream product type: {self.product_policy.display_name}

IMPORTANT CONTEXT:
The candidate images collected from Pinterest include:
1. Physical product designs, merchandise styling, product mockups, and finished items showcasing the trend aesthetic for '{self.niche}' (e.g. bags, satchels, totes, backpacks, mugs, rugs, blankets).
2. Surface patterns, seamless designs, illustrations, textile prints, and visual motifs inspired by or designed for '{self.niche}'.

EVALUATION GOAL:
Accept images that are high-quality, aesthetic visual references or printable artwork for '{self.niche}'.
Accept images that show:
- A distinct, attractive product design, shape, silhouette, hardware, or styling matching the trend.
- A clear printable surface pattern, illustration, graphic artwork, or embroidery motif.
- A rich material texture (e.g. vintage distressed leather, woven tapestry, ceramic glaze).

REJECT ONLY images that are:
- Multi-panel swatch grids or collage sheets (e.g. 4, 9, 12, 20 pattern blocks or multi-product grids). Set is_multi_panel_or_swatch=true, is_collage=true, reject_reason_code="REJECT_COLLAGE".
- Heavy commercial metadata text, pricing, promotional banners, file format specs (e.g. "AI/EPS/PNG", "$29.99"). Set has_commercial_metadata_text=true, reject_reason_code="REJECT_TEXT_BLOCK".
- Hands holding items with prominent nails/manicures (reject_reason_code="REJECT_HANDS_OR_NAILS").
- Phone frames / lockscreens with clock/battery UI (reject_reason_code="REJECT_PHONE_WALLPAPER").
- Completely illegible or corrupted files where no shape, design, or motif is discernible (reject_reason_code="REJECT_ILLEGIBLE"). Do NOT reject images for soft focus, film grain, or moderate resolution, as our pipeline enhances and upscales design assets in production.
- Brand logos / watermarks obscuring the design (reject_reason_code="REJECT_LOGO" or "REJECT_WATERMARK").
- Completely unrelated subjects (e.g. food/cooking recipes, gym fitness workouts).

Return only JSON:
{{
  "results": [
    {{
      "image_id": "exact id",
      "accepted": true,
      "product_present": true,
      "product_role": "PRIMARY|SECONDARY|INCIDENTAL|ABSENT|UNCERTAIN",
      "main_subject": "product|artwork|pattern|motif|room|text|logo|collage|other|unknown",
      "target_product_type": "product_design|printable_inspiration|pattern|artwork|motif|texture|not_usable|unknown",
      "is_single_product": true,
      "is_physical_product": true,
      "is_floor_textile": false,
      "is_collage": false,
      "is_multi_panel_or_swatch": false,
      "has_commercial_metadata_text": false,
      "is_single_clean_artwork": true,
      "is_doormat": false,
      "is_bath_mat": false,
      "is_wall_tapestry": false,
      "motifs": ["short visual motif"],
      "source_role": "artwork_source|style_reference|product_reference|extraction_required|reject",
      "is_lifestyle_scene": false,
      "foreground_coverage": 0.9,
      "background_complexity": 0.1,
      "flat_artwork_score": 0.8,
      "printability_score": 0.8,
      "requires_extraction": false,
      "reject_reason_code": "",
      "product_confidence": 0.95,
      "product_visibility": 85,
      "trend_relevance": 85,
      "commercial_quality": 80,
      "aesthetic": "short style and palette",
      "detected_product": "usable visual description",
      "reason": "visible evidence only",
      "confidence": 0.95
    }}
  ]
}}

Guidelines:
- product_present: true if a usable product design, pattern, texture, or artwork is present.
- product_role PRIMARY: the product design, motif, or artwork is the main subject.
- product_visibility: visual clarity of the product or motif (0..100).
- trend_relevance (0..100): evaluates how well this visual matches the candidate's trend or query from metadata.
- commercial_quality (0..100): print/ecommerce aesthetic quality.
- is_single_clean_artwork: true if the image is a single clean product photo or single artwork (NOT a multi-panel grid, swatch sheet, or collage).
- flat_artwork_score: 1.0 = completely flat 2D graphic/pattern; 0.2 = 3D physical product photo or lifestyle shot.
- printability_score: 1.0 = ready for direct POD printing; 0.6 = product reference or motif requiring placement/extraction.
- source_role:
  - artwork_source: flat graphic/pattern that can be printed directly.
  - style_reference: aesthetic product photo or lifestyle styling for inspiration.
  - extraction_required: product photo where the motif or texture can be extracted for POD.
  - reject: unusable, collage, text block, or spam.

Image metadata:
{json.dumps(payload, ensure_ascii=False, indent=2)}
""".strip()

        niche_rules = f"""
Product policy:
- Target product names/keywords: {self.product_policy.target_hint()}.
- Preferred target_product_type values: {self.product_policy.accepted_type_hint()}.
- Explicit non-target product types: {self.product_policy.excluded_type_hint() or "none"}.
- Use target_product_type="target_product" only when the target niche product is visibly present but no more specific product type fits.
- main_subject is the primary visible subject, for example: target_product, room, pet, person, furniture, collage, pattern_sheet, exterior, other, unknown.
- PRIMARY means the target product itself is one of the main visual subjects and its material/shape/color/pattern is inspectable.
- SECONDARY means a clear target product is visible but the room, furniture, person, or another object is the main subject.
""".strip()
        if self.product_policy.require_floor_textile:
            niche_rules = """
Rug-specific rules:
- Analyze the image first; do not apply business policy yourself.
- target_product_type should be one of: area_rug, runner_rug, shag_rug, floor_carpet, doormat, bath_mat, wall_tapestry, upholstery, blanket, pattern_sheet, collage, not_rug, unknown.
- main_subject is the primary visible subject: rug, room, pet, person, furniture, collage, pattern_sheet, exterior, other.
- If a cat/dog/person appears only as a pattern printed on the rug, keep main_subject="rug" and put it in motifs. Do not set main_subject to cat/dog/person for printed motifs.
- If a pet/person is physically the main subject and the rug is just background, set main_subject="pet" or "person" and product_role="INCIDENTAL" or "SECONDARY".
- Set is_doormat, is_bath_mat, is_wall_tapestry, is_collage explicitly.
- PRIMARY means the rug itself is one of the main visual subjects and its pattern/shape/color is inspectable.
- SECONDARY means a clear floor rug is visible but room/furniture/pet/person is the main subject.
""".strip()

        return f"""
You are a strict PRODUCT PRESENCE gate for a Pinterest hot trend image crawler.

Target niche: {self.niche}

For every image, first decide whether a real visible product from the target niche is present.
Do not accept an image just because its room, motif, color, or style could inspire the product.
{niche_rules}

Return only JSON:
{{
  "results": [
    {{
      "image_id": "exact id",
      "accepted": true,
      "product_present": true,
      "product_role": "PRIMARY|SECONDARY|INCIDENTAL|ABSENT|UNCERTAIN",
      "main_subject": "target_product|room|pet|person|furniture|collage|pattern_sheet|exterior|other|unknown",
      "target_product_type": "specific_snake_case_type|target_product|pattern_sheet|collage|not_target_product|unknown",
      "is_single_product": true,
      "is_physical_product": true,
      "is_floor_textile": true,
      "is_collage": false,
      "is_doormat": false,
      "is_bath_mat": false,
      "is_wall_tapestry": false,
      "motifs": ["cat", "pumpkin"],
      "reject_reason_code": "",
      "product_confidence": 0.95,
      "product_visibility": 80,
      "trend_relevance": 75,
      "commercial_quality": 70,
      "aesthetic": "short visible aesthetic",
      "detected_product": "visible product description",
      "reason": "visible evidence only",
      "confidence": 0.95
    }}
  ]
}}

Score fields product_visibility, trend_relevance, commercial_quality are 0..100.
Confidence fields are 0..1.
accepted means your vision analysis believes the target product is present with PRIMARY or SECONDARY role.
Do not reject printed motifs. Policy filtering happens later.

Image metadata:
{json.dumps(payload, ensure_ascii=False, indent=2)}
""".strip()

    def _call_batch(self, batch: list[ImageCandidate]) -> dict[str, VisionResult]:
        if self.client is None:
            raise RuntimeError("Gemini Vision client is not configured.")
        from google.genai import types

        valid_batch = [c for c in batch if c.local_path and Path(c.local_path).is_file()]
        if not valid_batch:
            return {}
        parts: list[Any] = [types.Part.from_text(text=self._prompt(valid_batch))]
        for index, candidate in enumerate(valid_batch, start=1):
            parts.append(types.Part.from_text(text=f"IMAGE {index}: {candidate.image_id}"))
            parts.append(
                types.Part.from_bytes(
                    data=Path(candidate.local_path).read_bytes(),
                    mime_type="image/jpeg",
                )
            )
        response = self.client.models.generate_content(
            model=self.model,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(
                temperature=0.0,
                response_mime_type="application/json",
            ),
        )
        raw = self._parse_json(getattr(response, "text", "") or "")
        output: dict[str, VisionResult] = {}
        for item in raw.get("results") or []:
            if not isinstance(item, dict):
                continue
            image_id = str(item.get("image_id") or "")
            if not image_id:
                continue
            role = str(item.get("product_role") or "UNCERTAIN").upper()
            product_present = bool(item.get("product_present"))
            accepted = bool(item.get("accepted")) and product_present and role in {"PRIMARY", "SECONDARY"}
            motifs = item.get("motifs")
            if not isinstance(motifs, list):
                motifs = []
            source_role = truncate_text(item.get("source_role"), 40).lower()
            is_lifestyle_scene = bool(item.get("is_lifestyle_scene"))
            foreground_coverage = clamp(item.get("foreground_coverage"), 0.0, 1.0)
            background_complexity = clamp(item.get("background_complexity"), 0.0, 1.0)
            flat_artwork_score = clamp(item.get("flat_artwork_score"), 0.0, 1.0)
            printability_score = clamp(item.get("printability_score"), 0.0, 1.0)
            requires_extraction = bool(item.get("requires_extraction"))
            if not source_role:
                if requires_extraction:
                    source_role = "extraction_required"
                elif is_lifestyle_scene or background_complexity >= 0.65:
                    source_role = "style_reference"
                elif flat_artwork_score >= 0.75 and foreground_coverage >= 0.55:
                    source_role = "artwork_source"
                else:
                    source_role = "unknown"
            is_multi_panel_or_swatch = bool(item.get("is_multi_panel_or_swatch") or item.get("is_collage"))
            has_commercial_metadata_text = bool(item.get("has_commercial_metadata_text"))
            is_single_clean_artwork = bool(item.get("is_single_clean_artwork", True))
            reject_reason_code = str(item.get("reject_reason_code") or "").strip()

            if is_multi_panel_or_swatch:
                accepted = False
                is_single_clean_artwork = False
                flat_artwork_score = min(flat_artwork_score, 0.2)
                printability_score = 0.0
                source_role = "reject"
                if not reject_reason_code:
                    reject_reason_code = "REJECT_COLLAGE"
            if has_commercial_metadata_text:
                accepted = False
                is_single_clean_artwork = False
                printability_score = 0.0
                source_role = "reject"
                if not reject_reason_code:
                    reject_reason_code = "REJECT_TEXT_BLOCK"

            # Soft-focus, film grain, or low-res inspiration can be enhanced/upscaled by downstream AI.
            # Do not hard-reject candidates if the product, pattern, or motif is present.
            if reject_reason_code in {"REJECT_BLURRY", "REJECT_LOW_RES"}:
                if product_present or role in {"PRIMARY", "SECONDARY"}:
                    accepted = True
                    reject_reason_code = ""
                    if str(item.get("target_product_type") or "").strip().lower() in {"not_usable", "unknown"}:
                        item["target_product_type"] = "style_reference"

            if self.crawl_purpose == "inspiration" and reject_reason_code in {
                "REJECT_PRODUCT_PHOTO",
                "REJECT_LIFESTYLE_PRODUCT_PHOTO",
                "REJECT_PRODUCT_DESIGN_NOT_PATTERN",
                "REJECT_NOT_ARTWORK",
                "REJECT_3D_ROOM_SCENE",
                "REJECT_NOT_SINGLE_PRODUCT",
            }:
                if product_present or role in {"PRIMARY", "SECONDARY"}:
                    accepted = True
                    reject_reason_code = ""
                    if str(item.get("target_product_type") or "").strip().lower() in {"not_usable", "unknown"}:
                        item["target_product_type"] = "style_reference"

            trend_relevance_raw = clamp(item.get("trend_relevance"))
            if self.crawl_purpose == "inspiration" and accepted:
                # If Gemini accepted the pattern as a clean printable artwork, don't let a low score
                # from downstream physical product confusion zero out trend_relevance.
                if trend_relevance_raw < 50.0:
                    trend_relevance_raw = max(trend_relevance_raw, 85.0)

            output[image_id] = VisionResult(
                image_id=image_id,
                accepted=accepted,
                product_present=product_present,
                product_role=role,
                product_confidence=clamp01(item.get("product_confidence")),
                product_visibility=clamp(item.get("product_visibility")),
                trend_relevance=trend_relevance_raw,
                commercial_quality=clamp(item.get("commercial_quality")),
                aesthetic=truncate_text(item.get("aesthetic"), 220),
                detected_product=truncate_text(item.get("detected_product"), 220),
                reason=truncate_text(item.get("reason"), 650),
                confidence=clamp01(item.get("confidence"), 0.5),
                main_subject=truncate_text(item.get("main_subject"), 80).lower(),
                target_product_type=truncate_text(item.get("target_product_type"), 80).lower(),
                is_single_product=bool(item.get("is_single_product")),
                is_physical_product=bool(item.get("is_physical_product")),
                is_floor_textile=bool(item.get("is_floor_textile")),
                is_collage=bool(item.get("is_collage") or is_multi_panel_or_swatch),
                is_doormat=bool(item.get("is_doormat")),
                is_bath_mat=bool(item.get("is_bath_mat")),
                is_wall_tapestry=bool(item.get("is_wall_tapestry")),
                motifs=[truncate_text(value, 60).lower() for value in motifs if str(value).strip()],
                reject_reason_code=truncate_text(reject_reason_code, 120).upper(),
                source_role=source_role,
                is_lifestyle_scene=is_lifestyle_scene,
                foreground_coverage=foreground_coverage,
                background_complexity=background_complexity,
                flat_artwork_score=flat_artwork_score,
                printability_score=printability_score,
                requires_extraction=requires_extraction,
                is_multi_panel_or_swatch=is_multi_panel_or_swatch,
                has_commercial_metadata_text=has_commercial_metadata_text,
                is_single_clean_artwork=is_single_clean_artwork,
            )
        return output

    def analyze(self, candidates: list[ImageCandidate]) -> dict[str, VisionResult]:
        if self.mode == "off" or env("DISABLE_VISION_FILTER", "").lower() in {"1", "true", "yes"}:
            LOG.info("Vision AI filter is disabled. Bypassing Gemini Vision and accepting all %d raw crawled images.", len(candidates))
            return {
                candidate.image_id: self._fallback(
                    candidate,
                    reason="Ảnh cào trực tiếp từ Pinterest (Đã tắt AI lọc)",
                )
                for candidate in candidates
            }

        results: dict[str, VisionResult] = {}
        pending: list[ImageCandidate] = []
        cache_keys: dict[str, str] = {}

        for candidate in candidates:
            key = fingerprint(
                {
                    "kind": "product-vision-v3-structured",
                    "niche": self.niche,
                    "product_policy": self.product_policy.policy_id,
                    "crawl_purpose": self.crawl_purpose,
                    "model": self.model,
                    "image_id": candidate.image_id,
                    "dhash": candidate.dhash,
                    "trend": candidate.trend,
                    "query": candidate.query,
                }
            )
            cache_keys[candidate.image_id] = key
            cached = None if self.refresh_cache or not self.cache else self.cache.get(key)
            if isinstance(cached, dict):
                results[candidate.image_id] = VisionResult(**cached)
            else:
                pending.append(candidate)

        if self.client is None:
            if self.mode == "required":
                raise RuntimeError("Gemini Vision is required but not configured.")
            for candidate in pending:
                results[candidate.image_id] = self._fallback(candidate)
            return results

        for start in range(0, len(pending), self.batch_size):
            batch = pending[start : start + self.batch_size]
            LOG.info("Vision batch %d-%d / %d", start + 1, start + len(batch), len(pending))
            try:
                batch_results = self._call_batch(batch)
            except Exception as exc:
                LOG.warning("Vision batch failed; falling back per image: %s", exc)
                batch_results = {}
                for candidate in batch:
                    try:
                        batch_results.update(self._call_batch([candidate]))
                    except Exception as one_exc:
                        batch_results[candidate.image_id] = self._fallback(candidate, str(one_exc))

            for candidate in batch:
                result = batch_results.get(candidate.image_id) or self._fallback(candidate, "Vision omitted this image.")
                results[candidate.image_id] = result
                if self.cache and not result.error:
                    self.cache.set(cache_keys[candidate.image_id], result.__dict__)
            LOG.info("Vision batch %d-%d / %d completed.", start + 1, start + len(batch), len(pending))

        if self.cache:
            self.cache.save()
        return results
