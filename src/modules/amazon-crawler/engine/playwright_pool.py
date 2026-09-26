"""Concurrent persistent Playwright pool with CAPTCHA and context recovery."""

from __future__ import annotations

import asyncio
import concurrent.futures
import sys
import threading
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, TypeVar

from .amazon_locale import USER_AGENT, force_us_profile_url, html_is_location_blocked, playwright_us_cookies
from .proxy_profiles import ProxyAssignment


class PlaywrightUnavailable(RuntimeError):
    pass


class CaptchaTimeout(RuntimeError):
    pass


def html_is_captcha(html: str) -> bool:
    lowered = html.casefold()
    markers = (
        "validatecaptcha", "opfcaptcha.amazon.com", "enter the characters you see below", "captchacharacters",
        "click the button below to continue shopping", "api-services-support@amazon.com",
        "sorry, we just need to make sure you're not a robot", "robot check",
    )
    return bool(html) and any(marker in lowered for marker in markers)


def start_with_playwright_event_loop(start: Callable[[], Any]) -> Any:
    """Retain the sync startup compatibility helper used by older integrations."""
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


T = TypeVar("T")
ProfileOperation = Callable[[int, Any], Awaitable[T]]


class PlaywrightPool:
    def __init__(
        self,
        *,
        profile_root: Path,
        profiles: int,
        tabs_per_profile: int,
        headless: bool,
        captcha_timeout: int,
        zip_code: str,
        proxy_assignments: list[ProxyAssignment] | None = None,
        on_captcha: Callable[[str], None] | None = None,
        on_activity: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.profile_root = profile_root
        self.profiles = max(1, profiles)
        self.tabs_per_profile = max(1, tabs_per_profile)
        self.headless = headless
        self.captcha_timeout = captcha_timeout
        self.zip_code = zip_code
        configured_proxies = [assignment for assignment in proxy_assignments or [] if assignment.is_enabled][:self.profiles]
        direct_assignments = [
            ProxyAssignment(index=index, name=f"direct-{index + 1}")
            for index in range(self.profiles)
        ]
        fallback_assignments = [
            ProxyAssignment(
                index=self.profiles + index,
                name=assignment.name,
                server=assignment.server,
                username=assignment.username,
                password=assignment.password,
            )
            for index, assignment in enumerate(configured_proxies)
        ]
        self.proxy_assignments = direct_assignments + fallback_assignments
        self.direct_profile_indices = list(range(self.profiles))
        self.proxy_profile_indices = list(range(self.profiles, len(self.proxy_assignments)))
        self.total_profiles = len(self.proxy_assignments)
        self.on_captcha = on_captcha
        self.on_activity = on_activity

        self._runtime: Any = None
        self._contexts: list[Any | None] = [None] * self.total_profiles
        self._us_profile_applied: dict[int, bool] = {}
        self._blocked_until: dict[int, float] = {}
        self._start_lock: asyncio.Lock | None = None
        self._context_locks: list[asyncio.Lock] | None = None
        self._profile_slots: list[asyncio.Semaphore] | None = None
        self._direct_slot_queue: asyncio.Queue[int] | None = None
        self._proxy_slot_queue: asyncio.Queue[int] | None = None
        self._async_state_loop: asyncio.AbstractEventLoop | None = None
        self._active_direct = 0
        self._active_proxy = 0
        self._queued_direct = 0
        self._queued_proxy = 0

        self._lifecycle_lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: threading.Thread | None = None
        self._loop_ready = threading.Event()
        self._thread_diagnostics = threading.local()
        self._is_closed = False

    def last_diagnostics(self) -> list[dict[str, Any]]:
        return list(getattr(self._thread_diagnostics, "attempts", []))

    @staticmethod
    def _new_worker_loop() -> asyncio.AbstractEventLoop:
        if sys.platform == "win32":
            proactor_policy_type = getattr(asyncio, "WindowsProactorEventLoopPolicy", None)
            if proactor_policy_type is not None:
                return proactor_policy_type().new_event_loop()
        return asyncio.new_event_loop()

    def _run_loop(self) -> None:
        loop = self._new_worker_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        self._loop_ready.set()
        try:
            loop.run_forever()
        finally:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            loop.close()

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._lifecycle_lock:
            if self._is_closed:
                raise RuntimeError("Playwright pool is closed.")
            if self._loop_thread is None:
                self._loop_ready.clear()
                self._loop_thread = threading.Thread(
                    target=self._run_loop,
                    name="amazon-playwright-loop",
                    daemon=True,
                )
                self._loop_thread.start()
        self._loop_ready.wait()
        if self._loop is None:
            raise RuntimeError("Playwright event loop failed to start.")
        return self._loop

    def _submit(self, awaitable: Awaitable[T]) -> T:
        loop = self._ensure_loop()
        future = asyncio.run_coroutine_threadsafe(awaitable, loop)
        return future.result()

    def _ensure_async_state(self) -> None:
        loop = asyncio.get_running_loop()
        if self._async_state_loop is loop:
            return
        if self._async_state_loop is not None:
            raise RuntimeError("Playwright pool cannot be shared across event loops.")
        self._async_state_loop = loop
        self._start_lock = asyncio.Lock()
        self._context_locks = [asyncio.Lock() for _ in range(self.total_profiles)]
        self._profile_slots = [asyncio.Semaphore(self.tabs_per_profile) for _ in range(self.total_profiles)]
        self._direct_slot_queue = asyncio.Queue()
        self._proxy_slot_queue = asyncio.Queue()
        # Spread work across browser contexts before opening a second tab in a
        # context. Proxy slots stay in a separate lazy fallback queue.
        for _tab_index in range(self.tabs_per_profile):
            for profile_index in self.direct_profile_indices:
                self._direct_slot_queue.put_nowait(profile_index)
            for profile_index in self.proxy_profile_indices:
                self._proxy_slot_queue.put_nowait(profile_index)

    async def _ensure_runtime(self) -> None:
        self._ensure_async_state()
        if self._runtime is not None:
            return
        if self._start_lock is None:
            raise RuntimeError("Playwright runtime lock was not initialized.")
        async with self._start_lock:
            if self._runtime is not None:
                return
            try:
                from playwright.async_api import async_playwright
            except ImportError as error:
                raise PlaywrightUnavailable(
                    "Playwright is not installed. Run pip install -r engine/requirements.txt."
                ) from error
            self._runtime = await async_playwright().start()

    async def _launch_context(
        self,
        index: int,
        cancel_event: threading.Event | None = None,
        allow_manual_captcha: bool = True,
    ) -> Any:
        await self._ensure_runtime()
        if index < self.profiles:
            profile = self.profile_root / f"direct-{index + 1}"
        else:
            profile = self.profile_root / f"proxy-{index - self.profiles + 1}"
        profile.mkdir(parents=True, exist_ok=True)
        options: dict[str, Any] = {
            "headless": self.headless,
            "locale": "en-US",
            "timezone_id": "America/New_York",
            "user_agent": USER_AGENT,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--no-default-browser-check",
            ],
            "viewport": {"width": 1365, "height": 900},
        }
        proxy = self.proxy_assignments[index].playwright_proxy()
        if proxy:
            options["proxy"] = proxy
        context = await self._runtime.chromium.launch_persistent_context(str(profile), **options)
        try:
            await context.add_cookies(playwright_us_cookies())
            self._us_profile_applied[index] = await self._set_amazon_zip(
                context,
                cancel_event,
                allow_manual_captcha=allow_manual_captcha,
            )
        except CaptchaTimeout:
            try:
                await context.close()
            except Exception:
                pass
            raise
        except Exception:
            self._us_profile_applied[index] = False
        return context

    async def _set_amazon_zip(
        self,
        context: Any,
        cancel_event: threading.Event | None = None,
        *,
        allow_manual_captcha: bool = True,
    ) -> bool:
        page = await context.new_page()
        timeout_ms = 15_000
        home_url = "https://www.amazon.com/?language=en_US&currency=USD"
        try:
            await page.goto(
                home_url,
                wait_until="commit",
                timeout=timeout_ms,
            )
            try:
                await page.wait_for_selector("body", state="attached", timeout=5_000)
            except Exception:
                pass
            await self._wait_for_captcha(
                page,
                home_url,
                cancel_event,
                allow_manual=allow_manual_captcha,
            )
            result = await page.evaluate(
                """async ({ zipCode, timeoutMs }) => {
                    const body = new URLSearchParams({
                        locationType: "LOCATION_INPUT", zipCode, storeContext: "generic",
                        deviceType: "web", pageType: "Gateway", actionSource: "glow"
                    });
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeoutMs);
                    try {
                        const response = await fetch("/gp/delivery/ajax/address-change.html", {
                            method: "POST", credentials: "include",
                            headers: {
                                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                                "x-requested-with": "XMLHttpRequest"
                            },
                            body: body.toString(), signal: controller.signal
                        });
                        const text = await response.text();
                        let payload = null;
                        try { payload = JSON.parse(text); } catch {}
                        return { ok: response.ok, status: response.status, text: text.slice(0, 300), payload };
                    } finally { clearTimeout(timer); }
                }""",
                {"zipCode": self.zip_code, "timeoutMs": timeout_ms},
            )
            payload = result.get("payload") if isinstance(result, dict) else None
            return bool(
                isinstance(result, dict)
                and result.get("ok")
                and (not isinstance(payload, dict) or payload.get("isAddressUpdated") or payload.get("successful"))
            )
        finally:
            await page.close()

    @staticmethod
    async def _load_product_page(page: Any, url: str) -> str:
        await page.goto(force_us_profile_url(url), wait_until="commit", timeout=60_000)
        try:
            await page.wait_for_selector("#productTitle, #ppd, #dp-container", state="attached", timeout=15_000)
        except Exception:
            pass
        try:
            await page.wait_for_selector(
                "#landingImage, #imgBlkFront, #main-image, #altImages",
                state="attached",
                timeout=5_000,
            )
        except Exception:
            pass
        # Amazon lazily materializes part of the gallery. Scrolling and clicking
        # each image thumbnail makes those URLs available in the rendered DOM.
        # Video thumbnails are deliberately skipped.
        rendered_gallery: list[dict[str, Any]] = []

        async def capture_current_image() -> None:
            try:
                captured = await page.eval_on_selector(
                    "#landingImage, #imgBlkFront, #main-image",
                    """element => ({
                        hiRes: element.getAttribute('data-old-hires') || '',
                        large: (() => {
                          const raw = element.getAttribute('data-a-dynamic-image') || '';
                          try { return Object.keys(JSON.parse(raw))[0] || ''; } catch { return ''; }
                        })(),
                        mainUrl: element.currentSrc || element.src || ''
                    })""",
                )
                if isinstance(captured, dict):
                    rendered_gallery.append(captured)
            except Exception:
                pass

        await capture_current_image()
        try:
            thumbnails = page.locator(
                "#altImages li:not(.videoThumbnail) img, "
                "#altImages li:not([class*='video']) input[type='image']"
            )
            count = min(await thumbnails.count(), 30)
            for index in range(count):
                thumbnail = thumbnails.nth(index)
                try:
                    await thumbnail.scroll_into_view_if_needed(timeout=1_500)
                    await thumbnail.click(timeout=1_500)
                    await page.wait_for_timeout(80)
                    await capture_current_image()
                except Exception:
                    continue
        except Exception:
            pass
        if rendered_gallery:
            await page.evaluate(
                """entries => {
                    const previous = document.querySelector('#ffp-rendered-gallery');
                    if (previous) previous.remove();
                    const script = document.createElement('script');
                    script.id = 'ffp-rendered-gallery';
                    script.type = 'application/json';
                    script.textContent = JSON.stringify(entries);
                    document.body.appendChild(script);
                }""",
                rendered_gallery,
            )
        await page.wait_for_timeout(250)
        return await page.content()

    @staticmethod
    async def _load_customization_page(
        page: Any,
        url: str,
        *,
        markers: tuple[str, ...],
        timeout_ms: int = 20_000,
    ) -> str:
        await page.goto(force_us_profile_url(url), wait_until="commit", timeout=60_000)
        try:
            await page.wait_for_selector("body", state="attached", timeout=10_000)
        except Exception:
            pass
        attempts = max(1, timeout_ms // 250)
        html = await page.content()
        for _ in range(attempts):
            if (
                any(marker.casefold() in html.casefold() for marker in markers)
                or html_is_captcha(html)
                or html_is_location_blocked(html)
            ):
                return html
            await page.wait_for_timeout(250)
            html = await page.content()
        raise RuntimeError("Amazon Customize markers did not appear before the render timeout.")

    async def _ensure_context(
        self,
        index: int,
        cancel_event: threading.Event | None = None,
        allow_manual_captcha: bool = True,
    ) -> Any:
        self._ensure_async_state()
        if self._context_locks is None:
            raise RuntimeError("Playwright context locks were not initialized.")
        async with self._context_locks[index]:
            context = self._contexts[index]
            if context is not None:
                try:
                    context.pages
                    return context
                except Exception:
                    try:
                        await context.close()
                    except Exception:
                        pass
            context = await self._launch_context(index, cancel_event, allow_manual_captcha)
            self._contexts[index] = context
            return context

    async def _replace_context(self, index: int, failed_context: Any) -> None:
        if self._context_locks is None:
            return
        async with self._context_locks[index]:
            if self._contexts[index] is not failed_context:
                return
            try:
                await failed_context.close()
            except Exception:
                pass
            self._contexts[index] = None
            self._us_profile_applied[index] = False

    async def _ensure_us_profile(
        self,
        index: int,
        context: Any,
        cancel_event: threading.Event | None,
        allow_manual_captcha: bool,
    ) -> None:
        if self._us_profile_applied.get(index) is True:
            return
        if self._context_locks is None:
            raise RuntimeError("Playwright context locks were not initialized.")
        async with self._context_locks[index]:
            if self._us_profile_applied.get(index) is not True:
                self._us_profile_applied[index] = await self._set_amazon_zip(
                    context,
                    cancel_event,
                    allow_manual_captcha=allow_manual_captcha,
                )
        if self._us_profile_applied.get(index) is not True:
            raise RuntimeError(f"Unable to confirm Amazon US ZIP {self.zip_code} for browser profile {index + 1}.")

    def _route_kind(self, index: int) -> str:
        return "direct" if index < self.profiles else "proxy"

    def _activity_snapshot(self) -> dict[str, Any]:
        return {
            "directProfiles": self.profiles,
            "proxyProfiles": len(self.proxy_profile_indices),
            "tabsPerProfile": self.tabs_per_profile,
            "directActive": self._active_direct,
            "proxyActive": self._active_proxy,
            "directQueued": self._queued_direct,
            "proxyQueued": self._queued_proxy,
        }

    def _emit_activity(self, url: str, index: int | None = None) -> None:
        if self.on_activity is None:
            return
        payload = self._activity_snapshot()
        payload["url"] = url
        if index is not None:
            assignment = self.proxy_assignments[index]
            payload.update({
                "networkRoute": self._route_kind(index),
                "browserProfile": assignment.name,
            })
        self.on_activity(payload)

    def _block_profile(self, index: int, error: Exception) -> None:
        message = str(error).casefold()
        seconds = 300 if isinstance(error, CaptchaTimeout) or "captcha" in message or "location" in message else 30
        self._blocked_until[index] = time.monotonic() + seconds

    async def _run_with_profile_slot(
        self,
        operation: ProfileOperation[T],
        *,
        route: str = "direct",
        url: str = "",
        cancel_event: threading.Event | None = None,
        allow_manual_captcha: bool = True,
    ) -> T:
        self._ensure_async_state()
        queue = self._direct_slot_queue if route == "direct" else self._proxy_slot_queue
        if queue is None:
            raise RuntimeError("Playwright profile slots were not initialized.")
        route_indices = self.direct_profile_indices if route == "direct" else self.proxy_profile_indices
        if not route_indices:
            raise RuntimeError(f"No {route} browser profiles are configured.")
        if route == "direct":
            self._queued_direct += 1
        else:
            self._queued_proxy += 1
        self._emit_activity(url)
        index: int | None = None
        try:
            slot_count = len(route_indices) * self.tabs_per_profile
            for _ in range(slot_count):
                candidate = await queue.get()
                if self._blocked_until.get(candidate, 0) <= time.monotonic():
                    index = candidate
                    break
                queue.put_nowait(candidate)
            if index is None:
                raise RuntimeError(f"All {route} browser profiles are temporarily cooling down.")
            if route == "direct":
                self._queued_direct -= 1
                self._active_direct += 1
            else:
                self._queued_proxy -= 1
                self._active_proxy += 1
            self._emit_activity(url, index)
            context = await self._ensure_context(index, cancel_event, allow_manual_captcha)
            return await operation(index, context)
        except Exception as error:
            if index is not None:
                setattr(error, "browser_profile_index", index)
            raise
        finally:
            if index is None:
                if route == "direct":
                    self._queued_direct = max(0, self._queued_direct - 1)
                else:
                    self._queued_proxy = max(0, self._queued_proxy - 1)
            else:
                if route == "direct":
                    self._active_direct = max(0, self._active_direct - 1)
                else:
                    self._active_proxy = max(0, self._active_proxy - 1)
                queue.put_nowait(index)
            self._emit_activity(url, index)

    async def _run_with_profile_index(self, index: int, operation: ProfileOperation[T]) -> T:
        self._ensure_async_state()
        if self._profile_slots is None:
            raise RuntimeError("Playwright profile slots were not initialized.")
        async with self._profile_slots[index]:
            try:
                context = await self._ensure_context(index)
                return await operation(index, context)
            except Exception as error:
                setattr(error, "browser_profile_index", index)
                raise

    async def _wait_for_captcha(
        self,
        page: Any,
        url: str,
        cancel_event: threading.Event | None,
        *,
        allow_manual: bool = True,
    ) -> str:
        html = await page.content()
        if not html_is_captcha(html):
            return html
        if self.headless or not allow_manual:
            raise CaptchaTimeout("CAPTCHA requires a headed browser profile or another proxy.")
        await page.bring_to_front()
        if self.on_captcha:
            self.on_captcha(url)
        deadline = time.monotonic() + self.captcha_timeout
        while html_is_captcha(html):
            if cancel_event and cancel_event.is_set():
                raise InterruptedError("Crawler job cancelled while waiting for CAPTCHA.")
            if time.monotonic() >= deadline:
                raise CaptchaTimeout(f"CAPTCHA was not solved within {self.captcha_timeout} seconds.")
            await page.wait_for_timeout(1000)
            html = await page.content()
        return html

    async def _fetch_once(
        self,
        url: str,
        cancel_event: threading.Event | None,
        *,
        route: str,
        allow_manual_captcha: bool,
        customization_markers: tuple[str, ...] | None = None,
    ) -> tuple[str, int]:
        async def fetch_from_context(index: int, context: Any) -> tuple[str, int]:
            page: Any = None
            try:
                await self._ensure_us_profile(index, context, cancel_event, allow_manual_captcha)
                page = await context.new_page()
                if customization_markers is None:
                    html = await self._load_product_page(page, url)
                else:
                    html = await self._load_customization_page(
                        page,
                        url,
                        markers=customization_markers,
                    )
                html = await self._wait_for_captcha(
                    page,
                    url,
                    cancel_event,
                    allow_manual=allow_manual_captcha,
                )
                if html_is_location_blocked(html):
                    if not await self._set_amazon_zip(
                        context,
                        cancel_event,
                        allow_manual_captcha=allow_manual_captcha,
                    ):
                        raise RuntimeError(f"Unable to switch Amazon profile to US ZIP {self.zip_code}.")
                    self._us_profile_applied[index] = True
                    if customization_markers is None:
                        html = await self._load_product_page(page, url)
                    else:
                        html = await self._load_customization_page(
                            page,
                            url,
                            markers=customization_markers,
                        )
                    html = await self._wait_for_captcha(
                        page,
                        url,
                        cancel_event,
                        allow_manual=allow_manual_captcha,
                    )
                    if html_is_location_blocked(html):
                        raise RuntimeError(
                            f"Amazon still returned a location-blocked offer after applying US ZIP {self.zip_code}."
                        )
                if customization_markers is not None and not any(
                    marker.casefold() in html.casefold()
                    for marker in customization_markers
                ):
                    raise RuntimeError("Amazon Customize markers did not appear after rendering the page.")
                return html, index
            except Exception as error:
                message = str(error).casefold()
                if "closed" in message or "target page" in message:
                    await self._replace_context(index, context)
                raise
            finally:
                if page is not None:
                    try:
                        await page.close()
                    except Exception:
                        pass

        return await self._run_with_profile_slot(
            fetch_from_context,
            route=route,
            url=url,
            cancel_event=cancel_event,
            allow_manual_captcha=allow_manual_captcha,
        )

    async def _fetch_with_retries(
        self,
        url: str,
        cancel_event: threading.Event | None,
        prefer_proxy: bool = False,
        customization_markers: tuple[str, ...] | None = None,
    ) -> tuple[str, list[dict[str, Any]]]:
        last_error: Exception | None = None
        diagnostics: list[dict[str, Any]] = []
        routes: list[str] = []
        if not prefer_proxy:
            direct_attempts = self.profiles if self.proxy_profile_indices else max(3, self.profiles)
            routes.extend("direct" for _ in range(direct_attempts))
        routes.extend("proxy" for _ in self.proxy_profile_indices)
        if not routes:
            routes.append("direct")
        skip_remaining_direct = False
        for attempt, route in enumerate(routes, start=1):
            if route == "direct" and skip_remaining_direct:
                continue
            is_last_route = attempt == len(routes)
            # Customize needs the current direct session to remain available for
            # a human CAPTCHA solve before rotating to another proxy.
            allow_manual_captcha = not self.headless and (
                is_last_route or (customization_markers is not None and route == "direct" and attempt == 1)
            )
            try:
                fetch_options: dict[str, Any] = {
                    "route": route,
                    "allow_manual_captcha": allow_manual_captcha,
                }
                if customization_markers is not None:
                    fetch_options["customization_markers"] = customization_markers
                html, profile_index = await self._fetch_once(url, cancel_event, **fetch_options)
                assignment = self.proxy_assignments[profile_index]
                diagnostics.append({
                    "attempt": attempt,
                    "profile": assignment.name,
                    "proxyEnabled": assignment.is_enabled,
                    "networkRoute": route,
                    "outcome": "success",
                    "htmlBytes": len(html),
                })
                return html, diagnostics
            except CaptchaTimeout as error:
                last_error = error
                profile_index = getattr(error, "browser_profile_index", None)
                if isinstance(profile_index, int):
                    self._block_profile(profile_index, error)
                diagnostics.append(self._browser_error_trace(attempt, profile_index, error, "captcha"))
                if allow_manual_captcha and is_last_route:
                    setattr(error, "diagnostics", diagnostics)
                    raise
            except Exception as error:
                last_error = error
                profile_index = getattr(error, "browser_profile_index", None)
                message = str(error).casefold()
                if route == "direct" and "all direct browser profiles are temporarily cooling down" in message:
                    skip_remaining_direct = True
                should_cooldown_profile = (
                    "closed" not in message
                    and "target page" not in message
                    and "customize markers" not in message
                )
                if isinstance(profile_index, int) and should_cooldown_profile:
                    self._block_profile(profile_index, error)
                diagnostics.append(self._browser_error_trace(attempt, profile_index, error, "error"))
                is_retryable = any(marker in message for marker in (
                    "closed", "target page", "net::err_", "timeout", "connection", "navigation",
                    "amazon us zip", "http_response_code_failure", "cooling down", "location",
                    "customize markers",
                ))
                if not is_retryable or is_last_route:
                    setattr(error, "diagnostics", diagnostics)
                    raise
                await asyncio.sleep(0.25 * attempt)
        if isinstance(last_error, CaptchaTimeout):
            error: Exception = CaptchaTimeout(f"All browser routes encountered CAPTCHA: {last_error}")
        else:
            error = RuntimeError(f"All browser routes failed: {last_error}")
        setattr(error, "diagnostics", diagnostics)
        raise error

    def _browser_error_trace(
        self,
        attempt: int,
        profile_index: int | None,
        error: Exception,
        outcome: str,
    ) -> dict[str, Any]:
        trace: dict[str, Any] = {
            "attempt": attempt,
            "outcome": outcome,
            "error": str(error),
        }
        if isinstance(profile_index, int) and 0 <= profile_index < len(self.proxy_assignments):
            assignment = self.proxy_assignments[profile_index]
            trace.update({
                "profile": assignment.name,
                "proxyEnabled": assignment.is_enabled,
                "networkRoute": self._route_kind(profile_index),
            })
        return trace

    def fetch(
        self,
        url: str,
        *,
        cancel_event: threading.Event | None = None,
        prefer_proxy: bool = False,
    ) -> str:
        if self._is_closed:
            raise RuntimeError("Playwright pool is closed.")
        try:
            html, diagnostics = self._submit(self._fetch_with_retries(url, cancel_event, prefer_proxy))
            self._thread_diagnostics.attempts = diagnostics
            return html
        except Exception as error:
            self._thread_diagnostics.attempts = list(getattr(error, "diagnostics", []))
            raise

    def fetch_proxy_fallback(self, url: str, *, cancel_event: threading.Event | None = None) -> str:
        return self.fetch(url, cancel_event=cancel_event, prefer_proxy=True)

    def fetch_gallery(self, url: str, *, cancel_event: threading.Event | None = None) -> str:
        """Render the complete image gallery using the normal direct/proxy routing."""
        return self.fetch(url, cancel_event=cancel_event)

    def _fetch_customization(
        self,
        url: str,
        *,
        markers: tuple[str, ...],
        cancel_event: threading.Event | None = None,
    ) -> str:
        if self._is_closed:
            raise RuntimeError("Playwright pool is closed.")
        try:
            html, diagnostics = self._submit(
                self._fetch_with_retries(
                    url,
                    cancel_event,
                    customization_markers=markers,
                )
            )
            self._thread_diagnostics.attempts = diagnostics
            return html
        except Exception as error:
            self._thread_diagnostics.attempts = list(getattr(error, "diagnostics", []))
            raise

    def fetch_customization_entry(
        self,
        url: str,
        *,
        cancel_event: threading.Event | None = None,
    ) -> str:
        return self._fetch_customization(
            url,
            markers=("customizationFormLink", "gc:productInfo"),
            cancel_event=cancel_event,
        )

    def fetch_customization_form(
        self,
        url: str,
        *,
        cancel_event: threading.Event | None = None,
    ) -> str:
        return self._fetch_customization(
            url,
            markers=("gc-widget", "sellerConfigComponents", "customizationConfig", "OptionChooserComponent"),
            cancel_event=cancel_event,
        )

    async def _sweep_variant_matrix_async(
        self,
        url: str,
        cap: int,
        cancel_event: threading.Event | None,
    ) -> list[str]:
        async def sweep_context(index: int, context: Any) -> list[str]:
            await self._ensure_us_profile(index, context, cancel_event, True)
            page = await context.new_page()
            pages: list[str] = []
            seen_asins: set[str] = set()
            try:
                html = await self._load_product_page(page, url)
                html = await self._wait_for_captcha(page, url, cancel_event)
                if html_is_location_blocked(html):
                    if not await self._set_amazon_zip(context, cancel_event):
                        raise RuntimeError(f"Unable to switch Amazon profile to US ZIP {self.zip_code}.")
                    self._us_profile_applied[index] = True
                    html = await self._load_product_page(page, url)
                    html = await self._wait_for_captcha(page, url, cancel_event)
                pages.append(html)
                selectors = [
                    "#twister li[data-asin]:not(.a-disabled)",
                    "#twister .a-button-toggle:not(.a-button-disabled)",
                    "#variation_color_name li[data-asin]:not(.a-disabled)",
                ]
                for selector in selectors:
                    count = await page.locator(selector).count()
                    for item_index in range(count):
                        if len(seen_asins) >= cap:
                            return pages
                        if cancel_event and cancel_event.is_set():
                            raise InterruptedError("Crawler job cancelled during variant matrix sweep.")
                        locator = page.locator(selector).nth(item_index)
                        asin = str(await locator.get_attribute("data-asin") or "").strip().upper()
                        if asin and asin in seen_asins:
                            continue
                        try:
                            await locator.click(timeout=8_000)
                            await page.wait_for_timeout(500)
                            html = await self._wait_for_captcha(page, url, cancel_event)
                            pages.append(html)
                            current_asin = await page.locator("#ASIN").get_attribute("value") or asin
                            if current_asin:
                                seen_asins.add(str(current_asin).upper())
                        except Exception:
                            continue
                return pages
            finally:
                try:
                    await page.close()
                except Exception:
                    pass

        return await self._run_with_profile_slot(
            sweep_context,
            route="direct",
            url=url,
            cancel_event=cancel_event,
            allow_manual_captcha=True,
        )

    def sweep_variant_matrix(
        self,
        url: str,
        *,
        cap: int,
        cancel_event: threading.Event | None = None,
    ) -> list[str]:
        if self._is_closed:
            raise RuntimeError("Playwright pool is closed.")
        return self._submit(self._sweep_variant_matrix_async(url, cap, cancel_event))

    async def _close_async(self) -> None:
        contexts = [context for context in self._contexts if context is not None]
        if contexts:
            await asyncio.gather(*(context.close() for context in contexts), return_exceptions=True)
        self._contexts = [None] * self.total_profiles
        self._us_profile_applied.clear()
        if self._runtime is not None:
            try:
                await self._runtime.stop()
            except Exception:
                pass
            self._runtime = None

    def close(self) -> None:
        with self._lifecycle_lock:
            if self._is_closed:
                return
            self._is_closed = True
            loop = self._loop
            thread = self._loop_thread
        if loop is None or thread is None:
            return
        try:
            future = asyncio.run_coroutine_threadsafe(self._close_async(), loop)
            future.result(timeout=30)
        except (concurrent.futures.TimeoutError, RuntimeError):
            pass
        finally:
            loop.call_soon_threadsafe(loop.stop)
            thread.join(timeout=10)
