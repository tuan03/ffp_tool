"""Jeminise variant presets for Bedding and Blanket ported from the production store."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

BEDDING_PRESET_ID = "jeminise_bedding_v2"
BLANKET_PRESET_ID = "jeminise_blanket_v1"
PRESET_ID = BEDDING_PRESET_ID

# Standardized Bedding Option Names & Values matching Jeminise store
BEDDING_TYPE_OPTION = "Bedding Type"
BEDDING_SIZE_OPTION = "Size"
BEDDING_SET_OPTION = "Set Options"
NO_PILLOWS = "No Pillowcases"

# Backward compatibility aliases
TYPE_OPTION = BEDDING_TYPE_OPTION
SIZE_OPTION = BEDDING_SIZE_OPTION
PILLOW_OPTION = BEDDING_SET_OPTION

BEDDING_TYPES: list[dict[str, Any]] = [
    {
        "name": "Duvet Cover",
        "code": "DV",
        "pillowPrices": {"P0": Decimal("0"), "P1": Decimal("10"), "P2": Decimal("20")},
        "sizes": [
            ('US Twin (68" x 88")', "TW", Decimal("34.90")),
            ('US Full (78" x 88")', "FU", Decimal("44.90")),
            ('US Queen (88" x 88")', "QU", Decimal("49.90")),
            ('US King (104" x 88")', "KI", Decimal("59.90")),
        ],
    },
    {
        "name": "Quilt",
        "code": "QT",
        "pillowPrices": {"P0": Decimal("0"), "P1": Decimal("10"), "P2": Decimal("20")},
        "sizes": [
            ('Throw (60" x 70")', "TH", Decimal("46.90")),
            ('Twin (68" x 86")', "TW", Decimal("61.90")),
            ('Full (80" x 90")', "FU", Decimal("71.90")),
            ('Queen (90" x 90")', "QU", Decimal("81.90")),
            ('King (102" x 91")', "KI", Decimal("91.90")),
        ],
    },
    {
        "name": "Comforter",
        "code": "CF",
        "pillowPrices": {
            "P0": Decimal("0"),
            "P1": Decimal("10"),
            "P2": Decimal("15"),
            "P2S": Decimal("45"),
            "P4": Decimal("25"),
        },
        "sizes": [
            ("Twin (173 x 218 cm)", "TW", Decimal("64.90")),
            ("Full (200 x 230 cm)", "FU", Decimal("79.90")),
            ("Queen (228 x 228 cm)", "QU", Decimal("94.90")),
            ("King (228 x 264 cm)", "KI", Decimal("109.90")),
        ],
    },
]

PILLOW_VALUES = [
    (NO_PILLOWS, "P0"),
    ('1 Pillowcase (20" x 30")', "P1"),
    ('2 Pillowcases (20" x 30")', "P2"),
    ("2 Pillowcases + 1 Sheet", "P2S"),
    ('4 Pillowcases (20" x 30")', "P4"),
]

# Standardized Blanket Option Names & Values matching Jeminise store
BLANKET_MATERIAL_OPTION = "Material"
BLANKET_SIZE_OPTION = "Size"

BLANKET_MATERIALS: list[dict[str, Any]] = [
    {
        "name": "Fleece",
        "code": "FL",
        "sizes": [
            ('40" x 30"', "4030", Decimal("24.90")),
            ('50" x 40"', "5040", Decimal("34.90")),
            ('60" x 50"', "6050", Decimal("44.90")),
            ('80" x 60"', "8060", Decimal("54.90")),
        ],
    },
    {
        "name": "Sherpa",
        "code": "SH",
        "sizes": [
            ('40" x 30"', "4030", Decimal("39.90")),
            ('50" x 40"', "5040", Decimal("44.90")),
            ('60" x 50"', "6050", Decimal("54.90")),
            ('80" x 60"', "8060", Decimal("69.90")),
        ],
    },
]


def _source_token(value: str) -> str:
    return (re.sub(r"[^A-Za-z0-9]+", "-", value.strip()).strip("-").upper()[:64] or "SOURCE")


def build_jeminise_variants(source_id: str) -> list[dict[str, Any]]:
    """Build standardized 47 variants for Jeminise Bedding (Duvet Cover, Quilt, Comforter)."""
    variants: list[dict[str, Any]] = []
    for bedding_type in BEDDING_TYPES:
        for size_name, size_code, base_price in bedding_type["sizes"]:
            for pillow_name, pillow_code in PILLOW_VALUES:
                pillow_prices = bedding_type["pillowPrices"]
                if pillow_code not in pillow_prices:
                    continue
                amount = base_price + pillow_prices[pillow_code]
                variant_id = f"{BEDDING_PRESET_ID}:{bedding_type['code']}:{size_code}:{pillow_code}"
                variants.append({
                    "id": variant_id,
                    "sku": f"AMZ-{_source_token(source_id)}-{bedding_type['code']}-{size_code}-{pillow_code}",
                    "sourceAsin": None,
                    "options": {
                        BEDDING_TYPE_OPTION: bedding_type["name"],
                        BEDDING_SIZE_OPTION: size_name,
                        BEDDING_SET_OPTION: pillow_name,
                    },
                    "price": {"raw": f"${amount:.2f}", "amount": float(amount), "currency": "USD"},
                    "surcharge": None,
                    "metadata": {
                        "preset": BEDDING_PRESET_ID,
                        "inventoryPolicy": "DENY",
                        "tracked": False,
                        "requiresShipping": True,
                    },
                })
    if len(variants) != 47:
        raise RuntimeError("Jeminise bedding preset must contain exactly 47 variants")
    return variants


def build_jeminise_blanket_variants(source_id: str) -> list[dict[str, Any]]:
    """Build standardized 8 variants for Jeminise Blanket (Fleece, Sherpa x 4 sizes)."""
    variants: list[dict[str, Any]] = []
    for material in BLANKET_MATERIALS:
        mat_code = material["code"]
        for size_name, size_code, price in material["sizes"]:
            variant_id = f"{BLANKET_PRESET_ID}:{mat_code}:{size_code}"
            variants.append({
                "id": variant_id,
                "sku": f"AMZ-{_source_token(source_id)}-BL-{mat_code}-{size_code}",
                "sourceAsin": None,
                "options": {
                    BLANKET_MATERIAL_OPTION: material["name"],
                    BLANKET_SIZE_OPTION: size_name,
                },
                "price": {"raw": f"${price:.2f}", "amount": float(price), "currency": "USD"},
                "surcharge": None,
                "metadata": {
                    "preset": BLANKET_PRESET_ID,
                    "inventoryPolicy": "DENY",
                    "tracked": False,
                    "requiresShipping": True,
                },
            })
    if len(variants) != 8:
        raise RuntimeError("Jeminise blanket preset must contain exactly 8 variants")
    return variants


def is_blanket_product(
    product_type: str = "",
    title: str = "",
    categories: list[str] | None = None,
) -> bool:
    """Identify if a product represents a Blanket based on type, title or category taxonomy."""
    pt = (product_type or "").strip().lower()
    if pt:
        if "blanket" in pt or "throw" in pt:
            return True
        if "bedding" in pt or "quilt" in pt or "comforter" in pt or "duvet" in pt:
            return False

    t = (title or "").lower()
    if "blanket" in t:
        return True

    if categories:
        for cat in categories:
            if "blanket" in str(cat).lower():
                return True

    return False


def build_jeminise_preset_variants(
    source_id: str,
    product_type: str = "",
    title: str = "",
    categories: list[str] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Resolve and build the appropriate Jeminise preset variants (Blanket 8v or Bedding 47v)."""
    if is_blanket_product(product_type=product_type, title=title, categories=categories):
        return build_jeminise_blanket_variants(source_id), BLANKET_PRESET_ID
    return build_jeminise_variants(source_id), BEDDING_PRESET_ID
