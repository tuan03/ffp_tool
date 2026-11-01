"""Map Etsy personalization questions into FFP's Customizer schema v1 and detect sync blockers."""

from __future__ import annotations

import hashlib
import html as html_lib
import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

SCHEMA_VERSION = 1
SUPPORTED_QUESTION_TYPES = frozenset({"text_input", "dropdown", "unlabeled_upload", "labeled_upload"})


@dataclass(frozen=True)
class EtsyPersonalizationConversion:
    customization: dict[str, Any] | None
    audit_status: str  # "verified_static" | "verified_custom" | "error"
    blockers: list[str]
    warnings: list[str]
    raw_personalization: dict[str, Any] | None

    @property
    def fingerprint(self) -> str | None:
        if isinstance(self.customization, dict):
            fp = str(self.customization.get("fingerprint") or "").strip()
            return fp or None
        return None


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(str(value or ""))).strip()


def _zero_money(currency: str = "USD") -> dict[str, Any]:
    symbol = "$" if currency == "USD" else f"{currency} "
    return {"raw": f"{symbol}0.00", "amount": 0.0, "currency": currency}


def _normalize_addon_money(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    raw_amount = value.get("amount")
    divisor = value.get("divisor")
    try:
        amount = Decimal(str(raw_amount if raw_amount is not None else 0))
        if divisor is not None:
            div_dec = Decimal(str(divisor))
            if div_dec <= 0:
                return None
            amount = amount / div_dec
    except (InvalidOperation, TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    quantized = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    currency = str(value.get("currencyCode") or value.get("currency_code") or "USD").strip().upper() or "USD"
    return {"amount": float(quantized), "currencyCode": currency}


def parse_raw_etsy_personalization(
    raw_association: Any,
    *,
    listing: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Extract canonical Etsy personalization questions from Open API v3 or legacy listing fields."""
    candidate = raw_association
    if isinstance(candidate, list):
        candidate = candidate[0] if candidate and isinstance(candidate[0], dict) else {}
    raw = candidate if isinstance(candidate, dict) else {}
    raw_questions = raw.get("personalization_questions")
    if raw_questions is None:
        raw_questions = raw.get("questions")

    normalized_questions: list[dict[str, Any]] = []
    if isinstance(raw_questions, list):
        for index, item in enumerate(raw_questions):
            if not isinstance(item, dict):
                continue
            question_type = str(item.get("question_type") or item.get("type") or "text_input").strip()
            options_raw = item.get("options") if isinstance(item.get("options"), list) else []
            options: list[dict[str, str]] = []
            seen_labels: set[str] = set()
            for opt_idx, opt in enumerate(options_raw):
                if not isinstance(opt, dict):
                    continue
                label = _clean(opt.get("label"))
                if not label or label.casefold() in seen_labels:
                    continue
                seen_labels.add(label.casefold())
                options.append({
                    "id": str(opt.get("option_id") or opt.get("id") or f"option-{opt_idx + 1}"),
                    "label": label,
                })
            normalized_questions.append({
                "id": str(item.get("question_id") or item.get("id") or f"question-{index + 1}"),
                "type": question_type,
                "label": _clean(item.get("question_text") or item.get("label")) or f"Personalization {index + 1}",
                "instructions": _clean(item.get("instructions") or item.get("helper_text")) or None,
                "required": bool(item.get("required")),
                "maxCharacters": item.get("max_allowed_characters") if "max_allowed_characters" in item else item.get("maxCharacters"),
                "maxFiles": item.get("max_allowed_files") if "max_allowed_files" in item else item.get("maxFiles"),
                "options": options,
                "addOnPrice": _normalize_addon_money(item.get("add_on_price") or item.get("addOnPrice")),
            })

    # Legacy single-field personalization on Etsy Listing resource when multi-question API array is absent.
    listing_dict = listing if isinstance(listing, dict) else {}
    if (
        not normalized_questions
        and raw_questions is None
        and listing_dict.get("is_personalizable") is True
        and (
            _clean(listing_dict.get("personalization_instructions"))
            or listing_dict.get("personalization_char_count_max") is not None
        )
    ):
        char_max = listing_dict.get("personalization_char_count_max")
        normalized_questions.append({
            "id": "legacy_personalization_1",
            "type": "text_input",
            "label": "Personalization",
            "instructions": _clean(listing_dict.get("personalization_instructions")) or None,
            "required": bool(listing_dict.get("personalization_is_required")),
            "maxCharacters": char_max if char_max is not None else 256,
            "maxFiles": None,
            "options": [],
            "addOnPrice": None,
        })

    if not normalized_questions:
        return None

    fingerprint_source = json.dumps(normalized_questions, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "hasPersonalization": True,
        "questions": normalized_questions,
        "source": "etsy_api",
        "sourceFingerprint": hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest(),
    }


def convert_etsy_personalization_to_customizer(
    personalization: dict[str, Any] | None,
    *,
    listing_id: str,
    canonical_url: str,
    product_image_url: str = "",
    is_personalizable_flag: bool = False,
    personalization_is_required_flag: bool = False,
) -> EtsyPersonalizationConversion:
    """Convert Etsy personalization questions into FFP's ProductCustomization (schemaVersion: 1).

    Any required field that cannot be cleanly represented in Customizer produces a blocker
    so SEO can still complete while auto-sync is blocked with an explicit actionable reason.
    """
    blockers: list[str] = []
    warnings: list[str] = []

    if isinstance(personalization, dict) and "personalization_questions" in personalization and "questions" not in personalization:
        personalization = parse_raw_etsy_personalization(personalization)
    elif isinstance(personalization, list):
        personalization = parse_raw_etsy_personalization(personalization)

    raw_questions = (
        personalization.get("questions")
        if isinstance(personalization, dict) and isinstance(personalization.get("questions"), list)
        else []
    )

    if not raw_questions:
        if is_personalizable_flag:
            warnings.append("Etsy marks this listing as personalizable but returned no personalization questions")
            if personalization_is_required_flag or personalization is None:
                blockers.append(
                    "Listing Etsy có cá nhân hóa nhưng API không trả về cấu trúc câu hỏi; cần kiểm tra và cấu hình Customizer thủ công trước khi sync."
                )
                return EtsyPersonalizationConversion(
                    customization=None,
                    audit_status="error",
                    blockers=blockers,
                    warnings=warnings,
                    raw_personalization=None,
                )
        return EtsyPersonalizationConversion(
            customization=None,
            audit_status="verified_static",
            blockers=[],
            warnings=warnings,
            raw_personalization=None,
        )

    option_groups: list[dict[str, Any]] = []
    text_inputs: list[dict[str, Any]] = []
    image_inputs: list[dict[str, Any]] = []
    control_order: list[dict[str, str]] = []
    component_types: dict[str, str] = {}

    for index, raw_question in enumerate(raw_questions):
        if not isinstance(raw_question, dict):
            continue
        question_id = _clean(raw_question.get("id")) or f"question_{index + 1}"
        control_id = f"etsy_q_{question_id}"
        q_type = str(raw_question.get("type") or "text_input").strip()
        label = _clean(raw_question.get("label")) or f"Personalization {index + 1}"
        instructions = _clean(raw_question.get("instructions"))
        required = bool(raw_question.get("required"))
        addon_price = raw_question.get("addOnPrice") if isinstance(raw_question.get("addOnPrice"), dict) else None
        addon_amount = float(addon_price.get("amount") or 0.0) if addon_price else 0.0

        if q_type not in SUPPORTED_QUESTION_TYPES:
            message = f"Trường cá nhân hóa '{label}' dùng kiểu '{q_type}' chưa được hỗ trợ tự động."
            if required:
                blockers.append(f"Trường cá nhân hóa bắt buộc chưa ánh xạ được ({message})")
            else:
                warnings.append(message)
            continue

        if addon_amount > 0:
            price_note = f"Trường cá nhân hóa '{label}' có phụ phí +${addon_amount:.2f} trên Etsy."
            if required:
                blockers.append(
                    f"Trường cá nhân hóa bắt buộc '{label}' có phụ phí +${addon_amount:.2f} chưa ánh xạ tự động sang biến thể giá; cần kiểm tra trước khi sync."
                )
            else:
                warnings.append(f"{price_note} Phụ phí tùy chọn không tự cộng vào giá biến thể.")

        if q_type == "text_input":
            raw_max = raw_question.get("maxCharacters")
            try:
                max_chars = max(1, min(1024, int(raw_max))) if raw_max is not None else 256
            except (TypeError, ValueError):
                max_chars = 256
            component_types[control_id] = "TextInputComponent"
            text_inputs.append({
                "id": control_id,
                "type": "TextInputComponent",
                "label": label,
                "required": required,
                "minLength": 1 if required else 0,
                "maxLength": max_chars,
                "maxLines": 3 if max_chars > 80 else 1,
                "placeholder": "",
                "instructions": instructions,
                "regexChoice": "",
                "placementId": None,
                "groupId": None,
                "ancestors": [],
            })
            control_order.append({"type": "text", "id": control_id})

        elif q_type == "dropdown":
            raw_options = raw_question.get("options") if isinstance(raw_question.get("options"), list) else []
            options: list[dict[str, Any]] = []
            for opt_index, opt in enumerate(raw_options):
                if not isinstance(opt, dict):
                    continue
                opt_label = _clean(opt.get("label"))
                if not opt_label:
                    continue
                opt_id = _clean(opt.get("id")) or f"{control_id}_opt_{opt_index + 1}"
                options.append({
                    "id": opt_id,
                    "label": opt_label,
                    "price": _zero_money("USD"),
                    "isAvailable": True,
                    "overlayImage": None,
                    "thumbnailImage": None,
                })
            if not options:
                msg = f"Trường dropdown '{label}' không có lựa chọn hợp lệ từ Etsy."
                if required:
                    blockers.append(f"Trường cá nhân hóa bắt buộc chưa ánh xạ được: {msg}")
                else:
                    warnings.append(msg)
                continue
            component_types[control_id] = "OptionChooserComponent"
            option_groups.append({
                "id": control_id,
                "type": "OptionChooserComponent",
                "label": label,
                "required": required,
                "defaultOptionId": str(options[0]["id"]) if required else "",
                "instructions": instructions,
                "options": options,
                "displayHint": "select",
            })
            control_order.append({"type": "option", "id": control_id})

        elif q_type in {"unlabeled_upload", "labeled_upload"}:
            raw_max_files = raw_question.get("maxFiles")
            try:
                default_files = 2 if q_type == "labeled_upload" else 1
                max_files = max(default_files, min(10, int(raw_max_files))) if raw_max_files is not None else default_files
            except (TypeError, ValueError):
                max_files = 2 if q_type == "labeled_upload" else 1
            raw_options = raw_question.get("options") if isinstance(raw_question.get("options"), list) else []
            slot_labels = [_clean(opt.get("label")) for opt in raw_options if isinstance(opt, dict) and _clean(opt.get("label"))]
            if q_type == "labeled_upload" and len(slot_labels) != max_files:
                msg = (
                    f"Trường tải ảnh có nhãn '{label}' yêu cầu {max_files} nhãn nhưng Etsy trả về {len(slot_labels)} nhãn."
                )
                if required:
                    blockers.append(f"Trường cá nhân hóa bắt buộc chưa ánh xạ được: {msg}")
                    continue
                warnings.append(msg)

            if max_files == 1:
                component_types[control_id] = "ImageInputComponent"
                image_inputs.append({
                    "id": control_id,
                    "type": "ImageInputComponent",
                    "label": slot_labels[0] if slot_labels else label,
                    "required": required,
                    "instructions": instructions,
                    "maxFiles": 1,
                    "placementId": None,
                    "groupId": None,
                    "ancestors": [],
                })
                control_order.append({"type": "image", "id": control_id})
            else:
                for slot_idx in range(max_files):
                    slot_id = f"{control_id}_file_{slot_idx + 1}"
                    slot_suffix = slot_labels[slot_idx] if slot_idx < len(slot_labels) else f"File {slot_idx + 1}/{max_files}"
                    slot_label = f"{label} — {slot_suffix}" if label.casefold() != slot_suffix.casefold() else slot_suffix
                    # For unlabeled multi-file upload, at least the first file is required when required=True;
                    # for labeled_upload, every labeled slot is part of the required upload set.
                    slot_required = required if (q_type == "labeled_upload" or slot_idx == 0) else False
                    component_types[slot_id] = "ImageInputComponent"
                    image_inputs.append({
                        "id": slot_id,
                        "type": "ImageInputComponent",
                        "label": slot_label,
                        "required": slot_required,
                        "instructions": instructions,
                        "maxFiles": max_files,
                        "slotIndex": slot_idx + 1,
                        "placementId": None,
                        "groupId": None,
                        "ancestors": [],
                    })
                    control_order.append({"type": "image", "id": slot_id})

    has_controls = bool(option_groups or text_inputs or image_inputs)
    if blockers:
        return EtsyPersonalizationConversion(
            customization=None,
            audit_status="error",
            blockers=blockers,
            warnings=warnings,
            raw_personalization=personalization,
        )

    if not has_controls:
        return EtsyPersonalizationConversion(
            customization=None,
            audit_status="verified_static",
            blockers=[],
            warnings=warnings,
            raw_personalization=personalization,
        )

    assets: list[dict[str, Any]] = []
    if product_image_url:
        assets.append({"url": product_image_url, "width": None, "height": None, "roles": ["product"]})

    encoded = json.dumps(
        {
            "listingId": listing_id,
            "optionGroups": option_groups,
            "textInputs": text_inputs,
            "imageInputs": image_inputs,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    normalized: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "hasCustomization": True,
        "source": {
            "platform": "etsy",
            "listingId": listing_id,
            "sourceUrl": canonical_url,
            "sourceFingerprint": str((personalization or {}).get("sourceFingerprint") or ""),
        },
        "product": {
            "productImageUrl": product_image_url,
            "previewSize": 400,
        },
        "surfaces": [],
        "optionGroups": option_groups,
        "textInputs": text_inputs,
        "imageInputs": image_inputs,
        "fontGroups": [],
        "colorGroups": [],
        "placements": [],
        "conditionalRules": [],
        "regexChoices": {},
        "controlOrder": control_order,
        "componentParent": {},
        "componentTypes": component_types,
        "assets": assets,
        "pricing": {
            "currencyCode": "USD",
            "mode": "product_variants",
            "paidOptionGroups": [],
        },
        "fingerprint": hashlib.sha256(encoded).hexdigest()[:16],
    }

    return EtsyPersonalizationConversion(
        customization=normalized,
        audit_status="error" if blockers else "verified_custom",
        blockers=blockers,
        warnings=warnings,
        raw_personalization=personalization,
    )
