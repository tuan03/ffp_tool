from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.playwright_pool import CaptchaTimeout, PlaywrightPool, html_is_captcha, start_with_playwright_event_loop


class FakeCaptchaPage:
    def __init__(self, contents: list[str]) -> None:
        self.contents = contents
        self.index = 0
        self.was_brought_forward = False

    def content(self) -> str:
        return self.contents[min(self.index, len(self.contents) - 1)]

    def bring_to_front(self) -> None:
        self.was_brought_forward = True

    def wait_for_timeout(self, milliseconds: int) -> None:
        self.index += 1


class FakeContext:
    def __init__(self, page) -> None:
        self.page = page
        self.pages: list = []

    def new_page(self):
        return self.page

    def close(self) -> None:
        pass


class ClosedPage:
    def goto(self, *args, **kwargs) -> None:
        raise RuntimeError("Target page, context or browser has been closed")

    def close(self) -> None:
        pass


class ReadyPage:
    def goto(self, *args, **kwargs) -> None:
        pass

    def content(self) -> str:
        return "<h1 id='productTitle'>Recovered</h1>"

    def wait_for_timeout(self, milliseconds: int) -> None:
        pass

    def close(self) -> None:
        pass


class FakeRuntime:
    def stop(self) -> None:
        pass


class PlaywrightPoolTests(unittest.TestCase):
    def make_pool(self, *, headless: bool, on_captcha=None) -> PlaywrightPool:
        return PlaywrightPool(
            profile_root=Path(tempfile.gettempdir()) / "ffp-playwright-test",
            profiles=1,
            tabs_per_profile=1,
            headless=headless,
            captcha_timeout=30,
            zip_code="10001",
            on_captcha=on_captcha,
        )

    def test_detects_captcha_and_headless_fails_fast(self) -> None:
        self.assertTrue(html_is_captcha('<form action="/errors/validateCaptcha">'))
        pool = self.make_pool(headless=True)
        try:
            with self.assertRaises(CaptchaTimeout):
                pool._wait_for_captcha(FakeCaptchaPage(["Enter the characters you see below"]), "https://amazon.com", None)
        finally:
            pool.close()

    def test_headed_mode_waits_for_manual_captcha_then_continues(self) -> None:
        notifications: list[str] = []
        page = FakeCaptchaPage(["Enter the characters you see below", "<h1 id='productTitle'>Ready</h1>"])
        pool = self.make_pool(headless=False, on_captcha=notifications.append)
        try:
            html = pool._wait_for_captcha(page, "https://amazon.com/dp/B012345678", None)
        finally:
            pool.close()
        self.assertIn("productTitle", html)
        self.assertTrue(page.was_brought_forward)
        self.assertEqual(notifications, ["https://amazon.com/dp/B012345678"])

    def test_closed_context_is_rebuilt_and_request_retried(self) -> None:
        pool = self.make_pool(headless=False)
        pool._runtime = FakeRuntime()
        pool._contexts = [FakeContext(ClosedPage())]
        pool._launch_context = lambda index: FakeContext(ReadyPage())
        pool._set_amazon_zip = lambda context: True
        try:
            html = pool.fetch("https://amazon.com/dp/B012345678")
        finally:
            pool.close()
        self.assertIn("Recovered", html)

    def test_windows_selector_policy_is_temporarily_replaced_for_playwright(self) -> None:
        class SelectorPolicy:
            pass

        class ProactorPolicy:
            pass

        original_policy = SelectorPolicy()

        with (
            patch("engine.playwright_pool.sys.platform", "win32"),
            patch("engine.playwright_pool.asyncio.WindowsSelectorEventLoopPolicy", SelectorPolicy, create=True),
            patch("engine.playwright_pool.asyncio.WindowsProactorEventLoopPolicy", ProactorPolicy, create=True),
            patch("engine.playwright_pool.asyncio.get_event_loop_policy", return_value=original_policy),
            patch("engine.playwright_pool.asyncio.set_event_loop_policy") as set_policy,
        ):
            result = start_with_playwright_event_loop(lambda: "started")

        self.assertEqual(result, "started")
        policies = [call.args[0] for call in set_policy.call_args_list]
        self.assertIsInstance(policies[0], ProactorPolicy)
        self.assertIs(policies[1], original_policy)


if __name__ == "__main__":
    unittest.main()
