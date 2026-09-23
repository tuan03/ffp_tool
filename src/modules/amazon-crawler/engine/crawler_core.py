"""Amazon-only crawl, family expansion, split, Customize conversion, and export pipeline."""

from __future__ import annotations

import concurrent.futures
import contextlib
import hashlib
import html as html_module
import http.cookiejar
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from bs4 import BeautifulSoup

from .amazon_locale import AMAZON_ORIGIN, DEFAULT_HEADERS, force_us_profile_url, html_is_location_blocked
from .cache import RawFamilyCache
from .customization_converter import expand_paid_variants, normalize_customization, remove_option_choosers
from .playwright_pool import CaptchaTimeout, PlaywrightPool, html_is_captcha
from .proxy_profiles import ProxyAssignment, resolve_proxy_assignments
from .variant_presets import PRESET_ID, build_jeminise_variants

ASIN_RE = re.compile(r"(?<![A-Z0-9])([A-Z0-9]{10})(?![A-Z0-9])", re.I)
AMAZON_HOST_RE = re.compile(r"(^|\.)amazon\.[a-z.]+$", re.I)
ETSY_HOST_RE = re.compile(r"(^|\.)etsy\.com$", re.I)
MONEY_RE = re.compile(r"(?:US\s*)?\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)")
SCHEMA_VERSION = "1.0"
SPLIT_PRIORITIES = ("design", "color", "colour", "style", "pattern", "theme")
InputCompletionCallback = Callable[[dict[str, Any]], None]
ProductCompletionCallback = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class CrawlSettings:
    profile_slug: str = "default"
    image_profile_slug: str = "default"
    image_profile_revision: str | None = None
    apply_jeminise_preset: bool = False
    product_threads: int = 3
    variant_threads: int = 8
    urllib_threads: int = 12
    browser_profiles: int = 4
    browser_tabs: int = 2
    headless: bool = False
    amazon_zip: str = "10001"
    captcha_timeout_seconds: int = 180
    max_matrix_variants: int = 500

    @classmethod
    def from_api(cls, payload: dict[str, Any]) -> "CrawlSettings":
        profile = str(payload.get("profileSlug") or "default").strip().casefold()
        aliases = {"jeminse": "jeminise", "chi_yeu_minh_em": "jeminise"}
        profile = aliases.get(profile, profile)
        if profile not in {"default", "jeminise"}:
            raise ValueError("profileSlug must be 'default' or 'jeminise'.")

        def bounded(key: str, default: int, minimum: int, maximum: int) -> int:
            value = int(payload.get(key, default))
            if value < minimum or value > maximum:
                raise ValueError(f"{key} must be between {minimum} and {maximum}.")
            return value

        zip_code = str(payload.get("amazonZip") or "10001").strip()
        if not re.fullmatch(r"\d{5}(?:-\d{4})?", zip_code):
            raise ValueError("amazonZip must be a US ZIP code.")
        return cls(
            profile_slug=profile,
            image_profile_slug=re.sub(
                r"[^a-z0-9]+", "-", str(payload.get("imageProfileSlug") or "default").strip().casefold()
            ).strip("-")[:80] or "default",
            image_profile_revision=(
                str(payload.get("imageProfileRevision") or "").strip() or None
            ),
            apply_jeminise_preset=bool(payload.get("applyJeminisePreset", False)),
            product_threads=bounded("productThreads", 3, 1, 16),
            variant_threads=bounded("variantThreads", 8, 1, 32),
            urllib_threads=bounded("urllibThreads", 12, 1, 64),
            browser_profiles=bounded("browserProfiles", 4, 1, 8),
            browser_tabs=bounded("browserTabs", 2, 1, 12),
            headless=bool(payload.get("headless", False)),
            amazon_zip=zip_code,
            captcha_timeout_seconds=bounded("captchaTimeoutSeconds", 180, 30, 900),
            max_matrix_variants=bounded("maxMatrixVariants", 500, 1, 5000),
        )

    def api_dict(self) -> dict[str, Any]:
        values = asdict(self)
        return {
            "profileSlug": values["profile_slug"], "applyJeminisePreset": values["apply_jeminise_preset"],
            "imageProfileSlug": values["image_profile_slug"],
            "imageProfileRevision": values["image_profile_revision"],
            "productThreads": values["product_threads"], "variantThreads": values["variant_threads"],
            "urllibThreads": values["urllib_threads"], "browserProfiles": values["browser_profiles"],
            "browserTabs": values["browser_tabs"], "headless": values["headless"],
            "amazonZip": values["amazon_zip"], "captchaTimeoutSeconds": values["captcha_timeout_seconds"],
            "maxMatrixVariants": values["max_matrix_variants"],
        }


@dataclass(frozen=True)
class NormalizedInput:
    source: str
    asin: str
    canonical_url: str


def normalize_amazon_input(source: str) -> NormalizedInput:
    value = source.strip()
    if not value:
        raise ValueError("Input is empty.")
    if re.fullmatch(r"[A-Za-z0-9]{10}", value):
        asin = value.upper()
        return NormalizedInput(source=value, asin=asin, canonical_url=f"https://www.amazon.com/dp/{asin}")
    candidate = value if "://" in value else f"https://{value}"
    parsed = urllib.parse.urlparse(candidate)
    host = (parsed.hostname or "").casefold()
    if ETSY_HOST_RE.search(host):
        raise ValueError("Etsy is not supported by this module.")
    if not AMAZON_HOST_RE.search(host):
        raise ValueError("Only Amazon product URLs or ASINs are supported.")
    match = re.search(r"/(?:dp|gp/product|gp/aw/d|product)/([A-Z0-9]{10})(?:[/?]|$)", parsed.path + ("?" + parsed.query if parsed.query else ""), re.I)
    if match is None:
        match = ASIN_RE.search(value)
    if match is None:
        raise ValueError("Could not find a valid ASIN in the Amazon URL.")
    asin = match.group(1).upper()
    return NormalizedInput(source=value, asin=asin, canonical_url=f"https://www.amazon.com/dp/{asin}")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html_module.unescape(value or "")).strip()


def _money(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    match = MONEY_RE.search(raw)
    if match is None:
        return None
    amount = float(match.group(1).replace(",", ""))
    return {"raw": f"${amount:.2f}", "amount": amount, "currency": "USD"}


def _stable_token(*values: str, length: int = 20) -> str:
    return hashlib.sha256("|".join(values).encode("utf-8")).hexdigest()[:length]


def _exception_message(error: BaseException) -> str:
    message = str(error).strip()
    return message or type(error).__name__


def _balanced_json(source: str, marker: str) -> Any | None:
    marker_index = source.find(marker)
    if marker_index < 0:
        return None
    start_candidates = [index for index in (source.find("{", marker_index), source.find("[", marker_index)) if index >= 0]
    if not start_candidates:
        return None
    start = min(start_candidates)
    opener = source[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    quoted = False
    escaped = False
    for index in range(start, len(source)):
        character = source[index]
        if quoted:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
            continue
        if character == '"':
            quoted = True
        elif character == opener:
            depth += 1
        elif character == closer:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(source[start:index + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _json_or_none(value: str) -> Any | None:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None


def _extract_customization(html: str) -> tuple[Any | None, list[str], str | None]:
    has_structured_signal = bool(re.search(
        r"gc:productInfo|customizationFormLink|gc-widget|sellerConfigComponents|"
        r"OptionChooserComponent|customizationConfig",
        html,
        re.I,
    ))
    has_customize_action = bool(re.search(
        r'<(?:button|input|a)\b[^>]*(?:id|name)=["\'][^"\']*customi[sz][^"\']*["\']',
        html,
        re.I,
    ))
    if not has_structured_signal and not has_customize_action:
        return None, [], None
    soup = BeautifulSoup(html, "html.parser")
    customization_state: dict[str, Any] = {}
    form_url: str | None = None
    for node in soup.select('script[type="a-state"][data-a-state]'):
        metadata = _json_or_none(html_module.unescape(str(node.get("data-a-state") or "")))
        key = str(metadata.get("key") or "") if isinstance(metadata, dict) else ""
        if not key.startswith("gc:"):
            continue
        body = _json_or_none(node.string or node.get_text() or "")
        customization_state[key] = body
        if key == "gc:productInfo" and isinstance(body, dict):
            link = str(body.get("customizationFormLink") or "").strip()
            if link:
                form_url = urllib.parse.urljoin("https://www.amazon.com", html_module.unescape(link))
    if form_url is None:
        # Some Amazon responses contain gc:productInfo in a script that is not
        # emitted as a valid a-state node. Recover the link from the raw source
        # before treating the customizable product as missing its widget.
        link_match = re.search(
            r'["\']customizationFormLink["\']\s*:\s*["\']([^"\']+)',
            html,
            re.I,
        )
        if link_match:
            raw_link = html_module.unescape(link_match.group(1)).replace(r"\/", "/")
            try:
                raw_link = bytes(raw_link, "utf-8").decode("unicode_escape")
            except UnicodeDecodeError:
                pass
            form_url = urllib.parse.urljoin("https://www.amazon.com", raw_link)
    for script in soup.find_all("script"):
        text = script.string or script.get_text() or ""
        if not re.search(r"OptionChooserComponent|sellerConfigComponents|customizationConfig|gc-widget", text, re.I):
            continue
        stripped = text.strip()
        if stripped.startswith(("{", "[")):
            try:
                parsed = json.loads(stripped)
                return parsed, [], form_url
            except json.JSONDecodeError:
                pass
        for marker in ("customizationConfig", "sellerConfigComponents", "OptionChooserComponent"):
            parsed = _balanced_json(text, marker)
            if parsed is not None:
                return parsed, [], form_url
    if customization_state:
        warning = [] if form_url else ["Amazon customization state does not include a form URL."]
        return {"state": customization_state}, warning, form_url
    if form_url:
        return None, [], form_url
    return None, ["Amazon indicates customization, but its widget payload could not be parsed."], form_url


def _extract_json_map(html: str, key: str) -> dict[str, Any]:
    value = _balanced_json(html, key)
    return value if isinstance(value, dict) else {}


def _extract_parent_asin(html: str, current_asin: str) -> str:
    for pattern in (r'"parentAsin"\s*:\s*"([A-Z0-9]{10})"', r'"parent_asin"\s*:\s*"([A-Z0-9]{10})"'):
        match = re.search(pattern, html, re.I)
        if match:
            return match.group(1).upper()
    return current_asin


def _balanced_json_array(text: str, start: int) -> list[Any] | None:
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(start, len(text)):
        character = text[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character in {"\"", "'"}:
            quote = character
        elif character == "[":
            depth += 1
        elif character == "]":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(text[start:index + 1])
                except json.JSONDecodeError:
                    return None
                return parsed if isinstance(parsed, list) else None
    return None


def _amazon_image_id(url: str) -> str | None:
    match = re.search(r"/images/I/([^./?]+)", url, re.I)
    if match is None:
        return None
    return match.group(1).split("._", 1)[0]


def _amazon_high_resolution_url(url: str) -> str:
    if "/images/I/" not in url:
        return url
    upgraded = re.sub(r"\._[^./?]*_(?=\.(?:jpe?g|png|webp)(?:\?|$))", "._SL1500_", url, flags=re.I)
    if upgraded == url:
        upgraded = re.sub(r"(?=\.(?:jpe?g|png|webp)(?:\?|$))", "._SL1500_", url, count=1, flags=re.I)
    return upgraded


def _is_video_gallery_entry(entry: dict[str, Any], url: str) -> bool:
    if entry.get("isVideo") is True or entry.get("videoUrl") or entry.get("video"):
        return True
    lowered = url.casefold()
    return any(marker in lowered for marker in ("play-button", "video", "/images/s/"))


def _extract_gallery_entries(html: str) -> list[Any]:
    marker = re.search(r"[\"']colorImages[\"']\s*:\s*\{\s*[\"']initial[\"']\s*:\s*", html, re.DOTALL)
    if marker is None:
        return []
    remainder = html[marker.end():]
    encoded = re.match(
        r"A\.\$\.parseJSON\(\s*(?P<quote>[\"'])(?P<payload>(?:\\.|(?!(?P=quote)).)*)\1\s*\)",
        remainder,
        re.DOTALL,
    )
    if encoded is not None:
        payload = html_module.unescape(encoded.group("payload")).replace(r"\/", "/")
        if encoded.group("quote") == '"':
            try:
                payload = json.loads(f'"{payload}"')
            except json.JSONDecodeError:
                return []
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    array_start = remainder.find("[")
    if array_start < 0:
        return []
    return _balanced_json_array(remainder, array_start) or []


def _extract_rendered_gallery_entries(html: str) -> list[Any]:
    soup = BeautifulSoup(html, "html.parser")
    script = soup.select_one("#ffp-rendered-gallery")
    if script is None:
        return []
    try:
        parsed = json.loads(script.string or script.get_text() or "[]")
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _extract_high_resolution_images(html: str, source_asin: str) -> list[dict[str, Any]]:
    entries = [*_extract_gallery_entries(html), *_extract_rendered_gallery_entries(html)]
    images: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        high_resolution = entry.get("hiRes") or entry.get("large")
        image_url = str(high_resolution or entry.get("mainUrl") or entry.get("thumb") or "").strip()
        if not high_resolution:
            image_url = _amazon_high_resolution_url(image_url)
        image_id = _amazon_image_id(image_url)
        if (
            not image_url.startswith("http")
            or _is_video_gallery_entry(entry, image_url)
            or image_url in seen_urls
            or (image_id is not None and image_id in seen_ids)
        ):
            continue
        seen_urls.add(image_url)
        if image_id is not None:
            seen_ids.add(image_id)
        images.append({
            "url": image_url,
            "kind": "image",
            "sourceAsin": source_asin,
            "amazonImageId": image_id,
            "isMain": len(images) == 0,
        })
    return images


def _extract_dimensions(html: str, current_asin: str) -> tuple[dict[str, list[str]], dict[str, dict[str, str]]]:
    labels_raw = _extract_json_map(html, "variationDisplayLabels")
    values_raw = _extract_json_map(html, "variationValues")
    display_raw = _extract_json_map(html, "dimensionValuesDisplayData")
    dimensions: dict[str, list[str]] = {}
    labels: list[str] = []
    if labels_raw:
        for key, label in labels_raw.items():
            labels.append(_clean_text(str(label or key)))
    elif values_raw:
        labels = [_clean_text(str(key)) for key in values_raw]
    for index, label in enumerate(labels):
        raw_values: Any = None
        if index < len(values_raw):
            raw_values = list(values_raw.values())[index]
        if isinstance(raw_values, list):
            dimensions[label] = [_clean_text(str(value)) for value in raw_values if _clean_text(str(value))]
    asin_options: dict[str, dict[str, str]] = {}
    for asin, raw_values in display_raw.items():
        if not ASIN_RE.fullmatch(str(asin)) or not isinstance(raw_values, list):
            continue
        asin_options[str(asin).upper()] = {
            label: _clean_text(str(raw_values[index]))
            for index, label in enumerate(labels)
            if index < len(raw_values) and _clean_text(str(raw_values[index]))
        }
    dimension_map = _extract_json_map(html, "dimensionToAsinMap")
    ordered_values = [value for value in values_raw.values() if isinstance(value, list)]
    for raw_combination, asin_value in dimension_map.items():
        asin = str(asin_value.get("asin") if isinstance(asin_value, dict) else asin_value or "").upper()
        if not ASIN_RE.fullmatch(asin):
            continue
        indexes = [int(value) for value in re.findall(r"\d+", str(raw_combination))]
        options: dict[str, str] = {}
        for index, label in enumerate(labels):
            if index >= len(indexes) or index >= len(ordered_values):
                continue
            values = ordered_values[index]
            value_index = indexes[index]
            if value_index < len(values):
                options[label] = _clean_text(str(values[value_index]))
        asin_options.setdefault(asin, options)
    soup = BeautifulSoup(html, "html.parser")
    variant_selectors = (
        "#twister [data-asin]",
        "[id^='variation_'] [data-asin]",
        "[id^='inline-twister-row-'] [data-asin]",
        "#native_dropdown_selected_size_name [data-asin]",
    )
    for element in soup.select(", ".join(variant_selectors)):
        asin = str(element.get("data-asin") or "").upper()
        if not ASIN_RE.fullmatch(asin):
            continue
        asin_options.setdefault(asin, {})
    asin_options.setdefault(current_asin, {})
    for options in asin_options.values():
        for label, value in options.items():
            bucket = dimensions.setdefault(label, [])
            if value.casefold() not in {existing.casefold() for existing in bucket}:
                bucket.append(value)
    return dimensions, asin_options


def parse_product_html(html: str, requested_asin: str, url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    canonical_asin = requested_asin
    asin_input = soup.select_one("#ASIN")
    if asin_input and ASIN_RE.fullmatch(str(asin_input.get("value") or "")):
        canonical_asin = str(asin_input.get("value")).upper()
    title_element = soup.select_one("#productTitle") or soup.select_one("h1")
    title = _clean_text(title_element.get_text(" ") if title_element else "")
    if not title:
        raise ValueError("Amazon HTML does not contain a product title.")
    bullet_nodes = soup.select("#feature-bullets li span.a-list-item, #productFactsDesktopExpander li")
    bullets = list(dict.fromkeys(_clean_text(element.get_text(" ")) for element in bullet_nodes))
    bullets = [bullet for bullet in bullets if bullet]
    description_element = soup.select_one("#productDescription, #aplus_feature_div, #aplus")
    description = _clean_text(description_element.get_text(" ")) if description_element else None
    if not description and bullets:
        description = " ".join(bullets)
    categories = [_clean_text(element.get_text(" ")) for element in soup.select("#wayfinding-breadcrumbs_container a")]
    categories = [category for category in categories if category]
    product_details: dict[str, str] = {}
    for row in soup.select("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr"):
        heading = row.select_one("th")
        value = row.select_one("td")
        if heading and value:
            product_details[_clean_text(heading.get_text(" "))] = _clean_text(value.get_text(" "))
    for item in soup.select("#detailBullets_feature_div li"):
        text = _clean_text(item.get_text(" "))
        if ":" in text:
            key, value = text.split(":", 1)
            if _clean_text(key) and _clean_text(value):
                product_details.setdefault(_clean_text(key), _clean_text(value))
    def first_money(selectors: tuple[str, ...]) -> dict[str, Any] | None:
        for selector in selectors:
            for element in soup.select(selector):
                parsed = _money(_clean_text(element.get_text(" ")))
                if parsed is not None:
                    return parsed
        return None

    price = first_money((
        "#apex-pricetopay-accessibility-label", ".priceToPay .a-offscreen",
        "#corePrice_feature_div .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-offscreen",
        "#priceblock_ourprice", "#price_inside_buybox", "#newBuyBoxPrice", "#tp_price_block_total_price_ww .a-offscreen",
    ))
    images = _extract_high_resolution_images(html, canonical_asin)
    if not images:
        seen_ids: set[str] = set()
        seen_urls: set[str] = set()
        for element in soup.select("#landingImage, #altImages img, img[data-old-hires]"):
            if element.find_parent(class_=re.compile(r"video", re.I)) is not None:
                continue
            image_url = str(element.get("data-old-hires") or element.get("data-a-dynamic-image") or element.get("src") or "")
            if image_url.startswith("{"):
                try:
                    dynamic = json.loads(image_url)
                    image_url = next(iter(dynamic), "")
                except json.JSONDecodeError:
                    image_url = ""
            image_url = image_url.strip()
            image_url = _amazon_high_resolution_url(image_url)
            image_id = _amazon_image_id(image_url)
            if (
                image_url.startswith("http")
                and not _is_video_gallery_entry({}, image_url)
                and image_url not in seen_urls
                and (image_id is None or image_id not in seen_ids)
            ):
                seen_urls.add(image_url)
                if image_id is not None:
                    seen_ids.add(image_id)
                images.append({
                    "url": image_url,
                    "kind": "image",
                    "sourceAsin": canonical_asin,
                    "amazonImageId": image_id,
                    "isMain": len(images) == 0,
                })
    dimensions, asin_options = _extract_dimensions(html, canonical_asin)
    customization_raw, customization_warnings, customization_form_url = _extract_customization(html)
    return {
        "asin": canonical_asin, "parentAsin": _extract_parent_asin(html, canonical_asin),
        "url": f"https://www.amazon.com/dp/{canonical_asin}", "requestedUrl": url,
        "title": title, "description": description, "bulletPoints": bullets,
        "categories": categories, "productDetails": product_details,
        "price": price,
        "media": images, "dimensions": dimensions, "asinOptions": asin_options,
        "customizationRaw": customization_raw, "customizationWarnings": customization_warnings,
        "customizationFormUrl": customization_form_url,
    }


class HttpFetcher:
    def __init__(self, *, zip_code: str = "10001", retries: int = 3, assignments: list[ProxyAssignment] | None = None) -> None:
        self.zip_code = zip_code
        self.retries = retries
        self.assignments = assignments or [ProxyAssignment(index=0, name="profile-1")]
        self._lock = threading.Lock()
        self._session_cookies: dict[int, str] = {}
        self._session_failures: dict[int, float] = {}
        self._us_profile_applied: dict[int, bool] = {}
        self._blocked_until: dict[int, float] = {}
        self._assignment_slots = {
            assignment.index: threading.BoundedSemaphore(1)
            for assignment in self.assignments
        }
        self._thread_diagnostics = threading.local()

    def last_diagnostics(self) -> list[dict[str, Any]]:
        return deepcopy(getattr(self._thread_diagnostics, "attempts", []))

    def _available_assignments(self) -> list[ProxyAssignment]:
        with self._lock:
            now = time.monotonic()
            return [
                assignment
                for assignment in self.assignments
                if self._blocked_until.get(assignment.index, 0) <= now
            ]

    def _block_assignment(self, assignment: ProxyAssignment, seconds: int = 300) -> None:
        with self._lock:
            self._blocked_until[assignment.index] = time.monotonic() + seconds

    @staticmethod
    def _opener(assignment: ProxyAssignment, cookie_jar: http.cookiejar.CookieJar | None = None) -> urllib.request.OpenerDirector:
        handlers: list[Any] = []
        proxy_url = assignment.urllib_url()
        if proxy_url:
            handlers.append(urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url}))
        else:
            # An explicit empty handler prevents HTTP_PROXY/HTTPS_PROXY from
            # silently turning the primary "direct" route into another proxy.
            handlers.append(urllib.request.ProxyHandler({}))
        if cookie_jar is not None:
            handlers.append(urllib.request.HTTPCookieProcessor(cookie_jar))
        return urllib.request.build_opener(*handlers)

    def _bootstrap_us_cookie(self, assignment: ProxyAssignment) -> str:
        with self._lock:
            cached = self._session_cookies.get(assignment.index)
            if cached:
                return cached
            failed_at = self._session_failures.get(assignment.index)
            if failed_at and time.monotonic() - failed_at < 900:
                return DEFAULT_HEADERS["Cookie"]
            last_error: Exception | None = None
            headers = {key: value for key, value in DEFAULT_HEADERS.items() if key != "Cookie"} | {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1",
            }
            for attempt in range(3):
                jar = http.cookiejar.CookieJar()
                opener = self._opener(assignment, jar)
                try:
                    home_request = urllib.request.Request(f"{AMAZON_ORIGIN}/?language=en_US&currency=USD", headers=headers)
                    with opener.open(home_request, timeout=12) as response:
                        response.read()
                    payload = urllib.parse.urlencode({
                        "locationType": "LOCATION_INPUT", "zipCode": self.zip_code, "storeContext": "generic",
                        "deviceType": "web", "pageType": "Gateway", "actionSource": "glow",
                    }).encode("utf-8")
                    location_headers = headers | {
                        "Accept": "application/json, text/javascript, */*; q=0.01",
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                        "Origin": AMAZON_ORIGIN, "Referer": f"{AMAZON_ORIGIN}/", "X-Requested-With": "XMLHttpRequest",
                    }
                    request = urllib.request.Request(f"{AMAZON_ORIGIN}/gp/delivery/ajax/address-change.html", data=payload, headers=location_headers)
                    with opener.open(request, timeout=12) as response:
                        result = json.loads(response.read().decode("utf-8", errors="replace"))
                    if not result.get("isAddressUpdated") and not result.get("successful"):
                        raise RuntimeError(f"Amazon rejected US ZIP {self.zip_code}: {result}")
                    cookies = {cookie.name: cookie.value for cookie in jar if cookie.name not in {"i18n-prefs", "lc-main", "sp-cdn"}}
                    cookies.update({"i18n-prefs": "USD", "lc-main": "en_US"})
                    cookie_header = "; ".join(f"{name}={value}" for name, value in cookies.items())
                    self._session_cookies[assignment.index] = cookie_header
                    self._us_profile_applied[assignment.index] = True
                    self._session_failures.pop(assignment.index, None)
                    return cookie_header
                except Exception as error:
                    last_error = error
                    time.sleep(0.7 * (attempt + 1))
            self._session_failures[assignment.index] = time.monotonic()
            self._us_profile_applied[assignment.index] = False
            return DEFAULT_HEADERS["Cookie"]

    @staticmethod
    def _candidate_urls(url: str) -> list[str]:
        canonical = force_us_profile_url(url)
        parsed = urllib.parse.urlsplit(canonical)
        query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        query.update({"th": "1", "psc": "1", "language": "en_US", "currency": "USD"})
        with_selection = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
        product_path = canonical.replace("/dp/", "/gp/product/")
        return [canonical, with_selection, force_us_profile_url(product_path)]

    def fetch(self, url: str) -> tuple[str, int]:
        error: Exception | None = None
        candidates = self._candidate_urls(url)
        diagnostics: list[dict[str, Any]] = []
        available_assignments = self._available_assignments()
        if not available_assignments:
            error = RuntimeError("All HTTP network routes are temporarily cooling down.")
            diagnostics.append({
                "attempt": 1,
                "outcome": "all_profiles_cooling_down",
                "error": "All HTTP network routes are temporarily cooling down after CAPTCHA or location failures.",
                "durationMs": 0,
            })
            self._thread_diagnostics.attempts = diagnostics
            raise HttpFetchError(f"HTTP fetch failed after 1 network attempt: {error}", diagnostics)
        route_assignments = (
            available_assignments
            if len(available_assignments) > 1
            else available_assignments * self.retries
        )
        for attempt, assignment in enumerate(route_assignments, start=1):
            candidate = candidates[(attempt - 1) % len(candidates)]
            started = time.monotonic()
            trace: dict[str, Any] = {
                "attempt": attempt,
                "profile": assignment.name,
                "proxyEnabled": assignment.is_enabled,
                "candidate": attempt - 1 if attempt <= len(candidates) else (attempt - 1) % len(candidates),
            }
            slot = self._assignment_slots[assignment.index] if assignment.is_enabled else contextlib.nullcontext()
            with slot:
                try:
                    cookie_header = self._bootstrap_us_cookie(assignment)
                    if self._us_profile_applied.get(assignment.index) is not True:
                        raise RuntimeError(
                            f"HTTP could not confirm Amazon US delivery ZIP {self.zip_code} for this profile."
                        )
                    request = urllib.request.Request(candidate, headers={**DEFAULT_HEADERS, "Cookie": cookie_header})
                    with self._opener(assignment).open(request, timeout=90) as response:
                        body = response.read().decode("utf-8", errors="replace")
                        trace["httpStatus"] = getattr(response, "status", None)
                    if html_is_captcha(body):
                        raise RuntimeError("Amazon CAPTCHA/bot-check page detected.")
                    if html_is_location_blocked(body):
                        raise RuntimeError(f"Amazon offer is blocked outside US ZIP {self.zip_code}.")
                    has_product_document = bool(re.search(r'id=["\'](?:productTitle|ppd|dp-container)["\']', body, re.I))
                    has_customize_document = "gc-widget" in body or "sellerConfigComponents" in body
                    if len(body) < 5_000 or not (has_product_document or has_customize_document):
                        raise RuntimeError("Amazon response does not contain a usable product document.")
                    trace.update({"outcome": "success", "htmlBytes": len(body)})
                    diagnostics.append(trace)
                    self._thread_diagnostics.attempts = diagnostics
                    return body, attempt
                except (urllib.error.URLError, TimeoutError, RuntimeError) as caught:
                    error = caught
                    message = _exception_message(caught)
                    outcome = "captcha" if "captcha" in message.casefold() else (
                        "location" if "zip" in message.casefold() or "location" in message.casefold() else "error"
                    )
                    if outcome in {"captcha", "location"}:
                        self._block_assignment(assignment)
                    trace.update({"outcome": outcome, "error": message})
                finally:
                    trace["durationMs"] = round((time.monotonic() - started) * 1000)
            diagnostics.append(trace)
            self._thread_diagnostics.attempts = diagnostics
            if attempt < len(route_assignments):
                time.sleep(0.25 * attempt)
        raise HttpFetchError(f"HTTP fetch failed after {len(diagnostics)} network attempts: {error}", diagnostics)


ProgressCallback = Callable[[dict[str, Any]], None]
InputCompletionCallback = Callable[[dict[str, Any]], None]


class HttpFetchError(RuntimeError):
    def __init__(self, message: str, diagnostics: list[dict[str, Any]]) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics


class CrawlFetchError(RuntimeError):
    def __init__(self, message: str, diagnostics: dict[str, Any]) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics


def effective_product_threads(input_count: int, settings: CrawlSettings) -> int:
    return min(input_count or 1, max(settings.product_threads, settings.browser_profiles))


class AmazonCrawler:
    def __init__(self, *, root: Path, settings: CrawlSettings, progress: ProgressCallback | None = None, cancel_event: threading.Event | None = None, fetcher: HttpFetcher | None = None, browser_pool: PlaywrightPool | None = None, proxy_config_path: Path | None = None) -> None:
        self.root = root
        self.settings = settings
        self.progress = progress or (lambda _: None)
        self._progress_lock = threading.Lock()
        self._progress_items: dict[str, dict[str, Any]] = {}
        self._progress_completed = 0
        self._progress_total = 0
        self._progress_phase = "queued"
        self._progress_message = "Đang chờ xử lý."
        self._browser_pool_state: dict[str, Any] = {
            "directProfiles": settings.browser_profiles,
            "proxyProfiles": 0,
            "tabsPerProfile": settings.browser_tabs,
            "directActive": 0,
            "proxyActive": 0,
            "directQueued": 0,
            "proxyQueued": 0,
        }
        self.cancel_event = cancel_event or threading.Event()
        proxy_assignments, self.proxy_warnings = resolve_proxy_assignments(
            root,
            settings.browser_profiles,
            config_path=proxy_config_path,
        )
        self.fetcher = fetcher or HttpFetcher(zip_code=settings.amazon_zip, assignments=proxy_assignments)
        self._http_slots = threading.BoundedSemaphore(settings.urllib_threads)
        self.cache = RawFamilyCache(root / ".runtime" / "cache")
        self.browser_pool = browser_pool or PlaywrightPool(
            profile_root=root / ".runtime" / "browser-profiles", profiles=settings.browser_profiles,
            tabs_per_profile=settings.browser_tabs, headless=settings.headless,
            captcha_timeout=settings.captcha_timeout_seconds, zip_code=settings.amazon_zip,
            proxy_assignments=proxy_assignments,
            on_captcha=self._captcha_progress,
            on_activity=self._browser_activity,
        )
        self._browser_pool_state["directProfiles"] = int(
            getattr(self.browser_pool, "profiles", settings.browser_profiles)
        )
        self._browser_pool_state["proxyProfiles"] = len(
            getattr(self.browser_pool, "proxy_profile_indices", [])
        )

    def _initialize_progress(self, normalized_inputs: list[NormalizedInput]) -> None:
        with self._progress_lock:
            self._progress_completed = 0
            self._progress_total = len(normalized_inputs)
            self._progress_items = {
                normalized.source: {
                    "source": normalized.source,
                    "asin": normalized.asin,
                    "phase": "queued",
                    "status": "queued",
                    "message": "Đang chờ xử lý.",
                    "variantCompleted": 0,
                    "variantTotal": 0,
                    "activeVariants": [],
                }
                for normalized in normalized_inputs
            }

    def _report_progress(
        self,
        *,
        phase: str,
        message: str,
        source: str | None = None,
        item_updates: dict[str, Any] | None = None,
        completed: int | None = None,
        total: int | None = None,
        job_status: str | None = None,
    ) -> None:
        with self._progress_lock:
            self._progress_phase = phase
            self._progress_message = message
            if completed is not None:
                self._progress_completed = completed
            if total is not None:
                self._progress_total = total
            if source is not None:
                item = self._progress_items.setdefault(source, {
                    "source": source,
                    "asin": "",
                    "phase": phase,
                    "status": "running",
                    "message": message,
                    "variantCompleted": 0,
                    "variantTotal": 0,
                    "activeVariants": [],
                })
                item.update({"phase": phase, "message": message})
                if item_updates:
                    item.update(deepcopy(item_updates))
            payload = {
                "phase": phase,
                "completed": self._progress_completed,
                "total": self._progress_total,
                "message": message,
                "items": deepcopy(list(self._progress_items.values())),
                "browserPool": deepcopy(self._browser_pool_state),
            }
            if source is not None:
                payload["source"] = source
            if job_status is not None:
                payload["status"] = job_status
        self.progress(payload)

    def _browser_activity(self, activity: dict[str, Any]) -> None:
        url = str(activity.pop("url", ""))
        match = ASIN_RE.search(url)
        requested_asin = match.group(1).upper() if match else None
        source: str | None = None
        item_updates: dict[str, Any] | None = None
        with self._progress_lock:
            self._browser_pool_state.update(deepcopy(activity))
            if requested_asin:
                source = next((
                    item_source
                    for item_source, item in self._progress_items.items()
                    if item.get("asin") == requested_asin or item.get("currentAsin") == requested_asin
                ), None)
            if source and activity.get("networkRoute"):
                item_updates = {
                    "networkRoute": activity.get("networkRoute"),
                    "browserProfile": activity.get("browserProfile"),
                }
            phase = self._progress_phase
            message = self._progress_message
        self._report_progress(
            phase=phase,
            message=message,
            source=source,
            item_updates=item_updates,
        )

    def _captcha_progress(self, url: str) -> None:
        match = ASIN_RE.search(url)
        requested_asin = match.group(1).upper() if match else None
        source: str | None = None
        if requested_asin:
            with self._progress_lock:
                source = next((
                    item_source
                    for item_source, item in self._progress_items.items()
                    if item.get("asin") == requested_asin or item.get("currentAsin") == requested_asin
                ), None)
        self._report_progress(
            phase="captcha",
            message="Hãy giải CAPTCHA trong cửa sổ trình duyệt; job sẽ tự tiếp tục.",
            source=source,
            item_updates={"status": "running"} if source else None,
            job_status="waiting_captcha",
        )

    def _check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise InterruptedError("Crawler job was cancelled.")

    def _fetch_parsed(self, normalized: NormalizedInput) -> tuple[dict[str, Any], dict[str, Any]]:
        attempts = 0
        captcha = False
        location_fallback = False
        http_trace: list[dict[str, Any]] = []
        playwright_trace: list[dict[str, Any]] = []
        try:
            with self._http_slots:
                html, attempts = self.fetcher.fetch(normalized.canonical_url)
            read_http_trace = getattr(self.fetcher, "last_diagnostics", None)
            if callable(read_http_trace):
                http_trace = read_http_trace()
            parsed = parse_product_html(html, normalized.asin, normalized.canonical_url)
            return parsed, {
                "fetchMode": "http", "attempts": attempts, "captchaEncountered": False,
                "locationFallbackUsed": False, "amazonZip": self.settings.amazon_zip,
                "usProfileApplied": True, "matrixSwept": False, "cacheHit": False,
                "fetchTrace": {"http": http_trace, "playwright": []},
            }
        except Exception as http_error:
            if not http_trace:
                http_trace = deepcopy(getattr(http_error, "diagnostics", []))
            text = str(http_error).casefold()
            captcha = "captcha" in text
            location_fallback = "location" in text or "delivery zip" in text or "us zip" in text
            self._check_cancelled()
            browser_error: Exception | None = None
            proxy_fallback = getattr(self.browser_pool, "fetch_proxy_fallback", None)
            has_proxy_fallback = bool(getattr(self.browser_pool, "proxy_profile_indices", [])) and callable(proxy_fallback)
            parse_attempts = 2 if has_proxy_fallback else min(
                2,
                int(getattr(self.browser_pool, "profiles", self.settings.browser_profiles)),
            )
            for browser_attempt in range(1, parse_attempts + 1):
                trace: dict[str, Any] = {"attempt": browser_attempt}
                try:
                    if browser_attempt > 1 and has_proxy_fallback:
                        html = proxy_fallback(normalized.canonical_url, cancel_event=self.cancel_event)
                    else:
                        html = self.browser_pool.fetch(normalized.canonical_url, cancel_event=self.cancel_event)
                    read_browser_trace = getattr(self.browser_pool, "last_diagnostics", None)
                    if callable(read_browser_trace):
                        trace["profiles"] = read_browser_trace()
                    parsed = parse_product_html(html, normalized.asin, normalized.canonical_url)
                    trace.update({"outcome": "success", "returnedAsin": parsed.get("asin"), "htmlBytes": len(html)})
                    playwright_trace.append(trace)
                    return parsed, {
                        "fetchMode": "playwright", "attempts": len(http_trace) + browser_attempt,
                        "captchaEncountered": captcha, "locationFallbackUsed": location_fallback,
                        "amazonZip": self.settings.amazon_zip, "usProfileApplied": True,
                        "matrixSwept": False, "cacheHit": False,
                        "fetchTrace": {"http": http_trace, "playwright": playwright_trace},
                    }
                except CaptchaTimeout as caught:
                    browser_error = caught
                    read_browser_trace = getattr(self.browser_pool, "last_diagnostics", None)
                    if callable(read_browser_trace):
                        trace["profiles"] = read_browser_trace()
                    trace.update({"outcome": "captcha", "error": _exception_message(caught)})
                    playwright_trace.append(trace)
                    break
                except Exception as caught:
                    browser_error = caught
                    read_browser_trace = getattr(self.browser_pool, "last_diagnostics", None)
                    if callable(read_browser_trace):
                        trace["profiles"] = read_browser_trace()
                    trace.update({"outcome": "error", "error": _exception_message(caught)})
                    playwright_trace.append(trace)
            diagnostics = {
                "fetchMode": "failed",
                "attempts": len(http_trace) + len(playwright_trace),
                "captchaEncountered": captcha,
                "locationFallbackUsed": location_fallback,
                "amazonZip": self.settings.amazon_zip,
                "usProfileApplied": False,
                "matrixSwept": False,
                "cacheHit": False,
                "fetchTrace": {"http": http_trace, "playwright": playwright_trace},
            }
            raise CrawlFetchError(
                f"HTTP and Playwright fallback failed: {_exception_message(http_error)}; "
                f"Playwright {_exception_message(browser_error)}",
                diagnostics,
            ) from browser_error

    @staticmethod
    def _has_customization_entry(child: dict[str, Any]) -> bool:
        return bool(child.get("customizationFormUrl"))

    def _recover_customization_entry(
        self,
        *,
        asin: str,
        source: str,
        options: dict[str, str],
    ) -> tuple[dict[str, Any] | None, list[str]]:
        url = f"https://www.amazon.com/dp/{asin}"
        errors: list[str] = []
        self._report_progress(
            phase="customization",
            message=f"Customize của {asin} bị thiếu payload; đang thử lại bằng proxy khác...",
            source=source,
            item_updates={"status": "running", "currentAsin": asin, "currentOptions": options},
        )
        try:
            with self._http_slots:
                html, _ = self.fetcher.fetch(url)
            refreshed = parse_product_html(html, asin, url)
            if refreshed.get("asin") != asin:
                raise ValueError(f"Amazon returned {refreshed.get('asin') or 'an unknown ASIN'}.")
            if self._has_customization_entry(refreshed):
                return refreshed, []
            errors.append("HTTP retry still omitted gc:productInfo or customizationFormLink")
        except Exception as error:
            errors.append(f"HTTP retry: {_exception_message(error)}")

        self._report_progress(
            phase="customization",
            message=f"Proxy retry chưa có Customize cho {asin}; đang render bằng Playwright...",
            source=source,
            item_updates={"status": "running", "currentAsin": asin, "currentOptions": options},
        )
        try:
            fetch_customization_entry = getattr(self.browser_pool, "fetch_customization_entry", None)
            if callable(fetch_customization_entry):
                html = fetch_customization_entry(url, cancel_event=self.cancel_event)
            else:
                html = self.browser_pool.fetch(url, cancel_event=self.cancel_event)
            refreshed = parse_product_html(html, asin, url)
            if refreshed.get("asin") != asin:
                raise ValueError(f"Amazon returned {refreshed.get('asin') or 'an unknown ASIN'}.")
            if self._has_customization_entry(refreshed):
                return refreshed, []
            errors.append("Playwright response still omitted gc:productInfo or customizationFormLink")
        except (InterruptedError, CaptchaTimeout):
            raise
        except Exception as error:
            errors.append(f"Playwright retry: {_exception_message(error)}")
        return None, errors

    def _fetch_customization_form(
        self,
        *,
        form_url: str,
        customization_raw: Any,
    ) -> tuple[Any, list[str], bool]:
        warnings: list[str] = []
        try:
            with self._http_slots:
                form_html, _ = self.fetcher.fetch(form_url)
            widget, widget_warnings, _ = _extract_customization(form_html)
            if widget is None:
                raise ValueError("Customize form did not contain #gc-widget data.")
            warnings.extend(widget_warnings)
            return {"state": customization_raw, "widget": widget}, warnings, True
        except Exception as http_error:
            try:
                fetch_customization_form = getattr(self.browser_pool, "fetch_customization_form", None)
                if callable(fetch_customization_form):
                    form_html = fetch_customization_form(form_url, cancel_event=self.cancel_event)
                else:
                    form_html = self.browser_pool.fetch(form_url, cancel_event=self.cancel_event)
                widget, widget_warnings, _ = _extract_customization(form_html)
                if widget is None:
                    raise ValueError("Customize form did not contain widget data after Playwright rendering.")
                warnings.extend(widget_warnings)
                return {"state": customization_raw, "widget": widget}, warnings, True
            except Exception as browser_error:
                warnings.append(
                    f"Customization form fetch failed: {_exception_message(http_error)}; "
                    f"Playwright {_exception_message(browser_error)}"
                )
                return customization_raw, warnings, False

    def _retry_family_customization(
        self,
        *,
        variants: list[dict[str, Any]],
        source: str,
        force: bool = False,
    ) -> None:
        if not force and not any(variant.get("customizationRaw") is not None for variant in variants):
            return
        candidates = [
            variant
            for variant in variants
            if variant.get("customization") is None or variant.get("customizationComplete") is not True
        ]
        for variant in candidates:
            asin = str(variant["asin"])
            options = dict(variant.get("options") or {})
            recovered, recovery_errors = self._recover_customization_entry(
                asin=asin,
                source=source,
                options=options,
            )
            if recovered is None:
                variant["customizationComplete"] = False
                variant["warnings"] = [
                    "Family contains Amazon Customize, but this child ASIN omitted its form payload after retries: "
                    + "; ".join(recovery_errors)
                ]
                continue
            customization_raw = recovered.get("customizationRaw")
            warnings = list(recovered.get("customizationWarnings", []))
            form_url = recovered.get("customizationFormUrl")
            customization_complete = not warnings
            if form_url:
                customization_raw, form_warnings, form_complete = self._fetch_customization_form(
                    form_url=str(form_url),
                    customization_raw=customization_raw,
                )
                warnings.extend(form_warnings)
                customization_complete = customization_complete and form_complete
            customization, normalization_warnings = (
                normalize_customization(customization_raw)
                if customization_raw is not None
                else (None, [])
            )
            warnings.extend(normalization_warnings)
            variant["customizationRaw"] = customization_raw
            variant["customization"] = customization
            variant["customizationFingerprint"] = customization.get("fingerprint") if customization else None
            variant["customizationComplete"] = customization_complete and customization is not None
            variant["warnings"] = warnings

    def _crawl_family(
        self,
        normalized: NormalizedInput,
        on_product_complete: ProductCompletionCallback | None = None,
    ) -> dict[str, Any]:
        cache_key = f"{normalized.asin}:{self.settings.amazon_zip}:us-v1"
        cached = self.cache.load(cache_key, require_customization=True)
        if cached is not None:
            family = deepcopy(cached)
            family["diagnostics"]["cacheHit"] = True
            family["diagnostics"]["fetchMode"] = "cache"
            cached_variants = len(family.get("sourceVariants", []))
            self._report_progress(
                phase="product",
                message=f"Đã tải family {normalized.asin} từ cache ({cached_variants} variants).",
                source=normalized.source,
                item_updates={
                    "status": "running",
                    "variantCompleted": cached_variants,
                    "variantTotal": cached_variants,
                },
            )
            return family
        self._report_progress(
            phase="product",
            message=f"Đang tải trang Amazon {normalized.asin}...",
            source=normalized.source,
            item_updates={"status": "running", "currentAsin": normalized.asin},
        )
        parent, diagnostics = self._fetch_parsed(normalized)
        parent_asin = parent["parentAsin"]
        asin_options: dict[str, dict[str, str]] = dict(parent["asinOptions"])
        # parentAsin identifies the variation family and is often not a
        # purchasable child. Adding it as a source variant makes Amazon redirect
        # to the default child and contaminates that variant with another ASIN's
        # price/media/customization. Only the ASIN actually rendered on the page
        # is guaranteed to be a source variant.
        asin_options.setdefault(parent["asin"], {})
        expected_count = 1
        for values in parent["dimensions"].values():
            expected_count *= max(1, len(values))
        expected_count = max(expected_count, len(asin_options))
        sweep = getattr(self.browser_pool, "sweep_variant_matrix", None)
        if len(asin_options) < expected_count and callable(sweep):
            self._report_progress(
                phase="variant_matrix",
                message=f"Đang quét variant matrix {len(asin_options)}/{expected_count} cho {parent_asin}...",
                source=normalized.source,
                item_updates={
                    "status": "running",
                    "variantCompleted": len(asin_options),
                    "variantTotal": expected_count,
                    "currentAsin": parent_asin,
                },
            )
            diagnostics["matrixSwept"] = True
            try:
                for swept_html in sweep(normalized.canonical_url, cap=self.settings.max_matrix_variants, cancel_event=self.cancel_event):
                    swept = parse_product_html(swept_html, parent_asin, normalized.canonical_url)
                    for label, values in swept["dimensions"].items():
                        bucket = parent["dimensions"].setdefault(label, [])
                        for value in values:
                            if value.casefold() not in {existing.casefold() for existing in bucket}:
                                bucket.append(value)
                    for asin, options in swept["asinOptions"].items():
                        asin_options.setdefault(asin, options)
                    if len(asin_options) >= self.settings.max_matrix_variants:
                        break
            except (InterruptedError, CaptchaTimeout):
                raise
            except Exception as error:
                parent.setdefault("customizationWarnings", []).append(f"Variant matrix browser sweep failed: {error}")
            expected_count = 1
            for values in parent["dimensions"].values():
                expected_count *= max(1, len(values))
            expected_count = max(expected_count, len(asin_options))
        discovered_asins = list(asin_options)
        is_capped = len(discovered_asins) > self.settings.max_matrix_variants
        discovered_asins = discovered_asins[:self.settings.max_matrix_variants]
        variants: list[dict[str, Any]] = []
        variant_total = len(discovered_asins)
        preliminary_variants = [
            {"asin": asin, "options": deepcopy(asin_options.get(asin, {}))}
            for asin in discovered_asins
        ]
        preliminary_dimensions = self._source_variant_dimensions(preliminary_variants)
        split_attribute = self._choose_split_attribute(preliminary_dimensions)
        expected_groups: dict[str | None, set[str]] = {}
        for asin in discovered_asins:
            split_value = asin_options.get(asin, {}).get(split_attribute) if split_attribute else None
            expected_groups.setdefault(split_value, set()).add(asin)
        emitted_groups: set[str | None] = set()
        family_customizable_hint = bool(
            parent.get("customizationRaw") is not None
            or parent.get("customizationFormUrl")
            or parent.get("customizationWarnings")
        )
        active_variants: dict[str, dict[str, str]] = {}
        active_variants_lock = threading.Lock()

        def active_variant_snapshot() -> list[dict[str, Any]]:
            return [
                {"asin": active_asin, "options": deepcopy(active_options)}
                for active_asin, active_options in active_variants.items()
            ]

        def crawl_child(asin: str) -> dict[str, Any]:
            self._check_cancelled()
            options = deepcopy(asin_options.get(asin, {}))
            with active_variants_lock:
                active_variants[asin] = options
                active_snapshot = active_variant_snapshot()
            option_text = " · ".join(f"{name}: {value}" for name, value in options.items()) or "Default"
            self._report_progress(
                phase="product",
                message=f"Đang cào variant {asin} — {option_text}",
                source=normalized.source,
                item_updates={
                    "status": "running",
                    "variantTotal": variant_total,
                    "currentAsin": asin,
                    "currentOptions": options,
                    "activeVariants": active_snapshot,
                },
            )
            if asin == parent["asin"]:
                child = deepcopy(parent)
                child_diagnostics = diagnostics
            else:
                child, child_diagnostics = self._fetch_parsed(normalize_amazon_input(asin))
            warnings = list(child.get("customizationWarnings", []))
            if len(child.get("media") or []) <= 1 and hasattr(self.browser_pool, "fetch_gallery"):
                try:
                    gallery_html = self.browser_pool.fetch_gallery(
                        f"https://www.amazon.com/dp/{asin}",
                        cancel_event=self.cancel_event,
                    )
                    gallery_product = parse_product_html(
                        gallery_html,
                        asin,
                        f"https://www.amazon.com/dp/{asin}",
                    )
                    gallery_media = gallery_product.get("media") or []
                    if gallery_product.get("asin") != asin:
                        warnings.append(
                            f"Gallery render requested {asin}, but Amazon returned {gallery_product.get('asin')}."
                        )
                    elif len(gallery_media) > len(child.get("media") or []):
                        child["media"] = gallery_media
                except (InterruptedError, CaptchaTimeout):
                    raise
                except Exception as error:
                    warnings.append(f"Full gallery browser fallback failed for {asin}: {error}")
            customization_raw = child.get("customizationRaw")
            form_url = child.get("customizationFormUrl")
            if warnings and not self._has_customization_entry(child):
                recovered_child, recovery_errors = self._recover_customization_entry(
                    asin=asin,
                    source=normalized.source,
                    options=options,
                )
                if recovered_child is not None:
                    customization_raw = recovered_child.get("customizationRaw")
                    form_url = recovered_child.get("customizationFormUrl")
                    warnings = list(recovered_child.get("customizationWarnings", []))
                else:
                    warnings = [
                        "Amazon indicated customization but omitted its form payload after HTTP and Playwright retries: "
                        + "; ".join(recovery_errors)
                    ]
            customization_complete = not warnings
            if form_url:
                with active_variants_lock:
                    current_active_snapshot = active_variant_snapshot()
                self._report_progress(
                    phase="customization",
                    message=f"Đang tải Amazon Customize cho {asin} — {option_text}",
                    source=normalized.source,
                    item_updates={
                        "status": "running",
                        "variantTotal": variant_total,
                        "currentAsin": asin,
                        "currentOptions": options,
                        "activeVariants": current_active_snapshot,
                    },
                )
                customization_raw, form_warnings, form_complete = self._fetch_customization_form(
                    form_url=str(form_url),
                    customization_raw=customization_raw,
                )
                warnings.extend(form_warnings)
                customization_complete = customization_complete and form_complete
            if child["asin"] != asin:
                warnings.append(f"Requested child ASIN {asin}, but Amazon returned {child['asin']}.")
            normalized_customization, custom_warnings = normalize_customization(customization_raw) if customization_raw is not None else (None, [])
            warnings.extend(custom_warnings)
            return {
                "asin": asin, "url": f"https://www.amazon.com/dp/{asin}", "options": options,
                "price": child.get("price"),
                "media": child.get("media", []),
                "description": child.get("description"), "bulletPoints": child.get("bulletPoints", []),
                "categories": child.get("categories", []), "productDetails": child.get("productDetails", {}),
                "customizationRaw": customization_raw, "customization": normalized_customization,
                "customizationFingerprint": normalized_customization.get("fingerprint") if normalized_customization else None,
                "customizationComplete": customization_complete,
                "priceInference": {"isInferred": False, "sourceAsins": []}, "warnings": warnings,
                "diagnostics": child_diagnostics,
            }

        self._report_progress(
            phase="product",
            message=f"Đã tìm thấy {variant_total} variants; bắt đầu cào chi tiết.",
            source=normalized.source,
            item_updates={"status": "running", "variantCompleted": 0, "variantTotal": variant_total},
        )
        variant_completed = 0

        def emit_completed_group(completed_asin: str) -> None:
            if on_product_complete is None:
                return
            completed_options = asin_options.get(completed_asin, {})
            split_value = completed_options.get(split_attribute) if split_attribute else None
            if split_value in emitted_groups:
                return
            expected_asins = expected_groups.get(split_value, set())
            group_variants = [
                variant
                for variant in variants
                if str(variant.get("asin")) in expected_asins
            ]
            completed_asins = {str(variant.get("asin")) for variant in group_variants}
            if not expected_asins or completed_asins != expected_asins:
                return

            self._retry_family_customization(
                variants=group_variants,
                source=normalized.source,
                force=family_customizable_hint,
            )
            self._infer_consensus_prices(group_variants)
            group_family = {
                "parentAsin": parent_asin,
                "canonicalUrl": f"https://www.amazon.com/dp/{parent_asin}",
                "sourceTitle": parent["title"],
                "description": parent.get("description"),
                "bulletPoints": parent.get("bulletPoints", []),
                "categories": parent.get("categories", []),
                "productDetails": parent.get("productDetails", {}),
                "media": parent.get("media", []),
                "sourceVariants": group_variants,
                "variantMatrix": {
                    "dimensions": parent["dimensions"],
                    "expectedCount": expected_count,
                    "discoveredCount": len(asin_options),
                    "complete": not is_capped and len(asin_options) >= expected_count,
                    "safetyCap": self.settings.max_matrix_variants,
                },
                "customizationChecked": all(
                    variant.get("customizationComplete") is True
                    for variant in group_variants
                ),
                "diagnostics": diagnostics,
            }
            for product in self._products_from_family(
                group_family,
                split_attribute_override=split_attribute,
            ):
                if self._product_publish_blockers(product):
                    continue
                on_product_complete(product)
                emitted_groups.add(split_value)

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.settings.variant_threads) as executor:
            futures = {executor.submit(crawl_child, asin): asin for asin in discovered_asins}
            for future in concurrent.futures.as_completed(futures):
                asin = futures[future]
                options = deepcopy(asin_options.get(asin, {}))
                try:
                    variants.append(future.result())
                except Exception as error:
                    failed_diagnostics = deepcopy(getattr(error, "diagnostics", {
                        "fetchMode": "failed", "attempts": 0, "captchaEncountered": False,
                        "locationFallbackUsed": False, "amazonZip": self.settings.amazon_zip,
                        "usProfileApplied": False, "matrixSwept": False, "cacheHit": False,
                        "fetchTrace": {"http": [], "playwright": []},
                    }))
                    variants.append({
                        "asin": asin, "url": f"https://www.amazon.com/dp/{asin}", "options": deepcopy(asin_options.get(asin, {})),
                        "price": None, "media": [],
                        "description": None, "bulletPoints": [], "categories": [], "productDetails": {},
                        "customizationRaw": None, "customization": None, "customizationFingerprint": None,
                        "priceInference": {"isInferred": False, "sourceAsins": []}, "warnings": [str(error)],
                        "diagnostics": failed_diagnostics,
                    })
                emit_completed_group(asin)
                variant_completed += 1
                with active_variants_lock:
                    active_variants.pop(asin, None)
                    active_snapshot = active_variant_snapshot()
                option_text = " · ".join(f"{name}: {value}" for name, value in options.items()) or "Default"
                self._report_progress(
                    phase="product",
                    message=f"Đã cào variant {variant_completed}/{variant_total}: {option_text} ({asin})",
                    source=normalized.source,
                    item_updates={
                        "status": "running",
                        "variantCompleted": variant_completed,
                        "variantTotal": variant_total,
                        "currentAsin": asin,
                        "currentOptions": options,
                        "activeVariants": active_snapshot,
                    },
                )
        order = {asin: index for index, asin in enumerate(discovered_asins)}
        variants.sort(key=lambda item: order.get(item["asin"], len(order)))
        self._retry_family_customization(variants=variants, source=normalized.source)
        self._infer_consensus_prices(variants)
        family = {
            "parentAsin": parent_asin, "canonicalUrl": f"https://www.amazon.com/dp/{parent_asin}",
            "sourceTitle": parent["title"], "description": parent.get("description"), "bulletPoints": parent.get("bulletPoints", []),
            "categories": parent.get("categories", []), "productDetails": parent.get("productDetails", {}), "media": parent.get("media", []),
            "sourceVariants": variants,
            "variantMatrix": {"dimensions": parent["dimensions"], "expectedCount": expected_count, "discoveredCount": len(asin_options), "complete": not is_capped and len(asin_options) >= expected_count, "safetyCap": self.settings.max_matrix_variants},
            "customizationChecked": all(variant.get("customizationComplete") is True for variant in variants), "diagnostics": diagnostics,
        }
        if is_capped:
            family["variantMatrix"]["complete"] = False
        if family["variantMatrix"]["complete"] and family["customizationChecked"]:
            self.cache.save(cache_key, family)
        self._report_progress(
            phase="product",
            message=f"Đã lấy đủ dữ liệu {variant_completed}/{variant_total} variants; đang tách sản phẩm.",
            source=normalized.source,
            item_updates={
                "status": "running",
                "variantCompleted": variant_completed,
                "variantTotal": variant_total,
                "activeVariants": [],
            },
        )
        return family

    @staticmethod
    def _infer_consensus_prices(variants: list[dict[str, Any]]) -> None:
        for variant in variants:
            if variant.get("price") is not None:
                continue
            peers = [candidate for candidate in variants if candidate.get("price") is not None and candidate.get("options") == variant.get("options")]
            prices = {candidate["price"]["amount"] for candidate in peers}
            if len(prices) == 1:
                source_asins = [candidate["asin"] for candidate in peers]
                variant["price"] = deepcopy(peers[0]["price"])
                variant["priceInference"] = {"isInferred": True, "sourceAsins": source_asins, "reason": "Matching option values have one consensus price."}

    @staticmethod
    def _choose_split_attribute(dimensions: dict[str, list[str]]) -> str | None:
        candidates = [(name, values) for name, values in dimensions.items() if len(values) > 1]
        for priority in SPLIT_PRIORITIES:
            for name, _ in candidates:
                if name.casefold() == priority or re.search(rf"\b{priority}\b", name, re.I):
                    return name
        return candidates[0][0] if candidates else None

    @staticmethod
    def _source_variant_dimensions(source_variants: list[dict[str, Any]]) -> dict[str, list[str]]:
        dimensions: dict[str, list[str]] = {}
        for variant in source_variants:
            for name, value in variant.get("options", {}).items():
                clean_value = _clean_text(str(value))
                if not clean_value:
                    continue
                values = dimensions.setdefault(name, [])
                if clean_value.casefold() not in {existing.casefold() for existing in values}:
                    values.append(clean_value)
        return dimensions

    @staticmethod
    def _product_publish_blockers(product: dict[str, Any]) -> list[str]:
        blockers: list[str] = []
        matrix = product.get("variantMatrix") if isinstance(product.get("variantMatrix"), dict) else {}
        if matrix.get("complete") is not True:
            blockers.append("variant_matrix_incomplete")
        source_variants = product.get("sourceVariants") if isinstance(product.get("sourceVariants"), list) else []
        if not source_variants or any(variant.get("price") is None for variant in source_variants if isinstance(variant, dict)):
            blockers.append("price_missing")
        if any(
            isinstance(variant, dict)
            and any("customiz" in str(warning).casefold() for warning in variant.get("warnings", []))
            for variant in source_variants
        ):
            blockers.append("customization_incomplete")
        return blockers

    def _products_from_family(
        self,
        family: dict[str, Any],
        *,
        split_attribute_override: str | None = None,
    ) -> list[dict[str, Any]]:
        rebuilt_source_variants = deepcopy(family["sourceVariants"])
        for variant in rebuilt_source_variants:
            customization_raw = variant.get("customizationRaw")
            if customization_raw is None:
                continue
            customization, customization_warnings = normalize_customization(customization_raw)
            variant["customization"] = customization
            variant["customizationFingerprint"] = customization.get("fingerprint") if customization else None
            variant["warnings"] = sorted(set(variant.get("warnings", []) + customization_warnings))
        actual_dimensions = self._source_variant_dimensions(rebuilt_source_variants)
        split_attribute = split_attribute_override or self._choose_split_attribute(actual_dimensions)
        grouped: dict[str | None, list[dict[str, Any]]] = {}
        if split_attribute is None:
            grouped[None] = rebuilt_source_variants
        else:
            for variant in rebuilt_source_variants:
                value = variant.get("options", {}).get(split_attribute)
                grouped.setdefault(value, []).append(variant)
        products: list[dict[str, Any]] = []
        for split_value, source_variants in grouped.items():
            if not source_variants:
                continue
            title = family["sourceTitle"]
            if split_value and not title.casefold().endswith(str(split_value).casefold()):
                title = f"{title} - {split_value}"
            source_asins = [variant["asin"] for variant in source_variants]
            group_key = _stable_token(family["parentAsin"], split_attribute or "none", str(split_value or "none"))
            fingerprints = sorted({variant["customizationFingerprint"] for variant in source_variants if variant.get("customizationFingerprint")})
            representative = next((variant for variant in source_variants if variant.get("customization") is not None), source_variants[0])
            customization = deepcopy(representative.get("customization"))
            description = next((variant.get("description") for variant in source_variants if variant.get("description")), family.get("description"))
            bullet_points = next((variant.get("bulletPoints") for variant in source_variants if variant.get("bulletPoints")), family.get("bulletPoints", []))
            categories = next((variant.get("categories") for variant in source_variants if variant.get("categories")), family.get("categories", []))
            product_details = next((variant.get("productDetails") for variant in source_variants if variant.get("productDetails")), family.get("productDetails", {}))
            warnings = [warning for variant in source_variants for warning in variant.get("warnings", [])]
            if len(fingerprints) > 1:
                warnings.append(f"Source variants have different customization configurations; representative {representative['asin']} was used. Fingerprints: {', '.join(fingerprints)}")
            base_variants: list[dict[str, Any]] = []
            for variant in source_variants:
                options = {key: value for key, value in variant.get("options", {}).items() if key != split_attribute}
                base_variants.append({
                    "id": f"{variant['asin']}-{_stable_token(json.dumps(options, sort_keys=True), length=10)}",
                    "sku": variant["asin"], "sourceAsin": variant["asin"], "options": options,
                    "price": deepcopy(variant.get("price")),
                    "surcharge": None,
                    "metadata": {"priceInference": deepcopy(variant.get("priceInference"))},
                })
            if self.settings.profile_slug == "jeminise" and self.settings.apply_jeminise_preset:
                final_variants = build_jeminise_variants(group_key)
                customization = remove_option_choosers(customization)
                preset = PRESET_ID
            else:
                final_variants = expand_paid_variants(base_variants, customization)
                preset = None
            media_by_identity: dict[str, dict[str, Any]] = {}
            ordered_media_variants = [representative, *(variant for variant in source_variants if variant is not representative)]
            for variant in ordered_media_variants:
                for media in variant.get("media", []):
                    identity = str(media.get("amazonImageId") or media.get("url") or "")
                    if identity:
                        media_by_identity.setdefault(identity, deepcopy(media))
            for media in family.get("media", []):
                media_source_asin = media.get("sourceAsin")
                if media_source_asin in source_asins:
                    identity = str(media.get("amazonImageId") or media.get("url") or "")
                    if identity:
                        media_by_identity.setdefault(identity, deepcopy(media))
            if not media_by_identity:
                for media in family.get("media", []):
                    identity = str(media.get("amazonImageId") or media.get("url") or "")
                    if identity:
                        media_by_identity.setdefault(identity, deepcopy(media))
            product_media = list(media_by_identity.values())
            for media_index, media in enumerate(product_media):
                media["isMain"] = media_index == 0
            remaining_dimensions = self._source_variant_dimensions(source_variants)
            if split_attribute:
                remaining_dimensions.pop(split_attribute, None)
            matrix = deepcopy(family["variantMatrix"])
            matrix["dimensions"] = remaining_dimensions
            remaining_expected = 1
            for values in matrix["dimensions"].values():
                remaining_expected *= max(1, len(values))
            matrix["expectedCount"] = remaining_expected
            matrix["discoveredCount"] = len(source_variants)
            was_capped = (
                family["variantMatrix"].get("complete") is False
                and family["variantMatrix"].get("discoveredCount", 0) >= family["variantMatrix"].get("safetyCap", 500)
            )
            matrix["complete"] = bool(not was_capped and len(source_variants) >= remaining_expected)
            if not matrix["complete"]:
                warnings.append(f"Variant matrix is incomplete (discovered {matrix['discoveredCount']} of {matrix['expectedCount']}, cap {matrix['safetyCap']}).")
            products.append({
                "id": group_key, "parentAsin": family["parentAsin"], "canonicalUrl": family["canonicalUrl"],
                "sourceTitle": family["sourceTitle"], "title": title, "description": description,
                "bulletPoints": deepcopy(bullet_points), "categories": deepcopy(categories),
                "productDetails": deepcopy(product_details), "media": product_media,
                "sourceVariants": [{
                    key: deepcopy(variant.get(key))
                    for key in (
                        "asin", "url", "options", "price",
                        "media", "customizationFingerprint", "priceInference", "warnings", "diagnostics",
                    )
                    if key != "diagnostics" or variant.get("diagnostics") is not None
                } for variant in source_variants],
                "variants": final_variants, "variantMatrix": matrix, "customization": customization,
                "splitContext": {"attribute": split_attribute, "value": split_value, "groupKey": group_key, "sourceAsins": source_asins},
                "sourceKey": (
                    f"amazon:{family['parentAsin']}:"
                    f"{str(split_attribute or 'none').strip().casefold()}:"
                    f"{str(split_value or 'none').strip().casefold()}"
                ),
                "preset": preset, "warnings": sorted(set(warnings)), "diagnostics": deepcopy(family["diagnostics"]),
            })
        return products

    def run(
        self,
        *,
        job_id: str,
        sources: list[str],
        on_input_complete: InputCompletionCallback | None = None,
        on_product_complete: ProductCompletionCallback | None = None,
        write_export: bool = True,
    ) -> dict[str, Any]:
        started_at = _now_iso()
        started_time = time.monotonic()
        errors: list[dict[str, Any]] = []
        normalized_inputs: list[NormalizedInput] = []
        seen_asins: set[str] = set()
        if len(sources) > 200:
            raise ValueError("A batch may contain at most 200 inputs.")
        for source in sources:
            try:
                normalized = normalize_amazon_input(source)
                if normalized.asin not in seen_asins:
                    seen_asins.add(normalized.asin)
                    normalized_inputs.append(normalized)
            except ValueError as error:
                errors.append({"source": source, "code": "INVALID_INPUT", "message": str(error), "retryable": False})
        rejected_inputs = len(errors)
        products: list[dict[str, Any]] = []
        completed = 0
        self._initialize_progress(normalized_inputs)

        def crawl_one(normalized: NormalizedInput) -> tuple[NormalizedInput, list[dict[str, Any]]]:
            self._check_cancelled()
            emitted_product_ids: set[str] = set()

            def product_completed(product: dict[str, Any]) -> None:
                if on_product_complete is None:
                    return
                emitted_product_ids.add(str(product.get("id") or ""))
                on_product_complete({
                    "source": normalized.source,
                    "asin": normalized.asin,
                    "product": deepcopy(product),
                    "completedAt": _now_iso(),
                })

            if on_product_complete is None:
                family = self._crawl_family(normalized)
            else:
                family = self._crawl_family(normalized, on_product_complete=product_completed)
            family_products = self._products_from_family(family)
            if on_product_complete is not None:
                for product in family_products:
                    product_id = str(product.get("id") or "")
                    if product_id in emitted_product_ids or self._product_publish_blockers(product):
                        continue
                    product_completed(product)
            return normalized, family_products

        product_worker_count = effective_product_threads(len(normalized_inputs), self.settings)
        self._report_progress(
            phase="product",
            completed=0,
            total=len(normalized_inputs),
            message=(
                f"Đang cào 0/{len(normalized_inputs)} Amazon products với "
                f"{product_worker_count} product workers..."
            ),
        )
        with concurrent.futures.ThreadPoolExecutor(max_workers=product_worker_count) as executor:
            futures = {executor.submit(crawl_one, normalized): (normalized, time.monotonic()) for normalized in normalized_inputs}
            for future in concurrent.futures.as_completed(futures):
                normalized, input_started_time = futures[future]
                item_status = "completed"
                item_message = "Đã hoàn tất sản phẩm."
                family_products: list[dict[str, Any]] = []
                input_errors: list[dict[str, Any]] = []
                try:
                    _, family_products = future.result()
                    products.extend(family_products)
                except InterruptedError:
                    self.cancel_event.set()
                    item_status = "cancelled"
                    item_message = "Đã dừng xử lý sản phẩm."
                except Exception as error:
                    input_error = {"source": normalized.source, "code": "CRAWL_FAILED", "message": str(error), "retryable": True}
                    errors.append(input_error)
                    input_errors.append(input_error)
                    item_status = "failed"
                    item_message = f"Cào thất bại: {error}"
                completed += 1
                self._report_progress(
                    phase="product",
                    completed=completed,
                    total=len(normalized_inputs),
                    message=f"Đã xử lý {completed}/{len(normalized_inputs)} products.",
                    source=normalized.source,
                    item_updates={"status": item_status, "message": item_message, "activeVariants": []},
                )
                if on_input_complete is not None:
                    on_input_complete({
                        "source": normalized.source,
                        "asin": normalized.asin,
                        "status": item_status,
                        "products": deepcopy(family_products),
                        "errors": deepcopy(input_errors),
                        "warnings": sorted({
                            warning
                            for product in family_products
                            for warning in product.get("warnings", [])
                        }),
                        "completedAt": _now_iso(),
                        "durationMs": round((time.monotonic() - input_started_time) * 1000),
                    })
        products_by_id = {product["id"]: product for product in products}
        products = list(products_by_id.values())
        status = "cancelled" if self.cancel_event.is_set() else ("partial" if errors else "completed")
        completed_at = _now_iso()
        output: dict[str, Any] = {
            "version": SCHEMA_VERSION, "jobId": job_id, "status": status,
            "startedAt": started_at, "completedAt": completed_at, "settings": self.settings.api_dict(),
            "products": products, "errors": errors,
            "warnings": sorted(set(self.proxy_warnings) | {warning for product in products for warning in product.get("warnings", [])}),
            "statistics": {
                "requestedInputs": len(sources), "acceptedInputs": len(normalized_inputs),
                "rejectedInputs": rejected_inputs, "products": len(products),
                "sourceVariants": sum(len(product["sourceVariants"]) for product in products),
                "finalVariants": sum(len(product["variants"]) for product in products),
                "durationMs": round((time.monotonic() - started_time) * 1000),
            },
            "exportFilename": None,
        }
        if status != "cancelled" and write_export:
            output["exportFilename"] = self._write_export(output)
        return output

    def _write_export(self, output: dict[str, Any]) -> str:
        self._report_progress(phase="export", message="Đang ghi JSON export...")
        export_directory = self.root / "exports"
        export_directory.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filename = f"amazon-crawl-{timestamp}-{output['jobId']}.json"
        target = export_directory / filename
        payload = deepcopy(output)
        payload["exportFilename"] = filename
        fd, temporary_name = tempfile.mkstemp(prefix=".amazon-export-", suffix=".tmp", dir=export_directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, target)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)
        self.progress({"phase": "export", "completed": 1, "total": 1, "message": "Đã ghi JSON export."})
        return filename
