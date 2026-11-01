"""Normalize and deduplicate Etsy listing URLs and bare listing IDs."""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass
from typing import Iterable

ETSY_BARE_LISTING_ID_RE = re.compile(r"^\d{6,20}$")
ETSY_LISTING_PATH_RE = re.compile(r"(?:^|/)(?:[a-z]{2}(?:-[a-z]{2})?/)?listing/(\d{6,20})(?:[/?#]|$)", re.I)


@dataclass(frozen=True)
class NormalizedEtsyInput:
    listing_id: str
    canonical_url: str
    raw_source: str


def normalize_etsy_input(source: str) -> NormalizedEtsyInput:
    """Parse an Etsy listing URL or bare numeric listing ID into a canonical identity."""
    raw = str(source or "").strip()
    if not raw:
        raise ValueError("Etsy listing URL or listing ID must not be empty.")
    if ETSY_BARE_LISTING_ID_RE.fullmatch(raw):
        return NormalizedEtsyInput(
            listing_id=raw,
            canonical_url=f"https://www.etsy.com/listing/{raw}",
            raw_source=raw,
        )

    candidate = raw
    if re.match(r"^(?:www\.)?etsy\.com/", raw, re.I):
        candidate = f"https://{raw}"
    try:
        parsed = urllib.parse.urlsplit(candidate)
    except ValueError as exc:
        raise ValueError(f"Invalid Etsy listing input: {raw}") from exc

    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError(
            "Invalid Etsy input. Paste an Etsy listing URL (https://www.etsy.com/listing/...) or numeric listing ID."
        )

    host = (parsed.hostname or "").lower().rstrip(".")
    if host == "amazon.com" or host.endswith(".amazon.com"):
        raise ValueError("Amazon URL detected in Etsy mode. Switch source to Amazon or paste an Etsy listing.")
    if host != "etsy.com" and not host.endswith(".etsy.com"):
        raise ValueError(f"Unsupported marketplace host '{host or raw}'. Expected etsy.com.")

    match = ETSY_LISTING_PATH_RE.search(parsed.path or "")
    if not match:
        if "/shop/" in (parsed.path or "").lower():
            raise ValueError("Whole Etsy shop URLs are not supported yet; paste individual listing URLs or IDs.")
        raise ValueError("Etsy URL does not contain a valid /listing/<id> path.")

    listing_id = match.group(1)
    return NormalizedEtsyInput(
        listing_id=listing_id,
        canonical_url=f"https://www.etsy.com/listing/{listing_id}",
        raw_source=raw,
    )


def normalize_etsy_inputs(
    sources: Iterable[str],
) -> tuple[list[NormalizedEtsyInput], list[tuple[int, str, str]]]:
    """Deduplicate Etsy inputs in order while capturing invalid lines with their 0-based ordinal."""
    seen: set[str] = set()
    accepted: list[NormalizedEtsyInput] = []
    rejected: list[tuple[int, str, str]] = []
    for ordinal, raw in enumerate(sources):
        text = str(raw or "").strip()
        if not text:
            continue
        try:
            normalized = normalize_etsy_input(text)
        except ValueError as exc:
            rejected.append((ordinal, str(raw), str(exc)))
            continue
        if normalized.listing_id in seen:
            continue
        seen.add(normalized.listing_id)
        accepted.append(normalized)
    return accepted, rejected
