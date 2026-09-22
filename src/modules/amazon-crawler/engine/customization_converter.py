"""Normalize Amazon Custom configuration and migrate paid choices to variants."""

from __future__ import annotations

import hashlib
import itertools
import json
import re
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

OPTION_CHOOSER = "OptionChooserComponent"
SCHEMA_VERSION = 1


def money(value: Any, default: Decimal = Decimal("0")) -> dict[str, Any]:
    if isinstance(value, dict):
        raw = str(value.get("raw") or value.get("formattedPrice") or value.get("price") or "").strip()
        amount_value = value.get("amount", value.get("value", raw))
        currency = str(value.get("currency") or value.get("currencyCode") or "USD")
    else:
        raw, amount_value, currency = str(value or "").strip(), value, "USD"
    try:
        cleaned = re.sub(r"[^0-9.\-]", "", str(amount_value or ""))
        amount = Decimal(cleaned) if cleaned not in {"", "-", "."} else default
    except InvalidOperation:
        amount = default
    return {"raw": raw or f"${amount:.2f}", "amount": float(amount), "currency": currency}


def _component_type(component: dict[str, Any]) -> str:
    return str(component.get("type") or component.get("componentType") or component.get("__typename") or "UnknownComponent")


def _identifier(value: dict[str, Any], fallback: str = "") -> str:
    return str(value.get("identifier") or value.get("id") or value.get("componentId") or fallback)


def _label(value: dict[str, Any], fallback: str) -> str:
    return str(value.get("label") or value.get("name") or value.get("displayName") or value.get("title") or fallback).strip()


def _image(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    url = value.get("imageUrl") or value.get("url")
    if not url:
        return None
    dimension = value.get("dimension") if isinstance(value.get("dimension"), dict) else {}
    return {"url": str(url), "width": value.get("width", dimension.get("width")), "height": value.get("height", dimension.get("height"))}


def _default_option_id(component: dict[str, Any]) -> str:
    for key in ("defaultOptionIdentifier", "defaultOptionId", "selectedOptionIdentifier", "selectedOptionId", "initialOptionIdentifier", "initialOptionId"):
        if component.get(key):
            return str(component[key])
    options = component.get("options") if isinstance(component.get("options"), list) else []
    for option in options:
        if isinstance(option, dict) and any(option.get(key) for key in ("selected", "isSelected", "default", "isDefault")):
            return _identifier(option)
    return ""


def _additional_cost(option: dict[str, Any]) -> Any:
    for key in ("additionalCost", "cost", "priceDelta", "price", "additionalPrice"):
        if key in option:
            return option[key]
    return 0


def _is_unavailable(option: dict[str, Any], label: str) -> bool:
    availability = str(option.get("availability") or option.get("status") or "").casefold().replace("_", " ")
    return bool(
        option.get("disabled") is True or option.get("isDisabled") is True or option.get("enabled") is False
        or option.get("outOfStock") is True or option.get("isOutOfStock") is True
        or option.get("isSoldOut") is True or option.get("unavailable") is True
        or availability in {"sold out", "unavailable", "out of stock"}
        or re.search(r"out\s*of\s*stock|sold\s*out|unavailable", label, re.I)
    )


def _normalize_options(component: dict[str, Any], add_asset: Callable[[dict[str, Any] | None, str], dict[str, Any] | None]) -> list[dict[str, Any]]:
    candidates = component.get("options") or component.get("choices") or component.get("values") or []
    if isinstance(candidates, dict):
        candidates = list(candidates.values())
    normalized: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates if isinstance(candidates, list) else []):
        option = candidate if isinstance(candidate, dict) else {"label": candidate}
        label = _label(option, f"Option {index + 1}")
        if "no print" in label.casefold() or _is_unavailable(option, label):
            continue
        normalized.append({
            "id": _identifier(option, str(option.get("value") or index)), "label": label,
            "price": money(_additional_cost(option)), "isAvailable": True,
            "overlayImage": add_asset(_image(option.get("overlayImage")), "overlay"),
            "thumbnailImage": add_asset(_image(option.get("thumbnailImage")), "thumbnail"),
        })
    return normalized


def _find_config_root(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        if isinstance(raw.get("sellerConfigComponents"), (dict, list)):
            return raw
        for child in raw.values():
            found = _find_config_root(child)
            if found is not None:
                return found
    elif isinstance(raw, list):
        for child in raw:
            found = _find_config_root(child)
            if found is not None:
                return found
    return None


def normalize_customization(raw: Any) -> tuple[dict[str, Any] | None, list[str]]:
    if not isinstance(raw, (dict, list)):
        return None, ["Customization payload is missing or malformed."]
    config = _find_config_root(raw)
    traversal_root: Any = config.get("sellerConfigComponents") if config is not None else raw
    source_config = config or (raw if isinstance(raw, dict) else {})
    preview = source_config.get("preview") if isinstance(source_config.get("preview"), dict) else {}
    preview_size = int(preview.get("previewSize") or 400)
    warnings: list[str] = []
    option_groups: list[dict[str, Any]] = []
    paid_groups: list[dict[str, Any]] = []
    text_inputs: list[dict[str, Any]] = []
    image_inputs: list[dict[str, Any]] = []
    font_groups: list[dict[str, Any]] = []
    color_groups: list[dict[str, Any]] = []
    surfaces: list[dict[str, Any]] = []
    placements: list[dict[str, Any]] = []
    conditional_rules: list[dict[str, Any]] = []
    control_order: list[dict[str, str]] = []
    component_parent: dict[str, str] = {}
    component_types: dict[str, str] = {}
    asset_map: dict[str, dict[str, Any]] = {}
    seen: set[int] = set()

    def add_asset(asset: dict[str, Any] | None, role: str) -> dict[str, Any] | None:
        if asset is None:
            return None
        url = str(asset["url"])
        if url not in asset_map:
            asset_map[url] = {**asset, "roles": []}
        if role not in asset_map[url]["roles"]:
            asset_map[url]["roles"].append(role)
        return asset

    def nearest_parent(component_id: str, wanted_type: str) -> str | None:
        current = component_id
        while current in component_parent:
            current = component_parent[current]
            if component_types.get(current) == wanted_type:
                return current
        return None

    def walk(value: Any, parent_id: str | None = None, ancestors: tuple[str, ...] = (), surface_id: str | None = None, placement_id: str | None = None) -> None:
        if isinstance(value, list):
            for child in value:
                walk(child, parent_id, ancestors, surface_id, placement_id)
            return
        if not isinstance(value, dict) or id(value) in seen:
            return
        seen.add(id(value))
        component_type = _component_type(value)
        is_component = component_type != "UnknownComponent" and "Component" in component_type
        next_parent, next_ancestors = parent_id, ancestors
        next_surface, next_placement = surface_id, placement_id
        if is_component:
            component_id = _identifier(value, f"control-{len(component_types) + 1}")
            component_types[component_id] = component_type
            if parent_id:
                component_parent[component_id] = parent_id
            next_parent, next_ancestors = component_id, (*ancestors, component_id)
            label = _label(value, component_type)
            required = bool(value.get("isRequired") or value.get("required"))
            rules = value.get("conditionalDisplayRules") if isinstance(value.get("conditionalDisplayRules"), list) else []
            for rule in rules:
                if isinstance(rule, dict):
                    conditional_rules.append({"ownerComponentId": component_id, "dependentId": str(rule.get("dependentId") or ""), "matcher": deepcopy(rule.get("matcher") or {})})
            if component_type == "PreviewContainerComponent":
                surfaces.append({"id": component_id, "label": label, "baseImage": add_asset(_image(value.get("baseImage")), "base"), "maskImage": add_asset(_image(value.get("maskImage")), "mask"), "previewSize": preview_size})
                next_surface = component_id
            elif component_type == "PlacementContainerComponent":
                placements.append({"id": component_id, "label": label, "surfaceId": surface_id, "position": deepcopy(value.get("position") or {"x": 0, "y": 0}), "dimension": deepcopy(value.get("dimension") or {"width": preview_size, "height": preview_size}), "isFreePlacement": bool(value.get("isFreePlacement"))})
                next_placement = component_id
            elif component_type == OPTION_CHOOSER:
                options = _normalize_options(value, add_asset)
                control = {"id": component_id, "type": component_type, "label": label, "required": required, "defaultOptionId": _default_option_id(value), "instructions": str(value.get("instructions") or ""), "options": options, "displayHint": "choice-grid" if options and all(option.get("thumbnailImage") or option.get("overlayImage") for option in options) else "select"}
                if any(float(option["price"]["amount"]) > 0 for option in options):
                    if not required and not any(float(option["price"]["amount"]) == 0 for option in options):
                        options.insert(0, {"id": f"{component_id}__none", "label": "None", "price": money(0), "isAvailable": True, "overlayImage": None, "thumbnailImage": None})
                    paid_groups.append(control)
                else:
                    if not options:
                        warnings.append(f"Customization group '{label}' has no selectable options.")
                    option_groups.append(control)
                    control_order.append({"type": "option", "id": component_id})
            elif component_type == "TextInputComponent":
                control = {"id": component_id, "type": component_type, "label": label, "required": required, "minLength": int(value.get("minLength") or 0), "maxLength": int(value["maxLength"]) if value.get("maxLength") is not None else None, "maxLines": int(value.get("maxLines") or 1), "placeholder": str(value.get("placeholder") or ""), "instructions": str(value.get("instructions") or ""), "regexChoice": str(value.get("regexChoice") or ""), "placementId": placement_id, "groupId": nearest_parent(component_id, "ContainerComponent"), "ancestors": list(ancestors)}
                text_inputs.append(control); control_order.append({"type": "text", "id": component_id})
            elif component_type == "ImageInputComponent":
                control = {"id": component_id, "type": component_type, "label": label, "required": required, "instructions": str(value.get("instructions") or ""), "placementId": placement_id, "groupId": nearest_parent(component_id, "ContainerComponent"), "ancestors": list(ancestors)}
                image_inputs.append(control); control_order.append({"type": "image", "id": component_id})
            elif component_type == "FontChooserComponent":
                font_options = []
                for font in value.get("fontOptions", []) if isinstance(value.get("fontOptions"), list) else []:
                    if isinstance(font, dict):
                        font_url = str(font.get("fontUrl") or "")
                        if font_url: add_asset({"url": font_url, "width": None, "height": None}, "font")
                        font_options.append({"id": _identifier(font), "family": str(font.get("family") or font.get("name") or "Arial"), "fontType": str(font.get("fontType") or ""), "fontUrl": font_url})
                control = {"id": component_id, "type": component_type, "label": label, "required": required, "defaultFontId": str(value.get("defaultFontIdentifier") or ""), "options": font_options, "groupId": nearest_parent(component_id, "ContainerComponent"), "ancestors": list(ancestors)}
                font_groups.append(control); control_order.append({"type": "font", "id": component_id})
            elif component_type == "ColorChooserComponent":
                color_options = [{"id": _identifier(color), "name": str(color.get("name") or "Color"), "value": str(color.get("value") or "#000000")} for color in value.get("colorOptions", []) if isinstance(color, dict)] if isinstance(value.get("colorOptions"), list) else []
                control = {"id": component_id, "type": component_type, "label": label, "required": required, "defaultColorId": str(value.get("defaultColorIdentifier") or ""), "options": color_options, "groupId": nearest_parent(component_id, "ContainerComponent"), "ancestors": list(ancestors)}
                color_groups.append(control); control_order.append({"type": "color", "id": component_id})
        for child in value.values():
            walk(child, next_parent, next_ancestors, next_surface, next_placement)

    walk(traversal_root)
    product_image_url = str(source_config.get("productImageUrl") or "")
    if product_image_url:
        add_asset({"url": product_image_url, "width": None, "height": None}, "product")
    encoded = json.dumps(raw, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    paid_summary = [{"id": group["id"], "label": group["label"], "required": group["required"], "defaultOptionId": group.get("defaultOptionId", ""), "options": deepcopy(group.get("options", []))} for group in paid_groups]
    normalized = {
        "schemaVersion": SCHEMA_VERSION,
        "source": {"asin": str(source_config.get("asin") or ""), "marketplaceId": str(source_config.get("marketplaceId") or ""), "merchantId": str(source_config.get("merchantId") or ""), "sku": str(source_config.get("sku") or ""), "sellerConfigVersion": str(source_config.get("sellerConfigVersion") or "")},
        "product": {"productImageUrl": product_image_url, "previewSize": preview_size},
        "surfaces": surfaces, "optionGroups": option_groups,
        "textInputs": text_inputs, "imageInputs": image_inputs, "fontGroups": font_groups,
        "colorGroups": color_groups, "placements": placements,
        "conditionalRules": conditional_rules,
        "regexChoices": deepcopy(source_config.get("regexChoices") or {}),
        "controlOrder": control_order, "componentParent": component_parent, "componentTypes": component_types,
        "assets": list(asset_map.values()),
        "pricing": {"currencyCode": "USD", "mode": "product_variants", "paidOptionGroups": paid_summary},
        "fingerprint": hashlib.sha256(encoded).hexdigest()[:16],
    }
    return normalized, warnings


def _add_money(base: dict[str, Any] | None, surcharge: Decimal) -> dict[str, Any] | None:
    if base is None:
        return None
    amount = Decimal(str(base["amount"])) + surcharge
    return {"raw": f"${amount:.2f}", "amount": float(amount), "currency": str(base.get("currency") or "USD")}


def _paid_groups(customization: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not customization:
        return []
    pricing = customization.get("pricing")
    if isinstance(pricing, dict) and isinstance(pricing.get("paidOptionGroups"), list):
        return pricing["paidOptionGroups"]
    legacy = customization.get("pricingGroups")
    return legacy if isinstance(legacy, list) else []


def expand_paid_variants(base_variants: list[dict[str, Any]], customization: dict[str, Any] | None) -> list[dict[str, Any]]:
    groups = _paid_groups(customization)
    if not groups:
        return deepcopy(base_variants)
    option_sets = [group.get("options", []) for group in groups]
    if any(not options for options in option_sets):
        return deepcopy(base_variants)
    expanded: list[dict[str, Any]] = []
    for base in base_variants:
        for selected_tuple in itertools.product(*option_sets):
            selected = list(selected_tuple)
            surcharge = sum((Decimal(str(option["price"]["amount"])) for option in selected), Decimal("0"))
            suffix_source = "|".join(f"{group.get('id')}:{option.get('id')}" for group, option in zip(groups, selected))
            suffix = hashlib.sha1(suffix_source.encode("utf-8")).hexdigest()[:10].upper()
            options = deepcopy(base.get("options", {}))
            paid_options = []
            for group, option in zip(groups, selected):
                options[str(group["label"])] = str(option["label"])
                paid_options.append({"groupId": str(group.get("id") or ""), "groupLabel": str(group.get("label") or "Option"), "optionId": str(option.get("id") or ""), "label": str(option.get("label") or "Option"), "price": deepcopy(option.get("price"))})
            expanded.append({
                **deepcopy(base), "id": f"{base['id']}-{suffix}", "sku": f"{base['sku']}-{suffix}", "options": options,
                "price": _add_money(base.get("price"), surcharge),
                "surcharge": money(surcharge), "metadata": {**deepcopy(base.get("metadata", {})), "customization": True, "paidOptions": paid_options},
            })
    return expanded


def remove_option_choosers(customization: dict[str, Any] | None) -> dict[str, Any] | None:
    if customization is None:
        return None
    filtered = deepcopy(customization)
    filtered["optionGroups"] = []
    filtered["controlOrder"] = [entry for entry in filtered.get("controlOrder", []) if entry.get("type") != "option"]
    pricing = filtered.get("pricing")
    if isinstance(pricing, dict):
        pricing["paidOptionGroups"] = []
    filtered.pop("pricingGroups", None)
    return filtered
