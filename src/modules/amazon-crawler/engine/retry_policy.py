"""Classified page failures and retry delays shared by HTTP, browser and coordinator."""

from __future__ import annotations

import random
import re
import math
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Mapping

from bs4 import BeautifulSoup


RETRY_FIELDS = ("httpStatus", "notFoundConfirmed")


class FetchFailure(RuntimeError):
    def __init__(self, message: str, *, status: str, reason: str, retryable: bool,
                 delay: float, http_status: int | None = None, confirmed: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.reason = reason
        self.retryable = retryable
        self.delay = delay
        self.http_status = http_status
        self.confirmed = confirmed

    def policy(self) -> dict[str, Any]:
        return {"status": self.status, "reason": self.reason, "retryable": self.retryable,
                "retryAfterSeconds": self.delay, "httpStatus": self.http_status,
                "notFoundConfirmed": self.confirmed}


def retry_delay(attempt: int, *, base: float = 2, cap: float = 300,
                retry_after: float = 0) -> float:
    interval = min(cap, base * 2 ** min(10, max(0, attempt - 1)))
    # Positive jitter never shortens the minimum requested by the server.
    jitter = random.uniform(0, interval / 2)
    return max(retry_after, interval) + jitter if retry_after > cap else min(cap, max(retry_after, interval) + jitter)


def _retry_after(headers: Mapping[str, str] | None) -> float:
    value = next((str(value) for name, value in (headers or {}).items() if name.casefold() == "retry-after"), "")
    try:
        seconds = float(value)
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            seconds = (date - datetime.now(timezone.utc)).total_seconds()
        except (ValueError, TypeError, OverflowError):
            return 0
    if not math.isfinite(seconds):
        return 0
    try:
        datetime.now(timezone.utc) + timedelta(seconds=max(0, seconds) + 600)
    except (ValueError, OverflowError):
        return 0
    return max(0, seconds)


def html_is_captcha(html: str) -> bool:
    lowered = html.casefold()
    return bool(html) and any(marker in lowered for marker in (
        "validatecaptcha", "opfcaptcha.amazon.com", "enter the characters you see below", "captchacharacters",
        "click the button below to continue shopping", "api-services-support@amazon.com",
        "sorry, we just need to make sure you're not a robot", "robot check",
    ))


def response_failure(status: int | None, html: str, headers: Mapping[str, str] | None = None,
                     *, verified: bool = False) -> FetchFailure | None:
    if html_is_captcha(html):
        return FetchFailure("Amazon CAPTCHA/bot-check page detected.", status="temporarily_blocked",
                            reason="captcha", retryable=True, delay=120, http_status=status)
    has_product = bool(re.search(r'id=["\'](?:productTitle|ppd|dp-container)["\']', html, re.I))
    if has_product and status not in {429, 503}:
        return None  # Some routes return an error status with a usable product document.
    if status in {429, 503}:
        return FetchFailure(f"Amazon HTTP {status}; network route needs a cooldown.", status="network_error",
                            reason=f"http_{status}", retryable=True, delay=max(30, _retry_after(headers)), http_status=status)
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True).casefold().replace("’", "'") if html else ""
    is_missing = any(marker in text for marker in (
        "sorry! we couldn't find that page", "sorry, we couldn't find that page",
        "sorry we couldn't find that page", "product not found",
    ))
    if is_missing or status == 404:
        confirmed = verified and is_missing and status in {None, 200, 404}
        return FetchFailure("Amazon product not found (browser verified)." if confirmed else "Amazon 404 has not been verified.",
                            status="not_found" if confirmed else "network_error",
                            reason="not_found" if confirmed else "not_found_unverified",
                            retryable=not confirmed, delay=86400 if confirmed else 30,
                            http_status=status, confirmed=confirmed)
    if status is not None and status >= 400:
        return FetchFailure(f"Amazon HTTP {status}.", status="network_error", reason=f"http_{status}",
                            retryable=True, delay=30, http_status=status)
    return None


def parser_failure(selector: str = "product") -> FetchFailure:
    return FetchFailure(f"Amazon rendered HTML does not contain the required {selector} selector.",
                        status="parser_error", reason="html_changed", retryable=False, delay=600)
