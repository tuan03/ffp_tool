"""Amazon US marketplace URL, cookies, and page-state helpers."""

from __future__ import annotations

import re
import urllib.parse
from typing import Any

AMAZON_ORIGIN = "https://www.amazon.com"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36"
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Cookie": "i18n-prefs=USD; lc-main=en_US",
}


def force_us_profile_url(url: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(url)
        if not parsed.netloc.casefold().endswith("amazon.com"):
            return url
        query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        query.update({"language": "en_US", "currency": "USD"})
        return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
    except ValueError:
        return url


def playwright_us_cookies(cookie_header: str | None = None) -> list[dict[str, Any]]:
    values: dict[str, str] = {}
    for item in (cookie_header or DEFAULT_HEADERS["Cookie"]).split(";"):
        if "=" not in item:
            continue
        name, value = item.strip().split("=", 1)
        if name in {"sp-cdn", "i18n-prefs", "lc-main"}:
            continue
        values[name] = value
    values.update({"i18n-prefs": "USD", "lc-main": "en_US"})
    return [{"name": name, "value": value, "domain": ".amazon.com", "path": "/"} for name, value in values.items()]


def html_is_location_blocked(html: str) -> bool:
    if not html:
        return False
    markers = (
        "This item cannot be shipped to your selected delivery location",
        "No featured offers available",
        "Deliver to Vietnam",
        "Currently unavailable for your location",
    )
    if not any(marker.casefold() in html.casefold() for marker in markers):
        return False
    has_reliable_price = bool(re.search(r'class=["\'][^"\']*a-offscreen[^"\']*["\'][^>]*>\s*(?:US\s*)?\$', html, re.I))
    return not has_reliable_price
