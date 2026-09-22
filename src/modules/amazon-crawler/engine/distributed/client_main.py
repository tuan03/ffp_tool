"""CLI entry point for the distributed Windows crawler agent."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Sequence


def _configure_packaged_browser() -> None:
    bundle_directory = Path(str(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent)))
    candidates = [bundle_directory / "ms-playwright", Path(sys.executable).resolve().parent / "ms-playwright"]
    packaged_browsers = next((candidate for candidate in candidates if candidate.is_dir()), None)
    if packaged_browsers is not None:
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(packaged_browsers))


def _resolve_config_path(explicit_path: Path | None) -> Path | None:
    if explicit_path is not None:
        return explicit_path
    if bool(getattr(sys, "frozen", False)):
        portable_config = Path(sys.executable).resolve().parent / "agent.json"
        if portable_config.is_file():
            return portable_config
    return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FFP distributed Amazon crawler client")
    parser.add_argument("--config", type=Path, help="Path to the agent JSON configuration file.")
    parser.add_argument("--project-root", type=Path, help="Crawler cache/profile root; defaults to the agent data directory.")
    parser.add_argument("--no-tray", action="store_true", help="Run in the foreground without a tray icon.")
    parser.add_argument("--check-config", action="store_true", help="Validate configuration and exit.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    _configure_packaged_browser()
    from .client_agent import DistributedCrawlerAgent
    from .client_config import AgentConfig

    arguments = build_parser().parse_args(argv)
    try:
        config = AgentConfig.load(_resolve_config_path(arguments.config))
        project_root = (arguments.project_root or config.data_directory).resolve()
        if arguments.check_config:
            print(json.dumps({
                "status": "ok",
                "serverUrl": config.server_url,
                "displayName": config.display_name,
                "dataDirectory": str(config.data_directory),
                "projectRoot": str(project_root),
            }, ensure_ascii=False))
            return 0
        config.data_directory.mkdir(parents=True, exist_ok=True)
        project_root.mkdir(parents=True, exist_ok=True)
        if arguments.no_tray:
            agent = DistributedCrawlerAgent(
                project_root=project_root,
                config=config,
                on_status=lambda status: print(json.dumps(status, ensure_ascii=False), flush=True),
            )
            asyncio.run(agent.run())
            return 0

        from .client_tray import TrayApplication

        agent = DistributedCrawlerAgent(project_root=project_root, config=config)
        TrayApplication(agent, config.data_directory).run()
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(f"FFP Amazon Crawler could not start: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
