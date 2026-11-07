"""Read availability only from the current product's buying area."""

import re

from bs4 import BeautifulSoup

from .retry_policy import FetchFailure, html_is_captcha


def product_is_unavailable(soup: BeautifulSoup, html: str) -> bool:
    if not soup.select_one("#productTitle") or html_is_captcha(html):
        return False
    # Recommendation cards and review text must never determine availability.
    nodes = soup.select("#availability, #outOfStock, #availability_feature_div, #outOfStock_feature_div")
    messages = [node.get_text(" ", strip=True).casefold().replace("’", "'") for node in nodes
                if not node.find_parent(attrs={"aria-hidden": "true"}) and node.get("aria-hidden") != "true"]
    if not any(re.search(r"\bcurrently unavailable\s*(?:[.!]|$)", message) for message in messages):
        return False
    if any(re.search(r"your (?:location|address)|delivery location|cannot be shipped", message) for message in messages):
        return False
    # Conflicting live purchase controls/prices mean the page needs normal verification.
    for node in soup.select("#add-to-cart-button, #buy-now-button, #customizeNow, #customize-now-button"):
        if not node.has_attr("disabled") and node.get("aria-disabled") != "true":
            return False
    for node in soup.select("#corePrice_feature_div, #corePriceDisplay_desktop_feature_div, #apex_desktop, #apex-pricetopay-accessibility-label, #priceblock_ourprice, #priceblock_dealprice, #price_inside_buybox, #newBuyBoxPrice"):
        if re.search(r"\$\s*\d", node.get_text(" ", strip=True)):
            return False
    return True


def unavailable_product_error(asin: str) -> FetchFailure:
    return FetchFailure(
        f"Bỏ qua {asin}: Amazon hiện không bán sản phẩm này (Currently unavailable).",
        status="product_unavailable", reason="product_unavailable", retryable=False,
        # A cached stock observation expires; it is not a permanent ASIN blacklist.
        delay=86400,
    )
