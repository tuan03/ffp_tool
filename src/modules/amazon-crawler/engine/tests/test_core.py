from __future__ import annotations

import json
import tempfile
import threading
import unittest
from copy import deepcopy
from pathlib import Path

from engine.cache import CACHE_SCHEMA_VERSION, RawFamilyCache
from engine.crawler_core import AmazonCrawler, CrawlSettings, NormalizedInput, normalize_amazon_input, parse_product_html
from engine.customization_converter import expand_paid_variants, normalize_customization, remove_option_choosers
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


class FakeBrowser:
    def __init__(self, html: str) -> None:
        self.html = html
        self.calls: list[str] = []

    def fetch(self, url: str, *, cancel_event: threading.Event | None = None) -> str:
        self.calls.append(url)
        return self.html

    def close(self) -> None:
        pass


class FailingFetcher:
    def fetch(self, url: str) -> tuple[str, int]:
        raise RuntimeError("Amazon returned CAPTCHA or a location interstitial.")


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


def source_variant(asin: str, design: str, size: str, customization: dict | None = None) -> dict:
    return {
        "asin": asin, "url": f"https://www.amazon.com/dp/{asin}", "options": {"Design": design, "Size": size},
        "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"},
        "media": [], "customizationRaw": None,
        "customization": customization, "customizationFingerprint": customization.get("fingerprint") if customization else None,
        "priceInference": {"isInferred": False, "sourceAsins": []}, "warnings": [],
    }


class CoreTests(unittest.TestCase):
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

    def test_http_failure_uses_playwright_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            browser = FakeBrowser(PRODUCT_HTML)
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=FailingFetcher(), browser_pool=browser)
            parsed, diagnostics = crawler._fetch_parsed(NormalizedInput("B012345678", "B012345678", "https://www.amazon.com/dp/B012345678"))
        self.assertEqual(parsed["asin"], "B012345678")
        self.assertEqual(diagnostics["fetchMode"], "playwright")
        self.assertTrue(diagnostics["captchaEncountered"])

    def test_family_parent_asin_is_not_injected_as_a_child_variant(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = ParentFamilyCrawler(
                root=Path(directory), settings=CrawlSettings(), browser_pool=FakeBrowser(PRODUCT_HTML)
            )
            family = crawler._crawl_family(normalize_amazon_input("B012345678"))
        self.assertEqual(family["parentAsin"], "B0PARENT00")
        self.assertEqual([variant["asin"] for variant in family["sourceVariants"]], ["B012345678", "B012345679"])
        self.assertNotIn("B0PARENT00", [variant["asin"] for variant in family["sourceVariants"]])

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
            "sourceVariants": [source_variant("B012345678", "Ocean", "Twin")],
            "variantMatrix": {"dimensions": {"Design": ["Ocean"], "Size": ["Twin"]}, "expectedCount": 1, "discoveredCount": 1, "complete": True, "safetyCap": 500},
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
        self.assertEqual(len(output["products"]), 1)

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


if __name__ == "__main__":
    unittest.main()
