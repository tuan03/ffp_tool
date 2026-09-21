"""Small persistent Playwright pool with CAPTCHA waiting and context recovery."""

from __future__ import annotations

import asyncio
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse


class PlaywrightUnavailable(RuntimeError):
    pass


class CaptchaTimeout(RuntimeError):
    pass


def html_is_captcha(html: str) -> bool:
    lowered = html.casefold()
    return "validatecaptcha" in lowered or "enter the characters you see below" in lowered or "captchacharacters" in lowered


def start_with_playwright_event_loop(start: Callable[[], Any]) -> Any:
    """Start Playwright with a subprocess-capable loop under Uvicorn reload.

    Uvicorn selects WindowsSelectorEventLoopPolicy when reload is enabled. That
    loop cannot create the Playwright driver subprocess and raises an empty
    NotImplementedError. The already-running Uvicorn loop is unaffected while
    this worker temporarily creates Playwright with a Proactor loop.
    """
    if sys.platform != "win32":
        return start()
    selector_policy_type = getattr(asyncio, "WindowsSelectorEventLoopPolicy", None)
    proactor_policy_type = getattr(asyncio, "WindowsProactorEventLoopPolicy", None)
    previous_policy = asyncio.get_event_loop_policy()
    if selector_policy_type is None or proactor_policy_type is None or not isinstance(previous_policy, selector_policy_type):
        return start()
    asyncio.set_event_loop_policy(proactor_policy_type())
    try:
        return start()
    finally:
        asyncio.set_event_loop_policy(previous_policy)


class PlaywrightPool:
    def __init__(self, *, profile_root: Path, profiles: int, tabs_per_profile: int, headless: bool, captcha_timeout: int, zip_code: str, proxies: list[str] | None = None, on_captcha: Callable[[str], None] | None = None) -> None:
        self.profile_root = profile_root
        self.profiles = max(1, profiles)
        self.tabs_per_profile = max(1, tabs_per_profile)
        self.headless = headless
        self.captcha_timeout = captcha_timeout
        self.zip_code = zip_code
        self.proxies = proxies or []
        self.on_captcha = on_captcha
        self._lock = threading.Lock()
        self._runtime: Any = None
        self._contexts: list[Any] = []
        self._next_context = 0
        # The synchronous Playwright API is thread-affine. All browser work is
        # routed through one worker while HTTP and product work remain parallel.
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="amazon-playwright")
        self._is_closed = False

    def _launch_context(self, index: int) -> Any:
        profile = self.profile_root / f"profile-{index + 1}"
        profile.mkdir(parents=True, exist_ok=True)
        options: dict[str, Any] = {
            "headless": self.headless, "locale": "en-US", "timezone_id": "America/New_York",
            "args": ["--disable-blink-features=AutomationControlled", "--no-default-browser-check"],
            "viewport": {"width": 1440, "height": 1000},
        }
        if self.proxies:
            parsed = urlparse(self.proxies[index % len(self.proxies)])
            if parsed.hostname and parsed.port:
                proxy: dict[str, str] = {"server": f"{parsed.scheme or 'http'}://{parsed.hostname}:{parsed.port}"}
                if parsed.username:
                    proxy["username"] = parsed.username
                if parsed.password:
                    proxy["password"] = parsed.password
                options["proxy"] = proxy
        context = self._runtime.chromium.launch_persistent_context(
            str(profile), headless=self.headless, locale="en-US", timezone_id="America/New_York",
            args=options["args"], viewport=options["viewport"],
            **({"proxy": options["proxy"]} if "proxy" in options else {}),
        )
        try:
            context.request.post(
                "https://www.amazon.com/gp/delivery/ajax/address-change.html",
                form={"locationType": "LOCATION_INPUT", "zipCode": self.zip_code, "storeContext": "generic", "pageType": "Gateway", "actionSource": "glow"},
                headers={"Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.amazon.com/"},
                timeout=15_000,
            )
        except Exception:
            # Amazon may reject the warm-up request; the page fallback still
            # uses the persisted locale cookies from earlier successful runs.
            pass
        return context

    def _ensure_started(self) -> None:
        with self._lock:
            if self._runtime is None:
                try:
                    from playwright.sync_api import sync_playwright
                except ImportError as error:
                    raise PlaywrightUnavailable("Playwright is not installed. Run pip install -r engine/requirements.txt.") from error
                self._runtime = start_with_playwright_event_loop(lambda: sync_playwright().start())
            while len(self._contexts) < self.profiles:
                self._contexts.append(self._launch_context(len(self._contexts)))

    def _context(self) -> tuple[int, Any]:
        self._ensure_started()
        with self._lock:
            index = self._next_context % len(self._contexts)
            self._next_context += 1
            context = self._contexts[index]
            try:
                context.pages
            except Exception:
                context = self._launch_context(index)
                self._contexts[index] = context
            return index, context

    def _wait_for_captcha(self, page: Any, url: str, cancel_event: threading.Event | None) -> str:
        html = page.content()
        if not html_is_captcha(html):
            return html
        if self.headless:
            raise CaptchaTimeout("CAPTCHA requires a headed browser profile or another proxy.")
        page.bring_to_front()
        if self.on_captcha:
            self.on_captcha(url)
        deadline = time.monotonic() + self.captcha_timeout
        while html_is_captcha(html):
            if cancel_event and cancel_event.is_set():
                raise InterruptedError("Crawler job cancelled while waiting for CAPTCHA.")
            if time.monotonic() >= deadline:
                raise CaptchaTimeout(f"CAPTCHA was not solved within {self.captcha_timeout} seconds.")
            page.wait_for_timeout(1000)
            html = page.content()
        return html

    def _fetch_internal(self, url: str, cancel_event: threading.Event | None) -> str:
        index, context = self._context()
        page: Any = None
        try:
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            return self._wait_for_captcha(page, url, cancel_event)
        except Exception as error:
            message = str(error).casefold()
            if "closed" in message or "target page" in message:
                with self._lock:
                    try:
                        self._contexts[index].close()
                    except Exception:
                        pass
                    self._contexts[index] = self._launch_context(index)
            raise
        finally:
            if page is not None:
                try:
                    page.close()
                except Exception:
                    pass

    def fetch(self, url: str, *, cancel_event: threading.Event | None = None) -> str:
        if self._is_closed:
            raise RuntimeError("Playwright pool is closed.")
        attempts = max(3, self.profiles)
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                return self._executor.submit(self._fetch_internal, url, cancel_event).result()
            except CaptchaTimeout as error:
                last_error = error
                if not self.headless:
                    raise
            except Exception as error:
                last_error = error
                message = str(error).casefold()
                is_retryable = any(marker in message for marker in (
                    "closed", "target page", "net::err_", "timeout", "connection", "navigation",
                ))
                if not is_retryable or attempt + 1 >= attempts:
                    raise
                time.sleep(0.5 * (attempt + 1))
        raise CaptchaTimeout(f"All {attempts} headless browser profile attempts encountered CAPTCHA: {last_error}")

    def _sweep_internal(self, url: str, cap: int, cancel_event: threading.Event | None) -> list[str]:
        _, context = self._context()
        page = context.new_page()
        pages: list[str] = []
        seen_asins: set[str] = set()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            pages.append(self._wait_for_captcha(page, url, cancel_event))
            selectors = [
                "#twister li[data-asin]:not(.a-disabled)",
                "#twister .a-button-toggle:not(.a-button-disabled)",
                "#variation_color_name li[data-asin]:not(.a-disabled)",
            ]
            for selector in selectors:
                count = page.locator(selector).count()
                for index in range(count):
                    if len(seen_asins) >= cap:
                        return pages
                    if cancel_event and cancel_event.is_set():
                        raise InterruptedError("Crawler job cancelled during variant matrix sweep.")
                    locator = page.locator(selector).nth(index)
                    asin = str(locator.get_attribute("data-asin") or "").strip().upper()
                    if asin and asin in seen_asins:
                        continue
                    try:
                        locator.click(timeout=8_000)
                        page.wait_for_timeout(500)
                        html = self._wait_for_captcha(page, url, cancel_event)
                        pages.append(html)
                        current_asin = page.locator("#ASIN").get_attribute("value") or asin
                        if current_asin:
                            seen_asins.add(str(current_asin).upper())
                    except Exception:
                        continue
            return pages
        finally:
            try:
                page.close()
            except Exception:
                pass

    def sweep_variant_matrix(self, url: str, *, cap: int, cancel_event: threading.Event | None = None) -> list[str]:
        if self._is_closed:
            raise RuntimeError("Playwright pool is closed.")
        return self._executor.submit(self._sweep_internal, url, cap, cancel_event).result()

    def close(self) -> None:
        if self._is_closed:
            return
        self._is_closed = True
        self._executor.submit(self._close_internal).result()
        self._executor.shutdown(wait=True)

    def _close_internal(self) -> None:
        with self._lock:
            for context in self._contexts:
                try:
                    context.close()
                except Exception:
                    pass
            self._contexts.clear()
            if self._runtime is not None:
                try:
                    self._runtime.stop()
                except Exception:
                    pass
                self._runtime = None
