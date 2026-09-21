"""Jeminise variant preset ported from the current production tool."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

PRESET_ID = "jeminise_bedding_v2"
TYPE_OPTION = "Choose type"
SIZE_OPTION = "Choose size"
PILLOW_OPTION = "PILLOWCASES (Purchase SEPARATELY)"
NO_PILLOWS = "I don't need pillowcases"

BEDDING_TYPES: list[dict[str, Any]] = [
    {
        "name": "Duvet cover", "code": "DV", "pillowPrices": {"P0": Decimal("0"), "P1": Decimal("10"), "P2": Decimal("20")},
        "sizes": [('US Twin (68" x 88")', "TW", Decimal("34.90")), ('US Full (78" x 88")', "FU", Decimal("44.90")), ('US Queen (88" x 88")', "QU", Decimal("49.90")), ('US King (104" x 88")', "KI", Decimal("59.90"))],
    },
    {
        "name": "Quilt", "code": "QT", "pillowPrices": {"P0": Decimal("0"), "P1": Decimal("10"), "P2": Decimal("20")},
        "sizes": [('Throw (60" x 70")', "TH", Decimal("46.90")), ('Twin (68" x 86")', "TW", Decimal("61.90")), ('Full (80" x 90")', "FU", Decimal("71.90")), ('Queen (90" x 90")', "QU", Decimal("81.90")), ('King (102" x 91")', "KI", Decimal("91.90"))],
    },
    {
        "name": "Comforter", "code": "CF", "pillowPrices": {"P0": Decimal("0"), "P1": Decimal("10"), "P2": Decimal("15"), "P2S": Decimal("45"), "P4": Decimal("25")},
        "sizes": [("Twin (173 x 218 cm)", "TW", Decimal("64.90")), ("Full (200 x 230 cm)", "FU", Decimal("79.90")), ("Queen (228 x 228 cm)", "QU", Decimal("94.90")), ("King (228 x 264 cm)", "KI", Decimal("109.90"))],
    },
]

PILLOW_VALUES = [
    (NO_PILLOWS, "P0"), ('1 Pillowcase (20" x 30")', "P1"),
    ('2 Pillowcases (20" x 30")', "P2"), ("2 Pillowcases + 1 Add Sheet", "P2S"),
    ('4 Pillowcases (20" x 30")', "P4"),
]


def _source_token(value: str) -> str:
    return (re.sub(r"[^A-Za-z0-9]+", "-", value.strip()).strip("-").upper()[:64] or "SOURCE")


def build_jeminise_variants(source_id: str) -> list[dict[str, Any]]:
    variants: list[dict[str, Any]] = []
    for bedding_type in BEDDING_TYPES:
        for size_name, size_code, base_price in bedding_type["sizes"]:
            for pillow_name, pillow_code in PILLOW_VALUES:
                pillow_prices = bedding_type["pillowPrices"]
                if pillow_code not in pillow_prices:
                    continue
                amount = base_price + pillow_prices[pillow_code]
                variant_id = f"{PRESET_ID}:{bedding_type['code']}:{size_code}:{pillow_code}"
                variants.append({
                    "id": variant_id,
                    "sku": f"AMZ-{_source_token(source_id)}-{bedding_type['code']}-{size_code}-{pillow_code}",
                    "sourceAsin": None,
                    "options": {TYPE_OPTION: bedding_type["name"], SIZE_OPTION: size_name, PILLOW_OPTION: pillow_name},
                    "price": {"raw": f"${amount:.2f}", "amount": float(amount), "currency": "USD"},
                    "listPrice": None,
                    "surcharge": None,
                    "isAvailable": True,
                    "metadata": {"preset": PRESET_ID, "inventoryPolicy": "DENY", "tracked": False, "requiresShipping": True},
                })
    if len(variants) != 47:
        raise RuntimeError("Jeminise preset must contain exactly 47 variants")
    return variants
