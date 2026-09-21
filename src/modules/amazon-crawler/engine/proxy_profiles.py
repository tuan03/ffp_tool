"""Safe proxy profile loading and round-robin assignments."""

from __future__ import annotations

import json
import os
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ProxyAssignment:
    index: int
    name: str
    server: str | None = None
    username: str | None = None
    password: str | None = None

    @property
    def is_enabled(self) -> bool:
        return bool(self.server)

    def urllib_url(self) -> str | None:
        if not self.server:
            return None
        parsed = urllib.parse.urlsplit(self.server)
        if not parsed.hostname:
            return None
        authentication = ""
        if self.username:
            authentication = urllib.parse.quote(self.username, safe="")
            if self.password:
                authentication += f":{urllib.parse.quote(self.password, safe='')}"
            authentication += "@"
        port = f":{parsed.port}" if parsed.port else ""
        return f"{parsed.scheme or 'http'}://{authentication}{parsed.hostname}{port}"

    def playwright_proxy(self) -> dict[str, str] | None:
        if not self.server:
            return None
        proxy = {"server": self.server}
        if self.username:
            proxy["username"] = self.username
        if self.password:
            proxy["password"] = self.password
        return proxy


def _from_environment() -> list[dict[str, Any]]:
    values = [value.strip() for value in re.split(r"[\r\n,;]+", os.environ.get("AMAZON_CRAWLER_PROXIES", "")) if value.strip()]
    return [{"name": f"env-profile-{index + 1}", "enabled": True, "proxy": {"server": value}} for index, value in enumerate(values)]


def load_proxy_profiles(project_root: Path) -> tuple[list[dict[str, Any]], bool, list[str]]:
    configured_path = os.environ.get("AMAZON_CRAWLER_PROXY_CONFIG")
    path = Path(configured_path) if configured_path else project_root / "config" / "amazon-crawler-profiles.json"
    warnings: list[str] = []
    profiles: list[dict[str, Any]] = []
    should_rotate = False
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            raw_profiles = payload.get("profiles", []) if isinstance(payload, dict) else []
            should_rotate = bool(payload.get("rotateProfiles")) if isinstance(payload, dict) else False
            if not isinstance(raw_profiles, list):
                warnings.append("Proxy config profiles must be an array.")
            else:
                profiles = [item for item in raw_profiles if isinstance(item, dict)]
        except (OSError, ValueError) as error:
            warnings.append(f"Proxy config is invalid: {error}")
    environment_profiles = _from_environment()
    profiles.extend(environment_profiles)
    if environment_profiles:
        should_rotate = True
    return profiles, should_rotate, warnings


def resolve_proxy_assignments(project_root: Path, requested_profiles: int) -> tuple[list[ProxyAssignment], list[str]]:
    profiles, should_rotate, warnings = load_proxy_profiles(project_root)
    enabled: list[dict[str, Any]] = []
    for index, profile in enumerate(profiles):
        proxy = profile.get("proxy") if isinstance(profile.get("proxy"), dict) else {}
        server = str(proxy.get("server") or "").strip()
        if profile.get("enabled", True) is False:
            continue
        if server and not urllib.parse.urlsplit(server).scheme:
            warnings.append(f"Proxy profile {profile.get('name') or index + 1} has no URL scheme and was disabled.")
            continue
        if server:
            enabled.append(profile)
    assignments: list[ProxyAssignment] = []
    count = max(1, requested_profiles)
    for index in range(count):
        if not enabled or index >= len(enabled) and not should_rotate:
            assignments.append(ProxyAssignment(index=index, name=f"profile-{index + 1}"))
            continue
        profile = enabled[index % len(enabled)]
        proxy = profile.get("proxy") if isinstance(profile.get("proxy"), dict) else {}
        assignments.append(ProxyAssignment(
            index=index,
            name=str(profile.get("name") or f"profile-{index + 1}"),
            server=str(proxy.get("server") or "").strip() or None,
            username=str(proxy.get("username") or "").strip() or None,
            password=str(proxy.get("password") or "") or None,
        ))
    return assignments, warnings
