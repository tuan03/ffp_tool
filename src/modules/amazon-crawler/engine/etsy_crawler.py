"""FFP Etsy crawler: centralized Server API baseline + Agent Playwright verifier.

Architecture split:
- Coordinator Server runs `fetch_etsy_api_baseline(...)` using `EtsyAuthStore`
  (encrypted tokens, locked refresh, centralized rate limits). Raw Etsy tokens
  never leave the Server.
- Windows Agent receives the sanitized baseline JSON, optionally runs local
  Playwright (`PlaywrightPool.extract_etsy_listing`) to verify displayed US/USD
  sale prices or extract DOM variation options, and converts the result into
  FFP's `AmazonCrawlerProduct`-compatible payload via `build_ffp_etsy_crawled_product`.
- Strict data integrity:
  - 1 Etsy listing -> 1 Shopify product (`etsy:{listingId}`).
  - Exact variant combinations, exact per-variant USD prices, and mapped
    variation images (`variation-images`); never invents Cartesian combinations
    and never assigns lowest price across variants.
  - Excludes sold-out variants and digital/download listings & variants.
  - Incomplete variant/price evidence or unmapped required personalization
    populates `syncBlockers` so the product routes to `SEO Review -> Cần xử lý`
    and never auto-syncs guessed data.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import html as html_lib
import json
import os
import re
from typing import Any, Callable
import urllib.parse

from bs4 import BeautifulSoup

from .distributed.etsy_auth_store import EtsyAuthError, EtsyAuthStore, EtsyRateLimitError
from .etsy_personalization import convert_etsy_personalization_to_customizer
from .etsy_sources import normalize_etsy_input


_SOLD_OUT_OPTION_RE = re.compile(r"\b(?:sold\s*out|out\s*of\s*stock|unavailable|not\s*available)\b", re.I)
_EXCLUDED_VARIANT_OPTION_RE = re.compile(
    r"(?:"
    r"\bdigital\s+(?:draft|png|file|download)\b|"
    r"\b(?:png|digital\s+file|digital\s+download|printable(?:\s+(?:file|download))?|instant\s+download)\b"
    r")",
    re.I,
)


class EtsyCrawlError(RuntimeError):
    """Base error for Etsy crawl failures."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "ETSY_CRAWL_FAILED",
        retryable: bool = True,
        http_status: int | None = None,
        requires_manual_intervention: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.http_status = http_status
        self.requires_manual_intervention = requires_manual_intervention


class EtsyListingNotFoundError(EtsyCrawlError):
    def __init__(self, listing_id: str) -> None:
        super().__init__(
            f"Không tìm thấy listing Etsy #{listing_id} (HTTP 404).",
            code="ETSY_LISTING_NOT_FOUND",
            retryable=False,
            http_status=404,
        )


class EtsyExcludedListingError(EtsyCrawlError):
    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message, code=code, retryable=False, http_status=422)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(str(value or ""))).strip()


def _money(value: Any, fallback_currency: str = "USD") -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    amount = value.get("amount")
    divisor = value.get("divisor") or 100
    try:
        dec = (Decimal(str(amount)) / Decimal(str(divisor))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError, ZeroDivisionError):
        return None
    if dec <= 0:
        return None
    currency = str(value.get("currency_code") or value.get("currency") or fallback_currency).upper()
    symbol = "$" if currency == "USD" else f"{currency} "
    return {"raw": f"{symbol}{float(dec):.2f}", "amount": float(dec), "currency": currency}


def _money_from_decimal(value: Decimal, currency: str = "USD") -> dict[str, Any]:
    number = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    clean_currency = currency.upper()
    symbol = "$" if clean_currency == "USD" else f"{clean_currency} "
    return {"raw": f"{symbol}{float(number):.2f}", "amount": float(number), "currency": clean_currency}


def _buyer_price_details(listing: dict[str, Any]) -> dict[str, Any]:
    value = listing.get("buyer_price") or listing.get("BuyerPrice") or {}
    if isinstance(value, dict) and isinstance(value.get("results"), list):
        value = value["results"][0] if value["results"] and isinstance(value["results"][0], dict) else {}
    if isinstance(value, list):
        value = value[0] if value and isinstance(value[0], dict) else {}
    return value if isinstance(value, dict) else {}


def _sale_ratio(buyer_price: dict[str, Any]) -> Decimal | None:
    if not buyer_price or buyer_price.get("has_discount") is not True:
        return None
    original = _money(buyer_price.get("original_price"))
    discounted = _money(buyer_price.get("discounted_price"))
    if original and discounted and original["amount"] > 0 and discounted["amount"] < original["amount"]:
        return Decimal(str(discounted["amount"])) / Decimal(str(original["amount"]))
    try:
        percentage = Decimal(str(buyer_price.get("discount_percentage")))
    except (InvalidOperation, TypeError):
        return None
    if percentage <= 0:
        return None
    if percentage <= 1:
        percentage *= Decimal("100")
    ratio = Decimal("1") - (percentage / Decimal("100"))
    return ratio if Decimal("0") < ratio < Decimal("1") else None


def _discounted_money(original: dict[str, Any] | None, ratio: Decimal | None) -> dict[str, Any] | None:
    if not original or ratio is None:
        return original
    return _money_from_decimal(Decimal(str(original["amount"])) * ratio, str(original.get("currency") or "USD"))


def _price_from_text(value: Any) -> dict[str, Any] | None:
    text = _clean(value)
    if not text:
        return None
    if re.search(r"(?:€|£|¥|₫|CA\$|AU\$|NZ\$|HK\$|SG\$|CAD|EUR|GBP|AUD)", text, re.I):
        return None
    match = re.search(r"(?:US\$|\$|USD\s*)\s*(\d[\d,]*(?:\.\d{1,2})?)", text, re.I)
    if not match:
        match = re.fullmatch(r"\s*(\d[\d,]*(?:\.\d{1,2})?)\s*", text)
    if not match:
        return None
    try:
        dec = Decimal(match.group(1).replace(",", "")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None
    if dec <= 0:
        return None
    return {"raw": f"${float(dec):.2f}", "amount": float(dec), "currency": "USD"}


def _image_record(item: dict[str, Any]) -> dict[str, Any] | None:
    full = item.get("url_fullxfull") or item.get("url_570xN") or item.get("url")
    if not full:
        return None
    thumb = item.get("url_170x135") or item.get("url_75x75") or full
    return {
        "id": str(item.get("listing_image_id") or item.get("image_id") or ""),
        "variant": "MAIN" if int(item.get("rank") or 0) == 1 else "GALLERY",
        "thumbnailUrl": str(thumb),
        "fullImageUrl": str(full),
        "alt": _clean(item.get("alt_text")) or None,
        "rank": int(item.get("rank") or 0),
        "source": "etsy_api",
    }


def _personalization_from_listing(listing: dict[str, Any], raw_assoc: Any) -> dict[str, Any] | None:
    if isinstance(raw_assoc, list):
        raw_assoc = raw_assoc[0] if raw_assoc and isinstance(raw_assoc[0], dict) else {}
    raw = raw_assoc if isinstance(raw_assoc, dict) else {}
    questions = raw.get("personalization_questions") or raw.get("questions") or []
    normalized: list[dict[str, Any]] = []
    for item in questions if isinstance(questions, list) else []:
        if not isinstance(item, dict):
            continue
        add_on_price = item.get("add_on_price")
        normalized_price = None
        if isinstance(add_on_price, dict):
            try:
                amount = Decimal(str(add_on_price.get("amount") or 0))
                divisor = Decimal(str(add_on_price.get("divisor") or 1))
                if divisor > 0 and amount > 0:
                    normalized_price = {
                        "amount": float((amount / divisor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
                        "currencyCode": str(add_on_price.get("currency_code") or "USD").upper(),
                    }
            except (InvalidOperation, TypeError, ValueError):
                normalized_price = None
        normalized.append(
            {
                "id": str(item.get("question_id") or item.get("id") or ""),
                "type": str(item.get("question_type") or item.get("type") or "text_input"),
                "label": _clean(item.get("question_text") or item.get("label")) or "Personalization",
                "instructions": _clean(item.get("instructions")) or None,
                "required": bool(item.get("required")),
                "maxCharacters": item.get("max_allowed_characters", item.get("maxCharacters")),
                "maxFiles": item.get("max_allowed_files", item.get("maxFiles")),
                "options": [
                    {
                        "id": str(option.get("option_id") or option.get("id") or ""),
                        "label": _clean(option.get("label")),
                    }
                    for option in (item.get("options") or [])
                    if isinstance(option, dict)
                ],
                "addOnPrice": normalized_price,
            }
        )

    if normalized:
        fingerprint_source = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return {
            "hasPersonalization": True,
            "isPersonalizable": True,
            "questions": normalized,
            "source": "etsy_api",
            "sourceFingerprint": hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest(),
        }

    # Check legacy single-field Etsy listing personalization attributes on `listing`
    legacy_instructions = _clean(listing.get("personalization_instructions"))
    legacy_max_chars = listing.get("personalization_char_count_max")
    if listing.get("is_personalizable") is True and (legacy_instructions or legacy_max_chars is not None):
        return {
            "is_personalizable": True,
            "personalization_is_required": bool(listing.get("personalization_is_required")),
            "personalization_instructions": legacy_instructions or None,
            "personalization_char_count_max": legacy_max_chars,
        }

    if listing.get("is_personalizable") is True:
        return {
            "hasPersonalization": True,
            "isPersonalizable": True,
            "questions": [],
            "source": "etsy_api_missing_questions",
        }
    return None


def is_digital_etsy_listing(listing: dict[str, Any]) -> bool:
    if listing.get("is_digital") is True:
        return True
    listing_type = str(listing.get("listing_type") or "").strip().lower()
    if listing_type == "download":
        return True
    return False


def parse_etsy_api_listing(
    listing: dict[str, Any],
    source_url: str,
    *,
    variation_images: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if is_digital_etsy_listing(listing):
        listing_id_raw = str(listing.get("listing_id") or "")
        raise EtsyExcludedListingError(
            f"Listing Etsy #{listing_id_raw} là sản phẩm số (digital/download), đã loại bỏ theo quy tắc.",
            code="ETSY_DIGITAL_LISTING",
        )

    normalized_source = normalize_etsy_input(str(listing.get("listing_id") or source_url))
    listing_id = normalized_source.listing_id

    def association(lower: str, upper: str) -> Any:
        value = listing.get(lower)
        if value in (None, [], {}):
            value = listing.get(upper)
        if isinstance(value, dict) and isinstance(value.get("results"), list):
            return value["results"]
        return value

    raw_images = association("images", "Images") or []
    images = [record for record in (_image_record(item) for item in raw_images if isinstance(item, dict)) if record]
    images.sort(key=lambda item: item.get("rank") or 9999)
    image_by_id = {item["id"]: item for item in images if item.get("id")}
    mapping_by_value: dict[tuple[str, str], str] = {}
    for item in variation_images or listing.get("variation_images") or []:
        if not isinstance(item, dict):
            continue
        image = image_by_id.get(str(item.get("image_id") or ""))
        if image:
            prop_id = str(item.get("property_id") or "")
            val_id = str(item.get("value_id") or item.get("value") or "")
            mapping_by_value[(prop_id, val_id)] = image["fullImageUrl"]
            if item.get("value"):
                mapping_by_value[(prop_id, _clean(item.get("value")))] = image["fullImageUrl"]

    raw_inventory = association("inventory", "Inventory")
    inventory = raw_inventory if isinstance(raw_inventory, dict) else {}
    inventory_products = inventory.get("products") or []
    inventory_loaded = isinstance(inventory_products, list) and bool(inventory_products)
    buyer_price = _buyer_price_details(listing)
    sale_ratio = _sale_ratio(buyer_price)

    labels: dict[str, str] = {}
    values: dict[str, list[str]] = {}
    variants: list[dict[str, Any]] = []
    inventory_records: list[dict[str, Any]] = []
    sold_out_variant_count = 0
    excluded_variant_count = 0

    for index, item in enumerate(inventory_products if isinstance(inventory_products, list) else []):
        if not isinstance(item, dict) or item.get("is_deleted") is True:
            continue
        offerings = [
            offer
            for offer in (item.get("offerings") or [])
            if isinstance(offer, dict) and offer.get("is_deleted") is not True
        ]
        enabled = next((offer for offer in offerings if offer.get("is_enabled") is True), None)
        list_price = _money((enabled or {}).get("price"))
        if list_price and list_price.get("currency") != "USD":
            list_price = None
        price = _discounted_money(list_price, sale_ratio)
        optionvalues: dict[str, dict[str, Any]] = {}
        selected_image = None
        for prop in item.get("property_values") or []:
            if not isinstance(prop, dict):
                continue
            property_id = str(prop.get("property_id") or "custom")
            key = f"etsy_property_{property_id}"
            label = _clean(prop.get("property_name") or "Option")
            raw_values = prop.get("values") or []
            value = _clean(raw_values[0] if raw_values else prop.get("value"))
            value_ids = prop.get("value_ids") or []
            value_id = str(value_ids[0]) if value_ids else value
            optionvalues[key] = {
                "label": label,
                "value": value,
                "propertyId": property_id,
                "valueId": value_id,
            }
            selected_image = (
                selected_image
                or mapping_by_value.get((property_id, value_id))
                or mapping_by_value.get((property_id, value))
            )

        sold_out_label = any(_SOLD_OUT_OPTION_RE.search(str(opt.get("value") or "")) for opt in optionvalues.values())
        excluded_variant = not sold_out_label and any(
            _EXCLUDED_VARIANT_OPTION_RE.search(str(opt.get("value") or ""))
            for opt in optionvalues.values()
        )
        if excluded_variant:
            excluded_variant_count += 1
            continue

        source_variant_id = str(item.get("product_id") or f"{listing_id}-{index + 1}")
        available = bool(
            enabled
            and enabled.get("is_enabled") is not False
            and int(enabled.get("quantity") or 0) > 0
            and not sold_out_label
        )
        common_record = {
            "sourcePlatform": "etsy",
            "sourceVariantId": source_variant_id,
            "productId": source_variant_id,
            "listingId": listing_id,
            "label": " / ".join(v.get("value") for v in optionvalues.values() if v.get("value")) or _clean(listing.get("title")),
            "sku": item.get("sku") or None,
            "price": price,
            "listPrice": list_price if sale_ratio is not None else None,
            "quantity": int((enabled or {}).get("quantity") or 0),
            "available": available,
            "optionvalues": optionvalues,
            "optionValues": optionvalues,
            "imageUrl": selected_image or (images[0]["fullImageUrl"] if images else None),
            "thumbnailUrl": selected_image or (images[0]["thumbnailUrl"] if images else None),
            "verification": {
                "verified": bool(price) if available else True,
                "priceVerified": bool(price),
                "source": "etsy_api_buyer_price" if sale_ratio is not None else "etsy_api_inventory",
                "warnings": [] if price or not available else ["Exact Etsy offering price was not available"],
            },
        }
        inventory_records.append(common_record)
        if not available:
            sold_out_variant_count += 1
            continue

        for key, option in optionvalues.items():
            labels[key] = option["label"]
            val = option.get("value")
            if val and val not in values.setdefault(key, []):
                values[key].append(val)

        variants.append(
            {
                **common_record,
                "images": [entry["fullImageUrl"] for entry in images],
                "imageObjects": images,
                "thumbnails": [{"type": "image", **entry} for entry in images],
            }
        )

    if inventory_loaded and not variants:
        if excluded_variant_count > 0 and sold_out_variant_count == 0:
            raise EtsyExcludedListingError(
                f"Listing Etsy #{listing_id} chỉ chứa biến thể số (digital/download), đã loại bỏ.",
                code="ETSY_DIGITAL_LISTING",
            )
        raise EtsyExcludedListingError(
            f"Listing Etsy #{listing_id} đã hết hàng toàn bộ biến thể.",
            code="ETSY_LISTING_SOLD_OUT",
        )

    listing_original_price = _money(buyer_price.get("original_price")) or _money(listing.get("price"))
    if listing_original_price and listing_original_price.get("currency") != "USD":
        listing_original_price = None
    listing_discounted_price = _money(buyer_price.get("discounted_price")) if sale_ratio is not None else None
    if listing_discounted_price and listing_discounted_price.get("currency") != "USD":
        listing_discounted_price = None
    base_price = listing_discounted_price or listing_original_price

    listing_state = str(listing.get("state") or "active").strip().lower()
    if listing_state in {"sold_out", "expired", "removed", "unavailable"}:
        raise EtsyExcludedListingError(
            f"Listing Etsy #{listing_id} không còn mở bán (trạng thái: {listing_state}).",
            code="ETSY_LISTING_SOLD_OUT",
        )

    has_variations_flag = bool(listing.get("has_variations")) or bool(inventory_loaded and labels)
    if not variants and not inventory_loaded:
        if int(listing.get("quantity") or 1) <= 0 and not has_variations_flag:
            raise EtsyExcludedListingError(
                f"Listing Etsy #{listing_id} đã hết hàng.",
                code="ETSY_LISTING_SOLD_OUT",
            )
        variants = [
            {
                "sourcePlatform": "etsy",
                "sourceVariantId": listing_id,
                "productId": listing_id,
                "listingId": listing_id,
                "label": _clean(listing.get("title")),
                "sku": None,
                "price": base_price if not has_variations_flag else None,
                "quantity": int(listing.get("quantity") or 0),
                "available": listing_state == "active",
                "optionvalues": {},
                "optionValues": {},
                "imageUrl": images[0]["fullImageUrl"] if images else None,
                "thumbnailUrl": images[0]["thumbnailUrl"] if images else None,
                "images": [entry["fullImageUrl"] for entry in images],
                "imageObjects": images,
                "thumbnails": [{"type": "image", **entry} for entry in images],
                "verification": {
                    "verified": bool(base_price) and not has_variations_flag,
                    "priceVerified": bool(base_price) and not has_variations_flag,
                    "source": "etsy_api_listing",
                },
            }
        ]

    raw_videos = association("videos", "Videos") or []
    videos = [
        {
            "url": str(item.get("video_url")),
            "thumbnailUrl": item.get("thumbnail_url"),
            "source": "etsy_api",
        }
        for item in raw_videos
        if isinstance(item, dict) and item.get("video_url")
    ]
    raw_shop = association("shop", "Shop")
    if isinstance(raw_shop, list):
        raw_shop = raw_shop[0] if raw_shop and isinstance(raw_shop[0], dict) else {}
    shop = raw_shop if isinstance(raw_shop, dict) else {}

    description = str(listing.get("description") or "").strip()
    materials = [str(item).strip() for item in (listing.get("materials") or []) if str(item or "").strip()]
    tags = [str(item).strip() for item in (listing.get("tags") or []) if str(item or "").strip()]
    taxonomy = [str(item).strip() for item in (listing.get("taxonomy_path") or []) if str(item or "").strip()]
    shop_name = _clean(shop.get("shop_name") or listing.get("shop_name"))
    details: dict[str, str] = {}
    if shop_name:
        details["Shop"] = shop_name
    if listing.get("state"):
        details["State"] = str(listing.get("state"))
    if materials:
        details["Materials"] = ", ".join(materials)

    personalization = _personalization_from_listing(listing, association("personalization", "Personalization"))
    dimensions = list(labels)
    warnings: list[str] = []
    if listing.get("is_personalizable") is True and (
        not personalization
        or (isinstance(personalization.get("questions"), list) and len(personalization["questions"]) == 0 and not personalization.get("personalization_instructions"))
    ):
        warnings.append("Listing Etsy bật cá nhân hóa nhưng chưa đọc được danh sách câu hỏi cá nhân hóa.")
    if inventory_products and any(not variant.get("price") for variant in variants):
        warnings.append("Một số biến thể Etsy chưa có giá USD xác thực.")
    if sold_out_variant_count:
        warnings.append(f"Đã loại {sold_out_variant_count} biến thể Etsy hết hàng.")
    if excluded_variant_count:
        warnings.append(f"Đã loại {excluded_variant_count} biến thể Etsy sản phẩm số.")

    variant_prices = [variant["price"] for variant in variants if variant.get("price")]
    variant_list_prices = [variant["listPrice"] for variant in variants if variant.get("listPrice")]
    product_price = min(variant_prices, key=lambda item: item["amount"]) if inventory_loaded and variant_prices else base_price
    product_list_price = (
        min(variant_list_prices, key=lambda item: item["amount"])
        if variant_list_prices
        else (listing_original_price if sale_ratio is not None else None)
    )

    return {
        "sourcePlatform": "etsy",
        "sourceProductId": listing_id,
        "listingId": listing_id,
        "url": normalized_source.canonical_url,
        "canonicalUrl": normalized_source.canonical_url,
        "title": _clean(listing.get("title")),
        "brand": shop_name or None,
        "price": product_price,
        "listPrice": product_list_price,
        "availability": "Active" if listing_state == "active" else _clean(listing.get("state")),
        "description": description,
        "mainImage": images[0]["fullImageUrl"] if images else None,
        "images": [item["fullImageUrl"] for item in images],
        "imageObjects": images,
        "videos": videos,
        "categories": taxonomy,
        "tags": tags,
        "materials": materials,
        "productDetails": details,
        "personalization": personalization,
        "variants": {
            "parentSourceId": listing_id,
            "dimensions": dimensions,
            "variationDisplayLabels": labels,
            "variationValues": values,
            "numTotalVariations": len(inventory_records) if inventory_loaded else len(variants),
            "availableVariationCount": len(variants),
            "unavailableVariationCount": sold_out_variant_count,
            "excludedVariationCount": excluded_variant_count,
            "inventoryRecords": inventory_records,
            "variants": variants,
        },
        "sourceMeta": {
            "shopId": str(listing.get("shop_id") or shop.get("shop_id") or ""),
            "shopName": shop_name or None,
            "state": listing.get("state"),
            "hasVariations": has_variations_flag,
            "inventoryLoaded": inventory_loaded,
            "inventoryProductCount": len(inventory_records),
            "availableVariationCount": len(variants),
            "unavailableVariationCount": sold_out_variant_count,
            "soldOutVariantCount": sold_out_variant_count,
            "excludedVariantCount": excluded_variant_count,
            "buyerPriceLoaded": bool(buyer_price),
            "salePriceApplied": sale_ratio is not None,
        },
        "sourceWarnings": warnings,
        "dataSource": "etsy_api",
        "crawledAt": _now_iso(),
    }


def _api_results(payload: Any) -> Any:
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        return payload["results"]
    return payload


def etsy_inventory_complete(product: dict[str, Any]) -> bool:
    meta = product.get("sourceMeta") if isinstance(product.get("sourceMeta"), dict) else {}
    return bool(meta.get("inventoryLoaded") or meta.get("variantInventoryVerified")) or meta.get("hasVariations") is False


def etsy_display_price_verification_needed(product: dict[str, Any]) -> bool:
    if str(os.getenv("ETSY_VERIFY_DISPLAYED_PRICES", "1")).strip().lower() in {"0", "false", "no", "off"}:
        return False
    meta = product.get("sourceMeta") if isinstance(product.get("sourceMeta"), dict) else {}
    return not bool(meta.get("salePriceApplied") or meta.get("buyerPriceLoaded"))


def fetch_etsy_api_baseline(
    listing_id_or_url: str,
    auth_store: EtsyAuthStore,
    *,
    log: Callable[..., None] | None = None,
) -> dict[str, Any]:
    """Fetch Etsy Open API v3 listing + inventory + buyerPrice on the Coordinator Server.

    NEVER includes raw OAuth tokens, shared secrets, or API keys in the returned dict.
    """
    normalized = normalize_etsy_input(listing_id_or_url)
    listing_id = normalized.listing_id

    query = urllib.parse.urlencode(
        {
            "includes": "Images,Shop,Videos,Personalization,BuyerPrice",
            "currency": "USD",
            "buyer_country": "US",
            "language": "en-US",
        }
    )
    try:
        payload, _ = auth_store.request_json(f"listings/{listing_id}?{query}", oauth=False)
    except (EtsyAuthError, EtsyRateLimitError):
        raise
    except RuntimeError as exc:
        msg = str(exc)
        if "HTTP 404" in msg:
            raise EtsyListingNotFoundError(listing_id) from exc
        if "HTTP 400" not in msg:
            raise EtsyCrawlError(f"Lỗi đọc Etsy API cho listing #{listing_id}: {msg}") from exc
        fallback_query = urllib.parse.urlencode(
            {
                "includes": "Images,Shop,Videos,Personalization",
                "currency": "USD",
                "buyer_country": "US",
            }
        )
        payload, _ = auth_store.request_json(f"listings/{listing_id}?{fallback_query}", oauth=False)

    listing_result = _api_results(payload)
    listing = listing_result[0] if isinstance(listing_result, list) and listing_result else listing_result
    if not isinstance(listing, dict):
        raise EtsyCrawlError(f"Etsy API trả dữ liệu không hợp lệ cho listing #{listing_id}.", retryable=False)

    if is_digital_etsy_listing(listing):
        raise EtsyExcludedListingError(
            f"Listing Etsy #{listing_id} là sản phẩm số (digital/download), đã loại bỏ theo quy tắc.",
            code="ETSY_DIGITAL_LISTING",
        )

    if _sale_ratio(_buyer_price_details(listing)) is None:
        batch_query = urllib.parse.urlencode(
            {
                "listing_ids": listing_id,
                "includes": "BuyerPrice",
                "currency": "USD",
                "buyer_country": "US",
                "language": "en-US",
            }
        )
        try:
            bp_payload, _ = auth_store.request_json(f"listings/batch?{batch_query}", oauth=False)
            bp_results = _api_results(bp_payload)
            bp_item = bp_results[0] if isinstance(bp_results, list) and bp_results and isinstance(bp_results[0], dict) else {}
            bp = _buyer_price_details(bp_item)
            if bp:
                listing["buyer_price"] = bp
        except EtsyRateLimitError:
            raise
        except Exception as exc:
            if log:
                log("etsy_buyer_price_unavailable", listingId=listing_id, error=str(exc))

    inventory = listing.get("inventory") or listing.get("Inventory")
    if not isinstance(inventory, dict) or not isinstance(inventory.get("products"), list):
        try:
            inv_payload, _ = auth_store.request_json(f"listings/{listing_id}/inventory", oauth=True)
            inv_value = _api_results(inv_payload)
            if isinstance(inv_value, dict):
                listing["inventory"] = inv_value
        except (EtsyAuthError, EtsyRateLimitError):
            raise
        except Exception as exc:
            if log:
                log("etsy_inventory_unavailable", listingId=listing_id, error=str(exc))

    for field_name, path_suffix in (
        ("images", "images"),
        ("videos", "videos"),
        ("personalization", "personalization"),
    ):
        existing_val = listing.get(field_name) or listing.get(field_name.capitalize())
        is_missing = (
            (not isinstance(existing_val, list) or (field_name == "images" and not existing_val))
            if field_name in {"images", "videos"}
            else not isinstance(existing_val, (dict, list))
        )
        if is_missing:
            try:
                comp_payload, _ = auth_store.request_json(f"listings/{listing_id}/{path_suffix}", oauth=False)
                comp_val = _api_results(comp_payload)
                if comp_val is not None:
                    listing[field_name] = comp_val
            except EtsyRateLimitError:
                raise
            except Exception:
                pass

    shop_id = listing.get("shop_id") or (
        (listing.get("shop") or {}).get("shop_id") if isinstance(listing.get("shop"), dict) else None
    )
    variation_images: list[dict[str, Any]] = []
    if shop_id:
        try:
            var_img_payload, _ = auth_store.request_json(
                f"shops/{shop_id}/listings/{listing_id}/variation-images",
                oauth=False,
            )
            if isinstance(var_img_payload, dict) and isinstance(var_img_payload.get("results"), list):
                variation_images = var_img_payload["results"]
        except EtsyRateLimitError:
            raise
        except Exception:
            pass

    api_product = parse_etsy_api_listing(listing, normalized.canonical_url, variation_images=variation_images)
    return {
        "listingId": listing_id,
        "canonicalUrl": normalized.canonical_url,
        "apiProduct": api_product,
        "needsBrowserVariants": not etsy_inventory_complete(api_product),
        "needsPriceVerification": etsy_display_price_verification_needed(api_product),
    }


def _option_signature(values: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    normalized: list[tuple[str, str]] = []
    for label, raw_value in values.items():
        if isinstance(raw_value, dict):
            label = raw_value.get("label") or label
            raw_value = raw_value.get("value")
        clean_label = re.sub(r"[^a-z0-9]+", "", _clean(label).lower())
        clean_value = re.sub(r"\s+", " ", _clean(raw_value).lower())
        if clean_value:
            normalized.append((clean_label, clean_value))
    return tuple(sorted(normalized))


def apply_playwright_variants(product: dict[str, Any], fetched: dict[str, Any], listing_id: str) -> dict[str, Any]:
    records = fetched.get("etsyVariants") if isinstance(fetched.get("etsyVariants"), list) else []
    variation_count = int(fetched.get("etsyVariationCount") or 0)
    if not records:
        return product
    source_meta = product.setdefault("sourceMeta", {})
    # A missing DOM control must not turn an API-confirmed variable listing
    # into a single-variant product (for example after a layout change).
    if source_meta.get("hasVariations") is True and variation_count == 0:
        source_meta["variantInventoryVerified"] = False
        return product
    complete_options = all(
        isinstance(record, dict)
        and isinstance(record.get("optionValues"), dict)
        and len(record["optionValues"]) == variation_count
        and all(_clean(value) for value in record["optionValues"].values())
        for record in records
    )
    labels: dict[str, str] = {}
    values: dict[str, list[str]] = {}
    variants: list[dict[str, Any]] = []
    inventory_records: list[dict[str, Any]] = []
    product_images = list(product.get("images") or [])
    sold_out_variant_count = 0
    excluded_variant_count = 0

    for record in records:
        if not isinstance(record, dict):
            continue
        raw_options = record.get("optionValues") if isinstance(record.get("optionValues"), dict) else {}
        sold_out = any(_SOLD_OUT_OPTION_RE.search(str(val or "")) for val in raw_options.values())
        excluded_variant = not sold_out and any(
            _EXCLUDED_VARIANT_OPTION_RE.search(str(val or ""))
            for val in raw_options.values()
        )
        if excluded_variant:
            excluded_variant_count += 1
            continue
        optionvalues: dict[str, dict[str, Any]] = {}
        identity_parts: list[str] = []
        for option_index, (label, val) in enumerate(raw_options.items()):
            key = f"etsy_dom_{option_index + 1}"
            clean_label = _clean(label) or f"Option {option_index + 1}"
            clean_value = _clean(val)
            optionvalues[key] = {"label": clean_label, "value": clean_value}
            identity_parts.append(f"{clean_label}={clean_value}")

        digest = hashlib.sha1("|".join(identity_parts).encode("utf-8")).hexdigest()[:12] if identity_parts else ""
        source_variant_id = f"DOM-{listing_id}-{digest}" if digest else listing_id
        price = _price_from_text(record.get("priceText"))
        image_url = str(record.get("imageUrl") or product.get("mainImage") or "").strip() or None
        gallery = list(dict.fromkeys([item for item in [image_url, *product_images] if item]))
        normalized_record = {
            "sourcePlatform": "etsy",
            "sourceVariantId": source_variant_id,
            "productId": None,
            "listingId": listing_id,
            "label": " / ".join(item.get("value") for item in optionvalues.values() if item.get("value")) or product.get("title"),
            "sku": None,
            "price": price,
            "quantity": None,
            "available": not sold_out,
            "optionvalues": optionvalues,
            "optionValues": optionvalues,
            "imageUrl": image_url,
            "thumbnailUrl": image_url,
            "images": gallery,
            "verification": {
                "verified": bool(price),
                "priceVerified": bool(price),
                "displayPriceVerified": bool(price),
                "source": "etsy_playwright_variation",
                "warnings": [] if price else ["Không đọc được giá USD khi chọn biến thể trên trình duyệt Etsy."],
            },
        }
        inventory_records.append(normalized_record)
        if sold_out:
            sold_out_variant_count += 1
            continue
        for key, opt in optionvalues.items():
            labels[key] = opt["label"]
            val_text = opt.get("value")
            if val_text and val_text not in values.setdefault(key, []):
                values[key].append(val_text)
        variants.append(normalized_record)

    if not variants:
        if excluded_variant_count > 0 and sold_out_variant_count == 0:
            raise EtsyExcludedListingError(
                f"Listing Etsy #{listing_id} chỉ chứa biến thể số (digital/download), đã loại bỏ.",
                code="ETSY_DIGITAL_LISTING",
            )
        if sold_out_variant_count > 0:
            raise EtsyExcludedListingError(
                f"Listing Etsy #{listing_id} đã hết hàng toàn bộ biến thể.",
                code="ETSY_LISTING_SOLD_OUT",
            )
        return product

    product["variants"] = {
        "parentSourceId": listing_id,
        "dimensions": list(labels),
        "variationDisplayLabels": labels,
        "variationValues": values,
        "numTotalVariations": len(inventory_records),
        "availableVariationCount": len(variants),
        "unavailableVariationCount": sold_out_variant_count,
        "excludedVariationCount": excluded_variant_count,
        "inventoryRecords": inventory_records,
        "variants": variants,
    }
    exact_prices = [item["price"]["amount"] for item in variants if item.get("price")]
    if exact_prices:
        minimum = min(exact_prices)
        product["price"] = {"raw": f"${minimum:.2f}", "amount": minimum, "currency": "USD"}
    source_meta = product.setdefault("sourceMeta", {})
    all_prices_verified = bool(variants) and all(bool(item.get("price")) for item in variants)
    source_meta.update(
        {
            "hasVariations": variation_count > 0,
            "variantInventoryVerified": all_prices_verified and complete_options and fetched.get("etsyInventoryComplete") is not False,
            "displayPriceVerifiedCount": sum(1 for item in variants if item.get("price")),
            "playwrightVariationCount": variation_count,
            "inventoryProductCount": len(inventory_records),
            "availableVariationCount": len(variants),
        }
    )
    _append_playwright_videos(product, fetched)
    product["dataSource"] = "hybrid"
    return product


def apply_playwright_prices(product: dict[str, Any], fetched: dict[str, Any]) -> dict[str, Any]:
    records = fetched.get("etsyVariants") if isinstance(fetched.get("etsyVariants"), list) else []
    variants = (product.get("variants") or {}).get("variants") or []
    _append_playwright_videos(product, fetched)
    if not records or not variants:
        return product

    records_by_signature: dict[tuple[tuple[str, str], ...], dict[str, Any]] = {}
    records_by_values: dict[tuple[str, ...], dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        raw_options = record.get("optionValues") if isinstance(record.get("optionValues"), dict) else {}
        if any(_SOLD_OUT_OPTION_RE.search(str(val or "")) for val in raw_options.values()):
            continue
        signature = _option_signature(raw_options)
        if signature:
            records_by_signature[signature] = record
            records_by_values[tuple(sorted(val for _, val in signature))] = record

    verified_count = 0
    discounted_count = 0
    for variant in variants:
        signature = _option_signature(variant.get("optionvalues") or variant.get("optionValues") or {})
        record = records_by_signature.get(signature)
        if record is None and signature:
            record = records_by_values.get(tuple(sorted(val for _, val in signature)))
        if record is None and len(records) == 1 and len(variants) == 1:
            record = records[0]
        if not isinstance(record, dict):
            continue

        api_price = variant.get("listPrice") or variant.get("price")
        displayed_price = _price_from_text(record.get("priceText"))
        displayed_original = _price_from_text(record.get("originalPriceText"))
        # A page-wide discount banner is not evidence of this selected variant's
        # price. Only an observed buy-box amount can verify the browser result.
        if not displayed_price:
            continue

        original_price = displayed_original or api_price
        is_discounted = bool(original_price and displayed_price["amount"] < original_price["amount"])
        variant["price"] = displayed_price
        variant["listPrice"] = original_price if is_discounted else None
        if not variant.get("imageUrl") and record.get("imageUrl"):
            variant["imageUrl"] = str(record["imageUrl"]).strip()
        verification = variant.setdefault("verification", {})
        verification.update(
            {
                "verified": True,
                "priceVerified": True,
                "source": "etsy_playwright_buy_box",
                "displayPriceVerified": True,
            }
        )
        verified_count += 1
        discounted_count += int(is_discounted)

    verified_prices = [
        variant["price"]
        for variant in variants
        if (variant.get("verification") or {}).get("displayPriceVerified") and variant.get("price")
    ]
    if verified_prices:
        product["price"] = min(verified_prices, key=lambda item: item["amount"])
    source_meta = product.setdefault("sourceMeta", {})
    source_meta["displayPriceVerifiedCount"] = verified_count
    source_meta["salePriceApplied"] = bool(source_meta.get("salePriceApplied")) or discounted_count > 0
    source_meta["displayPriceSource"] = "etsy_playwright_buy_box" if verified_count else None
    product["dataSource"] = "hybrid"
    return product


def _append_playwright_videos(product: dict[str, Any], fetched: dict[str, Any]) -> None:
    videos = list(product.get("videos") or [])
    known = {str(item.get("url") or "") for item in videos if isinstance(item, dict)}
    for url in fetched.get("videoResources") or []:
        clean_url = str(url or "").strip()
        if clean_url and clean_url not in known:
            videos.append({"url": clean_url, "thumbnailUrl": None, "source": "etsy_playwright_network"})
            known.add(clean_url)
    product["videos"] = videos


def merge_etsy_browser_verification(
    baseline: dict[str, Any],
    browser_payload: dict[str, Any] | None = None,
    *,
    browser_error: str | None = None,
    requires_manual_intervention: bool = False,
) -> dict[str, Any]:
    """Merge Agent Playwright output (or failure metadata) onto Server API baseline."""
    product = json.loads(json.dumps(baseline["apiProduct"]))
    listing_id = str(baseline["listingId"])
    needs_variants = bool(baseline.get("needsBrowserVariants"))
    needs_prices = bool(baseline.get("needsPriceVerification"))

    source_meta = product.setdefault("sourceMeta", {})
    source_meta["needsBrowserVariants"] = needs_variants
    source_meta["needsPriceVerification"] = needs_prices
    if requires_manual_intervention:
        source_meta["requiresManualIntervention"] = True

    if browser_payload:
        if needs_variants:
            product = apply_playwright_variants(product, browser_payload, listing_id)
        elif needs_prices:
            product = apply_playwright_prices(product, browser_payload)
        else:
            _append_playwright_videos(product, browser_payload)
    elif browser_error:
        source_meta["browserVerificationError"] = browser_error
        product.setdefault("sourceWarnings", []).append(f"Trình duyệt xác minh Etsy gặp lỗi: {browser_error}")

    return product


def build_ffp_etsy_crawled_product(
    etsy_product: dict[str, Any],
    *,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Convert an Etsy product payload into FFP's `AmazonCrawlerProduct`-compatible contract.

    Never applies Amazon Jeminise/Preaureum presets, never invents variation combinations,
    and populates `syncBlockers` whenever variant/price evidence or required personalization
    mapping is incomplete.
    """
    listing_id = str(etsy_product.get("listingId") or etsy_product.get("sourceProductId") or "").strip()
    canonical_url = str(etsy_product.get("canonicalUrl") or f"https://www.etsy.com/listing/{listing_id}")
    title = _clean(etsy_product.get("title")) or f"Etsy Listing {listing_id}"
    description = str(etsy_product.get("description") or "").strip() or None
    source_meta = dict(etsy_product.get("sourceMeta") or {})
    warnings = [str(w) for w in (etsy_product.get("sourceWarnings") or []) if str(w or "").strip()]
    sync_blockers: list[str] = []

    raw_variants_block = etsy_product.get("variants") if isinstance(etsy_product.get("variants"), dict) else {}
    raw_variants = list(raw_variants_block.get("variants") or [])
    display_labels = dict(raw_variants_block.get("variationDisplayLabels") or {})

    # 1. Check variant & inventory evidence completeness
    inventory_complete = etsy_inventory_complete(etsy_product)
    if not inventory_complete:
        browser_err = source_meta.get("browserVerificationError")
        reason_suffix = f" ({browser_err})" if browser_err else ""
        sync_blockers.append(
            f"Chưa xác minh đủ tổ hợp biến thể Etsy từ API hoặc trình duyệt{reason_suffix}; chuyển Cần xử lý, không tự động sync."
        )

    # 2. Check displayed US/USD price verification completeness
    needs_price_verification = bool(source_meta.get("needsPriceVerification"))
    verified_display_count = int(source_meta.get("displayPriceVerifiedCount") or 0)
    if needs_price_verification and not bool(source_meta.get("buyerPriceLoaded")):
        if verified_display_count < len(raw_variants):
            browser_err = source_meta.get("browserVerificationError")
            if source_meta.get("requiresManualIntervention"):
                sync_blockers.append(
                    f"Trang Etsy yêu cầu thao tác thủ công trên trình duyệt ({browser_err or 'DataDome/CAPTCHA'}); chưa xác minh được giá hiển thị US."
                )
            elif browser_err:
                sync_blockers.append(
                    f"Không thể xác minh giá hiển thị US qua trình duyệt Etsy ({browser_err}); chuyển Cần xử lý để kiểm tra giá trước khi sync."
                )
            else:
                sync_blockers.append(
                    f"Chỉ xác minh được giá hiển thị US cho {verified_display_count}/{len(raw_variants)} biến thể Etsy; chuyển Cần xử lý."
                )

    # 3. Convert personalization -> FFP Customizer contract
    personalization_conv = convert_etsy_personalization_to_customizer(
        etsy_product.get("personalization"),
        listing_id=listing_id,
        canonical_url=canonical_url,
        product_image_url=str(etsy_product.get("mainImage") or ""),
    )
    warnings.extend(personalization_conv.warnings)
    if personalization_conv.blockers:
        sync_blockers.extend(personalization_conv.blockers)

    # 4. Build product media gallery preserving variation-image linkage
    raw_image_objects = list(etsy_product.get("imageObjects") or [])
    seen_urls: dict[str, int] = {}
    media: list[dict[str, Any]] = []
    for idx, img_obj in enumerate(raw_image_objects):
        if not isinstance(img_obj, dict):
            continue
        url = str(img_obj.get("fullImageUrl") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls[url] = len(media)
        media.append(
            {
                "url": url,
                "kind": "image",
                "alt": img_obj.get("alt") or title,
                "isMain": idx == 0,
            }
        )
    if not media:
        for idx, raw_url in enumerate(etsy_product.get("images") or []):
            url = str(raw_url or "").strip()
            if not url or url in seen_urls:
                continue
            seen_urls[url] = len(media)
            media.append({"url": url, "kind": "image", "alt": title, "isMain": idx == 0})

    # 5. Build exact 1-to-1 `sourceVariants` and `variants`
    dimensions: dict[str, list[str]] = {}
    source_variants: list[dict[str, Any]] = []
    final_variants: list[dict[str, Any]] = []
    missing_price_labels: list[str] = []

    for index, raw_var in enumerate(raw_variants):
        if not isinstance(raw_var, dict):
            continue
        raw_opt_map = raw_var.get("optionvalues") or raw_var.get("optionValues") or {}
        options: dict[str, str] = {}
        for opt_key, opt_entry in raw_opt_map.items():
            if isinstance(opt_entry, dict):
                opt_label = _clean(opt_entry.get("label") or display_labels.get(opt_key) or opt_key)
                opt_val = _clean(opt_entry.get("value"))
            else:
                opt_label = _clean(display_labels.get(opt_key) or opt_key)
                opt_val = _clean(opt_entry)
            if opt_label and opt_val:
                options[opt_label] = opt_val
                if opt_val not in dimensions.setdefault(opt_label, []):
                    dimensions[opt_label].append(opt_val)

        raw_price = raw_var.get("price") if isinstance(raw_var.get("price"), dict) else None
        if raw_price and str(raw_price.get("currency") or "USD").upper() != "USD":
            raw_price = None
        verification = raw_var.get("verification") if isinstance(raw_var.get("verification"), dict) else {}
        if not raw_price or verification.get("priceVerified") is False:
            missing_price_labels.append(str(raw_var.get("label") or f"#{index + 1}"))
            raw_price = None

        source_variant_id = str(raw_var.get("sourceVariantId") or f"{listing_id}-{index + 1}").strip()
        raw_product_id = raw_var.get("productId")
        etsy_product_id = (
            str(raw_product_id).strip()
            if raw_product_id is not None
            and str(raw_product_id).strip()
            and not str(raw_product_id).strip().startswith("DOM-")
            and str(raw_product_id).strip() != listing_id
            else (
                source_variant_id
                if source_variant_id.isdigit() and source_variant_id != listing_id
                else None
            )
        )

        var_image_url = str(raw_var.get("imageUrl") or "").strip() or None
        if var_image_url:
            if var_image_url not in seen_urls:
                seen_urls[var_image_url] = len(media)
                media.append(
                    {
                        "url": var_image_url,
                        "kind": "image",
                        "sourceVariantId": source_variant_id,
                        "alt": title,
                        "isMain": len(media) == 0,
                    }
                )
            else:
                media_item = media[seen_urls[var_image_url]]
                if not media_item.get("sourceVariantId"):
                    media_item["sourceVariantId"] = source_variant_id

        source_variants.append(
            {
                "asin": "",
                "sourceVariantId": source_variant_id,
                "etsyProductId": etsy_product_id,
                "url": canonical_url,
                "options": options,
                "price": raw_price,
                "media": [{"url": var_image_url, "kind": "image"}] if var_image_url else [],
                "customizationFingerprint": personalization_conv.fingerprint,
                "priceInference": {"isInferred": False, "sourceAsins": []},
                "warnings": list(verification.get("warnings") or []),
            }
        )

        final_variants.append(
            {
                "id": f"etsy-var-{source_variant_id}",
                "sku": "",
                "sourceAsin": None,
                "sourceVariantId": source_variant_id,
                "etsyProductId": etsy_product_id,
                "options": options,
                "price": raw_price,
                "surcharge": None,
                "mediaUrl": var_image_url,
                "metadata": {
                    "sourcePlatform": "etsy",
                    "listingId": listing_id,
                    "sourceVariantId": source_variant_id,
                    "etsyProductId": etsy_product_id,
                    "quantity": raw_var.get("quantity"),
                    "verificationSource": verification.get("source"),
                },
            }
        )

    if not final_variants:
        sync_blockers.append("Listing Etsy không có biến thể hợp lệ để tạo sản phẩm Shopify.")
    elif missing_price_labels:
        preview = ", ".join(missing_price_labels[:4])
        sync_blockers.append(
            f"Thiếu giá USD xác thực cho biến thể Etsy ({preview}); chuyển Cần xử lý, không tự động sync."
        )

    deduped_blockers = list(dict.fromkeys(b for b in sync_blockers if b))
    deduped_warnings = list(dict.fromkeys([*warnings, *deduped_blockers]))

    videos = [
        item for item in (etsy_product.get("videos") or [])
        if isinstance(item, dict) and item.get("url")
    ]
    tags = [str(item) for item in (etsy_product.get("tags") or []) if str(item or "").strip()]
    materials = [str(item) for item in (etsy_product.get("materials") or []) if str(item or "").strip()]
    categories = [str(item) for item in (etsy_product.get("categories") or []) if str(item or "").strip()]

    diag = {
        "fetchMode": "mixed" if etsy_product.get("dataSource") == "hybrid" else "http",
        "attempts": 1,
        "captchaEncountered": bool(source_meta.get("requiresManualIntervention")),
        "locationFallbackUsed": False,
        "matrixSwept": bool(etsy_product.get("dataSource") == "hybrid"),
        "cacheHit": False,
        **(diagnostics or {}),
    }

    return {
        "id": f"etsy-{listing_id}",
        "sourcePlatform": "etsy",
        "sourceProductId": listing_id,
        "listingId": listing_id,
        "sourceKey": f"etsy:{listing_id}",
        "asin": "",
        "parentAsin": "",
        "canonicalUrl": canonical_url,
        "sourceTitle": title,
        "title": title,
        "description": description,
        "bulletPoints": [],
        "categories": categories,
        "tags": tags,
        "materials": materials,
        "productDetails": dict(etsy_product.get("productDetails") or {}),
        "media": media,
        "videos": videos,
        "etsyContext": {
            "listingId": listing_id,
            "canonicalUrl": canonical_url,
            "shopId": source_meta.get("shopId") or None,
            "shopName": source_meta.get("shopName") or etsy_product.get("brand") or None,
            "tags": tags,
            "materials": materials,
            "taxonomy": categories,
            "videos": videos,
            "personalization": etsy_product.get("personalization"),
        },
        "sourceVariants": source_variants,
        "variants": final_variants,
        "variantMatrix": {
            "dimensions": dimensions,
            "expectedCount": len(final_variants),
            "discoveredCount": len(final_variants),
            "complete": inventory_complete and not missing_price_labels and bool(final_variants),
            "safetyCap": max(len(final_variants), 250),
        },
        "customization": personalization_conv.customization,
        "customizerAuditStatus": personalization_conv.audit_status,
        "customizationBlockers": list(personalization_conv.blockers),
        "syncBlockers": deduped_blockers,
        "evidenceComplete": inventory_complete and not missing_price_labels and (
            not needs_price_verification
            or bool(source_meta.get("buyerPriceLoaded"))
            or verified_display_count >= len(raw_variants)
        ),
        "requiresManualIntervention": bool(source_meta.get("requiresManualIntervention")),
        "splitContext": {
            "attribute": None,
            "value": None,
            "groupKey": f"etsy:{listing_id}",
            "sourceAsins": [],
        },
        "preset": None,
        "warnings": deduped_warnings,
        "diagnostics": diag,
    }
