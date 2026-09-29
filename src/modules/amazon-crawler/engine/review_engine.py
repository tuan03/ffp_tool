"""Review-only Amazon crawl using the distributed agent's persistent browser profiles."""

from __future__ import annotations

import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .crawler_core import AMAZON_HOST_RE, CrawlSettings, normalize_amazon_input, parse_product_html
from .playwright_pool import PlaywrightPool
from .proxy_profiles import resolve_proxy_assignments


def normalize_review_source(source: str) -> tuple[str, str]:
    value = source.strip()
    portal_match = re.search(r"/(?:portal/customer-reviews|product-reviews)/([A-Z0-9]{10})(?:[/?]|$)", value, re.I)
    if portal_match:
        host = (urlparse(value).hostname or "").casefold()
        if not AMAZON_HOST_RE.search(host):
            raise ValueError("Only Amazon review URLs are supported.")
        asin = portal_match.group(1).upper()
    else:
        asin = normalize_amazon_input(value).asin
    return asin, f"https://www.amazon.com/dp/{asin}"


def _text(node: Any) -> str:
    return node.get_text(" ", strip=True) if node else ""


def parse_review_page(html: str, current_url: str = "https://www.amazon.com") -> tuple[list[dict[str, Any]], str | None]:
    soup = BeautifulSoup(html, "html.parser")
    reviews: list[dict[str, Any]] = []
    for card in soup.select('div[id^="customer_review-"], [data-hook="review"][id]'):
        review_id = re.sub(r"^customer_review-", "", str(card.get("id") or ""))
        if not review_id:
            continue
        rating_text = _text(card.select_one('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"]'))
        rating_match = re.search(r"([1-5](?:\.\d+)?)", rating_text)
        body = _text(card.select_one('[data-hook="review-body"]'))
        if not body or not rating_match:
            continue
        images = list(dict.fromkeys(
            str(image.get("data-src") or image.get("src") or "").strip()
            for image in card.select('img[data-hook="review-image-tile"], .review-image-tile img')
            if image.get("data-src") or image.get("src")
        ))
        title = _text(card.select_one('[data-hook="review-title"]'))
        review_link = card.select_one('[data-hook="review-title"][href]')
        reviews.append({
            "reviewId": review_id,
            "author": _text(card.select_one(".a-profile-name")),
            "rating": float(rating_match.group(1)),
            "title": title.replace(rating_text, "").strip() if rating_text else title,
            "body": body,
            "dateText": _text(card.select_one('[data-hook="review-date"]')),
            "variantText": _text(card.select_one('[data-hook="format-strip"]')),
            "verifiedPurchase": card.select_one('[data-hook="avp-badge"]') is not None,
            "images": images,
            "permalink": urljoin("https://www.amazon.com", str(review_link.get("href"))) if review_link else "",
            "synthetic": False,
            "source": "amazon",
        })
    next_link = soup.select_one("li.a-last:not(.a-disabled) a[href], .a-pagination li.a-last:not(.a-disabled) a[href]")
    next_url = urljoin(current_url, str(next_link.get("href"))) if next_link else None
    if next_url and (urlparse(next_url).hostname or "").casefold() not in {"www.amazon.com", "amazon.com"}:
        next_url = None
    return reviews, next_url


def _challenge(html: str) -> str | None:
    lower = html.casefold()
    if any(marker in lower for marker in ("ap_signin_form", "ap_login_form", "authportal-main-section", "amazon sign-in")):
        return "signin"
    if any(marker in lower for marker in ("validatecaptcha", "enter the characters you see below", "captcha challenge")):
        return "captcha"
    return None


def crawl_review_pages(
    source: str,
    *,
    fetch_page: Callable[[str], str],
    max_pages: int,
    progress: Callable[[dict[str, Any]], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    asin, product_url = normalize_review_source(source)
    if max_pages < 1 or max_pages > 1000:
        raise ValueError("maxPages must be between 1 and 1000.")
    context: dict[str, Any] = {"asin": asin, "url": product_url, "title": "", "description": "", "bullets": [], "details": {}}
    warnings: list[str] = []
    try:
        product_html = fetch_page(product_url)
        if _challenge(product_html):
            warnings.append("Product page requires sign-in or CAPTCHA.")
        else:
            product = parse_product_html(product_html, asin, product_url)
            if str(product.get("asin") or "").upper() != asin:
                raise ValueError("Amazon returned a different ASIN for the product context.")
            context.update({
                "title": product.get("title") or "",
                "description": product.get("description") or "",
                "bullets": product.get("bulletPoints") or [],
                "details": product.get("productDetails") or {},
            })
    except Exception as error:
        warnings.append(f"Product context unavailable: {error}")

    review_url = f"https://www.amazon.com/portal/customer-reviews/{asin}/"
    next_url: str | None = review_url
    visited: set[str] = set()
    seen_ids: set[str] = set()
    reviews: list[dict[str, Any]] = []
    pages: list[dict[str, Any]] = []
    stop_reason = "max_pages"
    while next_url and len(pages) < max_pages:
        if cancel_event and cancel_event.is_set():
            stop_reason = "cancelled"
            break
        if next_url in visited:
            stop_reason = "repeated_page"
            break
        visited.add(next_url)
        try:
            html = fetch_page(next_url)
        except Exception as error:
            message = str(error).casefold()
            stop_reason = "captcha" if "captcha" in message else "signin" if "sign-in" in message or "signin" in message else "fetch_failed"
            warnings.append(f"Review page {len(pages) + 1} failed: {error}")
            break
        challenge = _challenge(html)
        if challenge:
            stop_reason = challenge
            warnings.append(f"Review page requires {challenge} in the agent browser profile.")
            break
        page_reviews, following_url = parse_review_page(html, next_url)
        new_count = 0
        duplicate_count = 0
        skipped_low = 0
        for review in page_reviews:
            review_id = str(review["reviewId"])
            if review_id in seen_ids:
                duplicate_count += 1
                continue
            seen_ids.add(review_id)
            if review["rating"] < 3:
                skipped_low += 1
                continue
            reviews.append({**review, "pageNumber": len(pages) + 1})
            new_count += 1
        pages.append({"pageNumber": len(pages) + 1, "newReviews": new_count, "duplicateReviews": duplicate_count, "skippedLowRating": skipped_low})
        if progress:
            progress({"phase": "review", "message": f"Đã đọc trang {len(pages)}: {len(reviews)} review.", "completed": len(pages), "total": max_pages})
        if not page_reviews:
            stop_reason = "no_review_cards"
            break
        next_url = following_url
        if not next_url:
            stop_reason = "no_next_page"
            break
    return {
        "asin": asin, "sourceUrl": source, "reviewUrl": review_url, "context": context,
        "reviews": reviews, "reviewCount": len(reviews), "pagesFetched": len(pages),
        "pages": pages, "stopReason": stop_reason, "warnings": warnings,
    }


def crawl_reviews_with_agent(
    source: str,
    *,
    root: Path,
    settings: dict[str, Any],
    proxy_config_path: Path | None,
    progress: Callable[[dict[str, Any]], None],
    cancel_event: threading.Event,
) -> dict[str, Any]:
    crawl_settings = CrawlSettings.from_api(settings)
    proxies, _warnings = resolve_proxy_assignments(root, crawl_settings.browser_profiles, config_path=proxy_config_path)
    pool = PlaywrightPool(
        profile_root=root / ".runtime" / "browser-profiles",
        profiles=crawl_settings.browser_profiles,
        tabs_per_profile=crawl_settings.browser_tabs,
        headless=crawl_settings.headless,
        captcha_timeout=crawl_settings.captcha_timeout_seconds,
        zip_code=crawl_settings.amazon_zip,
        proxy_assignments=proxies,
        on_captcha=lambda url: progress({"phase": "captcha", "message": f"CAPTCHA cần xử lý trong agent: {url}"}),
    )
    try:
        return crawl_review_pages(
            source,
            fetch_page=lambda url: pool.fetch(url, cancel_event=cancel_event),
            max_pages=int(settings.get("maxPages", 10)),
            progress=progress,
            cancel_event=cancel_event,
        )
    finally:
        pool.close()
