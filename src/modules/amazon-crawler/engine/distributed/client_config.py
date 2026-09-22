"""Configuration and stable Windows storage paths for the client agent."""

from __future__ import annotations

import json
import os
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .protocol import AgentLimits


def default_data_directory() -> Path:
    base = os.environ.get("PROGRAMDATA") or os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / "FFP Amazon Crawler"


@dataclass(frozen=True)
class AgentConfig:
    server_url: str
    display_name: str
    max_concurrent_inputs: int
    limits: AgentLimits
    data_directory: Path
    proxy_config_path: Path | None = None

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
        display_name = str(payload.get("displayName") or socket.gethostname()).strip()
        try:
            concurrency = max(1, min(16, int(payload.get("maxConcurrentInputs", 4))))
        except (TypeError, ValueError):
            concurrency = 4
        data_directory = Path(str(payload.get("dataDirectory") or default_data_directory()))
        raw_proxy_path = str(payload.get("proxyConfigPath") or "").strip()
        if raw_proxy_path:
            proxy_config_path = Path(raw_proxy_path)
            if not proxy_config_path.is_absolute():
                proxy_config_path = configured_path.parent / proxy_config_path
        else:
            proxy_config_path = configured_path.parent / "amazon-crawler-profiles.json"
        proxy_config_path = proxy_config_path.resolve()
        return cls(
            server_url=server_url,
            display_name=display_name,
            max_concurrent_inputs=concurrency,
            limits=AgentLimits.from_payload(payload.get("limits") if isinstance(payload.get("limits"), dict) else {}),
            data_directory=data_directory,
            proxy_config_path=proxy_config_path if proxy_config_path.is_file() else None,
        )

    @property
    def websocket_url(self) -> str:
        if self.server_url.startswith("https://"):
            return "wss://" + self.server_url.removeprefix("https://") + "/api/v1/worker/connect"
        if self.server_url.startswith("http://"):
            return "ws://" + self.server_url.removeprefix("http://") + "/api/v1/worker/connect"
        raise ValueError("serverUrl must start with http:// or https://.")
