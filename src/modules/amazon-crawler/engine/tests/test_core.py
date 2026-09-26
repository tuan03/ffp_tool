from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.request
from copy import deepcopy
from pathlib import Path

from engine.cache import CACHE_SCHEMA_VERSION, RawFamilyCache
from engine.crawler_core import AmazonCrawler, CrawlSettings, HttpFetcher, NormalizedInput, effective_product_threads, normalize_amazon_input, parse_product_html
from engine.customization_converter import expand_paid_variants, normalize_customization, remove_option_choosers
from engine.proxy_profiles import ProxyAssignment
from engine.variant_presets import PRESET_ID, build_jeminise_variants


PRODUCT_HTML = """
<!doctype html><html><body>
<input id="ASIN" value="B012345678">
<h1 id="productTitle">  Original   Amazon Title </h1>
<a id="bylineInfo">Test Brand</a><div id="availability"><span>In Stock</span></div>
<div id="corePrice_feature_div"><span class="a-offscreen">$19.99</span></div>
<div class="basisPrice"><span class="a-offscreen">$24.99</span></div>
<div id="feature-bullets"><li><span> First bullet </span></li></div>
<img id="landingImage" src="https://m.media-amazon.com/images/I/product.jpg">
<script>
var variationDisplayLabels = {"design_name":"Design","size_name":"Size"};
var variationValues = {"design_name":["Ocean","Forest"],"size_name":["Twin","Queen"]};
var dimensionValuesDisplayData = {"B012345678":["Ocean","Twin"],"B012345679":["Ocean","Queen"],"B012345680":["Forest","Twin"]};
var dimensionToAsinMap = {"1_1":"B012345681"};
</script>
<script type="application/json">{"surfaces":[{"id":"front"}],"components":[{"componentType":"TextInputComponent","id":"name","label":"Name"},{"componentType":"OptionChooserComponent","id":"finish","label":"Finish","required":false,"options":[{"id":"plain","label":"Plain","price":0},{"id":"gold","label":"Gold","price":"+$5.00"}]}]}</script>
</body></html>
"""

DIRECT_GALLERY_HTML = r'''<html><body>
<input id="ASIN" value="B012345678"><h1 id="productTitle">Gallery product</h1>
<script>
var imageBlock = {"colorImages":{"initial":[
  {"hiRes":"https://m.media-amazon.com/images/I/MAINIMAGE01._SL1500_.jpg","large":"https://m.media-amazon.com/images/I/MAINIMAGE01._SL1000_.jpg","mainUrl":"https://m.media-amazon.com/images/I/MAINIMAGE01._SL500_.jpg"},
  {"large":"https://m.media-amazon.com/images/I/GALLERYIMG2._SL1000_.jpg"},
  {"thumb":"https://m.media-amazon.com/images/I/VIDEOICON01._SS40_PKplay-button-mb-image-grid-small_.png","isVideo":true},
  {"hiRes":"https://m.media-amazon.com/images/I/MAINIMAGE01._SL1500_.jpg"}
]}};
</script></body></html>'''

PARSE_JSON_GALLERY_HTML = r'''<html><body>
<input id="ASIN" value="B012345678"><h1 id="productTitle">Encoded gallery</h1>
<script>
var data = {"colorImages":{"initial":A.$.parseJSON('[{"hiRes":"https:\/\/m.media-amazon.com\/images\/I\/PARSEJSON01._SL1500_.jpg"},{"mainUrl":"https:\/\/m.media-amazon.com\/images\/I\/PARSEJSON02._SL500_.jpg"}]')}};
</script></body></html>'''

CUSTOMIZABLE_ENTRY_HTML = """
<html><body><input id="ASIN" value="B012345678"><h1 id="productTitle">Custom product</h1>
<script type="a-state" data-a-state='{"key":"gc:productInfo"}'>
{"customizationFormLink":"/customize/B012345678"}
</script></body></html>
"""

MISSING_CUSTOMIZATION_PAYLOAD_HTML = """
<html><body><input id="ASIN" value="B012345678"><h1 id="productTitle">Custom product</h1>
<button id="customizeNow">Customize Now</button></body></html>
"""


class FakeBrowser:
    def __init__(self, html: str) -> None:
        self.html = html
        self.calls: list[str] = []

    def fetch(self, url: str, *, cancel_event: threading.Event | None = None) -> str:
        self.calls.append(url)
        return self.html

    def close(self) -> None:
        pass


class CustomizationAwareBrowser(FakeBrowser):
    def __init__(self, entry_html_by_asin: dict[str, str], form_html: str) -> None:
        super().__init__(form_html)
        self.entry_html_by_asin = entry_html_by_asin
        self.entry_calls: list[str] = []
        self.form_calls: list[str] = []

    def fetch_customization_entry(self, url: str, *, cancel_event: threading.Event | None = None) -> str:
        self.entry_calls.append(url)
        asin = url.rstrip("/").rsplit("/", 1)[-1]
        return self.entry_html_by_asin[asin]

    def fetch_customization_form(self, url: str, *, cancel_event: threading.Event | None = None) -> str:
        self.form_calls.append(url)
        return self.html


class FailingFetcher:
    def fetch(self, url: str) -> tuple[str, int]:
        raise RuntimeError("Amazon returned CAPTCHA or a location interstitial.")


class StaticFetcher:
    def __init__(self, html: str) -> None:
        self.html = html
        self.calls: list[str] = []

    def fetch(self, url: str) -> tuple[str, int]:
        self.calls.append(url)
        return self.html, 1


class FakeHttpResponse:
    status = 200

    def __init__(self, html: str) -> None:
        self.html = html

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        pass

    def read(self) -> bytes:
        return self.html.encode("utf-8")


class RotatingHttpFetcher(HttpFetcher):
    def __init__(self) -> None:
        super().__init__(
            retries=2,
            assignments=[
                ProxyAssignment(index=0, name="proxy-1", server="http://proxy-1.test:80"),
                ProxyAssignment(index=1, name="proxy-2", server="http://proxy-2.test:80"),
            ],
        )

    def _bootstrap_us_cookie(self, assignment: ProxyAssignment) -> str:
        self._us_profile_applied[assignment.index] = True
        return "i18n-prefs=USD"

    def _opener(self, assignment: ProxyAssignment, cookie_jar=None):
        html = "<form action='/errors/validateCaptcha'>" if assignment.index == 0 else PRODUCT_HTML + (" " * 5_000)

        class Opener:
            def open(self, _request, timeout: int):
                return FakeHttpResponse(html)

        return Opener()


class DirectFirstHttpFetcher(HttpFetcher):
    def __init__(self, *, direct_html: str) -> None:
        super().__init__(
            retries=2,
            assignments=[
                ProxyAssignment(index=0, name="direct"),
                ProxyAssignment(index=1, name="proxy-1", server="http://proxy-1.test:80"),
            ],
        )
        self.direct_html = direct_html
        self.opened_profiles: list[str] = []

    def _bootstrap_us_cookie(self, assignment: ProxyAssignment) -> str:
        self._us_profile_applied[assignment.index] = True
        return "i18n-prefs=USD"

    def _opener(self, assignment: ProxyAssignment, cookie_jar=None):
        self.opened_profiles.append(assignment.name)
        html = self.direct_html if not assignment.is_enabled else PRODUCT_HTML + (" " * 5_000)

        class Opener:
            def open(self, _request, timeout: int):
                return FakeHttpResponse(html)

        return Opener()


class FixtureCrawler(AmazonCrawler):
    def __init__(self, family: dict, **kwargs) -> None:
        super().__init__(**kwargs)
        self.family = family

    def _crawl_family(self, normalized: NormalizedInput) -> dict:
        return self.family


class ParentFamilyCrawler(AmazonCrawler):
    def _fetch_parsed(self, normalized: NormalizedInput) -> tuple[dict, dict]:
        variants = {
            "B012345678": {"Design": "Ocean"},
            "B012345679": {"Design": "Forest"},
        }
        return ({
            "asin": normalized.asin,
            "parentAsin": "B0PARENT00",
            "url": normalized.canonical_url,
            "title": "Family",
            "description": None,
            "bulletPoints": [],
            "categories": [],
            "productDetails": {},
            "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"},
            "media": [],
            "dimensions": {"Design": ["Ocean", "Forest"]},
            "asinOptions": variants,
            "customizationRaw": None,
            "customizationWarnings": [],
            "customizationFormUrl": None,
        }, {
            "fetchMode": "http", "attempts": 1, "captchaEncountered": False,
            "locationFallbackUsed": False, "amazonZip": "10001", "usProfileApplied": True,
            "matrixSwept": False, "cacheHit": False,
        })


class PartiallyDetectedCustomizeFamilyCrawler(AmazonCrawler):
    def _fetch_parsed(self, normalized: NormalizedInput) -> tuple[dict, dict]:
        first_asin = "B012345678"
        second_asin = "B012345679"
        has_customize = normalized.asin == first_asin
        return ({
            "asin": normalized.asin,
            "parentAsin": "B0PARENT00",
            "url": normalized.canonical_url,
            "title": "Custom family",
            "description": None,
            "bulletPoints": [],
            "categories": [],
            "productDetails": {},
            "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"},
            "media": [],
            "dimensions": {"Design": ["Ocean", "Forest"]},
            "asinOptions": {
                first_asin: {"Design": "Ocean"},
                second_asin: {"Design": "Forest"},
            },
            "customizationRaw": {"state": {"gc:productInfo": {}}} if has_customize else None,
            "customizationWarnings": [],
            "customizationFormUrl": f"https://www.amazon.com/customize/{normalized.asin}" if has_customize else None,
        }, {
            "fetchMode": "playwright", "attempts": 1, "captchaEncountered": False,
            "locationFallbackUsed": False, "amazonZip": "10001", "usProfileApplied": True,
            "matrixSwept": False, "cacheHit": False,
        })


def source_variant(asin: str, design: str, size: str, customization: dict | None = None) -> dict:
    return {
        "asin": asin, "url": f"https://www.amazon.com/dp/{asin}", "options": {"Design": design, "Size": size},
        "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"},
        "media": [], "customizationRaw": None,
        "customization": customization, "customizationFingerprint": customization.get("fingerprint") if customization else None,
        "priceInference": {"isInferred": False, "sourceAsins": []}, "warnings": [],
    }


class CoreTests(unittest.TestCase):
    def test_http_response_wait_is_interrupted_by_stop_event(self) -> None:
        request_started = threading.Event()
        release_request = threading.Event()
        cancel_event = threading.Event()

        class BlockingResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self) -> bytes:
                request_started.set()
                release_request.wait(timeout=2)
                return b"late response"

        class BlockingOpener:
            def open(self, *_args: object, **_kwargs: object) -> BlockingResponse:
                return BlockingResponse()

        fetcher = HttpFetcher(cancel_event=cancel_event)
        timer = threading.Timer(0.05, cancel_event.set)
        timer.start()
        try:
            with self.assertRaisesRegex(InterruptedError, "cancelled"):
                fetcher._read_response(
                    BlockingOpener(),
                    urllib.request.Request("https://example.test"),
                    timeout=90,
                )
            self.assertTrue(request_started.is_set())
        finally:
            release_request.set()
            timer.cancel()

    def test_default_settings_match_four_proxy_concurrency_profile(self) -> None:
        settings = CrawlSettings.from_api({})

        self.assertEqual(settings.product_threads, 3)
        self.assertEqual(settings.variant_threads, 8)
        self.assertEqual(settings.urllib_threads, 12)
        self.assertEqual(settings.browser_profiles, 4)
        self.assertEqual(settings.browser_tabs, 2)

    def test_product_workers_use_at_least_the_browser_profile_count(self) -> None:
        settings = CrawlSettings(product_threads=3, browser_profiles=4)

        self.assertEqual(effective_product_threads(10, settings), 4)
        self.assertEqual(effective_product_threads(2, settings), 2)

    def test_normalizes_asin_and_rejects_etsy(self) -> None:
        self.assertEqual(normalize_amazon_input("b012345678").canonical_url, "https://www.amazon.com/dp/B012345678")
        self.assertEqual(normalize_amazon_input("https://amazon.co.uk/dp/B012345678?tag=x").asin, "B012345678")
        with self.assertRaisesRegex(ValueError, "Etsy"):
            normalize_amazon_input("https://www.etsy.com/listing/123")
        with self.assertRaisesRegex(ValueError, "Only Amazon"):
            normalize_amazon_input("https://example.com/dp/B012345678")

    def test_parses_family_matrix_media_and_customization(self) -> None:
        parsed = parse_product_html(PRODUCT_HTML, "B012345678", "https://www.amazon.com/dp/B012345678")
        self.assertEqual(parsed["title"], "Original Amazon Title")
        self.assertEqual(parsed["price"]["amount"], 19.99)
        self.assertEqual(len(parsed["asinOptions"]), 4)
        self.assertEqual(parsed["asinOptions"]["B012345681"], {"Design": "Forest", "Size": "Queen"})
        self.assertEqual(parsed["media"][0]["sourceAsin"], "B012345678")
        self.assertIsNotNone(parsed["customizationRaw"])
        for field in ("brand", "seller", "rating", "reviewCount", "availability", "isAvailable"):
            self.assertNotIn(field, parsed)

    def test_media_prefers_amazon_image_block_high_resolution_urls(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Images</h1>
        <img id='landingImage' src='https://m.media-amazon.com/images/I/main-thumb._AC_US100_.jpg'>
        <div id='altImages'><img src='https://m.media-amazon.com/images/I/alt-thumb._AC_US100_.jpg'></div>
        <script>
        var data = {'colorImages': {'initial': A.$.parseJSON('[{"hiRes":"https://m.media-amazon.com/images/I/main-hires._AC_SL1500_.jpg","thumb":"https://m.media-amazon.com/images/I/main-thumb._AC_US100_.jpg","large":"https://m.media-amazon.com/images/I/main-large._AC_.jpg"},{"hiRes":null,"thumb":"https://m.media-amazon.com/images/I/alt-thumb._AC_US100_.jpg","large":"https://m.media-amazon.com/images/I/alt-large._AC_.jpg"} ]')}};
        </script></body></html>"""

        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")

        self.assertEqual([media["url"] for media in parsed["media"]], [
            "https://m.media-amazon.com/images/I/main-hires._AC_SL1500_.jpg",
            "https://m.media-amazon.com/images/I/alt-large._AC_.jpg",
        ])

    def test_media_parses_direct_color_images_and_preserves_gallery_metadata(self) -> None:
        parsed = parse_product_html(
            DIRECT_GALLERY_HTML,
            "B012345678",
            "https://www.amazon.com/dp/B012345678",
        )

        self.assertEqual(len(parsed["media"]), 2)
        self.assertEqual(parsed["media"][0]["amazonImageId"], "MAINIMAGE01")
        self.assertTrue(parsed["media"][0]["isMain"])
        self.assertEqual(parsed["media"][1]["amazonImageId"], "GALLERYIMG2")
        self.assertFalse(parsed["media"][1]["isMain"])
        self.assertTrue(all(media["sourceAsin"] == "B012345678" for media in parsed["media"]))

    def test_media_parses_amazon_parse_json_main_url_fallback(self) -> None:
        parsed = parse_product_html(
            PARSE_JSON_GALLERY_HTML,
            "B012345678",
            "https://www.amazon.com/dp/B012345678",
        )

        self.assertEqual(
            [media["amazonImageId"] for media in parsed["media"]],
            ["PARSEJSON01", "PARSEJSON02"],
        )

    def test_media_excludes_product_videos(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Images only</h1>
        <img id='landingImage' src='https://m.media-amazon.com/images/I/product.jpg'>
        <video src='https://m.media-amazon.com/images/S/product-video.mp4'></video>
        <video><source src='https://m.media-amazon.com/images/S/second-video.mp4'></video>
        </body></html>"""

        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")

        self.assertEqual([media["url"] for media in parsed["media"]], [
            "https://m.media-amazon.com/images/I/product._SL1500_.jpg",
        ])

    def test_parses_description_and_bullets_from_new_product_facts_layout(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Facts</h1>
        <div id='productFactsDesktopExpander'><ul><li>First product fact</li><li>Second product fact</li></ul></div>
        </body></html>"""
        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")
        self.assertEqual(parsed["bulletPoints"], ["First product fact", "Second product fact"])
        self.assertEqual(parsed["description"], "First product fact Second product fact")

    def test_price_parser_skips_blank_offscreen_nodes(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Price</h1>
        <div id='corePriceDisplay_desktop_feature_div'><span class='a-offscreen'> </span>
        <span id='apex-pricetopay-accessibility-label'> $29.93 </span></div></body></html>"""
        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")
        self.assertEqual(parsed["price"], {"raw": "$29.93", "amount": 29.93, "currency": "USD"})

    def test_unrelated_recommendation_asins_are_not_variants(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Family</h1>
        <div id='twister'><li data-asin='B012345679'></li></div>
        <div id='recommendations'><div data-asin='B0BADASIN1'></div></div></body></html>"""
        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")
        self.assertIn("B012345679", parsed["asinOptions"])
        self.assertNotIn("B0BADASIN1", parsed["asinOptions"])

    def test_detects_customize_form_url_from_amazon_state(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Custom</h1>
        <script type='a-state' data-a-state='{&quot;key&quot;:&quot;gc:productInfo&quot;}'>{"customizationFormLink":"/customize/B012345678"}</script>
        </body></html>"""
        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")
        self.assertEqual(parsed["customizationFormUrl"], "https://www.amazon.com/customize/B012345678")

    def test_recovers_customize_form_url_from_non_a_state_script(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Custom</h1>
        <script>window.payload = {"customizationFormLink":"\\/customize\\/B012345678"};</script>
        </body></html>"""

        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")

        self.assertEqual(parsed["customizationFormUrl"], "https://www.amazon.com/customize/B012345678")
        self.assertEqual(parsed["customizationWarnings"], [])

    def test_add_to_cart_product_is_not_mistaken_for_customize(self) -> None:
        html = """<html><body><input id='ASIN' value='B012345678'><h1 id='productTitle'>Regular product</h1>
        <input id='add-to-cart-button' value='Add to Cart'>
        <a href='/Amazon-Custom/'>Amazon Custom</a>
        <script>window.flags = {"customization": true, "customizeNow": "Customize Now"};</script>
        </body></html>"""

        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")

        self.assertIsNone(parsed["customizationRaw"])
        self.assertIsNone(parsed["customizationFormUrl"])
        self.assertEqual(parsed["customizationWarnings"], [])

    def test_missing_customize_payload_retries_http_then_playwright(self) -> None:
        fetcher = StaticFetcher(MISSING_CUSTOMIZATION_PAYLOAD_HTML)
        browser = FakeBrowser(CUSTOMIZABLE_ENTRY_HTML)
        normalized = normalize_amazon_input("B012345678")
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(
                root=Path(directory),
                settings=CrawlSettings(),
                fetcher=fetcher,
                browser_pool=browser,
            )
            crawler._initialize_progress([normalized])
            recovered, errors = crawler._recover_customization_entry(
                asin=normalized.asin,
                source=normalized.source,
                options={"Size": "Queen"},
            )

        self.assertIsNotNone(recovered)
        self.assertEqual(errors, [])
        self.assertEqual(recovered["customizationFormUrl"], "https://www.amazon.com/customize/B012345678")
        self.assertEqual(len(fetcher.calls), 1)
        self.assertEqual(browser.calls, ["https://www.amazon.com/dp/B012345678"])

    def test_customize_family_rechecks_child_whose_first_snapshot_has_no_customize_marker(self) -> None:
        second_entry_html = CUSTOMIZABLE_ENTRY_HTML.replace("B012345678", "B012345679")
        widget_html = """<html><body><script type='application/json'>
        {"sellerConfigComponents":[{"componentType":"TextInputComponent","id":"name","label":"Name"}]}
        </script></body></html>"""
        browser = CustomizationAwareBrowser({"B012345679": second_entry_html}, widget_html)
        fetcher = StaticFetcher(MISSING_CUSTOMIZATION_PAYLOAD_HTML)

        with tempfile.TemporaryDirectory() as directory:
            crawler = PartiallyDetectedCustomizeFamilyCrawler(
                root=Path(directory),
                settings=CrawlSettings(variant_threads=1),
                fetcher=fetcher,
                browser_pool=browser,
            )
            family = crawler._crawl_family(normalize_amazon_input("B012345678"))

        variants = {variant["asin"]: variant for variant in family["sourceVariants"]}
        self.assertIsNotNone(variants["B012345679"]["customization"])
        self.assertTrue(variants["B012345679"]["customizationComplete"])
        self.assertEqual(browser.entry_calls, ["https://www.amazon.com/dp/B012345679"])
        self.assertIn("https://www.amazon.com/customize/B012345679", browser.form_calls)

    def test_http_failure_uses_playwright_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            browser = FakeBrowser(PRODUCT_HTML)
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=FailingFetcher(), browser_pool=browser)
            parsed, diagnostics = crawler._fetch_parsed(NormalizedInput("B012345678", "B012345678", "https://www.amazon.com/dp/B012345678"))
        self.assertEqual(parsed["asin"], "B012345678")
        self.assertEqual(diagnostics["fetchMode"], "playwright")
        self.assertTrue(diagnostics["captchaEncountered"])

    def test_http_fetch_rotates_proxy_after_captcha_and_records_trace(self) -> None:
        fetcher = RotatingHttpFetcher()

        html, attempts = fetcher.fetch("https://www.amazon.com/dp/B012345678")

        self.assertIn("productTitle", html)
        self.assertEqual(attempts, 2)
        self.assertEqual(
            [(trace["profile"], trace["outcome"]) for trace in fetcher.last_diagnostics()],
            [("proxy-1", "captcha"), ("proxy-2", "success")],
        )

        fetcher.fetch("https://www.amazon.com/dp/B012345678")

        self.assertEqual(
            [(trace["profile"], trace["outcome"]) for trace in fetcher.last_diagnostics()],
            [("proxy-2", "success")],
        )

    def test_http_fetch_uses_direct_connection_without_touching_proxy_when_it_succeeds(self) -> None:
        fetcher = DirectFirstHttpFetcher(direct_html=PRODUCT_HTML + (" " * 5_000))

        html, attempts = fetcher.fetch("https://www.amazon.com/dp/B012345678")

        self.assertIn("productTitle", html)
        self.assertEqual(attempts, 1)
        self.assertEqual(fetcher.opened_profiles, ["direct"])
        self.assertEqual(fetcher.last_diagnostics()[0]["proxyEnabled"], False)

        fetcher.fetch("https://www.amazon.com/dp/B012345679")

        self.assertEqual(fetcher.opened_profiles, ["direct", "direct"])

    def test_http_fetch_falls_back_to_proxy_only_after_direct_captcha(self) -> None:
        fetcher = DirectFirstHttpFetcher(direct_html="<form action='/errors/validateCaptcha'>")

        html, attempts = fetcher.fetch("https://www.amazon.com/dp/B012345678")

        self.assertIn("productTitle", html)
        self.assertEqual(attempts, 2)
        self.assertEqual(fetcher.opened_profiles, ["direct", "proxy-1"])
        self.assertEqual(
            [(trace["profile"], trace["outcome"]) for trace in fetcher.last_diagnostics()],
            [("direct", "captcha"), ("proxy-1", "success")],
        )

    def test_family_parent_asin_is_not_injected_as_a_child_variant(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = ParentFamilyCrawler(
                root=Path(directory), settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML)
            )
            family = crawler._crawl_family(normalize_amazon_input("B012345678"))
        self.assertEqual(family["parentAsin"], "B0PARENT00")
        self.assertEqual([variant["asin"] for variant in family["sourceVariants"]], ["B012345678", "B012345679"])
        self.assertNotIn("B0PARENT00", [variant["asin"] for variant in family["sourceVariants"]])

    def test_family_reports_per_variant_options_and_counts(self) -> None:
        progress_events: list[dict] = []
        normalized = normalize_amazon_input("B012345678")
        with tempfile.TemporaryDirectory() as directory:
            crawler = ParentFamilyCrawler(
                root=Path(directory),
                settings=CrawlSettings(),
                browser_pool=FakeBrowser(PRODUCT_HTML),
                progress=progress_events.append,
            )
            crawler._initialize_progress([normalized])
            crawler._crawl_family(normalized)

        variant_events = [
            event
            for event in progress_events
            if event.get("items") and event["items"][0].get("variantTotal") == 2
        ]
        self.assertTrue(variant_events)
        final_item = variant_events[-1]["items"][0]
        self.assertEqual(final_item["variantCompleted"], 2)
        self.assertEqual(final_item["variantTotal"], 2)
        self.assertEqual(final_item["activeVariants"], [])
        self.assertIn("2/2", final_item["message"])
        self.assertTrue(any(event["items"][0].get("currentOptions") for event in variant_events))

    def test_customization_filters_options_and_multiplies_base_variants(self) -> None:
        raw = {"components": [{
            "componentType": "OptionChooserComponent", "id": "box", "label": "Gift Box", "required": False,
            "options": [
                {"id": "bad", "label": "No Print", "price": 0},
                {"id": "sold", "label": "Red", "price": 3, "status": "sold_out"},
                {"id": "premium", "label": "Premium", "price": "+$5.00"},
            ],
        }, {"componentType": "TextInputComponent", "id": "name", "label": "Name"}]}
        normalized, warnings = normalize_customization(raw)
        self.assertEqual(warnings, [])
        self.assertIsNotNone(normalized)
        assert normalized is not None
        paid_groups = normalized["pricing"]["paidOptionGroups"]
        self.assertEqual([option["label"] for option in paid_groups[0]["options"]], ["None", "Premium"])
        self.assertEqual(normalized["optionGroups"], [])
        self.assertTrue(all(entry["id"] != "box" for entry in normalized["controlOrder"]))
        base = [
            {"id": "base", "sku": "BASE", "sourceAsin": "B012345678", "options": {"Size": "Twin"}, "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"}, "surcharge": None, "metadata": {}},
            {"id": "base-2", "sku": "BASE-2", "sourceAsin": "B012345679", "options": {"Size": "Queen"}, "price": None, "surcharge": None, "metadata": {}},
        ]
        variants = expand_paid_variants(base, normalized)
        self.assertEqual(len(variants), 4)
        self.assertEqual([variant["price"]["amount"] for variant in variants[:2]], [20.0, 25.0])
        self.assertIsNone(variants[2]["price"])
        self.assertEqual([control["type"] for control in normalized["textInputs"]], ["TextInputComponent"])
        self.assertNotIn("controls", normalized)
        self.assertNotIn("rules", normalized)

    def test_customization_filters_mini_size_and_all_unavailable_option_signals(self) -> None:
        raw = {"components": [{
            "componentType": "OptionChooserComponent", "id": "size", "label": "Size", "required": False,
            "defaultOptionId": "mini",
            "options": [
                {"id": "mini", "label": "SMALL (Mini Size)", "price": 0},
                {"id": "no-print", "label": "Small Size - No-Print", "price": 0},
                {"id": "stock-flag", "label": "Medium", "price": 4, "outOfStock": True},
                {"id": "available-flag", "label": "Large", "price": 5, "isAvailable": False},
                {"id": "status", "label": "X-Large", "price": 6, "status": "currently_unavailable"},
                {"id": "regular", "label": "Regular Size", "price": 7},
            ],
        }]}

        normalized, warnings = normalize_customization(raw)

        self.assertEqual(warnings, [])
        assert normalized is not None
        paid_group = normalized["pricing"]["paidOptionGroups"][0]
        self.assertEqual([option["label"] for option in paid_group["options"]], ["None", "Regular Size"])
        self.assertEqual(paid_group["defaultOptionId"], "")
        variants = expand_paid_variants([
            {
                "id": "base", "sku": "BASE", "sourceAsin": "B012345678", "options": {},
                "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"},
                "surcharge": None, "metadata": {},
            },
        ], normalized)
        self.assertEqual([variant["options"]["Size"] for variant in variants], ["None", "Regular Size"])

    def test_customization_keeps_normal_small_options_without_mini_marker(self) -> None:
        raw = {"components": [{
            "componentType": "OptionChooserComponent", "id": "size", "label": "Size", "required": True,
            "defaultOptionId": "small",
            "options": [
                {"id": "small", "label": "Small", "price": 3},
                {"id": "large", "label": "Large", "price": 5},
            ],
        }]}

        normalized, _ = normalize_customization(raw)

        assert normalized is not None
        paid_group = normalized["pricing"]["paidOptionGroups"][0]
        self.assertEqual([option["label"] for option in paid_group["options"]], ["Small", "Large"])
        self.assertEqual(paid_group["defaultOptionId"], "small")

    def test_customization_ports_amazon_identifiers_costs_hierarchy_and_assets(self) -> None:
        raw = {
            "asin": "B0CUSTOM01", "marketplaceId": "ATVPDKIKX0DER", "productImageUrl": "https://img/product.jpg",
            "preview": {"previewSize": 600},
            "sellerConfigComponents": {
                "type": "PreviewContainerComponent", "identifier": "front", "label": "Front",
                "baseImage": {"imageUrl": "https://img/base.png", "dimension": {"width": 600, "height": 600}},
                "children": [{
                    "type": "PlacementContainerComponent", "identifier": "placement", "children": [
                        {"type": "OptionChooserComponent", "identifier": "finish", "label": "Finish", "isRequired": False,
                         "defaultOptionIdentifier": "plain", "options": [
                             {"identifier": "plain", "label": "Plain", "additionalCost": {"amount": 0, "currencyCode": "USD"}},
                             {"identifier": "gold", "label": "Gold", "additionalCost": {"amount": 5.25, "currencyCode": "USD"}, "thumbnailImage": {"imageUrl": "https://img/gold.png"}},
                             {"identifier": "sold", "label": "Sold out", "additionalCost": {"amount": 8}, "outOfStock": True},
                         ]},
                        {"type": "OptionChooserComponent", "identifier": "shape", "label": "Shape", "options": [
                            {"identifier": "round", "label": "Round", "additionalCost": {"amount": 0}},
                        ]},
                        {"type": "TextInputComponent", "identifier": "name", "label": "Name", "maxLength": 20},
                        {"type": "ImageInputComponent", "identifier": "photo", "label": "Photo"},
                        {"type": "FontChooserComponent", "identifier": "font", "fontOptions": [{"identifier": "arial", "family": "Arial", "fontUrl": "https://img/font.woff"}]},
                        {"type": "ColorChooserComponent", "identifier": "color", "colorOptions": [{"identifier": "red", "name": "Red", "value": "#f00"}]},
                    ],
                }],
            },
        }
        original = deepcopy(raw)
        normalized, warnings = normalize_customization(raw)
        self.assertEqual(warnings, [])
        self.assertEqual(raw, original)
        assert normalized is not None
        paid = normalized["pricing"]["paidOptionGroups"][0]
        self.assertEqual(paid["id"], "finish")
        self.assertEqual([option["id"] for option in paid["options"]], ["plain", "gold"])
        self.assertEqual(paid["options"][1]["price"]["amount"], 5.25)
        self.assertEqual([group["id"] for group in normalized["optionGroups"]], ["shape"])
        self.assertNotIn("finish", [entry["id"] for entry in normalized["controlOrder"]])
        self.assertEqual(normalized["componentParent"]["name"], "placement")
        self.assertEqual(normalized["textInputs"][0]["placementId"], "placement")
        self.assertEqual(normalized["surfaces"][0]["previewSize"], 600)
        self.assertIn("thumbnail", next(asset["roles"] for asset in normalized["assets"] if asset["url"] == "https://img/gold.png"))

    def test_multiple_paid_groups_multiply_prices_and_keep_missing_prices_null(self) -> None:
        raw = {"components": [
            {"componentType": "OptionChooserComponent", "id": "finish", "label": "Finish", "options": [{"id": "plain", "label": "Plain", "price": 0}, {"id": "gold", "label": "Gold", "price": 5}]},
            {"componentType": "OptionChooserComponent", "id": "wrap", "label": "Wrap", "required": True, "options": [{"id": "paper", "label": "Paper", "price": 2}, {"id": "box", "label": "Box", "price": 4}]},
        ]}
        customization, _ = normalize_customization(raw)
        base_variants = [
            {"id": "priced", "sku": "PRICED", "sourceAsin": "B012345678", "options": {"Size": "Queen"}, "price": {"raw": "$20.00", "amount": 20, "currency": "USD"}, "surcharge": None, "metadata": {}},
            {"id": "missing", "sku": "MISSING", "sourceAsin": "B012345679", "options": {"Size": "King"}, "price": None, "surcharge": None, "metadata": {}},
        ]
        first = expand_paid_variants(base_variants, customization)
        second = expand_paid_variants(base_variants, customization)
        self.assertEqual(len(first), 8)
        self.assertEqual([variant["id"] for variant in first], [variant["id"] for variant in second])
        self.assertEqual(first[0]["price"]["amount"], 22)
        self.assertTrue(all("listPrice" not in variant for variant in first))
        self.assertTrue(all(variant["price"] is None for variant in first[4:]))
        self.assertTrue(all(len(variant["metadata"]["paidOptions"]) == 2 for variant in first))

    def test_auto_split_and_jeminise_replace_variants_per_child(self) -> None:
        raw = {"components": [{"componentType": "TextInputComponent", "id": "name", "label": "Name"}, {"componentType": "OptionChooserComponent", "id": "free", "label": "Free", "options": [{"label": "A", "price": 0}]}]}
        customization, _ = normalize_customization(raw)
        family = {
            "parentAsin": "B012345678", "canonicalUrl": "https://www.amazon.com/dp/B012345678", "sourceTitle": "Bedding",
            "description": None, "bulletPoints": [], "media": [],
            "sourceVariants": [source_variant("B012345678", "Ocean", "Twin", customization), source_variant("B012345679", "Forest", "Twin", customization)],
            "variantMatrix": {"dimensions": {"Design": ["Ocean", "Forest"], "Size": ["Twin"]}, "expectedCount": 2, "discoveredCount": 2, "complete": True, "safetyCap": 500},
            "diagnostics": {"fetchMode": "http", "attempts": 1, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
        }
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(profile_slug="jeminise", apply_jeminise_preset=True), browser_pool=FakeBrowser(PRODUCT_HTML))
            products = crawler._products_from_family(family)
        self.assertEqual(len(products), 2)
        self.assertEqual([product["asin"] for product in products], ["B012345678", "B012345679"])
        self.assertEqual(products[0]["splitContext"]["attribute"], "Design")
        self.assertTrue(products[0]["title"].startswith("Bedding - "))
        self.assertTrue(all(product["preset"] == PRESET_ID and len(product["variants"]) == 47 for product in products))
        self.assertEqual(products[0]["customization"]["optionGroups"], [])

    def test_split_products_use_only_their_source_variant_media(self) -> None:
        ocean = source_variant("B012345678", "Ocean", "Twin")
        forest = source_variant("B012345679", "Forest", "Twin")
        ocean["media"] = [{"url": "https://img/ocean.jpg", "kind": "image", "sourceAsin": ocean["asin"]}]
        forest["media"] = [{"url": "https://img/forest.jpg", "kind": "image", "sourceAsin": forest["asin"]}]
        family = {
            "parentAsin": "B0PARENT00", "canonicalUrl": "https://www.amazon.com/dp/B0PARENT00", "sourceTitle": "Blanket",
            "description": None, "bulletPoints": [],
            "media": [{"url": "https://img/parent.jpg", "kind": "image", "sourceAsin": "B0PARENT00"}],
            "sourceVariants": [ocean, forest],
            "variantMatrix": {"dimensions": {"Design": ["Ocean", "Forest"], "Size": ["Twin"]}, "expectedCount": 2, "discoveredCount": 2, "complete": True, "safetyCap": 500},
            "diagnostics": {"fetchMode": "http", "attempts": 1, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
        }
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML))
            products = crawler._products_from_family(family)
        media_by_split = {product["splitContext"]["value"]: [media["url"] for media in product["media"]] for product in products}
        self.assertEqual(media_by_split["Ocean"], ["https://img/ocean.jpg"])
        self.assertEqual(media_by_split["Forest"], ["https://img/forest.jpg"])
        links_by_split = {product["splitContext"]["value"]: product["canonicalUrl"] for product in products}
        self.assertEqual(links_by_split["Ocean"], "https://www.amazon.com/dp/B012345678")
        self.assertEqual(links_by_split["Forest"], "https://www.amazon.com/dp/B012345679")
        self.assertTrue(all(product["parentAsin"] == "B0PARENT00" for product in products))

    def test_split_uses_actual_source_options_when_matrix_labels_are_inconsistent(self) -> None:
        first = source_variant("B012345678", "Ocean", "Twin")
        second = source_variant("B012345679", "Forest", "Twin")
        first["options"] = {"Size": "Ocean", "Color": "One Size"}
        second["options"] = {"Size": "Forest", "Color": "One Size"}
        family = {
            "parentAsin": "B0PARENT00",
            "canonicalUrl": "https://www.amazon.com/dp/B0PARENT00",
            "sourceTitle": "Tote",
            "description": None,
            "bulletPoints": [],
            "categories": [],
            "productDetails": {},
            "media": [],
            "sourceVariants": [first, second],
            # Amazon occasionally swaps the display-label/value arrays. The
            # source option map is authoritative for grouping final products.
            "variantMatrix": {
                "dimensions": {"Color": ["Ocean", "Forest"], "Size": ["One Size", "Ocean", "Forest"]},
                "expectedCount": 6,
                "discoveredCount": 2,
                "complete": False,
                "safetyCap": 500,
            },
            "diagnostics": {"fetchMode": "http", "attempts": 1, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
        }
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML))
            products = crawler._products_from_family(family)

        self.assertEqual([product["splitContext"]["value"] for product in products], ["Ocean", "Forest"])
        self.assertTrue(all(product["splitContext"]["attribute"] == "Size" for product in products))
        self.assertTrue(all(product["variantMatrix"]["complete"] for product in products))
        self.assertTrue(all(product["variantMatrix"]["dimensions"] == {"Color": ["One Size"]} for product in products))

    def test_product_rebuilds_customization_from_raw_cache_payload(self) -> None:
        raw = {"sellerConfigComponents": {"type": "OptionChooserComponent", "identifier": "finish", "label": "Finish", "options": [
            {"identifier": "plain", "label": "Plain", "additionalCost": {"amount": 0}},
            {"identifier": "gold", "label": "Gold", "additionalCost": {"amount": 5}},
        ]}}
        cached_variant = source_variant("B012345678", "Ocean", "Twin", {"pricingGroups": [], "fingerprint": "legacy"})
        cached_variant["customizationRaw"] = raw
        cached_variant["description"] = "Description from the child ASIN"
        cached_variant["bulletPoints"] = ["Child bullet"]
        family = {
            "parentAsin": "B012345678", "canonicalUrl": "https://www.amazon.com/dp/B012345678", "sourceTitle": "Cached",
            "description": None, "bulletPoints": [], "media": [],
            "sourceVariants": [cached_variant],
            "variantMatrix": {"dimensions": {"Design": ["Ocean"], "Size": ["Twin"]}, "expectedCount": 1, "discoveredCount": 1, "complete": True, "safetyCap": 500},
            "diagnostics": {"fetchMode": "cache", "attempts": 0, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": True},
        }
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML))
            product = crawler._products_from_family(family)[0]
        self.assertEqual(product["customization"]["pricing"]["paidOptionGroups"][0]["id"], "finish")
        self.assertEqual(len(product["variants"]), 2)
        self.assertEqual(product["description"], "Description from the child ASIN")
        self.assertEqual(product["bulletPoints"], ["Child bullet"])
        self.assertEqual(product["sourceVariants"][0]["customizationFingerprint"], product["customization"]["fingerprint"])
        self.assertNotIn("customizationRaw", product)
        self.assertNotIn("customizationRaw", product["sourceVariants"][0])
        self.assertNotIn("customization", product["sourceVariants"][0])
        self.assertNotIn("customizationComplete", product["sourceVariants"][0])
        self.assertNotIn("diagnostics", product["sourceVariants"][0])

    def test_source_variant_keeps_structured_fetch_trace_for_debugging(self) -> None:
        variant = source_variant("B012345678", "Ocean", "Twin")
        variant["diagnostics"] = {
            "fetchMode": "failed",
            "attempts": 2,
            "captchaEncountered": True,
            "locationFallbackUsed": False,
            "matrixSwept": False,
            "cacheHit": False,
            "fetchTrace": {
                "http": [{"profile": "proxy-1", "outcome": "captcha"}],
                "playwright": [{"profile": "proxy-2", "outcome": "error"}],
            },
        }
        family = {
            "parentAsin": "B012345678", "canonicalUrl": "https://www.amazon.com/dp/B012345678", "sourceTitle": "Debug",
            "description": None, "bulletPoints": [], "categories": [], "productDetails": {}, "media": [],
            "sourceVariants": [variant],
            "variantMatrix": {"dimensions": {"Design": ["Ocean"], "Size": ["Twin"]}, "expectedCount": 1, "discoveredCount": 1, "complete": True, "safetyCap": 500},
            "diagnostics": {"fetchMode": "http", "attempts": 1, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
        }
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML))
            product = crawler._products_from_family(family)[0]

        self.assertEqual(product["sourceVariants"][0]["diagnostics"]["fetchTrace"]["http"][0]["outcome"], "captcha")

    def test_jeminise_preset_is_exactly_47_variants(self) -> None:
        variants = build_jeminise_variants("B012345678")
        self.assertEqual(len(variants), 47)
        self.assertEqual(len({variant["sku"] for variant in variants}), 47)

    def test_versioned_cache_invalidates_incomplete_matrix(self) -> None:
        family = {"variantMatrix": {"complete": False}, "customizationChecked": True}
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save("B012345678", family)
            self.assertIsNone(cache.load("B012345678"))
            raw = json.loads(next(Path(directory).glob("*.json")).read_text(encoding="utf-8"))
            self.assertEqual(raw["schemaVersion"], CACHE_SCHEMA_VERSION)

    def test_cache_invalidates_media_from_pre_hires_schema(self) -> None:
        family = {
            "variantMatrix": {"complete": True},
            "customizationChecked": True,
            "media": [{"url": "https://m.media-amazon.com/video.mp4", "kind": "video"}],
        }
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save("B012345678", family)
            cache_path = next(Path(directory).glob("*.json"))
            raw = json.loads(cache_path.read_text(encoding="utf-8"))
            raw["schemaVersion"] = 6
            cache_path.write_text(json.dumps(raw), encoding="utf-8")

            self.assertIsNone(cache.load("B012345678", require_customization=True))

    def test_cache_clear_removes_only_family_cache_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_directory = Path(directory)
            cache = RawFamilyCache(cache_directory)
            cache.save("B012345678", {"variantMatrix": {"complete": True}})
            unrelated = cache_directory / "keep.txt"
            unrelated.write_text("keep", encoding="utf-8")
            result = cache.clear()
            self.assertEqual(result["removedFiles"], 1)
            self.assertGreater(result["removedBytes"], 0)
            self.assertTrue(unrelated.is_file())
            self.assertEqual(list(cache_directory.glob("family-*.json")), [])

    def test_price_inference_requires_one_consensus_price(self) -> None:
        priced = source_variant("B012345678", "Ocean", "Twin")
        missing = source_variant("B012345679", "Ocean", "Twin")
        missing["price"] = None
        AmazonCrawler._infer_consensus_prices([priced, missing])
        self.assertEqual(missing["price"]["amount"], 20.0)
        self.assertTrue(missing["priceInference"]["isInferred"])
        self.assertEqual(missing["priceInference"]["sourceAsins"], ["B012345678"])

    def test_malformed_customization_warns_without_dropping_product(self) -> None:
        normalized, warnings = normalize_customization("not-json")
        self.assertIsNone(normalized)
        self.assertTrue(warnings)
        self.assertIsNone(remove_option_choosers(None))

    def test_partial_batch_isolates_invalid_input_and_writes_atomic_export(self) -> None:
        family = {
            "parentAsin": "B012345678", "canonicalUrl": "https://www.amazon.com/dp/B012345678", "sourceTitle": "Bedding",
            "description": None, "bulletPoints": [], "media": [],
            "sourceVariants": [
                source_variant("B012345678", "Ocean", "Twin"),
                source_variant("B012345679", "Forest", "Twin"),
            ],
            "variantMatrix": {"dimensions": {"Design": ["Ocean", "Forest"], "Size": ["Twin"]}, "expectedCount": 2, "discoveredCount": 2, "complete": True, "safetyCap": 500},
            "diagnostics": {"fetchMode": "http", "attempts": 1, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crawler = FixtureCrawler(family, root=root, settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML))
            output = crawler.run(job_id="test-job", sources=["https://etsy.com/listing/1", "B012345678"])
            export_path = root / "exports" / output["exportFilename"]
            self.assertTrue(export_path.is_file())
            exported = json.loads(export_path.read_text(encoding="utf-8"))
            self.assertEqual(exported["jobId"], "test-job")
            self.assertEqual(list((root / "exports").glob("*.tmp")), [])
        self.assertEqual(output["status"], "partial")
        self.assertEqual(output["statistics"]["rejectedInputs"], 1)
        self.assertEqual(len(output["products"]), 2)

    def test_cancelled_batch_does_not_write_export(self) -> None:
        cancel_event = threading.Event()
        cancel_event.set()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crawler = FixtureCrawler({}, root=root, settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML), cancel_event=cancel_event)
            output = crawler.run(job_id="cancelled-job", sources=["B012345678"])
            self.assertIsNone(output["exportFilename"])
            self.assertFalse((root / "exports").exists())
        self.assertEqual(output["status"], "cancelled")

    def test_distributed_mode_reports_each_input_without_writing_export(self) -> None:
        family = {
            "parentAsin": "B012345678", "canonicalUrl": "https://www.amazon.com/dp/B012345678", "sourceTitle": "Bedding",
            "description": None, "bulletPoints": [], "media": [],
            "sourceVariants": [source_variant("B012345678", "Ocean", "Twin")],
            "variantMatrix": {"dimensions": {"Design": ["Ocean"], "Size": ["Twin"]}, "expectedCount": 1, "discoveredCount": 1, "complete": True, "safetyCap": 500},
            "diagnostics": {"fetchMode": "http", "attempts": 1, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
        }
        callbacks: list[dict[str, object]] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crawler = FixtureCrawler(family, root=root, settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML))

            output = crawler.run(
                job_id="distributed-job",
                sources=["B012345678"],
                on_input_complete=callbacks.append,
                write_export=False,
            )

            self.assertFalse((root / "exports").exists())
        self.assertIsNone(output["exportFilename"])
        self.assertEqual(len(callbacks), 1)
        self.assertEqual(callbacks[0]["asin"], "B012345678")
        self.assertEqual(callbacks[0]["status"], "completed")
        self.assertEqual(len(callbacks[0]["products"]), 1)

    def test_product_callback_is_forwarded_before_input_completion(self) -> None:
        family = {
            "parentAsin": "B012345678", "canonicalUrl": "https://www.amazon.com/dp/B012345678", "sourceTitle": "Bedding",
            "description": None, "bulletPoints": [], "categories": [], "productDetails": {}, "media": [],
            "sourceVariants": [source_variant("B012345678", "Ocean", "Twin")],
            "variantMatrix": {"dimensions": {"Design": ["Ocean"], "Size": ["Twin"]}, "expectedCount": 1, "discoveredCount": 1, "complete": True, "safetyCap": 500},
            "diagnostics": {"fetchMode": "http", "attempts": 1, "captchaEncountered": False, "locationFallbackUsed": False, "matrixSwept": False, "cacheHit": False},
        }

        class StreamingFixtureCrawler(FixtureCrawler):
            def _crawl_family(self, normalized, on_product_complete=None):
                crawled = super()._crawl_family(normalized)
                if on_product_complete is not None:
                    on_product_complete(
                        self._products_from_family(
                            crawled,
                            split_attribute_override="Design",
                        )[0]
                    )
                return crawled

        callback_order: list[str] = []
        with tempfile.TemporaryDirectory() as directory:
            crawler = StreamingFixtureCrawler(
                family,
                root=Path(directory),
                settings=CrawlSettings(),
                browser_pool=FakeBrowser(PRODUCT_HTML),
            )
            crawler.run(
                job_id="streaming-job",
                sources=["B012345678"],
                on_product_complete=lambda payload: callback_order.append(f"product:{payload['product']['sourceKey']}"),
                on_input_complete=lambda _payload: callback_order.append("input"),
                write_export=False,
            )

        self.assertEqual(callback_order[0], "product:amazon:B012345678:design:ocean")
        self.assertEqual(callback_order[-1], "input")

    def test_split_group_is_emitted_while_a_different_group_is_still_crawling(self) -> None:
        ocean_emitted = threading.Event()
        forest_finished_before_ocean = False

        class ConcurrentGroupCrawler(AmazonCrawler):
            def _fetch_parsed(self, normalized: NormalizedInput) -> tuple[dict, dict]:
                nonlocal forest_finished_before_ocean
                options_by_asin = {
                    "B012345678": {"Design": "Ocean", "Size": "Twin"},
                    "B012345679": {"Design": "Forest", "Size": "Twin"},
                }
                if normalized.asin == "B012345679":
                    forest_finished_before_ocean = not ocean_emitted.wait(timeout=1)
                parsed = {
                    "asin": normalized.asin,
                    "parentAsin": "B0PARENT00",
                    "url": normalized.canonical_url,
                    "title": "Bedding",
                    "description": None,
                    "bulletPoints": [],
                    "categories": [],
                    "productDetails": {},
                    "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"},
                    "media": [],
                    "dimensions": {"Design": ["Ocean", "Forest"], "Size": ["Twin"]},
                    "asinOptions": options_by_asin,
                    "customizationRaw": None,
                    "customizationWarnings": [],
                    "customizationFormUrl": None,
                }
                diagnostics = {
                    "fetchMode": "http", "attempts": 1, "captchaEncountered": False,
                    "locationFallbackUsed": False, "amazonZip": "10001", "usProfileApplied": True,
                    "matrixSwept": False, "cacheHit": False,
                }
                return parsed, diagnostics

        emitted: list[str] = []
        with tempfile.TemporaryDirectory() as directory:
            crawler = ConcurrentGroupCrawler(
                root=Path(directory),
                settings=CrawlSettings(variant_threads=2),
                browser_pool=FakeBrowser(PRODUCT_HTML),
            )

            def product_completed(product: dict[str, object]) -> None:
                emitted.append(str(product["sourceKey"]))
                if str(product["sourceKey"]).endswith(":ocean"):
                    ocean_emitted.set()

            crawler._crawl_family(
                normalize_amazon_input("B012345678"),
                on_product_complete=product_completed,
            )

        self.assertIn("amazon:B0PARENT00:design:ocean", emitted)
        self.assertFalse(forest_finished_before_ocean)

    def test_incomplete_or_priceless_product_is_blocked_from_live_publish(self) -> None:
        product = {
            "variantMatrix": {"complete": False},
            "sourceVariants": [{"price": None, "warnings": []}],
        }
        self.assertEqual(
            AmazonCrawler._product_publish_blockers(product),
            ["variant_matrix_incomplete", "price_missing"],
        )


if __name__ == "__main__":
    unittest.main()
