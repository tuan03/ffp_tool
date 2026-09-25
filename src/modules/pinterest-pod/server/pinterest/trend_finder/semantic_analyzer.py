from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..shared.cache import JsonCache
from ..shared.models import QuerySpec, TrendPackageItem
from ..shared.utils import clamp, clamp01, env, fingerprint, normalize_text, stable_id, truncate_text, unique
from .models import TrendCandidate


LOG = logging.getLogger("pinterest.semantic")


RELATIONSHIPS = {
    "DIRECT_PRODUCT",
    "DESIGN_INSPIRATION",
    "CONTEXTUAL_USE",
    "AUDIENCE_ADJACENT",
    "IRRELEVANT",
}

VISUAL_TREND_TERMS = {
    "art", "artwork", "aesthetic", "botanical", "floral", "flower", "garden",
    "pattern", "print", "textile", "fabric", "color", "colour", "palette",
    "geometric", "checkerboard", "checkered", "striped", "plaid", "gingham",
    "vintage", "retro", "boho", "minimal", "modern", "abstract", "illustration",
    "halloween", "pumpkin", "christmas", "holiday", "autumn", "fall", "spring",
    "summer", "winter", "beach", "coastal", "tropical", "celestial", "animal",
    "fruit", "mushroom", "butterfly", "cottagecore", "farmhouse", "decor",
    "folk art", "ribbon", "wavy", "tooled", "leather", "runner",
}


# Strict Graphic Printability Gate: deterministic stopword regex
# Keep: Food / cooking recipes, beauty / nails / cosmetics, 3D architectural spaces, and gym workouts.
# NOTE: Typography quotes, witty memes, and aesthetic phone wallpaper digital art ARE HIGH-VALUE POD MOTIFS.
# They are deliberately allowed through and converted into dedicated graphic typography & vector art queries.
NON_PRINTABLE_GATE_REGEX = re.compile(
    r"\b("
    # Food / recipes / cooking / drinks / ingredients
    r"recipes?|simmer[\s_-]*pots?|soup|salads?|crockpot|slow[\s_-]*cooker|cocktails?|smoothies?|baking|cookies?|cakes?|"
    r"dinner[\s_-]*ideas?|meal[\s_-]*prep|snacks?|sourdough|casseroles?|pasta|breakfast|desserts?|cook(?:ing)?|"
    # 3D architectural / physical spaces / porch / exterior / interior staging
    r"(?:front|back|fall|halloween|christmas|farmhouse)?[\s_-]*porch(?:\s+decor)?|front[\s_-]*doors?|patio(?:\s+decor)?|"
    r"remodel(?:ing)?|cabinetry|landscaping|curb[\s_-]*appeal|exterior[\s_-]*design|shelf[\s_-]*styling|"
    # Beauty, skincare, nails, hair, makeup, cosmetics
    r"nails?|nail[\s_-]*art|nail[\s_-]*tech|press[\s_-]*on[\s_-]*nails?|acrylic[\s_-]*nails?|gel[\s_-]*nails?|manicure|pedicure|"
    r"hair|hair[\s_-]*styles?|hair[\s_-]*cuts?|hair[\s_-]*color|braids?|updo|"
    r"makeup|make[\s_-]*up|lipsticks?|eye[\s_-]*shadow|mascara|lip[\s_-]*gloss|skin[\s_-]*care|eye[\s_-]*lashes?|eye[\s_-]*brows?|"
    # Fashion styling outfits
    r"ootd|shoes|sneakers|heels|tattoos?|piercings?|"
    # Physical exercise workouts, gym routines, diets
    r"workout|gym|fitness|abs[\s_-]*routine|weight[\s_-]*loss|diet|"
    r"garters?[\s_-]*homecoming|homecoming[\s_-]*mums?|homecoming[\s_-]*garters?|bulletin[\s_-]*boards?|school[\s_-]*crafts?"
    r")\b",
    re.IGNORECASE,
)


PRODUCT_CONTAINER_PATTERN = re.compile(
    r"\b(?:"
    r"leather\s+bag|tote\s+bag|shoulder\s+bag|crossbody\s+bag|messenger\s+bag|"
    r"leather\s+purse|leather\s+backpack|satchel\s+bag|leather\s+satchel|"
    r"bag|purse|tote|backpack|satchel|crossbody|handbag|clutch|briefcase|weekender|fringe\s+bag|"
    r"area\s+rug|runner\s+rug|floor\s+rug|throw\s+rug|floor\s+carpet|accent\s+rug|"
    r"rug|carpet|doormat|bath\s+mat|mat|"
    r"throw\s+blanket|fleece\s+blanket|woven\s+blanket|quilted\s+blanket|"
    r"blanket|throw|quilt|comforter|"
    r"coffee\s+mug|ceramic\s+mug|travel\s+mug|coffee\s+cup|"
    r"mug|cup|tumbler"
    r")\b",
    flags=re.IGNORECASE,
)


def extract_design_theme(trend: str, niche: str = "") -> str:
    clean = trend.strip()
    theme = PRODUCT_CONTAINER_PATTERN.sub("", clean)
    if niche:
        niche_clean = re.sub(r"\b(?:design|pattern|artwork|style|print)\b", "", niche, flags=re.I).strip()
        if niche_clean:
            for word in niche_clean.split():
                if len(word) > 2:
                    theme = re.sub(rf"\b{re.escape(word)}\b", "", theme, flags=re.I)
    theme = re.sub(r"\s+", " ", theme).strip()
    return theme if len(theme) >= 3 else clean


def build_smart_queries(trend: str, niche: str = "") -> list[QuerySpec]:
    clean = trend.strip()
    # Strip redundant trailing pattern keywords to form clean base
    base = re.sub(
        r"\b(?:surface\s+pattern\s+design|seamless\s+pattern\s+vector|textile\s+print\s+flat|pattern\s+design\s+flat|seamless\s+pattern|surface\s+pattern|pattern\s+design|textile\s+print|pattern)\b",
        "",
        clean,
        flags=re.I,
    ).strip()
    base = re.sub(r"\s+", " ", base)
    if not base:
        base = clean

    theme = extract_design_theme(trend, niche)
    if not theme or theme.lower() in {"bag", "leather bag", "rug", "blanket", "custom", "product"}:
        theme = base if base and base.lower() not in {"bag", "leather bag", "rug", "blanket"} else clean

    queries: list[QuerySpec] = []
    # Dedicated typography quote and meme vector print intent
    if re.search(r"\b(quotes?|memes?|sayings?|typography|slogans?|text)\b", clean, re.I):
        queries.append(QuerySpec(query=f"{theme} typography vector graphic print", intent="typography_quote", priority=1))
        queries.append(QuerySpec(query=f"{theme} aesthetic quote design vector", intent="quote_artwork", priority=2))
    # Dedicated wallpaper & aesthetic lock screen digital art intent
    elif re.search(r"\b(wallpapers?|lock[\s_-]*screens?)\b", clean, re.I):
        clean_wall = re.sub(r"\b(wallpapers?|lock[\s_-]*screens?|iphone[\s_-]*wallpapers?)\b", "", theme, flags=re.I).strip()
        wall_theme = clean_wall if len(clean_wall) >= 3 else theme
        queries.append(QuerySpec(query=f"{wall_theme} aesthetic digital art vector print", intent="digital_art", priority=1))
        queries.append(QuerySpec(query=f"{wall_theme} seamless pattern vector", intent="surface_pattern", priority=2))

    # Priority 1: Direct Printable Seamless Pattern query (strictly without product container)
    queries.append(QuerySpec(query=f"{theme} seamless pattern vector", intent="surface_pattern", priority=1))

    # Priority 2: Flat surface print design query
    queries.append(QuerySpec(query=f"{theme} surface print design flat", intent="surface_pattern_design", priority=2))

    # Priority 3: Printable Vector & Graphic Artwork query
    queries.append(QuerySpec(query=f"{theme} vector artwork print", intent="trend_artwork", priority=3))

    # Priority 4: Pattern & textile print query
    queries.append(QuerySpec(query=f"{theme} pattern design flat", intent="pattern_design", priority=4))

    # Priority 5: Aesthetic pattern vector query
    queries.append(QuerySpec(query=f"{theme} aesthetic print vector", intent="trend_aesthetic", priority=5))

    return queries


def generate_niche_core_candidates(
    niche: str,
    *,
    client: Any = None,
    limit: int = 10,
    model: str = "gemini-2.5-flash",
    backend: str = "auto",
) -> list[TrendCandidate]:
    """Track 1 (Product Niche Core): dynamically expands the user's specific niche into high-intent visual design motifs."""
    clean_niche = niche.strip()
    if not clean_niche:
        return []

    results: list[str] = []

    # 1. Try Gemini dynamic trend expansion first (completely un-hardcoded)
    gemini_client = client
    if gemini_client is None:
        try:
            from google import genai

            api_key = env("GEMINI_API_KEY") or env("GOOGLE_API_KEY")
            project = env("GOOGLE_CLOUD_PROJECT")
            location = env("GOOGLE_CLOUD_LOCATION", "us-central1")
            use_enterprise = env("GOOGLE_GENAI_USE_ENTERPRISE", "").lower() in {"1", "true", "yes"}
            if backend == "api-key" or (backend == "auto" and api_key and not use_enterprise):
                gemini_client = genai.Client(api_key=api_key)
            elif backend in {"enterprise", "auto"}:
                if project:
                    gemini_client = genai.Client(vertexai=True, project=project, location=location)
                else:
                    gemini_client = genai.Client(vertexai=True, location=location)
            elif api_key:
                gemini_client = genai.Client(api_key=api_key)
        except Exception as exc:
            LOG.debug("Gemini client init for niche core: %s", exc)

    if gemini_client is not None:
        try:
            from google.genai import types

            prompt = f"""You are a Pinterest commercial trend intelligence engine for Print-on-Demand (POD) and lifestyle merchandise.
Target product or niche: '{clean_niche}'

Generate {limit} highly trending, diverse visual aesthetics, design motifs, and product styling themes that consumers actively search for on Pinterest for this product.
Focus on high commercial appeal, distinct visual styles, and real Pinterest search phrasing.
Examples:
- If niche is 'leather bag': 'Quiet Luxury leather bag', 'Vintage distressed leather bag', 'Minimalist chic leather tote', 'Dark academia leather satchel', 'Y2K leather baguette bag', 'Bohemian fringe leather purse', 'Botanical stamped leather bag', 'Western cowgirl leather bag'
- If niche is 'coffee mug': 'Coquette bow ceramic mug', 'Vintage botanical wildflower coffee mug', 'Cute ghost reading books mug', 'Retro groovy quote coffee cup', 'Minimalist line art ceramic mug', 'Cottagecore mushroom mug'
- If niche is 'rug': 'Vintage distressed oriental runner rug', 'Boho moroccan geometric area rug', 'Checkerboard wavy aesthetic rug', 'Minimalist japandi neutral area rug', 'Moss green nature floor rug'
- If niche is 'blanket': 'Chunky knit throw blanket', 'Cottagecore floral patchwork blanket', 'Celestial tarot woven tapestry blanket', 'Retro groovy checkerboard blanket'

Return JSON only:
{{
  "trends": [
    "specific aesthetic / design theme 1",
    "specific aesthetic / design theme 2"
  ]
}}"""
            response = gemini_client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.3,
                    response_mime_type="application/json",
                ),
            )
            raw_text = getattr(response, "text", "") or "{}"
            raw_text = re.sub(r"^```(?:json)?", "", raw_text.strip(), flags=re.I).strip()
            raw_text = re.sub(r"```$", "", raw_text).strip()
            parsed = json.loads(raw_text)
            trend_list = parsed.get("trends", []) if isinstance(parsed, dict) else (parsed if isinstance(parsed, list) else [])
            for t in trend_list:
                t_str = str(t).strip()
                if t_str and t_str not in results:
                    results.append(t_str)
            if results:
                LOG.info("Track 1 (Product Niche Core): Gemini dynamically generated %d trends for %r", len(results), clean_niche)
        except Exception as exc:
            LOG.warning("Dynamic Gemini expansion for niche core failed (%s); using universal heuristic fallback", exc)

    # 2. Universal heuristic fallback (completely dynamic, zero hardcoding of specific product types)
    if not results:
        fallback_templates = [
            f"aesthetic {clean_niche}",
            f"vintage {clean_niche} design",
            f"minimalist {clean_niche}",
            f"boho {clean_niche} style",
            f"retro {clean_niche} illustration",
            f"botanical {clean_niche} print",
            f"modern {clean_niche} artwork",
            f"cottagecore {clean_niche}",
            f"celestial {clean_niche}",
            f"handcrafted {clean_niche}",
        ]
        results.extend(fallback_templates)

    candidates: list[TrendCandidate] = []
    for idx, name in enumerate(results[:limit], start=1):
        candidates.append(
            TrendCandidate(
                candidate_id=stable_id("niche_core", clean_niche.lower(), name.lower()),
                name=name,
                source="product_niche_core",
                rank=idx,
                strength=round(95.0 - (idx - 1) * 0.8, 2),
                metrics={"track": "niche_core", "target_niche": clean_niche},
                raw={"track": "niche_core", "seed_niche": clean_niche},
            )
        )
    return candidates


class GeminiSemanticAnalyzer:
    def __init__(
        self,
        *,
        niche: str,
        model: str = "gemini-2.5-pro",
        backend: str = "auto",
        batch_size: int = 20,
        cache: JsonCache | None = None,
        refresh_cache: bool = False,
    ):
        self.niche = niche.strip()
        self.model = model
        self.backend = backend
        self.batch_size = max(1, min(50, int(batch_size)))
        self.cache = cache
        self.refresh_cache = refresh_cache
        self.client = self._build_client()

    def _build_client(self) -> Any:
        try:
            from google import genai
        except Exception as exc:
            LOG.warning("google-genai unavailable; using heuristic semantic fallback: %s", exc)
            return None

        api_key = env("GEMINI_API_KEY") or env("GOOGLE_API_KEY")
        project = env("GOOGLE_CLOUD_PROJECT")
        location = env("GOOGLE_CLOUD_LOCATION", "us-central1")
        use_enterprise = env("GOOGLE_GENAI_USE_ENTERPRISE", "").lower() in {"1", "true", "yes"}

        try:
            if self.backend == "api-key" or (self.backend == "auto" and api_key and not use_enterprise):
                return genai.Client(api_key=api_key)
            if self.backend in {"enterprise", "auto"}:
                if project:
                    return genai.Client(vertexai=True, project=project, location=location)
                return genai.Client(vertexai=True, location=location)
            if api_key:
                return genai.Client(api_key=api_key)
        except Exception as exc:
            LOG.warning("Could not initialize Gemini; using heuristic fallback: %s", exc)
        return None

    @staticmethod
    def _parse_json(text: str) -> Any:
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?", "", text, flags=re.I).strip()
            text = re.sub(r"```$", "", text).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"(\{.*\}|\[.*\])", text, re.S)
            if not match:
                raise
            return json.loads(match.group(0))

    def _heuristic_item(self, candidate: TrendCandidate) -> TrendPackageItem:
        hard_reject = self._hard_reject_reason(candidate.name, is_niche_core=candidate.source == "product_niche_core")
        if hard_reject:
            return TrendPackageItem(
                trend_id="trend_" + candidate.candidate_id[:12],
                trend=candidate.name,
                trend_strength=candidate.strength,
                relationship="IRRELEVANT",
                semantic_fit=0.0,
                queries=build_smart_queries(candidate.name, self.niche),
                reason=hard_reject,
                sources=[candidate.source],
                source_metrics=candidate.metrics,
                tags=["rejected_non_printable"],
            )

        text_norm = normalize_text(candidate.name)
        is_niche_core = candidate.source == "product_niche_core" or candidate.metrics.get("track") == "niche_core"
        if is_niche_core:
            relationship = "DIRECT_PRODUCT"
            semantic_fit = 92.0
            reason = f"Track 1 (Product Niche Core): Direct surface pattern expansion for '{self.niche}'."
        else:
            visual = any(term in text_norm for term in VISUAL_TREND_TERMS)
            if visual:
                relationship = "DESIGN_INSPIRATION"
                semantic_fit = 80.0
                reason = "Track 2 (Cross-Category Visual Viral Trend): High printability aesthetic motif from Pinterest."
            else:
                relationship = "AUDIENCE_ADJACENT"
                semantic_fit = 55.0
                reason = "Heuristic fallback; retain the trend for image-level visual and printability review."

        trend = candidate.name
        queries = build_smart_queries(trend, self.niche)
        return TrendPackageItem(
            trend_id="trend_" + candidate.candidate_id[:12],
            trend=trend,
            trend_strength=candidate.strength,
            relationship=relationship,
            semantic_fit=semantic_fit,
            queries=queries[:6],
            reason=reason,
            sources=[candidate.source],
            source_metrics=candidate.metrics,
            tags=["niche_core" if is_niche_core else "viral_macro"],
        )

    def _prompt(self, candidates: list[TrendCandidate]) -> str:
        payload = [
            {
                "candidate_id": item.candidate_id,
                "name": item.name,
                "source": item.source,
                "rank": item.rank,
                "strength": item.strength,
                "metrics": item.metrics,
            }
            for item in candidates
        ]
        return f"""
You are the 2-Track Visual Trend Intelligence Engine for a Universal Print-on-Demand (POD) product tool.

Target product domain: Print-on-Demand Surface Prints & Physical Merchandise.
Target reference niche: '{self.niche or "POD graphic prints"}'

Apply the 2-Track Trend Evaluation Strategy:
TRACK 1: Product Niche Core
- Trends, surface patterns, or textures that directly and organically expand '{self.niche}'.
- Prioritize high-value surface motifs: e.g. tooled leather, embossed floral, vintage distressed pattern, bohemian runner, geometric weave, antique filigree.
- Give high semantic_fit (85-98) and classify as DIRECT_PRODUCT or DESIGN_INSPIRATION.

TRACK 2: Cross-Category Visual Viral Trends
- Viral aesthetic/macro trends from Pinterest (e.g. folk art, coquette ribbon, groovy 70s wavy, celestial, cottagecore botanicals).
- Evaluate if their visual vocabulary can be translated into flat 2D surface pattern designs for POD merchandise.
- If they have rich printable visual motifs, give solid semantic_fit (70-90) and classify as DESIGN_INSPIRATION.

STRICT GRAPHIC PRINTABILITY GATE:
Hard reject (set reject=true, relationship=IRRELEVANT, semantic_fit=0):
- Food, cooking, recipes, ingredients, drinks (e.g. 'simmer pot recipes', 'soup', 'crockpot').
- 3D physical spaces, architectural structures, home remodeling, or porch decor (e.g. 'fall porch decor', 'front porch').
- Beauty, skincare, nails, manicures, hairstyles, makeup.
- Text memes, quotes, workout/fitness routines, school/homecoming crafts (e.g. 'garters homecoming').
- Any trend that lacks distinct 2D visual motifs, surface patterns, flat illustrations, or textures suitable for POD printing.

PRIORITIZE:
- Surface patterns (floral, botanical, geometric, checkerboard, plaid, abstract, boho, vintage, celestial, cottagecore).
- Textile prints, folk art, retro illustrations, tapestry designs, seamless patterns.

Return only JSON:
{{
  "items": [
    {{
      "candidate_id": "exact id",
      "trend": "clean label",
      "relationship": "DIRECT_PRODUCT|DESIGN_INSPIRATION|CONTEXTUAL_USE|AUDIENCE_ADJACENT|IRRELEVANT",
      "semantic_fit": 86,
      "reject": false,
      "visual_relevance": 90,
      "printability_potential": 86,
      "design_transferability": 86,
      "reason": "short reason specifying Track 1 or Track 2 alignment",
      "tags": ["short tags"]
    }}
  ]
}}

Candidates:
{json.dumps(payload, ensure_ascii=False, indent=2)}
""".strip()

    def _call_gemini(self, candidates: list[TrendCandidate]) -> dict[str, Any]:
        if self.client is None:
            raise RuntimeError("Gemini client is not configured.")
        from google.genai import types

        response = self.client.models.generate_content(
            model=self.model,
            contents=self._prompt(candidates),
            config=types.GenerateContentConfig(
                temperature=0.0,
                response_mime_type="application/json",
            ),
        )
        return self._parse_json(getattr(response, "text", "") or "")

    def analyze(self, candidates: list[TrendCandidate]) -> tuple[list[TrendPackageItem], list[dict[str, Any]]]:
        by_id = {item.candidate_id: item for item in candidates}
        accepted: list[TrendPackageItem] = []
        rejected: list[dict[str, Any]] = []
        pending: list[TrendCandidate] = []

        for candidate in candidates:
            hard_reject = self._hard_reject_reason(candidate.name, is_niche_core=candidate.source == "product_niche_core")
            if hard_reject:
                rejected.append({
                    "candidate_id": candidate.candidate_id,
                    "trend": candidate.name,
                    "reject": True,
                    "reason": hard_reject,
                    "filter": "deterministic_non_visual_filter",
                })
                continue
            key = fingerprint(
                {
                    "kind": "trend-semantic-v4",
                    "niche": self.niche,
                    "model": self.model,
                    "candidate": {
                        "id": candidate.candidate_id,
                        "name": candidate.name,
                        "source": candidate.source,
                        "strength": candidate.strength,
                    },
                }
            )
            cached = None if self.refresh_cache or not self.cache else self.cache.get(key)
            if isinstance(cached, dict):
                item, reject = self._item_from_raw(candidate, cached)
                if reject:
                    rejected.append(cached)
                else:
                    accepted.append(item)
                continue
            pending.append(candidate)

        for start in range(0, len(pending), self.batch_size):
            batch = pending[start : start + self.batch_size]
            raw_items: list[dict[str, Any]]
            try:
                raw = self._call_gemini(batch)
                if isinstance(raw, list):
                    raw_items = [item for item in raw if isinstance(item, dict)]
                elif isinstance(raw, dict):
                    raw_items = [item for item in raw.get("items", []) if isinstance(item, dict)]
                else:
                    raw_items = []
            except Exception as exc:
                LOG.warning("Gemini semantic batch failed; using heuristic fallback: %s", exc)
                raw_items = []
                for candidate in batch:
                    fallback = self._heuristic_item(candidate)
                    raw_items.append(
                        {
                            "candidate_id": candidate.candidate_id,
                            "trend": fallback.trend,
                            "relationship": fallback.relationship,
                            "semantic_fit": fallback.semantic_fit,
                            "reject": fallback.relationship == "IRRELEVANT",
                            "reason": fallback.reason,
                            "tags": fallback.tags,
                            "queries": [query.__dict__ for query in fallback.queries],
                        }
                    )

            seen_ids: set[str] = set()
            for raw_item in raw_items:
                candidate_id = str(raw_item.get("candidate_id") or "").strip()
                candidate = by_id.get(candidate_id)
                if candidate is None or candidate_id in seen_ids:
                    continue
                seen_ids.add(candidate_id)
                item, reject = self._item_from_raw(candidate, raw_item)
                cache_key = fingerprint(
                    {
                        "kind": "trend-semantic-v4",
                        "niche": self.niche,
                        "model": self.model,
                        "candidate": {
                            "id": candidate.candidate_id,
                            "name": candidate.name,
                            "source": candidate.source,
                            "strength": candidate.strength,
                        },
                    }
                )
                if self.cache:
                    self.cache.set(cache_key, raw_item)
                if reject:
                    rejected.append(raw_item)
                else:
                    accepted.append(item)

            for candidate in batch:
                if candidate.candidate_id in seen_ids:
                    continue
                item = self._heuristic_item(candidate)
                if item.relationship == "IRRELEVANT":
                    rejected.append({"candidate_id": candidate.candidate_id, "trend": candidate.name, "reject": True})
                else:
                    accepted.append(item)

        if self.cache:
            self.cache.save()

        accepted.sort(key=lambda item: (item.semantic_fit, item.trend_strength), reverse=True)
        for index, item in enumerate(accepted, start=1):
            item.trend_id = f"trend_{index:03d}"
        return accepted, rejected

    @staticmethod
    def _hard_reject_reason(name: str, is_niche_core: bool = False) -> str:
        text = name.strip().lower()
        if not text:
            return "empty_trend_keyword"
        if is_niche_core:
            return ""
        match = NON_PRINTABLE_GATE_REGEX.search(text)
        if match:
            return f"Matched non-printable stopword: '{match.group(0)}'"
        return ""

    def _item_from_raw(self, candidate: TrendCandidate, raw: dict[str, Any]) -> tuple[TrendPackageItem, bool]:
        hard_reject = self._hard_reject_reason(candidate.name, is_niche_core=candidate.source == "product_niche_core")
        relationship = str(raw.get("relationship") or "IRRELEVANT").strip().upper()
        if relationship not in RELATIONSHIPS:
            relationship = "IRRELEVANT"
        semantic_fit = clamp(raw.get("semantic_fit"), default=0.0)
        reject = bool(raw.get("reject")) or relationship == "IRRELEVANT" or semantic_fit <= 0
        reason = truncate_text(raw.get("reason"), 500)

        if hard_reject:
            reject = True
            relationship = "IRRELEVANT"
            semantic_fit = 0.0
            reason = hard_reject

        queries = build_smart_queries(candidate.name, self.niche)

        tags = raw.get("tags") or raw.get("semantic_tags") or []
        if not isinstance(tags, list):
            tags = []

        item = TrendPackageItem(
            trend_id="trend_" + stable_id(candidate.candidate_id, raw.get("trend"), length=8),
            trend=truncate_text(candidate.name, 180),
            trend_strength=candidate.strength,
            relationship=relationship,
            semantic_fit=semantic_fit,
            queries=queries,
            reason=truncate_text(raw.get("reason"), 500),
            sources=[candidate.source],
            source_metrics=candidate.metrics,
            tags=unique(tags)[:12],
        )
        return item, reject
