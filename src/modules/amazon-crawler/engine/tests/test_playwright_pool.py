from __future__ import annotations

import tempfile
import asyncio
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.playwright_pool import CaptchaTimeout, PlaywrightPool, html_is_captcha, start_with_playwright_event_loop
from engine.proxy_profiles import ProxyAssignment


class FakeCaptchaPage:
    def __init__(self, contents: list[str]) -> None:
        self.contents = contents
        self.index = 0
        self.was_brought_forward = False

    async def content(self) -> str:
        return self.contents[min(self.index, len(self.contents) - 1)]

    async def bring_to_front(self) -> None:
        self.was_brought_forward = True

    async def wait_for_timeout(self, milliseconds: int) -> None:
        self.index += 1


class FakeContinuePage(FakeCaptchaPage):
    def __init__(self, contents: list[str]) -> None:
        super().__init__(contents)
        self.clicks: list[str] = []

    async def click(self, selector: str, **_kwargs: object) -> None:
        self.clicks.append(selector)
        self.index += 1


class FakeZipCaptchaPage(FakeCaptchaPage):
    def __init__(self, contents: list[str]) -> None:
        super().__init__(contents)
        self.was_closed = False
        self.requested_zip: str | None = None

    async def goto(self, *args, **kwargs) -> None:
        pass

    async def wait_for_selector(self, *args, **kwargs) -> None:
        pass

    async def evaluate(self, _script, arguments):
        self.requested_zip = arguments["zipCode"]
        return {"ok": True, "payload": {"isAddressUpdated": True}}

    async def close(self) -> None:
        self.was_closed = True


class FakeContext:
    def __init__(self, page) -> None:
        self.page = page
        self.pages: list = []
        self.was_closed = False

    async def new_page(self):
        return self.page

    async def close(self) -> None:
        self.was_closed = True


class ClosedPage:
    async def goto(self, *args, **kwargs) -> None:
        raise RuntimeError("Target page, context or browser has been closed")

    async def close(self) -> None:
        pass


class ReadyPage:
    async def goto(self, *args, **kwargs) -> None:
        pass

    async def content(self) -> str:
        return "<h1 id='productTitle'>Recovered</h1>"

    async def wait_for_selector(self, *args, **kwargs) -> None:
        pass

    async def wait_for_timeout(self, milliseconds: int) -> None:
        pass

    async def close(self) -> None:
        pass


class DelayedCustomizationPage(ReadyPage):
    def __init__(self, contents: list[str]) -> None:
        self.contents = contents
        self.index = 0

    async def content(self) -> str:
        return self.contents[min(self.index, len(self.contents) - 1)]

    async def wait_for_timeout(self, milliseconds: int) -> None:
        self.index += 1


class PlaywrightPoolTests(unittest.IsolatedAsyncioTestCase):
    def make_pool(self, *, headless: bool, on_captcha=None) -> PlaywrightPool:
        return PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=1,
            tabs_per_profile=1,
            headless=headless,
            captcha_timeout=30,
            zip_code="90001",
            on_captcha=on_captcha,
        )

    async def test_amazon_captcha_skips_for_headed_and_headless_without_manual_prompt(self) -> None:
        from engine.retry_policy import FetchFailure
        for headless in (True, False):
            notifications = []
            pool = self.make_pool(headless=headless, on_captcha=notifications.append)
            page = FakeCaptchaPage(["Enter the characters you see below"])
            with self.assertRaises(FetchFailure) as caught:
                await pool._wait_for_captcha(page, "https://amazon.com/dp/B012345678", None)
            self.assertEqual(caught.exception.reason, "captcha_skipped")
            self.assertFalse(page.was_brought_forward)
            self.assertEqual(notifications, [])

    async def test_amazon_zip_challenge_skips_before_location_request(self) -> None:
        from engine.retry_policy import FetchFailure
        page = FakeZipCaptchaPage(["Enter the characters you see below"])
        pool = self.make_pool(headless=False)
        with self.assertRaises(FetchFailure) as caught:
            await pool._set_amazon_zip(FakeContext(page))
        self.assertEqual(caught.exception.reason, "captcha_skipped")
        self.assertTrue(page.was_closed)
        self.assertFalse(page.was_brought_forward)

    async def test_non_amazon_manual_challenge_behavior_is_preserved(self) -> None:
        notifications = []
        page = FakeCaptchaPage(["Enter the characters you see below", "<h1>Ready</h1>"])
        pool = self.make_pool(headless=False, on_captcha=notifications.append)
        pool.source_platform = "etsy"
        html = await pool._wait_for_captcha(page, "https://www.etsy.com/listing/123", None)
        self.assertIn("Ready", html)
        self.assertTrue(page.was_brought_forward)
        self.assertEqual(len(notifications), 1)

    async def test_profile_tab_capacity_runs_browser_work_in_parallel(self) -> None:
        activity: list[dict] = []
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=4,
            tabs_per_profile=2,
            headless=True,
            captcha_timeout=30,
            zip_code="10001",
            on_activity=lambda state: activity.append(dict(state)),
        )
        active = 0
        maximum_active = 0

        async def operation(_index, _context) -> str:
            nonlocal active, maximum_active
            active += 1
            maximum_active = max(maximum_active, active)
            await asyncio.sleep(0.02)
            active -= 1
            return "ok"

        async def fake_context(index: int, *_args):
            return object()

        pool._ensure_context = fake_context
        outputs = await asyncio.gather(*(pool._run_with_profile_slot(operation) for _ in range(9)))

        self.assertEqual(outputs, ["ok"] * 9)
        self.assertEqual(maximum_active, 8)
        self.assertEqual(max(state["directActive"] for state in activity), 8)
        self.assertEqual(max(state["directQueued"] for state in activity), 1)
        self.assertTrue(all(state["proxyActive"] == 0 for state in activity))

    async def test_closed_context_is_rebuilt_and_request_retried(self) -> None:
        pool = self.make_pool(headless=False)
        pool._contexts = [FakeContext(ClosedPage())]
        pool._us_profile_applied[0] = True

        async def launch_context(index: int, *_args):
            pool._us_profile_applied[index] = True
            return FakeContext(ReadyPage())

        pool._launch_context = launch_context
        html, diagnostics = await pool._fetch_with_retries("https://amazon.com/dp/B012345678", None)

        self.assertIn("Recovered", html)
        self.assertEqual(diagnostics[-1]["outcome"], "success")

    async def test_customization_loader_waits_until_dynamic_widget_is_present(self) -> None:
        page = DelayedCustomizationPage([
            "<html><body><div>Customize is loading</div></body></html>",
            "<html><body><script>window.sellerConfigComponents = [];</script></body></html>",
        ])

        html = await PlaywrightPool._load_customization_page(
            page,
            "https://www.amazon.com/customize/B012345678",
            markers=("sellerConfigComponents", "gc-widget"),
            timeout_ms=5_000,
        )

        self.assertIn("sellerConfigComponents", html)
        self.assertEqual(page.index, 1)

    async def test_customization_loader_rejects_a_rendered_page_without_required_markers(self) -> None:
        page = DelayedCustomizationPage([
            "<html><body><div>Customize is still loading</div></body></html>",
        ])

        from engine.timeouts import CrawlTimeout
        with self.assertRaisesRegex(CrawlTimeout, "customization deadline"):
            await PlaywrightPool._load_customization_page(
                page,
                "https://www.amazon.com/customize/B012345678",
                markers=("sellerConfigComponents", "gc-widget"),
                timeout_ms=250,
            )

    async def test_us_zip_failure_rotates_to_the_next_browser_profile(self) -> None:
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=2,
            tabs_per_profile=1,
            headless=True,
            captcha_timeout=30,
            zip_code="10001",
            proxy_assignments=[
                ProxyAssignment(index=0, name="direct"),
                ProxyAssignment(index=1, name="proxy-1", server="http://proxy.test:80"),
            ],
        )
        routes: list[str] = []

        async def fetch_once(_url: str, _cancel_event, *, route: str, allow_manual_captcha: bool):
            routes.append(route)
            if route == "direct":
                error = RuntimeError("Unable to confirm Amazon US ZIP 10001 for browser profile 1.")
                error.browser_profile_index = 0
                raise error
            return "<h1 id='productTitle'>Ready</h1>", pool.profiles

        pool._fetch_once = fetch_once
        html, diagnostics = await pool._fetch_with_retries("https://amazon.com/dp/B012345678", None)

        self.assertIn("Ready", html)
        self.assertEqual(routes, ["direct", "direct", "proxy"])
        self.assertEqual([trace["profile"] for trace in diagnostics], ["direct-1", "direct-1", "proxy-1"])

    async def test_missing_customize_markers_rotate_through_direct_profiles_and_proxy(self) -> None:
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=2,
            tabs_per_profile=1,
            headless=True,
            captcha_timeout=30,
            zip_code="10001",
            proxy_assignments=[
                ProxyAssignment(index=0, name="direct"),
                ProxyAssignment(index=1, name="proxy-1", server="http://proxy.test:80"),
            ],
        )
        routes: list[str] = []

        async def fetch_once(
            _url: str,
            _cancel_event,
            *,
            route: str,
            allow_manual_captcha: bool,
            customization_markers: tuple[str, ...],
        ):
            routes.append(route)
            if route == "direct":
                error = RuntimeError("Amazon Customize markers did not appear before the render timeout.")
                error.browser_profile_index = len(routes) - 1
                raise error
            return "<script>sellerConfigComponents = [];</script>", pool.profiles

        pool._fetch_once = fetch_once
        html, diagnostics = await pool._fetch_with_retries(
            "https://amazon.com/customize/B012345678",
            None,
            customization_markers=("sellerConfigComponents",),
        )

        self.assertIn("sellerConfigComponents", html)
        self.assertEqual(routes, ["direct", "direct", "proxy"])
        self.assertEqual([trace["outcome"] for trace in diagnostics], ["error", "error", "success"])
        self.assertEqual(pool._blocked_until, {})

    async def test_successful_direct_browser_does_not_use_proxy_profile(self) -> None:
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=2,
            tabs_per_profile=1,
            headless=True,
            captcha_timeout=30,
            zip_code="10001",
            proxy_assignments=[
                ProxyAssignment(index=0, name="direct"),
                ProxyAssignment(index=1, name="proxy-1", server="http://proxy.test:80"),
            ],
        )
        used_routes: list[str] = []

        async def fetch_once(_url: str, _cancel_event, *, route: str, allow_manual_captcha: bool):
            used_routes.append(route)
            return "<h1 id='productTitle'>Ready</h1>", 0

        pool._fetch_once = fetch_once
        _html, diagnostics = await pool._fetch_with_retries("https://amazon.com/dp/B012345678", None)

        self.assertEqual(used_routes, ["direct"])
        self.assertEqual(diagnostics[0]["profile"], "direct-1")
        self.assertFalse(diagnostics[0]["proxyEnabled"])

    async def test_amazon_captcha_stops_after_first_route(self) -> None:
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=2,
            tabs_per_profile=1,
            headless=False,
            captcha_timeout=30,
            zip_code="10001",
            proxy_assignments=[ProxyAssignment(index=0, name="proxy-1", server="http://proxy.test:80")],
        )
        attempts: list[tuple[str, bool]] = []

        async def fetch_once(_url: str, _cancel_event, *, route: str, allow_manual_captcha: bool):
            attempts.append((route, allow_manual_captcha))
            error = CaptchaTimeout("captcha")
            error.browser_profile_index = 0 if route == "direct" else pool.profiles
            raise error

        pool._fetch_once = fetch_once
        from engine.retry_policy import FetchFailure
        with self.assertRaises(FetchFailure) as caught:
            await pool._fetch_with_retries("https://amazon.com/dp/B012345678", None)
        self.assertEqual(caught.exception.reason, "captcha_skipped")
        self.assertEqual(attempts, [("direct", False)])

    async def test_headed_customize_can_solve_captcha_on_direct_profile(self) -> None:
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=1, tabs_per_profile=1, headless=False, captcha_timeout=30, zip_code="10001",
            proxy_assignments=[ProxyAssignment(index=0, name="proxy-1", server="http://proxy.test:80")],
        )
        pool.source_platform = "etsy"
        attempts: list[tuple[str, bool]] = []

        async def fetch_once(_url: str, _cancel_event, *, route: str, allow_manual_captcha: bool, customization_markers: tuple[str, ...]):
            attempts.append((route, allow_manual_captcha))
            if allow_manual_captcha and route == "direct":
                return "sellerConfigComponents", 0
            raise CaptchaTimeout("captcha")

        pool._fetch_once = fetch_once
        html, _ = await pool._fetch_with_retries(
            "https://amazon.com/customize/B012345678", None,
            customization_markers=("sellerConfigComponents",),
        )
        self.assertEqual(html, "sellerConfigComponents")
        self.assertEqual(attempts, [("direct", True)])

    async def test_customize_falls_back_to_proxy_after_direct_captcha_timeout(self) -> None:
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=1, tabs_per_profile=1, headless=False, captcha_timeout=30, zip_code="10001",
            proxy_assignments=[ProxyAssignment(index=0, name="proxy-1", server="http://proxy.test:80")],
        )
        pool.source_platform = "etsy"
        attempts: list[tuple[str, bool]] = []

        async def fetch_once(_url: str, _cancel_event, *, route: str, allow_manual_captcha: bool, customization_markers: tuple[str, ...]):
            attempts.append((route, allow_manual_captcha))
            if route == "direct":
                raise CaptchaTimeout("captcha")
            return "sellerConfigComponents", pool.profiles

        pool._fetch_once = fetch_once
        html, _ = await pool._fetch_with_retries(
            "https://amazon.com/customize/B012345678", None,
            customization_markers=("sellerConfigComponents",),
        )
        self.assertEqual(html, "sellerConfigComponents")
        self.assertEqual(attempts, [("direct", True), ("proxy", True)])

    async def test_exhausted_cooldown_routes_are_not_reported_as_captcha(self) -> None:
        pool = self.make_pool(headless=False)

        async def fetch_once(_url: str, _cancel_event, *, route: str, allow_manual_captcha: bool):
            raise RuntimeError("All direct browser profiles are temporarily cooling down.")

        pool._fetch_once = fetch_once

        with self.assertRaisesRegex(RuntimeError, "All browser routes failed") as raised:
            await pool._fetch_with_retries("https://amazon.com/dp/B012345678", None)

        self.assertNotIsInstance(raised.exception, CaptchaTimeout)

    async def test_close_closes_direct_and_proxy_contexts(self) -> None:
        pool = PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=1,
            tabs_per_profile=1,
            headless=True,
            captcha_timeout=30,
            zip_code="10001",
            proxy_assignments=[ProxyAssignment(index=0, name="proxy-1", server="http://proxy.test:80")],
        )
        direct_context = FakeContext(ReadyPage())
        proxy_context = FakeContext(ReadyPage())
        pool._contexts = [direct_context, proxy_context]

        await pool._close_async()

        self.assertTrue(direct_context.was_closed)
        self.assertTrue(proxy_context.was_closed)
        self.assertEqual(pool._contexts, [None, None])

    def test_windows_selector_policy_is_temporarily_replaced_for_playwright(self) -> None:
        class SelectorPolicy:
            pass

        class ProactorPolicy:
            pass

        original_policy = SelectorPolicy()
        setattr(asyncio, "WindowsSelectorEventLoopPolicy", SelectorPolicy)
        setattr(asyncio, "WindowsProactorEventLoopPolicy", ProactorPolicy)
        try:
            with (
                patch("engine.playwright_pool.sys.platform", "win32"),
                patch("engine.playwright_pool.asyncio.get_event_loop_policy", return_value=original_policy),
                patch("engine.playwright_pool.asyncio.set_event_loop_policy") as set_policy,
            ):
                result = start_with_playwright_event_loop(lambda: "started")
        finally:
            delattr(asyncio, "WindowsSelectorEventLoopPolicy")
            delattr(asyncio, "WindowsProactorEventLoopPolicy")

        self.assertEqual(result, "started")
        policies = [call.args[0] for call in set_policy.call_args_list]
        self.assertIsInstance(policies[0], ProactorPolicy)
        self.assertIs(policies[1], original_policy)


if __name__ == "__main__":
    unittest.main()
