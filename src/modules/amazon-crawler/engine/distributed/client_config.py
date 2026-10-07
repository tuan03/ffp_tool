"""Configuration and stable Windows storage paths for the client agent."""

from __future__ import annotations

import hashlib
import json
import os
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .protocol import AgentLimits
from .client_storage_pressure import OutboxLimits


def server_data_scope(server_url: str) -> str:
    """Return a stable, filesystem-safe namespace for one Coordinator origin."""
    parsed = urlsplit(server_url)
    hostname = (parsed.hostname or "").encode("idna").decode("ascii").lower()
    if parsed.scheme not in {"http", "https"} or not hostname:
        raise ValueError("serverUrl must contain a valid http or https origin.")
    default_port = 443 if parsed.scheme == "https" else 80
    port = parsed.port
    canonical_origin = f"{parsed.scheme.lower()}://{hostname}"
    if port is not None and port != default_port:
        canonical_origin += f":{port}"
    safe_host = re.sub(r"[^a-z0-9.-]+", "-", hostname).strip("-.") or "server"
    if port is not None and port != default_port:
        safe_host += f"-{port}"
    digest = hashlib.sha256(canonical_origin.encode("utf-8")).hexdigest()[:12]
    return f"{safe_host[:80]}-{digest}"


def default_data_directory(server_url: str | None = None) -> Path:
    base = os.environ.get("PROGRAMDATA") or os.environ.get("LOCALAPPDATA") or str(Path.home())
    root = Path(base) / "FFP Amazon Crawler"
    return root / "servers" / server_data_scope(server_url) if server_url else root


@dataclass(frozen=True)
class AgentConfig:
    server_url: str
    display_name: str
    max_concurrent_inputs: int
    limits: AgentLimits
    data_directory: Path
    proxy_config_path: Path | None = None
    config_file_path: Path | None = None
    trusted_signer_thumbprints: tuple[str, ...] = ()
    outbox: OutboxLimits = OutboxLimits()
    auth_mode: str = "legacy"

    @classmethod
    def load(cls, path: Path | None = None) -> "AgentConfig":
        configured_path = path or Path(os.environ.get("AMAZON_CRAWLER_AGENT_CONFIG", "config/amazon-crawler-agent.json"))
        payload: dict[str, Any] = {}
        if configured_path.is_file():
            loaded = json.loads(configured_path.read_text(encoding="utf-8-sig"))
            if isinstance(loaded, dict):
                payload = loaded
        server_url = str(os.environ.get("AMAZON_COORDINATOR_URL") or payload.get("serverUrl") or "").strip().rstrip("/")
        if not server_url:
            raise ValueError("serverUrl is required in amazon-crawler-agent.json or AMAZON_COORDINATOR_URL.")
        auth_mode = payload.get("authMode", "legacy")
        if auth_mode not in ("legacy", "key"):
            raise ValueError("authMode must be legacy or key.")
        if auth_mode == "key":
            from .client_credentials import validate_secure_origin
            server_url = validate_secure_origin(server_url)
        display_name = str(payload.get("displayName") or socket.gethostname()).strip()
        try:
            concurrency = max(1, min(16, int(payload.get("maxConcurrentInputs", 4))))
        except (TypeError, ValueError):
            concurrency = 4
        data_directory = Path(str(payload.get("dataDirectory") or default_data_directory(server_url)))
        raw_proxy_path = str(payload.get("proxyConfigPath") or "").strip()
        if raw_proxy_path:
            proxy_config_path = Path(raw_proxy_path)
            if not proxy_config_path.is_absolute():
                proxy_config_path = configured_path.parent / proxy_config_path
        else:
            proxy_config_path = configured_path.parent / "amazon-crawler-profiles.json"
        proxy_config_path = proxy_config_path.resolve()
        raw_signers = payload.get("trustedSignerThumbprints", [])
        if not isinstance(raw_signers, list) or any(not isinstance(pin, str) for pin in raw_signers):
            raise ValueError("trustedSignerThumbprints must be an array of certificate thumbprints.")
        trusted_signers = tuple(pin.strip().upper() for pin in raw_signers)
        if any(len(pin) != 40 or any(character not in "0123456789ABCDEF" for character in pin)
               for pin in trusted_signers):
            raise ValueError("trustedSignerThumbprints contains an invalid certificate thumbprint.")
        return cls(
            server_url=server_url,
            display_name=display_name,
            max_concurrent_inputs=concurrency,
            limits=AgentLimits.from_payload(payload.get("limits") if isinstance(payload.get("limits"), dict) else {}),
            data_directory=data_directory,
            proxy_config_path=proxy_config_path if proxy_config_path.is_file() else None,
            config_file_path=configured_path.resolve(),
            trusted_signer_thumbprints=trusted_signers,
            outbox=OutboxLimits.from_payload(payload.get("outbox", {})),
            auth_mode=auth_mode,
        )

    @property
    def websocket_url(self) -> str:
        if self.server_url.startswith("https://"):
            return "wss://" + self.server_url.removeprefix("https://") + "/api/v1/worker/connect"
        if self.server_url.startswith("http://"):
            return "ws://" + self.server_url.removeprefix("http://") + "/api/v1/worker/connect"
        raise ValueError("serverUrl must start with http:// or https://.")
