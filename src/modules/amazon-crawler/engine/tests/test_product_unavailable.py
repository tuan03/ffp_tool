import tempfile
import unittest
from pathlib import Path

from engine.crawler_core import AmazonCrawler, CrawlSettings, classify_crawl_failure, normalize_amazon_input, parse_product_html
from engine.distributed.retry_taxonomy import classify_task_error
from engine.retry_policy import FetchFailure, response_failure
from engine.amazon_locale import html_is_location_blocked
from engine.distributed.client_agent import refresh_requested_family_caches
from engine.cache import RawFamilyCache


def product_html(asin="B012345678", *, availability="Currently unavailable.", price="", extra=""):
    return f'''<html><body><input id="ASIN" value="{asin}">
    <h1 id="productTitle">Personalized handbag</h1>
    <div id="availability">{availability}</div>
    <div id="corePrice_feature_div">{price}</div>
    <img id="landingImage" src="https://m.media-amazon.com/images/I/sample.jpg">
    {extra}</body></html>'''


class PageFetcher:
    def __init__(self, html):
        self.html = html
        self.calls = 0

    def fetch(self, url):
        self.calls += 1
        return self.html, 1


class PageBrowser:
    profiles = 2

    def __init__(self, html):
        self.html = html
        self.calls = 0

    def fetch(self, url, **kwargs):
        self.calls += 1
        return self.html


class ProductUnavailableTests(unittest.TestCase):
    def test_missing_child_preserves_available_sibling_and_confirmation(self):
        matrix = '''<script>var variationDisplayLabels={"color_name":"Color"};
        var variationValues={"color_name":["Red","Blue"]};
        var dimensionValuesDisplayData={"B012345678":["Red"],"B012345679":["Blue"]};</script>'''
        seed = product_html(availability="In Stock", price='<span class="a-offscreen">$19.99</span>', extra=matrix)
        missing_html = '''<img alt="Sorry! We couldn't find that page. Try searching.">'''

        class FamilyFetcher(PageFetcher):
            def fetch(self, url):
                if "B012345679" in url:
                    raise response_failure(404, missing_html)
                return seed, 1

        class MissingBrowser(PageBrowser):
            def fetch(self, url, **kwargs):
                self.calls += 1
                raise response_failure(404, missing_html, verified=True)

        with tempfile.TemporaryDirectory() as directory:
            browser = MissingBrowser(missing_html)
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=FamilyFetcher(seed), browser_pool=browser)
            result = crawler.run(job_id="missing-child", sources=["B012345678"], write_export=False)
            self.assertEqual(len(result["products"]), 1)
            self.assertEqual(result["products"][0]["splitContext"]["sourceAsins"], ["B012345678"])
            self.assertEqual(result["errors"][0]["nonRetryableAsins"], ["B012345679"])
            self.assertTrue(result["errors"][0]["notFoundConfirmed"])
            failure = classify_task_error(result["errors"][0])
            self.assertEqual(failure["errorCode"], "NOT_FOUND")
            self.assertFalse(failure["retryable"])
            self.assertEqual(browser.calls, 0)

    def test_uncertain_price_failure_in_same_family_still_retries(self):
        matrix = '''<script>var variationDisplayLabels={"color_name":"Color"};
        var variationValues={"color_name":["Red","Blue"]};
        var dimensionValuesDisplayData={"B012345678":["Red"],"B012345679":["Blue"]};</script>'''
        seed = product_html(extra=matrix)
        uncertain = product_html("B012345679", availability="")

        class FamilyFetcher(PageFetcher):
            def fetch(self, url):
                return (uncertain if "B012345679" in url else seed), 1

        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=FamilyFetcher(seed), browser_pool=PageBrowser(uncertain))
            result = crawler.run(job_id="mixed-failures", sources=["B012345678"], write_export=False)
            self.assertTrue(result["errors"][0]["retryable"])
            self.assertEqual(result["errors"][0]["retryableAsins"], ["B012345679"])
            self.assertEqual(result["errors"][0]["nonRetryableAsins"], ["B012345678"])

    def test_manual_recheck_clears_only_selected_unavailable_child_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            for asin in ["B012345679", "B012345680"]:
                cache.save_failure(f"{asin}:90001:us-v1", status="product_unavailable", reason="product_unavailable", retry_after_seconds=86400)
            refresh_requested_family_caches(cache,
                [{"asin": "B012345678", "refreshUnavailableAsins": ["B012345679"]}],
                {"refreshFamilyAsins": ["B012345678"], "amazonZip": "90001"})
            self.assertIsNone(cache.load_failure("B012345679:90001:us-v1"))
            self.assertIsNotNone(cache.load_failure("B012345680:90001:us-v1"))

    def test_unavailable_with_no_featured_offers_is_not_a_location_error(self):
        self.assertFalse(html_is_location_blocked(product_html(extra="No featured offers available")))

    def test_expired_unavailable_observation_reloads_page_instead_of_old_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            fetcher = PageFetcher(product_html())
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=fetcher, browser_pool=PageBrowser(product_html()))
            crawler.run(job_id="first", sources=["B012345678"], write_export=False)
            key = "B012345678:90001:us-v1"
            crawler.cache.save_failure(key, status="product_unavailable", reason="product_unavailable", retry_after_seconds=-1)
            fetcher.html = product_html(availability="In Stock", price='<span class="a-offscreen">$19.99</span>')
            result = crawler.run(job_id="second", sources=["B012345678"], write_export=False)
            self.assertEqual(len(result["products"]), 1)
            self.assertEqual(result["errors"], [])
            self.assertEqual(fetcher.calls, 2)

    def test_unavailable_child_keeps_available_sibling_and_does_not_retry_family(self):
        matrix = '''<script>var variationDisplayLabels={"color_name":"Color"};
        var variationValues={"color_name":["Red","Blue"]};
        var dimensionValuesDisplayData={"B012345678":["Red"],"B012345679":["Blue"]};</script>'''
        seed = product_html(extra=matrix)
        available = product_html("B012345679", availability="In Stock", price='<span class="a-offscreen">$19.99</span>')

        class FamilyFetcher(PageFetcher):
            def fetch(self, url):
                self.calls += 1
                return (available if "B012345679" in url else seed), 1

        with tempfile.TemporaryDirectory() as directory:
            fetcher = FamilyFetcher(seed)
            browser = PageBrowser(seed)
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=fetcher, browser_pool=browser)
            result = crawler.run(job_id="family-test", sources=["B012345678"], write_export=False)
            self.assertEqual(len(result["products"]), 1)
            product = result["products"][0]
            self.assertEqual(product["splitContext"]["sourceAsins"], ["B012345679"])
            self.assertEqual(crawler._product_publish_blockers(product), [])
            self.assertFalse(result["errors"][0]["retryable"])
            self.assertEqual(result["errors"][0]["nonRetryableAsins"], ["B012345678"])
            self.assertEqual(fetcher.calls, 2)
            self.assertEqual(browser.calls, 0)

    def test_unavailable_offer_does_not_use_recommendation_prices(self):
        html = product_html(extra='<div id="sims"><span class="priceToPay"><span class="a-offscreen">$29.95</span></span></div>')
        parsed = parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")
        self.assertTrue(parsed["productUnavailable"])
        self.assertIsNone(parsed["price"])

    def test_missing_price_or_unrelated_text_does_not_confirm_unavailable(self):
        for html in [product_html(availability="", extra='<div id="sims">Currently unavailable.</div>'),
                     product_html(availability="Currently unavailable for your location"),
                     product_html(price='<span class="a-offscreen">$19.99</span>'),
                     product_html(extra='<button id="add-to-cart-button">Add to Cart</button>'),
                     product_html(extra='<form action="/errors/validateCaptcha">Robot check</form>')]:
            with self.subTest(html=html):
                self.assertFalse(parse_product_html(html, "B012345678", "https://www.amazon.com/dp/B012345678")["productUnavailable"])

    def test_confirmed_unavailable_does_not_open_browser(self):
        with tempfile.TemporaryDirectory() as directory:
            browser = PageBrowser(product_html())
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=PageFetcher(product_html()), browser_pool=browser)
            with self.assertRaises(FetchFailure) as caught:
                crawler._fetch_parsed(normalize_amazon_input("B012345678"))
            self.assertEqual(classify_crawl_failure(caught.exception)["reason"], "product_unavailable")
            self.assertFalse(classify_crawl_failure(caught.exception)["retryable"])
            self.assertEqual(browser.calls, 0)

    def test_browser_confirmation_does_not_try_another_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            browser = PageBrowser(product_html())
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=PageFetcher(product_html(availability="")), browser_pool=browser)
            with self.assertRaises(FetchFailure):
                crawler._fetch_parsed(normalize_amazon_input("B012345678"))
            self.assertEqual(browser.calls, 1)

    def test_unavailable_seed_is_not_fetched_again_or_sent_to_seo(self):
        with tempfile.TemporaryDirectory() as directory:
            fetcher = PageFetcher(product_html())
            browser = PageBrowser(product_html())
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=fetcher, browser_pool=browser)
            result = crawler.run(job_id="unavailable-test", sources=["B012345678"], write_export=False)
            self.assertEqual(result["products"], [])
            self.assertEqual(result["errors"][0]["reason"], "product_unavailable")
            self.assertFalse(result["errors"][0]["retryable"])
            self.assertEqual(fetcher.calls, 1)
            self.assertEqual(browser.calls, 0)

    def test_coordinator_does_not_retry_unavailable_even_with_stale_retry_hint(self):
        error = classify_task_error({"reason": "product_unavailable", "retryable": True})
        self.assertEqual(error["errorCode"], "PRODUCT_UNAVAILABLE")
        self.assertFalse(error["retryable"])
