"""Wire contracts shared by the coordinator and client agent."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

try:
    from datetime import UTC  # type: ignore[attr-defined]
except ImportError:
    UTC = timezone.utc

from . import AGENT_VERSION, PROTOCOL_VERSION


HEARTBEAT_INTERVAL_SECONDS = 10
CLIENT_OFFLINE_SECONDS = 30
LEASE_SECONDS = 60
MAX_CRAWL_FAILURES = 3


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_iso(value: datetime | None = None) -> str:
    timestamp = value or utc_now()
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=UTC)
    return timestamp.astimezone(UTC).isoformat().replace("+00:00", "Z")


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def payload_checksum(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def settings_fingerprint(settings: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(settings)).hexdigest()[:20]


def require_message(payload: Any, expected_type: str | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Worker message must be a JSON object.")
    message_type = payload.get("type")
    if not isinstance(message_type, str) or not message_type:
        raise ValueError("Worker message type is required.")
    if expected_type is not None and message_type != expected_type:
        raise ValueError(f"Expected {expected_type}, received {message_type}.")
    return payload


@dataclass(frozen=True)
class AgentLimits:
    product_threads: int = 4
    variant_threads: int = 8
    urllib_threads: int = 12
    browser_profiles: int = 4
    browser_tabs: int = 2
    headless: bool = False

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "AgentLimits":
        values = payload or {}

        def bounded(name: str, default: int, maximum: int) -> int:
            try:
                return max(1, min(maximum, int(values.get(name, default))))
            except (TypeError, ValueError):
                return default

        return cls(
            product_threads=bounded("productThreads", 4, 16),
            variant_threads=bounded("variantThreads", 8, 32),
            urllib_threads=bounded("urllibThreads", 12, 64),
            browser_profiles=bounded("browserProfiles", 4, 8),
            browser_tabs=bounded("browserTabs", 2, 12),
            headless=bool(values.get("headless", False)),
        )

    def apply(self, server_settings: dict[str, Any]) -> dict[str, Any]:
        settings = dict(server_settings)
        caps = {
            "productThreads": self.product_threads,
            "variantThreads": self.variant_threads,
            "urllibThreads": self.urllib_threads,
            "browserProfiles": self.browser_profiles,
            "browserTabs": self.browser_tabs,
        }
        for name, maximum in caps.items():
            try:
                settings[name] = min(maximum, max(1, int(settings.get(name, maximum))))
            except (TypeError, ValueError):
                settings[name] = maximum
        settings["headless"] = self.headless
        return settings


def hello_message(
    *,
    client_id: str,
    display_name: str,
    available_slots: int,
    max_concurrent_inputs: int,
    limits: AgentLimits,
    local_tasks: list[dict[str, Any]] | None = None,
    cancel_intents: list[str] | None = None,
    cache_generation: int = 0,
) -> dict[str, Any]:
    return {
        "type": "hello",
        "protocolVersion": PROTOCOL_VERSION,
        "agentVersion": AGENT_VERSION,
        "clientId": client_id,
        "displayName": display_name,
        "availableSlots": max(0, available_slots),
        "maxConcurrentInputs": max(1, max_concurrent_inputs),
        "capabilities": {
            "amazon": True,
            "captcha": not limits.headless,
            "offlineSpool": True,
            "mediaGalleryV2": True,
        },
        "limits": {
            "productThreads": limits.product_threads,
            "variantThreads": limits.variant_threads,
            "urllibThreads": limits.urllib_threads,
            "browserProfiles": limits.browser_profiles,
            "browserTabs": limits.browser_tabs,
            "headless": limits.headless,
        },
        "localTasks": list(local_tasks or []),
        "cancelIntents": list(cancel_intents or []),
        "cacheGeneration": max(0, int(cache_generation)),
    }
