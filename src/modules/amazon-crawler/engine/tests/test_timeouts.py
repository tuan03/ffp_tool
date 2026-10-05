from __future__ import annotations

import asyncio
import concurrent.futures
import os
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.request
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from engine.crawler_core import CrawlSettings, HttpFetcher, classify_crawl_failure
from engine.playwright_pool import PlaywrightPool
from engine.timeouts import CrawlTimeout, check_deadline, remaining_seconds, timeout_scope, transport_context
from engine.cache import RawFamilyCache
from engine.process_crawler import ProcessCrawler
from engine.distributed.coordinator_models import CrawlTask, create_database_engine, create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.protocol import utc_now
from engine.bounded_http import BoundedHTTPConnection
from engine.tests.test_core import FakeBrowser, ParentFamilyCrawler, PRODUCT_HTML
from engine.tests.coordinator_test_support import create_coordinator_test_schema


class HungCheckpointCrawler:
    """Importable spawn fixture: persists progress, then ignores cooperative cancellation."""
    def __init__(self, *, root, settings, progress, **_kwargs):
        self.root = root
        self.settings = settings
        self.progress = progress
        self.browser_pool = self

    def close(self):
        pass

    def run(self, *, sources, **_kwargs):
        cache = RawFamilyCache(self.root / ".runtime" / "cache")
        cache.append_checkpoint("B012345678:90001:us-v1", "parent_complete", {"parent": {"asin": "B012345678"}, "diagnostics": {}})
        self.progress({"source": sources[0], "items": [{"asin": "B012345678", "status": "running"}]})
        threading.Event().wait()


class HungChildCrawler(HungCheckpointCrawler):
    def run(self, *, sources, **_kwargs):
        self.progress({"source": sources[0], "items": [{"asin": "B012345678", "status": "running", "activeVariants": [{"asin": "B012345679"}]}]})
        threading.Event().wait()


class ConcurrentStreamCrawler(HungCheckpointCrawler):
    def run(self, *, sources, on_input_complete, **_kwargs):
        def send_progress(index):
            self.progress({"source": sources[0], "items": [{"asin": "B012345678", "status": "running"}], "message": str(index) + "x" * 100000})
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(send_progress, range(32)))
        on_input_complete({"asin": "B012345678", "source": sources[0], "status": "completed", "products": [], "errors": []})
        return {"status": "completed", "products": [], "errors": []}


class ExitedWorkerCrawler(HungCheckpointCrawler):
    def run(self, **_kwargs):
        os._exit(17)


class CooperativeCancelCrawler(HungCheckpointCrawler):
    def __init__(self, *, cancel_event, **kwargs):
        super().__init__(**kwargs)
        self.cancel_event = cancel_event

    def run(self, **_kwargs):
        while not self.cancel_event.wait(0.05):
            pass
        raise InterruptedError("cancelled cooperatively")


class HungBatchCrawler(HungCheckpointCrawler):
    def run(self, *, sources, **_kwargs):
        self.progress({"items": [{"asin": "B012345678", "status": "running", "activeVariants": [{"asin": "B012345680"}]},
                                {"asin": "B012345679", "status": "running", "activeVariants": []}]})
        threading.Event().wait()


class HungCustomizationCrawler(HungCheckpointCrawler):
    def run(self, *, sources, **_kwargs):
        with transport_context(sourceAsin="B012345678", childAsin="B012345679", attempt=2, route="proxy", profile="profile-2"):
            with timeout_scope("customization", 0.1):
                threading.Event().wait()


class TimeoutTests(unittest.TestCase):
    def test_nested_stage_cannot_extend_family_deadline(self) -> None:
        clock = [100.0]
        with patch("engine.timeouts.monotonic", side_effect=lambda: clock[0]):
            with timeout_scope("asin", 10):
                clock[0] = 109
                with timeout_scope("customization", 20):
                    self.assertEqual(remaining_seconds(20), 1)
                    clock[0] = 111
                    with self.assertRaises(CrawlTimeout) as caught:
                        check_deadline()
                    self.assertEqual(caught.exception.details["stage"], "asin")
                    self.assertEqual(caught.exception.details["elapsedMs"], 11000)

    def test_timeout_error_has_retry_policy_and_transport_context(self) -> None:
        with patch("engine.timeouts.monotonic", return_value=12):
            error = CrawlTimeout("http_response", started=10, attempt=2, route="proxy", profile="profile-2")
        self.assertEqual(error.details["elapsedMs"], 2000)
        self.assertEqual(error.details["attempt"], 2)
        self.assertEqual(error.details["route"], "proxy")
        self.assertEqual(error.details["profile"], "profile-2")
        self.assertTrue(error.details["isRetryable"])
        self.assertIsNotNone(error.details["retryAfter"])
        self.assertEqual(classify_crawl_failure(error)["reason"], "timeout")

    def test_http_response_deadline_releases_waiter_even_if_reader_is_stuck(self) -> None:
        release = threading.Event()
        class StuckOpener:
            def open(self, *_args: object, **_kwargs: object) -> object:
                release.wait()
                raise ConnectionError("test reader released")
        try:
            with self.assertRaises(CrawlTimeout) as caught:
                HttpFetcher()._read_response(StuckOpener(), urllib.request.Request("http://localhost/"), timeout=0.03)
            self.assertEqual(caught.exception.details["stage"], "http_response")
        finally:
            release.set()

    def test_dns_has_a_separate_deadline_without_waiting_for_native_resolver(self) -> None:
        release = threading.Event()
        connection = BoundedHTTPConnection("example.test")
        connection.dns_timeout = 0.03
        try:
            with patch("engine.bounded_http.socket.getaddrinfo", side_effect=lambda *_args: release.wait()):
                with self.assertRaises(CrawlTimeout) as caught:
                    connection.connect()
            self.assertEqual(caught.exception.details["stage"], "dns")
        finally:
            release.set()

    def test_connect_timeout_is_classified_separately_from_response_timeout(self) -> None:
        class TimeoutSocket:
            def settimeout(self, _seconds): pass
            def connect(self, _address): raise TimeoutError("socket connect deadline")
            def close(self): pass
        with patch("engine.bounded_http.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 80))]), patch("engine.bounded_http.socket.socket", return_value=TimeoutSocket()):
            with self.assertRaises(CrawlTimeout) as caught:
                BoundedHTTPConnection("example.test").connect()
        self.assertEqual(caught.exception.details["stage"], "connect")

    def test_browser_submit_cancels_coroutine_when_upper_deadline_expires(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pool = PlaywrightPool(profile_root=Path(directory), profiles=1, tabs_per_profile=1, headless=True, captcha_timeout=30, zip_code="90001")
            cancelled = threading.Event()
            async def never_finishes() -> None:
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
            pool._ensure_loop()
            try:
                with timeout_scope("child", 0.03):
                    with self.assertRaises(CrawlTimeout) as caught:
                        pool._submit(never_finishes())
                self.assertEqual(caught.exception.details["stage"], "child")
                self.assertTrue(cancelled.wait(timeout=1))
            finally:
                pool.close()

    def test_api_timeout_settings_are_bounded_and_round_trip(self) -> None:
        settings = CrawlSettings.from_api({"dnsTimeoutSeconds": 3, "connectTimeoutSeconds": 5, "httpResponseTimeoutSeconds": 20, "childTimeoutSeconds": 60, "asinTimeoutSeconds": 120, "jobTimeoutSeconds": 360})
        self.assertEqual(settings.api_dict()["dnsTimeoutSeconds"], 3)
        self.assertEqual(settings.api_dict()["asinTimeoutSeconds"], 120)
        with self.assertRaises(ValueError):
            CrawlSettings.from_api({"connectTimeoutSeconds": 0})

    def test_captcha_timeout_preserves_captcha_cooldown_policy(self) -> None:
        error = CrawlTimeout("captcha", started=0)
        policy = classify_crawl_failure(error)
        self.assertEqual(policy["status"], "temporarily_blocked")
        self.assertEqual(policy["retryAfterSeconds"], 120)
        self.assertTrue(policy["isRetryable"])

    def test_worker_timeout_terminates_process_before_reporting_failure_and_keeps_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = ProcessCrawler(root=Path(directory), settings=CrawlSettings(asin_timeout_seconds=0.2), crawler_factory=HungCheckpointCrawler)
            completions = []
            output = crawler.run(job_id="timeout", sources=["B012345678"], write_export=False,
                                 on_input_complete=lambda completion: completions.append((crawler._process.is_alive(), completion)))
            self.assertFalse(completions[0][0])
            self.assertEqual(output["errors"][0]["stage"], "asin")
            self.assertTrue(output["errors"][0]["isRetryable"])
            self.assertIsNotNone(RawFamilyCache(Path(directory) / ".runtime" / "cache").load_checkpoint("B012345678:90001:us-v1"))

    def test_worker_cancellation_reaches_child_before_force_termination(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cancel_event = threading.Event()
            crawler = ProcessCrawler(
                root=Path(directory), settings=CrawlSettings(), cancel_event=cancel_event,
                crawler_factory=CooperativeCancelCrawler,
            )
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                running = executor.submit(crawler.run, job_id="cooperative-cancel", sources=["B012345678"], write_export=False)
                deadline = time.monotonic() + 5
                while crawler._process is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertIsNotNone(crawler._process)
                cancel_event.set()
                running.result(timeout=5)
            self.assertFalse(crawler._process.is_alive())

    def test_worker_force_stops_after_cancellation_grace_when_child_ignores_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch("engine.process_crawler.PROCESS_CANCEL_GRACE_SECONDS", 0.2):
            cancel_event = threading.Event()
            crawler = ProcessCrawler(
                root=Path(directory), settings=CrawlSettings(), cancel_event=cancel_event,
                crawler_factory=HungCheckpointCrawler,
            )
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                running = executor.submit(crawler.run, job_id="forced-cancel", sources=["B012345678"], write_export=False)
                deadline = time.monotonic() + 5
                while crawler._process is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertIsNotNone(crawler._process)
                cancel_event.set()
                with self.assertRaises(InterruptedError):
                    running.result(timeout=5)
            self.assertFalse(crawler._process.is_alive())

    def test_unexpected_worker_exit_is_reported_and_a_new_worker_can_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            failures = []
            failed = ProcessCrawler(root=Path(directory), settings=CrawlSettings(),
                                    crawler_factory=ExitedWorkerCrawler,
                                    on_worker_failure=failures.append)
            output = failed.run(job_id="worker-exit", sources=["B012345678"], write_export=False)
            self.assertEqual(output["errors"][0]["code"], "CRAWLER_WORKER_EXITED")
            self.assertEqual(failures, [{"reason": "worker_exited"}])
            self.assertFalse(failed._process.is_alive())

            healthy = ProcessCrawler(root=Path(directory), settings=CrawlSettings(),
                                     crawler_factory=ConcurrentStreamCrawler,
                                     on_worker_failure=failures.append)
            recovered = healthy.run(job_id="worker-recovered", sources=["B012345678"], write_export=False)
            self.assertEqual(recovered["status"], "completed")
            self.assertEqual(failures, [{"reason": "worker_exited"}])

    def test_windows_watchdog_targets_only_the_worker_process_tree(self) -> None:
        class FakeProcess:
            pid = 4567
            alive = True

            def is_alive(self):
                return self.alive

            def kill(self):
                self.alive = False

            def join(self, timeout=None):
                return None

        with tempfile.TemporaryDirectory() as directory:
            crawler = ProcessCrawler(root=Path(directory), settings=CrawlSettings())
            crawler._process = FakeProcess()
            with patch("engine.process_crawler.os.name", "nt"), \
                    patch("engine.process_crawler.subprocess.CREATE_NO_WINDOW", 0, create=True), \
                    patch("engine.process_crawler.subprocess.run") as run:
                crawler.close()

        self.assertEqual(run.call_args.args[0], ["taskkill", "/PID", "4567", "/T", "/F"])
        self.assertNotIn("/IM", run.call_args.args[0])

    def test_worker_enforces_child_deadline_before_longer_family_deadline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = ProcessCrawler(root=Path(directory), settings=CrawlSettings(child_timeout_seconds=0.2, asin_timeout_seconds=10), crawler_factory=HungChildCrawler)
            output = crawler.run(job_id="child-timeout", sources=["B012345678"], write_export=False)
            self.assertEqual(output["errors"][0]["stage"], "child")
            self.assertEqual(output["errors"][0]["asin"], "B012345679")
            self.assertFalse(crawler._process.is_alive())

    def test_worker_serializes_concurrent_progress_without_corrupting_windows_pipe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            progress = []
            crawler = ProcessCrawler(root=Path(directory), settings=CrawlSettings(), crawler_factory=ConcurrentStreamCrawler, progress=progress.append)
            output = crawler.run(job_id="concurrent-pipe", sources=["B012345678"], write_export=False)
            self.assertEqual(output["status"], "completed")
            self.assertEqual(len(progress), 32)

    def test_other_family_in_terminated_batch_reports_interruption_instead_of_false_child_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = ProcessCrawler(root=Path(directory), settings=CrawlSettings(child_timeout_seconds=0.2), crawler_factory=HungBatchCrawler)
            output = crawler.run(job_id="batch-timeout", sources=["B012345678", "B012345679"], write_export=False)
            errors = {error["source"]: error for error in output["errors"]}
            self.assertEqual(errors["B012345678"]["stage"], "child")
            self.assertEqual(errors["B012345679"]["code"], "WORKER_INTERRUPTED")
            self.assertEqual(errors["B012345679"]["stage"], "worker_shutdown")
            self.assertTrue(errors["B012345679"]["isRetryable"])

    def test_native_customization_hang_terminates_worker_and_preserves_transport_details(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = ProcessCrawler(root=Path(directory), settings=CrawlSettings(), crawler_factory=HungCustomizationCrawler)
            output = crawler.run(job_id="customization-hang", sources=["B012345678"], write_export=False)
            error = output["errors"][0]
            self.assertEqual(error["stage"], "customization")
            self.assertEqual(error["attempt"], 2)
            self.assertEqual(error["profile"], "profile-2")
            self.assertEqual(error["route"], "proxy")
            self.assertFalse(crawler._process.is_alive())
            self.assertEqual(output["statistics"]["acceptedInputs"], 1)
            self.assertEqual(output["version"], "1.0")

    def test_child_timeout_keeps_successful_variants_and_merges_retry(self) -> None:
        class TimeoutChildCrawler(ParentFamilyCrawler):
            should_timeout = True
            fetches = []
            def _fetch_parsed(self, normalized, *, require_price=True):
                self.fetches.append(normalized.asin)
                if normalized.asin == "B012345679" and self.should_timeout:
                    raise CrawlTimeout("http_response", started=0, attempt=2, route="proxy", profile="profile-2")
                return super()._fetch_parsed(normalized, require_price=require_price)
        with tempfile.TemporaryDirectory() as directory:
            crawler = TimeoutChildCrawler(root=Path(directory), settings=CrawlSettings(variant_threads=1), browser_pool=FakeBrowser(PRODUCT_HTML))
            first = crawler.run(job_id="partial-timeout", sources=["B012345678"], write_export=False)
            self.assertEqual(first["completedAsins"], ["B012345678"])
            self.assertEqual(first["failedAsins"], ["B012345679"])
            self.assertEqual(first["errors"][0]["stage"], "http_response")
            self.assertEqual(first["errors"][0]["profile"], "profile-2")
            crawler.should_timeout = False
            crawler.cache.clear_failure("B012345679:90001:us-v1")
            second = crawler.run(job_id="retry-timeout", sources=["B012345678"], write_export=False)
            self.assertEqual(second["status"], "completed")
            self.assertEqual(crawler.fetches, ["B012345678", "B012345679", "B012345679"])

    def test_heartbeat_cannot_extend_asin_deadline_and_timeout_has_retry_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            engine = create_database_engine("sqlite:///" + (Path(directory) / "coordinator.sqlite3").as_posix())
            create_coordinator_test_schema(engine)
            sessions = create_session_factory(engine)
            store = CoordinatorStore(sessions)
            now = utc_now()
            with patch("engine.distributed.coordinator_store.utc_now", return_value=now):
                store.create_job({"urls": ["B012345678"], "asinTimeoutSeconds": 20})
                store.register_client({"clientId": "timeout-agent", "maxConcurrentInputs": 1})
                assignment = store.lease_tasks("timeout-agent", 1)[0]
            with patch("engine.distributed.coordinator_store.utc_now", return_value=now + timedelta(seconds=21)):
                store.heartbeat("timeout-agent", [{"taskId": assignment["taskId"], "leaseId": assignment["leaseId"]}])
                store.reap_expired()
            with sessions() as session:
                task = session.get(CrawlTask, assignment["taskId"])
                self.assertEqual(task.status, "queued")
                self.assertEqual(task.last_error["stage"], "asin")
                self.assertEqual(task.last_error["elapsedMs"], 21000)
                self.assertIsNotNone(task.last_error["retryAfter"])
            engine.dispose()


class BrowserStageTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_navigation_timeout_has_structured_stage(self) -> None:
        class HungPage:
            async def goto(self, *_args, **_kwargs):
                await asyncio.Event().wait()
        with self.assertRaises(CrawlTimeout) as caught:
            await PlaywrightPool._load_product_page(HungPage(), "https://www.amazon.com/dp/B012345678", navigation_timeout=0.03)
        self.assertEqual(caught.exception.details["stage"], "navigation")

    async def test_selector_timeout_has_structured_stage(self) -> None:
        class HungPage:
            async def goto(self, *_args, **_kwargs): pass
            async def content(self): return ""
            async def wait_for_selector(self, *_args, **_kwargs):
                await asyncio.Event().wait()
        with self.assertRaises(CrawlTimeout) as caught:
            await PlaywrightPool._load_product_page(HungPage(), "https://www.amazon.com/dp/B012345678", selector_timeout=0.03)
        self.assertEqual(caught.exception.details["stage"], "selector")

    async def test_manual_captcha_wait_is_bounded_and_reports_captcha_stage(self) -> None:
        class CaptchaPage:
            async def content(self): return '<html>Enter the characters you see below</html>'
            async def bring_to_front(self): pass
            async def wait_for_timeout(self, _milliseconds): await asyncio.Event().wait()
        with tempfile.TemporaryDirectory() as directory:
            pool = PlaywrightPool(profile_root=Path(directory), profiles=1, tabs_per_profile=1, headless=False, captcha_timeout=0.03, zip_code="90001")
            with self.assertRaises(CrawlTimeout) as caught:
                await pool._wait_for_captcha(CaptchaPage(), "https://www.amazon.com/dp/B012345678", None)
            self.assertEqual(caught.exception.details["stage"], "captcha")


class CoordinatorTimeoutTests(unittest.TestCase):
    def test_job_deadline_survives_store_restart_and_does_not_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            engine = create_database_engine("sqlite:///" + (Path(directory) / "coordinator.sqlite3").as_posix())
            create_coordinator_test_schema(engine)
            sessions = create_session_factory(engine)
            store = CoordinatorStore(sessions)
            now = utc_now()
            with patch("engine.distributed.coordinator_store.utc_now", return_value=now):
                job = store.create_job({"urls": ["B012345678"], "jobTimeoutSeconds": 5})
            with patch("engine.distributed.coordinator_store.utc_now", return_value=now + timedelta(seconds=6)):
                CoordinatorStore(sessions).reap_expired()
            with sessions() as session:
                task = session.query(CrawlTask).filter_by(job_id=job["id"]).one()
                self.assertEqual(task.last_error["stage"], "job")
                self.assertFalse(task.last_error["isRetryable"])
                self.assertIsNone(task.last_error["retryAfter"])
            result = store.job_results(job["id"])
            self.assertEqual(result["errors"][0]["stage"], "job")
            self.assertFalse(result["errors"][0]["isRetryable"])
            self.assertEqual(store.job_summary(job["id"])["errors"], 1)
            engine.dispose()
