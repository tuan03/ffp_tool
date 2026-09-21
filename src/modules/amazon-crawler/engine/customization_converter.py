"""Normalize Amazon Custom configuration and expand paid option groups."""

from __future__ import annotations

import hashlib
import itertools
import json
import re
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from typing import Any

OPTION_CHOOSER = "OptionChooserComponent"


def money(value: Any, default: Decimal = Decimal("0")) -> dict[str, Any]:
    if isinstance(value, dict):
        raw = str(value.get("raw") or value.get("formattedPrice") or value.get("price") or "").strip()
        amount_value = value.get("amount", value.get("value", raw))
        currency = str(value.get("currency") or value.get("currencyCode") or "USD")
    else:
        raw = str(value or "").strip()
        amount_value = value
        currency = "USD"
    try:
        cleaned = re.sub(r"[^0-9.\-]", "", str(amount_value or ""))
        amount = Decimal(cleaned) if cleaned not in {"", "-", "."} else default
    except InvalidOperation:
        amount = default
    return {"raw": raw or f"${amount:.2f}", "amount": float(amount), "currency": currency}


def _component_type(component: dict[str, Any]) -> str:
    return str(component.get("type") or component.get("componentType") or component.get("__typename") or "UnknownComponent")


def _label(value: dict[str, Any], fallback: str) -> str:
    return str(value.get("label") or value.get("name") or value.get("displayName") or value.get("title") or fallback).strip()


def _components_from(raw: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    seen: set[int] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            marker = id(value)
            if marker in seen:
                return
            seen.add(marker)
            if any(key in value for key in ("componentType", "__typename")) or str(value.get("type", "")).endswith("Component"):
                found.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(raw)
    return found


def _normalize_options(component: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = component.get("options") or component.get("choices") or component.get("values") or []
    if isinstance(candidates, dict):
        candidates = list(candidates.values())
    normalized: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates if isinstance(candidates, list) else []):
        option = candidate if isinstance(candidate, dict) else {"label": candidate}
        label = _label(option, f"Option {index + 1}")
        availability = str(option.get("availability") or option.get("status") or "").casefold()
        is_disabled = option.get("disabled") is True or option.get("enabled") is False or option.get("outOfStock") is True
        if is_disabled or availability in {"sold_out", "sold out", "unavailable", "out_of_stock"} or "no print" in label.casefold():
            continue
        price = money(option.get("cost", option.get("priceDelta", option.get("price", option.get("additionalPrice", 0)))))
        normalized.append({
            "id": str(option.get("id") or option.get("value") or index),
            "label": label,
            "price": price,
            "isAvailable": True,
        })
    return normalized


def normalize_customization(raw: Any) -> tuple[dict[str, Any] | None, list[str]]:
    if not isinstance(raw, (dict, list)):
        return None, ["Customization payload is missing or malformed."]
    warnings: list[str] = []
    controls: list[dict[str, Any]] = []
    pricing_groups: list[dict[str, Any]] = []
    for index, component in enumerate(_components_from(raw)):
        component_type = _component_type(component)
        if component_type in {"PageContainerComponent", "GroupContainerComponent", "ContainerComponent"}:
            continue
        control: dict[str, Any] = {
            "id": str(component.get("id") or component.get("componentId") or f"control-{index + 1}"),
            "type": component_type,
            "label": _label(component, component_type),
            "required": bool(component.get("required") or component.get("isRequired")),
        }
        for key in ("maxLength", "minLength", "placeholder", "surfaceId", "placement", "font", "color", "preview"):
            if key in component:
                control[key] = deepcopy(component[key])
        if component_type == OPTION_CHOOSER:
            options = _normalize_options(component)
            control["options"] = options
            if any(float(option["price"]["amount"]) > 0 for option in options):
                if not control["required"] and not any(float(option["price"]["amount"]) == 0 for option in options):
                    options.insert(0, {"id": "none", "label": "None", "price": money(0), "isAvailable": True})
                pricing_groups.append(control)
                continue
            if not options:
                warnings.append(f"Customization group '{control['label']}' has no selectable options.")
        controls.append(control)
    encoded = json.dumps(raw, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    fingerprint = hashlib.sha256(encoded).hexdigest()[:16]
    def first_list(value: Any, keys: set[str]) -> list[Any]:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in keys and isinstance(child, list):
                    return deepcopy(child)
            for child in value.values():
                found = first_list(child, keys)
                if found:
                    return found
        elif isinstance(value, list):
            for child in value:
                found = first_list(child, keys)
                if found:
                    return found
        return []

    surfaces = first_list(raw, {"surfaces", "surfaceConfigurations"})
    rules = first_list(raw, {"rules", "conditionalRules", "conditions"})
    assets = first_list(raw, {"assets", "images", "assetLibrary"})
    return {"surfaces": surfaces, "controls": controls, "rules": rules, "assets": assets, "pricingGroups": pricing_groups, "fingerprint": fingerprint}, warnings


def _add_money(base: dict[str, Any] | None, surcharge: Decimal) -> dict[str, Any] | None:
    if base is None:
        return None
    amount = Decimal(str(base["amount"])) + surcharge
    return {"raw": f"${amount:.2f}", "amount": float(amount), "currency": str(base.get("currency") or "USD")}


def expand_paid_variants(base_variants: list[dict[str, Any]], customization: dict[str, Any] | None) -> list[dict[str, Any]]:
    groups = customization.get("pricingGroups", []) if customization else []
    if not groups:
        return deepcopy(base_variants)
    option_sets = [group.get("options", []) for group in groups]
    expanded: list[dict[str, Any]] = []
    for base in base_variants:
        for selected in itertools.product(*option_sets):
            selected_list = list(selected)
            surcharge = sum((Decimal(str(option["price"]["amount"])) for option in selected_list), Decimal("0"))
            suffix_source = "|".join(str(option["id"]) for option in selected_list)
            suffix = hashlib.sha1(suffix_source.encode("utf-8")).hexdigest()[:10].upper()
            options = deepcopy(base.get("options", {}))
            for group, option in zip(groups, selected_list):
                options[str(group["label"])] = str(option["label"])
            expanded.append({
                **deepcopy(base),
                "id": f"{base['id']}-{suffix}",
                "sku": f"{base['sku']}-{suffix}",
                "options": options,
                "price": _add_money(base.get("price"), surcharge),
                "listPrice": _add_money(base.get("listPrice"), surcharge),
                "surcharge": money(surcharge),
                "metadata": {**deepcopy(base.get("metadata", {})), "customization": True, "paidOptions": deepcopy(selected_list)},
            })
    return expanded


def remove_option_choosers(customization: dict[str, Any] | None) -> dict[str, Any] | None:
    if customization is None:
        return None
    filtered = deepcopy(customization)
    filtered["controls"] = [control for control in filtered.get("controls", []) if control.get("type") != OPTION_CHOOSER]
    filtered["pricingGroups"] = []
    return filtered
