"""Conservative display-only cleanup for default-profile size choices."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


_SIZE_NAME = re.compile(r"\b(?:size|sizes|dimension|dimensions|kích\s*thước)\b", re.I)
_OPTIONAL_PHRASE = re.compile(
    r"\b(?:very\s+small|super\s+small|tiny\s+size|recommended|best\s+seller|popular|hot|best\s+choice|for\s+entryways)\b",
    re.I,
)
_KIDS_NOTE = re.compile(r"\(?\b\d+\s*(?:[-–—]\s*\d+)?\s*kids?\b\)?", re.I)
_ROOM_NOTE = re.compile(r"\(?\bfits\s+\d[^,;()]*?\s+room\b\)?", re.I)


def is_size_name(name: str) -> bool:
    return bool(_SIZE_NAME.search(name))


def clean_size_label(label: str) -> str:
    """Remove only known adjunct phrases, leaving units and actual sizes unchanged."""
    if not label or not any(pattern.search(label) for pattern in (_KIDS_NOTE, _ROOM_NOTE, _OPTIONAL_PHRASE)):
        return label
    return _strip_auxiliary_size_text(label) or label


def _strip_auxiliary_size_text(label: str) -> str:
    cleaned = _KIDS_NOTE.sub("", label)
    cleaned = _ROOM_NOTE.sub("", cleaned)
    cleaned = _OPTIONAL_PHRASE.sub("", cleaned)
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    cleaned = re.sub(r"\s+([,;:])", r"\1", cleaned)
    cleaned = re.sub(r"\s*[-–—]\s*(?=[-–—]|$)", "", cleaned)
    cleaned = re.sub(r"(?:\s*[-–—]\s*){2,}", " - ", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" \t\r\n-–—,;:")
    return cleaned


def clean_source_size_options(source_variants: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str], list[str]]:
    """Clean family-wide so duplicate display choices cannot collapse a variant axis."""
    projected = deepcopy(source_variants)
    names = list(dict.fromkeys(name for variant in source_variants for name in variant.get("options", {})))
    mapped_names = {name: clean_size_label(name) if is_size_name(name) else name for name in names}
    warnings: list[str] = []
    if len({name.casefold() for name in mapped_names.values()}) != len(mapped_names):
        mapped_names = {name: name for name in names}
        warnings.append("Size label name collision; original option names were retained.")
    for name in names:
        if not is_size_name(name):
            continue
        raw_values = list(dict.fromkeys(str(variant.get("options", {}).get(name)) for variant in source_variants if name in variant.get("options", {})))
        mapped_values = {value: clean_size_label(value) for value in raw_values}
        if any(not _strip_auxiliary_size_text(value) for value in raw_values):
            warnings.append(f"Size label in '{name}' has no real size after cleanup; original value was retained.")
        if len({value.casefold() for value in mapped_values.values()}) != len(mapped_values):
            mapped_values = {value: value for value in raw_values}
            warnings.append(f"Size label collision in '{name}'; original option values were retained.")
        for variant in projected:
            options = variant.get("options", {})
            if name in options:
                options[name] = mapped_values[str(options[name])]
    for variant in projected:
        variant["options"] = {mapped_names.get(name, name): value for name, value in variant.get("options", {}).items()}
    return projected, mapped_names, warnings


def clean_customization_size_options(
    customization: dict[str, Any] | None,
    *,
    reserved_names: set[str],
) -> tuple[dict[str, Any] | None, list[str]]:
    if customization is None:
        return None, []
    projected = deepcopy(customization)
    pricing = projected.get("pricing") or {}
    groups = [*projected.get("optionGroups", []), *pricing.get("paidOptionGroups", [])]
    warnings: list[str] = []
    names = {str(name).casefold() for name in reserved_names}
    original_group_names = {str(group.get("label") or "").casefold() for group in groups}
    for group in groups:
        name = str(group.get("label") or "")
        if not is_size_name(name):
            continue
        candidate_name = clean_size_label(name)
        if candidate_name.casefold() in names or (candidate_name.casefold() in original_group_names and candidate_name.casefold() != name.casefold()):
            warnings.append(f"Size label name collision in Customize group '{name}'; original name was retained.")
        else:
            group["label"] = candidate_name
            names.add(candidate_name.casefold())
        options = group.get("options", [])
        raw_values = list(dict.fromkeys(str(option.get("label") or "") for option in options))
        mapped_values = {value: clean_size_label(value) for value in raw_values}
        if any(not _strip_auxiliary_size_text(value) for value in raw_values):
            warnings.append(f"Size label in Customize group '{name}' has no real size after cleanup; original value was retained.")
        if len({value.casefold() for value in mapped_values.values()}) != len(mapped_values):
            warnings.append(f"Size label collision in Customize group '{name}'; original values were retained.")
            continue
        for option in options:
            option["label"] = mapped_values[str(option.get("label") or "")]
    return projected, warnings
