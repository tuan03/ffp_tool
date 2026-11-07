import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from engine.crawler_core import AmazonCrawler, CrawlSettings
from engine.distributed.retry_taxonomy import classify_task_error
from engine.playwright_pool import PlaywrightPool
from engine.retry_policy import FetchFailure, captcha_skip_failure, html_is_captcha, response_failure
from engine.tests.test_core import ParentFamilyCrawler, FakeBrowser, PRODUCT_HTML
from engine.tests.test_retry_policy import ErrorBrowser, StatusFetcher


MISSING = '''<html><body><!-- Contact api-services-support@amazon.com -->
<img src="/images/G/01/error/en_US/title._TTD_.png" alt="Sorry! We couldn't find that page.">
</body></html>'''
CHALLENGE = '''<html><body><h4>Click the button below to continue shopping</h4>
<form action="/errors_page/validateCaptcha"><button>Continue shopping</button></form></body></html>'''


class CaptchaSkipTests(unittest.TestCase):
    def test_blocked_child_keeps_successful_sibling_without_retrying_family(self):
        class BlockedChildCrawler(ParentFamilyCrawler):
            def _fetch_parsed(self, normalized, *, require_price=True):
                if normalized.asin == "B012345679":
                    raise captcha_skip_failure()
                return super()._fetch_parsed(normalized, require_price=require_price)
        with tempfile.TemporaryDirectory() as directory:
            crawler = BlockedChildCrawler(root=Path(directory), settings=CrawlSettings(variant_threads=1), browser_pool=FakeBrowser(PRODUCT_HTML))
            result = crawler.run(job_id="blocked-child", sources=["B012345678"], write_export=False)
            self.assertEqual(result["completedAsins"], ["B012345678"])
            self.assertEqual(result["errors"][0]["reason"], "captcha_skipped")
            self.assertFalse(result["errors"][0]["retryable"])
            self.assertEqual(result["errors"][0]["nonRetryableAsins"], ["B012345679"])
            for product in result["products"]:
                self.assertNotIn("B012345679", product["splitContext"]["sourceAsins"])

    def test_missing_page_with_support_comment_is_not_captcha(self):
        self.assertFalse(html_is_captcha(MISSING))
        failure = response_failure(404, MISSING)
        self.assertEqual(failure.reason, "not_found")
        self.assertTrue(failure.confirmed)
        self.assertFalse(failure.retryable)
        self.assertTrue(response_failure(404, "Generic proxy 404").retryable)
        self.assertEqual(response_failure(404, CHALLENGE).reason, "captcha")

    def test_missing_page_does_not_open_browser(self):
        with tempfile.TemporaryDirectory() as directory:
            browser = ErrorBrowser(AssertionError("Must not render confirmed 404"))
            fetcher = StatusFetcher(404, proxy=True, body=MISSING)
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=fetcher, browser_pool=browser)
            result = crawler.run(job_id="missing", sources=["B012345678"], write_export=False)
            self.assertEqual(result["errors"][0]["reason"], "not_found")
            self.assertEqual(browser.calls, 0)
            self.assertEqual(fetcher.calls, ["direct"])

    def test_captcha_skips_input_without_browser_retry_and_can_be_checked_again(self):
        with tempfile.TemporaryDirectory() as directory:
            browser = ErrorBrowser(AssertionError("Must not wait for CAPTCHA"))
            fetcher = StatusFetcher(404, proxy=True, body=CHALLENGE)
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=fetcher, browser_pool=browser)
            result = crawler.run(job_id="captcha", sources=["B012345678"], write_export=False)
            error = result["errors"][0]
            self.assertEqual(error["reason"], "captcha_skipped")
            self.assertFalse(error["retryable"])
            self.assertEqual(classify_task_error(error)["errorCode"], "CAPTCHA_SKIPPED")
            self.assertEqual(browser.calls, 0)
            self.assertEqual(fetcher.calls, ["direct"])
            self.assertIsNone(crawler.cache.load_failure("B012345678:90001:us-v1"))

    def test_browser_captcha_does_not_open_manual_wait_or_click_challenge(self):
        pool = object.__new__(PlaywrightPool)
        pool.captcha_timeout = 180
        pool.source_platform = "amazon"
        pool.on_captcha = Mock()
        page = AsyncMock()
        with self.assertRaises(FetchFailure) as caught:
            asyncio.run(pool._solve_captcha(page, "https://www.amazon.com/dp/B012345678", None,
                html=CHALLENGE, allow_manual=True))
        self.assertEqual(caught.exception.reason, "captcha_skipped")
        page.click.assert_not_awaited()
        page.bring_to_front.assert_not_awaited()
        pool.on_captcha.assert_not_called()
