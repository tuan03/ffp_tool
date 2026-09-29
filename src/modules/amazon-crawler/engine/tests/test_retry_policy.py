from __future__ import annotations

import io
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import AsyncMock, patch

from engine.cache import RawFamilyCache
from engine.crawler_core import AmazonCrawler, CrawlSettings, HttpFetcher, classify_crawl_failure
from engine.playwright_pool import PlaywrightPool
from engine.proxy_profiles import ProxyAssignment
from engine.retry_policy import FetchFailure, retry_delay, response_failure
from engine.tests.test_core import FakeBrowser, ParentFamilyCrawler, PRODUCT_HTML, StaticFetcher


class StatusFetcher(HttpFetcher):
    def __init__(self, status: int, *, proxy: bool = False, body: str = "", retry_after: str = "120") -> None:
        assignments = [ProxyAssignment(index=0, name="direct")]
        if proxy:
            assignments.append(ProxyAssignment(index=1, name="proxy", server="http://proxy.test:80"))
        super().__init__(assignments=assignments)
        self.status = status
        self.body = body
        self.retry_after = retry_after
        self.calls: list[str] = []
        self.delays: list[float] = []

    def _bootstrap_us_cookie(self, assignment):
        self._us_profile_applied[assignment.index] = True
        return "i18n-prefs=USD"

    def _opener(self, assignment, cookie_jar=None):
        owner = self
        class Opener:
            def open(self, request, timeout):
                owner.calls.append(assignment.name)
                if assignment.is_enabled:
                    from engine.tests.test_core import FakeHttpResponse
                    return FakeHttpResponse(PRODUCT_HTML + " " * 5000)
                raise urllib.error.HTTPError(request.full_url, owner.status, "simulated",
                    {"Retry-After": owner.retry_after}, io.BytesIO(owner.body.encode()))
        return Opener()

    def _wait_before_retry(self, seconds):
        self.delays.append(seconds)


class ErrorBrowser(FakeBrowser):
    profiles = 2
    def __init__(self, error: Exception):
        super().__init__("")
        self.error = error
        self.calls = 0
    def fetch(self, url, **kwargs):
        self.calls += 1
        raise self.error


class RetryPolicyTests(unittest.TestCase):
    def test_backoff_grows_with_jitter_and_respects_server_minimum(self):
        with patch("engine.retry_policy.random.uniform", return_value=1):
            self.assertEqual(retry_delay(1, base=2), 3)
            self.assertEqual(retry_delay(2, base=2), 5)
            self.assertEqual(retry_delay(3, base=2, retry_after=120), 121)

    def test_retry_after_http_date_and_invalid_header(self):
        from datetime import datetime, timezone
        with patch("engine.retry_policy.datetime") as clock:
            clock.now.return_value = datetime(2026, 9, 28, tzinfo=timezone.utc)
            self.assertEqual(response_failure(429, "", {"Retry-After": "Mon, 28 Sep 2026 00:02:00 GMT"}).delay, 120)
        for header in ("bad", "inf", "NaN", "1e300"):
            self.assertEqual(response_failure(503, "", {"Retry-After": header}).delay, 30)

    def test_http_rate_limit_rotates_route_after_server_delay(self):
        for status in (429, 503):
            with self.subTest(status=status):
                fetcher = StatusFetcher(status, proxy=True)
                html, _ = fetcher.fetch("https://www.amazon.com/dp/B012345678")
                self.assertIn("productTitle", html)
                self.assertEqual(fetcher.calls, ["direct", "proxy"])
                self.assertGreaterEqual(fetcher.delays[0], 120)
                self.assertIn(0, fetcher._blocked_until)
                self.assertEqual(fetcher.last_diagnostics()[0]["httpStatus"], status)

    def test_rate_limited_only_route_is_not_reused_or_immediately_rendered(self):
        with tempfile.TemporaryDirectory() as directory:
            fetcher = StatusFetcher(429)
            browser = ErrorBrowser(ConnectionError("must not render"))
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=fetcher, browser_pool=browser)
            output = crawler.run(job_id="rate-limit", sources=["B012345678"], write_export=False)
            self.assertEqual(fetcher.calls, ["direct"])
            self.assertEqual(browser.calls, 0)
            self.assertEqual(output["errors"][0]["reason"], "http_429")

    def test_http_session_bootstrap_preserves_rate_limit_and_captcha(self):
        fixture = StatusFetcher(429)
        fetcher = HttpFetcher()
        fetcher._opener = fixture._opener
        with self.assertRaises(FetchFailure) as caught:
            fetcher.fetch("https://www.amazon.com/dp/B012345678")
        self.assertEqual(caught.exception.reason, "http_429")
        self.assertEqual(len(fixture.calls), 1)
        from engine.tests.test_core import FakeHttpResponse
        class CaptchaOpener:
            def open(self, request, timeout):
                return FakeHttpResponse('<form action="/errors/validateCaptcha">')
        fetcher = HttpFetcher()
        fetcher._opener = lambda *args: CaptchaOpener()
        with self.assertRaises(FetchFailure) as caught:
            fetcher.fetch("https://www.amazon.com/dp/B012345678")
        self.assertEqual(caught.exception.reason, "captcha")

    def test_http_error_captcha_body_takes_precedence_over_503(self):
        fetcher = StatusFetcher(503, body='<form action="/errors/validateCaptcha">')
        with self.assertRaises(Exception) as caught:
            fetcher.fetch("https://www.amazon.com/dp/B012345678")
        self.assertEqual(classify_crawl_failure(caught.exception)["reason"], "captcha")
        self.assertEqual(fetcher.calls, ["direct"])

    def test_partial_child503_preserves_rate_limit_reason(self):
        class Child503(ParentFamilyCrawler):
            def _fetch_parsed(self, normalized, *, require_price=True):
                if normalized.asin == "B012345679":
                    raise response_failure(503, "", {})
                return super()._fetch_parsed(normalized, require_price=require_price)
        with tempfile.TemporaryDirectory() as directory:
            crawler = Child503(root=Path(directory), settings=CrawlSettings(variant_threads=1), browser_pool=FakeBrowser(PRODUCT_HTML))
            output = crawler.run(job_id="partial-503", sources=["B012345678"], write_export=False)
            self.assertEqual(output["errors"][0]["reason"], "http_503")
            self.assertEqual(output["completedAsins"], ["B012345678"])

    def test_another_asin_does_not_bypass_http_route_cooldown(self):
        fetcher = StatusFetcher(429)
        for asin in ("B012345678", "B012345679"):
            with self.assertRaises(FetchFailure) as caught:
                fetcher.fetch(f"https://www.amazon.com/dp/{asin}")
            self.assertEqual(caught.exception.reason, "http_429")
        self.assertEqual(fetcher.calls, ["direct"])

    def test_coordinator_client_rate_cooldown_survives_new_worker_and_allows_other_client(self):
        from datetime import timedelta
        from engine.tests.test_distributed import CoordinatorStoreTests, client_hello
        from engine.distributed.coordinator_store import CoordinatorStore
        from engine.distributed.protocol import utc_now
        fixture = CoordinatorStoreTests()
        fixture.setUp()
        try:
            fixture.store.create_job({"urls": ["B012345678", "B012345679"]})
            fixture.store.register_client(client_hello("client-a", slots=1))
            fixture.store.register_client(client_hello("client-b", slots=1))
            first = fixture.store.lease_tasks("client-a", 1)[0]
            fixture.store.fail_task("client-a", {"taskId": first["taskId"], "leaseId": first["leaseId"],
                "error": {"status": "network_error", "reason": "http_429", "retryable": True,
                          "retryAfter": (utc_now() + timedelta(seconds=120)).isoformat()}})
            restarted = CoordinatorStore(fixture.sessions)
            self.assertEqual(restarted.lease_tasks("client-a", 1), [])
            self.assertEqual(restarted.lease_tasks("client-b", 1)[0]["asin"], "B012345679")
        finally:
            fixture.tearDown()

    def test_unverified_http404_with_browser_network_error_does_not_cache_not_found(self):
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=StatusFetcher(404),
                browser_pool=ErrorBrowser(ConnectionError("browser connection reset")))
            output = crawler.run(job_id="404-unverified", sources=["B012345678"], write_export=False)
            self.assertEqual(output["errors"][0]["status"], "network_error")
            self.assertTrue(output["errors"][0]["retryable"])
            self.assertEqual(crawler.cache.load_failure("B012345678:90001:us-v1")["status"], "network_error")

    def test_confirmed_browser404_is_negative_cached_without_repeated_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            browser = ErrorBrowser(response_failure(404, "Looking for something? Sorry! We couldn't find that page.", {}, verified=True))
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(), fetcher=StatusFetcher(404), browser_pool=browser)
            first = crawler.run(job_id="404-confirmed", sources=["B012345678"], write_export=False)
            crawler.run(job_id="404-cached", sources=["B012345678"], write_export=False)
            self.assertEqual(first["errors"][0]["status"], "not_found")
            self.assertFalse(first["errors"][0]["retryable"])
            self.assertEqual(browser.calls, 1)

    def test_child_captcha_remains_visible_to_coordinator_cooldown(self):
        from engine.tests.test_distributed import CoordinatorStoreTests, client_hello
        class ChildCaptcha(ParentFamilyCrawler):
            def _fetch_parsed(self, normalized, *, require_price=True):
                if normalized.asin == "B012345679":
                    raise RuntimeError("Amazon CAPTCHA detected")
                return super()._fetch_parsed(normalized, require_price=require_price)
        with tempfile.TemporaryDirectory() as directory:
            crawler = ChildCaptcha(root=Path(directory), settings=CrawlSettings(variant_threads=1), browser_pool=FakeBrowser(PRODUCT_HTML))
            output = crawler.run(job_id="child-captcha", sources=["B012345678"], write_export=False)
            self.assertEqual(output["errors"][0]["reason"], "captcha")
            fixture = CoordinatorStoreTests()
            fixture.setUp()
            try:
                fixture.store.create_job({"urls": ["B012345678", "B012345680"]})
                fixture.store.register_client(client_hello(slots=1))
                lease = fixture.store.lease_tasks("client-a", 1)[0]
                fixture.store.fail_task("client-a", {"taskId": lease["taskId"], "leaseId": lease["leaseId"], "error": output["errors"][0]})
                self.assertEqual(fixture.store.lease_tasks("client-a", 1), [])
            finally:
                fixture.tearDown()

    def test_cache_corrupt_json_is_quarantined(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            path = cache._path("B012345678")
            path.write_text("{broken", encoding="utf-8")
            self.assertIsNone(cache.load("B012345678"))
            self.assertFalse(path.exists())
            self.assertEqual(len(list(Path(directory).glob("quarantine/*.corrupt"))), 1)

    def test_invalidation_clears_only_matching_quarantined_asin(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            for asin in ("B012345678", "B012345679"):
                cache._path(asin).write_text("{broken", encoding="utf-8")
                cache.load(asin)
            cache.invalidate("B012345678")
            self.assertEqual(len(list(cache.directory.glob("quarantine/*.corrupt"))), 1)
            cache.clear()
            self.assertEqual(len(list(cache.directory.glob("quarantine/*.corrupt"))), 0)

    def test_cache_invalid_shape_is_quarantined_and_crawler_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime/cache")
            cache.save("B012345678:90001:us-v1", {"variantMatrix": {"complete": True}, "customizationChecked": True, "sourceVariants": []})
            crawler = ParentFamilyCrawler(root=root, settings=CrawlSettings(variant_threads=1), browser_pool=FakeBrowser(PRODUCT_HTML))
            output = crawler.run(job_id="repair-cache", sources=["B012345678"], write_export=False)
            self.assertEqual(output["status"], "completed")
            self.assertFalse(output["errors"])
            self.assertEqual(len(list(cache.directory.glob("quarantine/*.corrupt"))), 1)

    def test_corrupt_partial_and_negative_records_are_quarantined(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            for kind, payload, load in (("partial", {"partial": {"family": []}, "expiresAt": "bad"}, cache.load_partial),
                                       ("failure", {"failure": {"status": "not_found", "retryAfter": "bad"}}, cache.load_failure)):
                cache._write("B012345678", kind, payload)
                self.assertIsNone(load("B012345678"))
                self.assertFalse(cache._path("B012345678", kind).exists())
            self.assertEqual(len(list(cache.directory.glob("quarantine/*.corrupt"))), 2)


    def test_legacy_unverified_not_found_cache_is_discarded(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save_failure("B012345678", status="not_found", reason="not_found", retry_after_seconds=86400)
            self.assertIsNone(cache.load_failure("B012345678"))

    def test_coordinator_backoff_grows_without_resetting_failure_limit(self):
        from datetime import timedelta
        from engine.tests.test_distributed import CoordinatorStoreTests, client_hello
        from engine.distributed.protocol import utc_now
        fixture = CoordinatorStoreTests()
        fixture.setUp()
        try:
            with patch("engine.retry_policy.random.uniform", return_value=0):
                fixture.store.create_job({"urls": ["B012345678"]})
                fixture.store.register_client(client_hello(slots=1))
                first = fixture.store.lease_tasks("client-a", 1)[0]
                now = utc_now()
                with patch("engine.distributed.coordinator_store.utc_now", return_value=now):
                    fixture.store.fail_task("client-a", {"taskId": first["taskId"], "leaseId": first["leaseId"], "error": {"status": "network_error", "retryable": True}})
                    self.assertEqual(fixture.store.lease_tasks("client-a", 1), [])
                with patch("engine.distributed.coordinator_store.utc_now", return_value=now + timedelta(seconds=31)):
                    second = fixture.store.lease_tasks("client-a", 1)[0]
                    response = fixture.store.fail_task("client-a", {"taskId": second["taskId"], "leaseId": second["leaseId"], "error": {"status": "network_error", "retryable": True}})
                    self.assertEqual(response["failureCount"], 2)
                with patch("engine.distributed.coordinator_store.utc_now", return_value=now + timedelta(seconds=90)):
                    self.assertEqual(fixture.store.lease_tasks("client-a", 1), [])
                with patch("engine.distributed.coordinator_store.utc_now", return_value=now + timedelta(seconds=92)):
                    self.assertEqual(len(fixture.store.lease_tasks("client-a", 1)), 1)
        finally:
            fixture.tearDown()


class BrowserClassificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_browser_zip_bootstrap_preserves_rate_limit(self):
        from engine.tests.test_playwright_pool import FakeContext, ReadyPage
        class Page(ReadyPage):
            async def goto(self, *args, **kwargs):
                class Response:
                    status = 503
                    headers = {"Retry-After": "120"}
                return Response()
            async def content(self): return "Service unavailable"
        with tempfile.TemporaryDirectory() as directory:
            pool = PlaywrightPool(profile_root=Path(directory), profiles=1, tabs_per_profile=1, headless=True, captcha_timeout=30, zip_code="90001")
            with self.assertRaises(FetchFailure) as caught:
                await pool._set_amazon_zip(FakeContext(Page()))
            self.assertEqual(caught.exception.reason, "http_503")
            self.assertEqual(caught.exception.delay, 120)

    async def test_challenge_is_detected_before_product_selector(self):
        class Page:
            async def goto(self, *args, **kwargs): return None
            async def content(self): return '<form action="/errors/validateCaptcha">'
            async def wait_for_selector(self, *args, **kwargs): raise AssertionError("must detect challenge first")
        html = await PlaywrightPool._load_product_page(Page(), "https://www.amazon.com/dp/B012345678")
        self.assertIn("validateCaptcha", html)

    async def test_missing_product_selector_on_rendered_document_is_parser_failure(self):
        class Page:
            async def goto(self, *args, **kwargs): return None
            async def content(self): return '<html><body>Product markup changed</body></html>'
            async def wait_for_selector(self, *args, **kwargs): raise TimeoutError("selector missing")
        with self.assertRaises(FetchFailure) as caught:
            await PlaywrightPool._load_product_page(Page(), "https://www.amazon.com/dp/B012345678")
        self.assertEqual(classify_crawl_failure(caught.exception)["status"], "parser_error")
        self.assertFalse(caught.exception.retryable)

    async def test_browser_http404_with_product_html_is_accepted(self):
        from engine.tests.test_playwright_pool import ReadyPage
        class Page(ReadyPage):
            async def goto(self, *args, **kwargs):
                class Response:
                    status = 404
                    headers = {}
                return Response()
        html = await PlaywrightPool._load_product_page(Page(), "https://www.amazon.com/dp/B012345678")
        self.assertIn("productTitle", html)

    async def test_browser_rate_limit_respects_retry_after_before_rotating(self):
        with tempfile.TemporaryDirectory() as directory:
            pool = PlaywrightPool(profile_root=Path(directory), profiles=1, tabs_per_profile=1,
                headless=True, captcha_timeout=30, zip_code="90001", proxy_assignments=[ProxyAssignment(index=1, name="proxy", server="http://proxy.test:80")])
            calls = []
            async def fetch_once(url, cancel_event, **kwargs):
                calls.append(kwargs["route"])
                if kwargs["route"] == "direct":
                    error = response_failure(429, "", {"Retry-After": "120"})
                    error.browser_profile_index = 0
                    raise error
                return PRODUCT_HTML, pool.profiles
            pool._fetch_once = fetch_once
            with patch("engine.playwright_pool.asyncio.sleep", new_callable=AsyncMock) as sleep:
                html, _ = await pool._fetch_with_retries("https://www.amazon.com/dp/B012345678", None)
            self.assertIn("productTitle", html)
            self.assertEqual(calls, ["direct", "proxy"])
            self.assertGreaterEqual(sleep.call_args.args[0], 120)
