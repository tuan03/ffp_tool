"""Amazon-only crawl, family expansion, split, Customize conversion, and export pipeline."""

from __future__ import annotations

import concurrent.futures
import hashlib
import html as html_module
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
from typing import Any, Callable, Iterable

from bs4 import BeautifulSoup

from .cache import RawFamilyCache
from .customization_converter import expand_paid_variants, normalize_customization, remove_option_choosers
from .playwright_pool import CaptchaTimeout, PlaywrightPool, html_is_captcha
from .variant_presets import PRESET_ID, build_jeminise_variants

ASIN_RE = re.compile(r"(?<![A-Z0-9])([A-Z0-9]{10})(?![A-Z0-9])", re.I)
AMAZON_HOST_RE = re.compile(r"(^|\.)amazon\.[a-z.]+$", re.I)
ETSY_HOST_RE = re.compile(r"(^|\.)etsy\.com$", re.I)
MONEY_RE = re.compile(r"(?:US\s*)?\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)")
SCHEMA_VERSION = "1.0"
SPLIT_PRIORITIES = ("design", "color", "colour", "style", "pattern", "theme")


@dataclass(frozen=True)
class CrawlSettings:
    profile_slug: str = "default"
    apply_jeminise_preset: bool = False
    product_threads: int = 3
    variant_threads: int = 4
    urllib_threads: int = 8
    browser_profiles: int = 1
    browser_tabs: int = 3
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
            apply_jeminise_preset=bool(payload.get("applyJeminisePreset", False)),
            product_threads=bounded("productThreads", 3, 1, 16),
            variant_threads=bounded("variantThreads", 4, 1, 32),
            urllib_threads=bounded("urllibThreads", 8, 1, 64),
            browser_profiles=bounded("browserProfiles", 1, 1, 8),
            browser_tabs=bounded("browserTabs", 3, 1, 12),
            headless=bool(payload.get("headless", False)),
            amazon_zip=zip_code,
            captcha_timeout_seconds=bounded("captchaTimeoutSeconds", 180, 30, 900),
            max_matrix_variants=bounded("maxMatrixVariants", 500, 1, 5000),
        )

    def api_dict(self) -> dict[str, Any]:
        values = asdict(self)
        return {
            "profileSlug": values["profile_slug"], "applyJeminisePreset": values["apply_jeminise_preset"],
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
    if not re.search(r"customi[sz]|OptionChooserComponent|gc-", html, re.I):
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
    for script in soup.find_all("script"):
        text = script.string or script.get_text() or ""
        if "OptionChooserComponent" not in text and "customization" not in text.casefold():
            continue
        stripped = text.strip()
        if stripped.startswith(("{", "[")):
            try:
                parsed = json.loads(stripped)
                return parsed, [], form_url
            except json.JSONDecodeError:
                pass
        for marker in ("customizationConfig", "customization", "OptionChooserComponent"):
            parsed = _balanced_json(text, marker)
            if parsed is not None:
                return parsed, [], form_url
    if customization_state:
        warning = [] if form_url else ["Amazon customization state does not include a form URL."]
        return {"state": customization_state}, warning, form_url
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
    for element in soup.select("[data-asin]"):
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
    bullets = [_clean_text(element.get_text(" ")) for element in soup.select("#feature-bullets li span")]
    bullets = [bullet for bullet in bullets if bullet]
    description_element = soup.select_one("#productDescription")
    description = _clean_text(description_element.get_text(" ")) if description_element else None
    brand_element = soup.select_one("#bylineInfo")
    brand = _clean_text(brand_element.get_text(" ")) if brand_element else None
    seller_element = soup.select_one("#sellerProfileTriggerId") or soup.select_one("#merchant-info")
    seller = _clean_text(seller_element.get_text(" ")) if seller_element else None
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
    rating_element = soup.select_one("#acrPopover") or soup.select_one("[data-hook='rating-out-of-text']")
    rating = _clean_text(str(rating_element.get("title") or rating_element.get_text(" "))) if rating_element else None
    review_element = soup.select_one("#acrCustomerReviewText")
    review_digits = re.sub(r"[^0-9]", "", review_element.get_text(" ") if review_element else "")
    review_count = int(review_digits) if review_digits else None
    availability_element = soup.select_one("#availability span")
    availability = _clean_text(availability_element.get_text(" ")) if availability_element else None
    price_element = soup.select_one("#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, .priceToPay .a-offscreen, #priceblock_ourprice")
    list_price_element = soup.select_one(".basisPrice .a-offscreen, .a-text-price .a-offscreen")
    images: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for element in soup.select("#landingImage, #altImages img, img[data-old-hires]"):
        image_url = str(element.get("data-old-hires") or element.get("data-a-dynamic-image") or element.get("src") or "")
        if image_url.startswith("{"):
            try:
                dynamic = json.loads(image_url)
                image_url = next(iter(dynamic), "")
            except json.JSONDecodeError:
                image_url = ""
        image_url = image_url.strip()
        if image_url.startswith("http") and image_url not in seen_urls:
            seen_urls.add(image_url)
            images.append({"url": image_url, "kind": "image", "sourceAsin": canonical_asin})
    for element in soup.select("video[src], video source[src]"):
        video_url = str(element.get("src") or "").strip()
        if video_url.startswith("http") and video_url not in seen_urls:
            seen_urls.add(video_url)
            images.append({"url": video_url, "kind": "video", "sourceAsin": canonical_asin})
    dimensions, asin_options = _extract_dimensions(html, canonical_asin)
    customization_raw, customization_warnings, customization_form_url = _extract_customization(html)
    return {
        "asin": canonical_asin, "parentAsin": _extract_parent_asin(html, canonical_asin),
        "url": f"https://www.amazon.com/dp/{canonical_asin}", "requestedUrl": url,
        "title": title, "description": description, "bulletPoints": bullets, "brand": brand, "seller": seller,
        "categories": categories, "productDetails": product_details, "rating": rating, "reviewCount": review_count,
        "availability": availability, "isAvailable": bool(availability is None or "unavailable" not in availability.casefold()),
        "price": _money(price_element.get_text(" ") if price_element else None),
        "listPrice": _money(list_price_element.get_text(" ") if list_price_element else None),
        "media": images, "dimensions": dimensions, "asinOptions": asin_options,
        "customizationRaw": customization_raw, "customizationWarnings": customization_warnings,
        "customizationFormUrl": customization_form_url,
    }


class HttpFetcher:
    def __init__(self, *, retries: int = 3, proxies: Iterable[str] = ()) -> None:
        self.retries = retries
        self.proxies = [proxy.strip() for proxy in proxies if proxy.strip()]
        self._counter = 0
        self._lock = threading.Lock()

    def _opener(self) -> urllib.request.OpenerDirector:
        if not self.proxies:
            return urllib.request.build_opener()
        with self._lock:
            proxy = self.proxies[self._counter % len(self.proxies)]
            self._counter += 1
        return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))

    def fetch(self, url: str) -> tuple[str, int]:
        error: Exception | None = None
        candidates = [url, f"{url}?th=1&psc=1", url.replace("/dp/", "/gp/product/")]
        for attempt in range(1, self.retries + 1):
            candidate = candidates[(attempt - 1) % len(candidates)]
            request = urllib.request.Request(candidate, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html,application/xhtml+xml",
                "Cookie": "lc-main=en_US; i18n-prefs=USD",
            })
            try:
                with self._opener().open(request, timeout=30) as response:
                    body = response.read().decode("utf-8", errors="replace")
                if html_is_captcha(body) or "deliver to" in body.casefold() and "choose your location" in body.casefold():
                    raise RuntimeError("Amazon returned CAPTCHA or a location interstitial.")
                if len(body) < 5_000:
                    raise RuntimeError("Amazon response is too small to contain product data.")
                return body, attempt
            except (urllib.error.URLError, TimeoutError, RuntimeError) as caught:
                error = caught
                if attempt < self.retries:
                    time.sleep(0.25 * attempt)
        raise RuntimeError(f"HTTP fetch failed: {error}")


ProgressCallback = Callable[[dict[str, Any]], None]


class AmazonCrawler:
    def __init__(self, *, root: Path, settings: CrawlSettings, progress: ProgressCallback | None = None, cancel_event: threading.Event | None = None, fetcher: HttpFetcher | None = None, browser_pool: PlaywrightPool | None = None) -> None:
        self.root = root
        self.settings = settings
        self.progress = progress or (lambda _: None)
        self.cancel_event = cancel_event or threading.Event()
        proxy_text = os.environ.get("AMAZON_CRAWLER_PROXIES", "")
        self.fetcher = fetcher or HttpFetcher(proxies=re.split(r"[\r\n,;]+", proxy_text))
        self._http_slots = threading.BoundedSemaphore(settings.urllib_threads)
        self.cache = RawFamilyCache(root / ".runtime" / "cache")
        self.browser_pool = browser_pool or PlaywrightPool(
            profile_root=root / ".runtime" / "browser-profiles", profiles=settings.browser_profiles,
            tabs_per_profile=settings.browser_tabs, headless=settings.headless,
            captcha_timeout=settings.captcha_timeout_seconds, zip_code=settings.amazon_zip, proxies=self.fetcher.proxies,
            on_captcha=self._captcha_progress,
        )

    def _captcha_progress(self, url: str) -> None:
        self.progress({"phase": "captcha", "completed": 0, "total": 1, "message": "Hãy giải CAPTCHA trong cửa sổ trình duyệt; job sẽ tự tiếp tục.", "source": url, "status": "waiting_captcha"})

    def _check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise InterruptedError("Crawler job was cancelled.")

    def _fetch_parsed(self, normalized: NormalizedInput) -> tuple[dict[str, Any], dict[str, Any]]:
        attempts = 0
        captcha = False
        location_fallback = False
        try:
            with self._http_slots:
                html, attempts = self.fetcher.fetch(normalized.canonical_url)
            parsed = parse_product_html(html, normalized.asin, normalized.canonical_url)
            return parsed, {"fetchMode": "http", "attempts": attempts, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False}
        except Exception as http_error:
            text = str(http_error).casefold()
            captcha = "captcha" in text
            location_fallback = "location" in text
            self._check_cancelled()
            try:
                html = self.browser_pool.fetch(normalized.canonical_url, cancel_event=self.cancel_event)
                parsed = parse_product_html(html, normalized.asin, normalized.canonical_url)
                return parsed, {"fetchMode": "playwright", "attempts": attempts + 1, "captchaEncountered": captcha, "locationFallbackUsed": location_fallback, "matrixSwept": False, "cacheHit": False}
            except CaptchaTimeout:
                raise
            except Exception as browser_error:
                raise RuntimeError(
                    f"HTTP and Playwright fallback failed: {_exception_message(http_error)}; "
                    f"Playwright {_exception_message(browser_error)}"
                ) from browser_error

    def _crawl_family(self, normalized: NormalizedInput) -> dict[str, Any]:
        cached = self.cache.load(normalized.asin, require_customization=True)
        if cached is not None:
            family = deepcopy(cached)
            family["diagnostics"]["cacheHit"] = True
            family["diagnostics"]["fetchMode"] = "cache"
            return family
        parent, diagnostics = self._fetch_parsed(normalized)
        parent_asin = parent["parentAsin"]
        asin_options: dict[str, dict[str, str]] = dict(parent["asinOptions"])
        asin_options.setdefault(parent_asin, {})
        expected_count = 1
        for values in parent["dimensions"].values():
            expected_count *= max(1, len(values))
        expected_count = max(expected_count, len(asin_options))
        sweep = getattr(self.browser_pool, "sweep_variant_matrix", None)
        if len(asin_options) < expected_count and callable(sweep):
            self.progress({"phase": "variant_matrix", "completed": len(asin_options), "total": expected_count, "message": f"Đang quét variant matrix cho {parent_asin}...", "source": normalized.source})
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

        def crawl_child(asin: str) -> dict[str, Any]:
            self._check_cancelled()
            options = deepcopy(asin_options.get(asin, {}))
            if asin == parent_asin:
                child = deepcopy(parent)
                child_diagnostics = diagnostics
            else:
                child, child_diagnostics = self._fetch_parsed(normalize_amazon_input(asin))
            warnings = list(child.get("customizationWarnings", []))
            customization_complete = not warnings
            customization_raw = child.get("customizationRaw")
            form_url = child.get("customizationFormUrl")
            if form_url:
                self.progress({"phase": "customization", "completed": 0, "total": 1, "message": f"Đang tải Amazon Customize cho {asin}...", "source": child["url"]})
                try:
                    with self._http_slots:
                        form_html, _ = self.fetcher.fetch(str(form_url))
                    widget, widget_warnings, _ = _extract_customization(form_html)
                    warnings.extend(widget_warnings)
                    if widget is None:
                        raise ValueError("Customize form did not contain #gc-widget data.")
                    customization_raw = {"state": customization_raw, "widget": widget}
                except Exception as http_error:
                    try:
                        form_html = self.browser_pool.fetch(str(form_url), cancel_event=self.cancel_event)
                        widget, widget_warnings, _ = _extract_customization(form_html)
                        warnings.extend(widget_warnings)
                        if widget is None:
                            raise ValueError("Customize form did not contain widget data after Playwright rendering.")
                        customization_raw = {"state": customization_raw, "widget": widget}
                    except Exception as browser_error:
                        warnings.append(
                            f"Customization form fetch failed: {_exception_message(http_error)}; "
                            f"Playwright {_exception_message(browser_error)}"
                        )
                        customization_complete = False
            if child["asin"] != asin:
                warnings.append(f"Requested child ASIN {asin}, but Amazon returned {child['asin']}.")
            normalized_customization, custom_warnings = normalize_customization(customization_raw) if customization_raw is not None else (None, [])
            warnings.extend(custom_warnings)
            return {
                "asin": asin, "url": f"https://www.amazon.com/dp/{asin}", "options": options,
                "price": child.get("price"), "listPrice": child.get("listPrice"),
                "availability": child.get("availability"), "isAvailable": child.get("isAvailable", True),
                "media": child.get("media", []),
                "customizationRaw": customization_raw, "customization": normalized_customization,
                "customizationFingerprint": normalized_customization.get("fingerprint") if normalized_customization else None,
                "customizationComplete": customization_complete,
                "priceInference": {"isInferred": False, "sourceAsins": []}, "warnings": warnings,
                "diagnostics": child_diagnostics,
            }

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.settings.variant_threads) as executor:
            futures = {executor.submit(crawl_child, asin): asin for asin in discovered_asins}
            for future in concurrent.futures.as_completed(futures):
                asin = futures[future]
                try:
                    variants.append(future.result())
                except Exception as error:
                    variants.append({
                        "asin": asin, "url": f"https://www.amazon.com/dp/{asin}", "options": deepcopy(asin_options.get(asin, {})),
                        "price": None, "listPrice": None, "availability": None, "isAvailable": False, "media": [],
                        "customizationRaw": None, "customization": None, "customizationFingerprint": None,
                        "priceInference": {"isInferred": False, "sourceAsins": []}, "warnings": [str(error)],
                        "diagnostics": {"fetchMode": "mixed", "attempts": 0, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
                    })
        order = {asin: index for index, asin in enumerate(discovered_asins)}
        variants.sort(key=lambda item: order.get(item["asin"], len(order)))
        self._infer_consensus_prices(variants)
        family = {
            "parentAsin": parent_asin, "canonicalUrl": f"https://www.amazon.com/dp/{parent_asin}",
            "sourceTitle": parent["title"], "description": parent.get("description"), "bulletPoints": parent.get("bulletPoints", []),
            "brand": parent.get("brand"), "seller": parent.get("seller"), "categories": parent.get("categories", []),
            "productDetails": parent.get("productDetails", {}), "rating": parent.get("rating"), "reviewCount": parent.get("reviewCount"),
            "availability": parent.get("availability"), "media": parent.get("media", []),
            "sourceVariants": variants,
            "variantMatrix": {"dimensions": parent["dimensions"], "expectedCount": expected_count, "discoveredCount": len(asin_options), "complete": not is_capped and len(asin_options) >= expected_count, "safetyCap": self.settings.max_matrix_variants},
            "customizationChecked": all(variant.get("customizationComplete") is True for variant in variants), "diagnostics": diagnostics,
        }
        if is_capped:
            family["variantMatrix"]["complete"] = False
        if family["variantMatrix"]["complete"] and family["customizationChecked"]:
            self.cache.save(normalized.asin, family)
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

    def _products_from_family(self, family: dict[str, Any]) -> list[dict[str, Any]]:
        split_attribute = self._choose_split_attribute(family["variantMatrix"]["dimensions"])
        grouped: dict[str | None, list[dict[str, Any]]] = {}
        if split_attribute is None:
            grouped[None] = family["sourceVariants"]
        else:
            for variant in family["sourceVariants"]:
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
            group_key = _stable_token(family["parentAsin"], split_attribute or "none", str(split_value or "none"), *sorted(source_asins))
            fingerprints = sorted({variant["customizationFingerprint"] for variant in source_variants if variant.get("customizationFingerprint")})
            representative = next((variant for variant in source_variants if variant.get("customization") is not None), source_variants[0])
            customization = deepcopy(representative.get("customization"))
            customization_raw = deepcopy(representative.get("customizationRaw"))
            warnings = [warning for variant in source_variants for warning in variant.get("warnings", [])]
            if len(fingerprints) > 1:
                warnings.append(f"Source variants have different customization configurations; representative {representative['asin']} was used. Fingerprints: {', '.join(fingerprints)}")
            base_variants: list[dict[str, Any]] = []
            for variant in source_variants:
                options = {key: value for key, value in variant.get("options", {}).items() if key != split_attribute}
                base_variants.append({
                    "id": f"{variant['asin']}-{_stable_token(json.dumps(options, sort_keys=True), length=10)}",
                    "sku": variant["asin"], "sourceAsin": variant["asin"], "options": options,
                    "price": deepcopy(variant.get("price")), "listPrice": deepcopy(variant.get("listPrice")),
                    "surcharge": None, "isAvailable": bool(variant.get("isAvailable")),
                    "metadata": {"priceInference": deepcopy(variant.get("priceInference"))},
                })
            if self.settings.profile_slug == "jeminise" and self.settings.apply_jeminise_preset:
                final_variants = build_jeminise_variants(group_key)
                customization = remove_option_choosers(customization)
                preset = PRESET_ID
            else:
                final_variants = expand_paid_variants(base_variants, customization)
                preset = None
            media_by_url: dict[str, dict[str, Any]] = {}
            for media in family.get("media", []) + [entry for variant in source_variants for entry in variant.get("media", [])]:
                media_by_url.setdefault(media["url"], media)
            matrix = deepcopy(family["variantMatrix"])
            if split_attribute:
                matrix["dimensions"].pop(split_attribute, None)
            remaining_expected = 1
            for values in matrix["dimensions"].values():
                remaining_expected *= max(1, len(values))
            matrix["expectedCount"] = remaining_expected
            matrix["discoveredCount"] = len(source_variants)
            matrix["complete"] = bool(matrix["complete"] and len(source_variants) >= remaining_expected)
            if not matrix["complete"]:
                warnings.append(f"Variant matrix is incomplete (discovered {matrix['discoveredCount']} of {matrix['expectedCount']}, cap {matrix['safetyCap']}).")
            products.append({
                "id": group_key, "parentAsin": family["parentAsin"], "canonicalUrl": family["canonicalUrl"],
                "sourceTitle": family["sourceTitle"], "title": title, "description": family.get("description"),
                "bulletPoints": deepcopy(family.get("bulletPoints", [])), "brand": family.get("brand"), "seller": family.get("seller"),
                "categories": deepcopy(family.get("categories", [])), "productDetails": deepcopy(family.get("productDetails", {})),
                "rating": family.get("rating"), "reviewCount": family.get("reviewCount"),
                "availability": family.get("availability"), "media": list(media_by_url.values()),
                "sourceVariants": deepcopy(source_variants), "variants": final_variants, "variantMatrix": matrix,
                "customizationRaw": customization_raw, "customization": customization,
                "splitContext": {"attribute": split_attribute, "value": split_value, "groupKey": group_key, "sourceAsins": source_asins},
                "preset": preset, "warnings": sorted(set(warnings)), "diagnostics": deepcopy(family["diagnostics"]),
            })
        return products

    def run(self, *, job_id: str, sources: list[str]) -> dict[str, Any]:
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

        def crawl_one(normalized: NormalizedInput) -> tuple[NormalizedInput, list[dict[str, Any]]]:
            self._check_cancelled()
            family = self._crawl_family(normalized)
            return normalized, self._products_from_family(family)

        self.progress({"phase": "product", "completed": 0, "total": len(normalized_inputs), "message": "Đang cào Amazon products..."})
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.settings.product_threads) as executor:
            futures = {executor.submit(crawl_one, normalized): normalized for normalized in normalized_inputs}
            for future in concurrent.futures.as_completed(futures):
                normalized = futures[future]
                try:
                    _, family_products = future.result()
                    products.extend(family_products)
                except InterruptedError:
                    self.cancel_event.set()
                except Exception as error:
                    errors.append({"source": normalized.source, "code": "CRAWL_FAILED", "message": str(error), "retryable": True})
                completed += 1
                self.progress({"phase": "product", "completed": completed, "total": len(normalized_inputs), "message": f"Đã xử lý {completed}/{len(normalized_inputs)} products.", "source": normalized.source})
        products_by_id = {product["id"]: product for product in products}
        products = list(products_by_id.values())
        status = "cancelled" if self.cancel_event.is_set() else ("partial" if errors else "completed")
        completed_at = _now_iso()
        output: dict[str, Any] = {
            "version": SCHEMA_VERSION, "jobId": job_id, "status": status,
            "startedAt": started_at, "completedAt": completed_at, "settings": self.settings.api_dict(),
            "products": products, "errors": errors,
            "warnings": sorted({warning for product in products for warning in product.get("warnings", [])}),
            "statistics": {
                "requestedInputs": len(sources), "acceptedInputs": len(normalized_inputs),
                "rejectedInputs": rejected_inputs, "products": len(products),
                "sourceVariants": sum(len(product["sourceVariants"]) for product in products),
                "finalVariants": sum(len(product["variants"]) for product in products),
                "durationMs": round((time.monotonic() - started_time) * 1000),
            },
            "exportFilename": None,
        }
        if status != "cancelled":
            output["exportFilename"] = self._write_export(output)
        return output

    def _write_export(self, output: dict[str, Any]) -> str:
        self.progress({"phase": "export", "completed": 0, "total": 1, "message": "Đang ghi JSON export..."})
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
