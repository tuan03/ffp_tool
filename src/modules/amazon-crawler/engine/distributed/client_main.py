"""CLI entry point for the distributed Windows crawler agent."""

from __future__ import annotations

from ..observability import redact

import argparse
import asyncio
import gc
from contextlib import contextmanager
import json
import multiprocessing
import os
import sys
import time
import re
from pathlib import Path
from typing import Iterator, Sequence

from .instance_lock import AgentAlreadyRunningError, AgentInstanceLock


@contextmanager
def _acquire_agent_lock(data_directory: Path, *, restart_command_id: str | None) -> Iterator[AgentInstanceLock]:
    deadline = time.monotonic() + (90 if restart_command_id else 0)
    while True:
        lock = AgentInstanceLock(data_directory)
        try:
            lock.__enter__()
            break
        except AgentAlreadyRunningError:
            if restart_command_id is None or time.monotonic() >= deadline:
                raise
            time.sleep(0.25)
    try:
        yield lock
    finally:
        lock.__exit__(None, None, None)


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
        from .client_setup import read_setup_payload, server_setup_config_path, setup_config_path
        saved_config = setup_config_path()
        if saved_config.is_file():
            try:
                scoped = server_setup_config_path(str(read_setup_payload(saved_config).get("serverUrl") or ""))
                if scoped.is_file():
                    return scoped
            except (ValueError, OSError):
                pass
            return saved_config
        portable_config = Path(sys.executable).resolve().parent / "agent.json"
        if portable_config.is_file():
            return portable_config
    return None


def _run_desktop(arguments: argparse.Namespace) -> int:
    from .client_config import AgentConfig
    from .client_agent import DistributedCrawlerAgent
    from .client_setup import read_setup_payload, save_setup_payload, server_setup_config_path, setup_config_path
    from .client_connection_window import AgentConnectionWindow
    from .client_tray import TrayApplication

    source = _resolve_config_path(arguments.config) or Path(os.environ.get("AMAZON_CRAWLER_AGENT_CONFIG", "config/amazon-crawler-agent.json"))
    target = setup_config_path()
    error = ""
    try:
        original = read_setup_payload(source)
    except (ValueError, OSError):
        original = {}
        error = "Không đọc được cấu hình cũ. Bạn có thể nhập lại; file cũ không bị xóa."
    force_setup = False
    while True:
        config = None
        try:
            config = AgentConfig.from_payload(original, source)
            # Opening an existing installation focuses its dashboard, not a second setup.
            with AgentInstanceLock(config.data_directory):
                pass
        except AgentAlreadyRunningError:
            from .client_activation import request_activation
            request_activation(config.data_directory)
            return 0
        except (ValueError, OSError):
            force_setup = True
        if force_setup or original.get("autoConnect") is not True:
            def prepare(payload: dict[str, object], key: str) -> None:
                profile_path = server_setup_config_path(str(payload["serverUrl"]))
                prepared = AgentConfig.from_payload(payload, profile_path)
                proxy_path = str(payload.get("proxyConfigPath") or "").strip()
                if proxy_path and prepared.proxy_config_path is None:
                    raise FileNotFoundError()
                with AgentInstanceLock(prepared.data_directory):
                    if prepared.auth_mode == "key":
                        from .client_credentials import store_credential, load_credential, enroll_agent
                        from .client_store import ClientStore
                        store = ClientStore(prepared.data_directory / "agent.sqlite3")
                        if key:
                            store_credential(store, prepared.server_url, key)
                            enroll_agent(store, prepared.server_url, prepared.display_name)
                        else:
                            load_credential(store, prepared.server_url)
                    save_setup_payload(profile_path, payload)
                    save_setup_payload(target, payload)
            connection_window = AgentConnectionWindow(original, prepare, error=error)
            payload = connection_window.run()
            del connection_window
            # Finalize Tcl objects on the UI thread before starting crawler threads.
            gc.collect()
            if payload is None:
                return 0
            original = payload
            source = server_setup_config_path(str(payload["serverUrl"]))
            config = AgentConfig.from_payload(payload, source)
        if config is None:
            return 1
        default_root = Path(sys.executable).parent if bool(getattr(sys, "frozen", False)) else config.data_directory
        project_root = (arguments.project_root or default_root).resolve()
        project_root.mkdir(parents=True, exist_ok=True)
        try:
            with AgentInstanceLock(config.data_directory):
                agent = DistributedCrawlerAgent(project_root=project_root, config=config)
                application = TrayApplication(agent, config.data_directory, start_minimized=arguments.start_minimized and not force_setup)
                application.run()
                if application.wants_reconfigure:
                    force_setup = True
                    error = "Đã ngắt kết nối an toàn. Chọn server và bấm Kết nối."
                    continue
        except AgentAlreadyRunningError:
            from .client_activation import request_activation
            request_activation(config.data_directory)
            return 0
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FFP distributed crawler agent")
    parser.add_argument("--config", type=Path, help="Path to the agent JSON configuration file.")
    parser.add_argument("--project-root", type=Path, help="Crawler cache/profile root; defaults to the agent data directory.")
    parser.add_argument("--no-tray", action="store_true", help="Run in the foreground without a tray icon.")
    parser.add_argument("--start-minimized", action="store_true", help="Start in the tray without opening the dashboard.")
    parser.add_argument("--check-config", action="store_true", help="Validate configuration and exit.")
    parser.add_argument("--enroll", action="store_true", help="Prompt privately for an Agent Key and enroll over HTTPS.")
    parser.add_argument("--installation-report", type=Path, help="Write the stable client identity during --check-config for installer verification.")
    parser.add_argument("--restart-command-id", help=argparse.SUPPRESS)
    parser.add_argument("--restore-update-database", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--update-command-id", help=argparse.SUPPRESS)
    parser.add_argument("--database-backup-path", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--database-backup-sha256", help=argparse.SUPPRESS)
    parser.add_argument("--apply-zip-update", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--zip-update-probe", type=Path, help=argparse.SUPPRESS)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    multiprocessing.freeze_support()
    _configure_packaged_browser()
    from .client_agent import DistributedCrawlerAgent
    from .client_config import AgentConfig
    arguments = build_parser().parse_args(argv)
    if arguments.apply_zip_update:
        from .zip_updater import apply_update
        return apply_update(arguments.apply_zip_update)
    if arguments.restart_command_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", arguments.restart_command_id):
        print("FFP Amazon Crawler restart command ID is invalid.", file=sys.stderr)
        return 2
    try:
        interactive = (sys.platform == "win32" and not arguments.no_tray
                       and not (arguments.start_minimized and arguments.config is not None)
                       and not any((arguments.check_config, arguments.enroll, arguments.zip_update_probe,
                                    arguments.restore_update_database, arguments.restart_command_id)))
        if interactive:
            return _run_desktop(arguments)
        config = AgentConfig.load(_resolve_config_path(arguments.config))
        default_project_root = (Path(sys.executable).parent if bool(getattr(sys, "frozen", False))
                                else config.data_directory)
        project_root = (arguments.project_root or default_project_root).resolve()
        if arguments.zip_update_probe:
            from . import AGENT_VERSION
            from .client_store import ClientStore
            store = ClientStore(config.data_directory / "agent.sqlite3")
            healthy = store.self_test_database_integrity() and store.drain_outbox_count() == 0 and store.is_paused()
            arguments.zip_update_probe.write_text(json.dumps({
                "status": "PASS" if healthy else "FAIL", "version": AGENT_VERSION,
                "clientId": store.client_id(),
            }), encoding="utf-8")
            return 0 if healthy else 1
        if arguments.restore_update_database:
            if (not arguments.update_command_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", arguments.update_command_id)
                    or arguments.database_backup_path is None
                    or not arguments.database_backup_sha256
                    or not re.fullmatch(r"[a-f0-9]{64}", arguments.database_backup_sha256)):
                raise ValueError("Offline Agent database rollback arguments are invalid.")
            from .client_store import ClientStore
            with AgentInstanceLock(config.data_directory):
                ClientStore(config.data_directory / "agent.sqlite3").restore_agent_update_database(
                    arguments.update_command_id, arguments.database_backup_path,
                    arguments.database_backup_sha256)
            print("Agent database rollback snapshot restored and verified.")
            return 0
        if arguments.enroll:
            import getpass
            from .client_credentials import enroll_agent, store_credential
            from .client_store import ClientStore
            if config.auth_mode != "key":
                raise ValueError("Set authMode to key before enrollment.")
            with AgentInstanceLock(config.data_directory):
                store = ClientStore(config.data_directory / "agent.sqlite3")
                store_credential(store, config.server_url, getpass.getpass("Agent Key (hidden): ").strip())
                identity = enroll_agent(store, config.server_url, config.display_name)
                print(json.dumps({"status": "enrolled", "clientId": identity}))
            return 0
        if arguments.check_config:
            if config.auth_mode == "key":
                from .client_credentials import load_credential
                from .client_store import ClientStore
                load_credential(ClientStore(config.data_directory / "agent.sqlite3"), config.server_url)
            if arguments.installation_report:
                from .client_store import ClientStore
                identity = ClientStore(config.data_directory / "agent.sqlite3").client_id()
                arguments.installation_report.write_text(json.dumps({
                    "clientId": identity, "serverUrl": config.server_url,
                }), encoding="utf-8")
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
        with _acquire_agent_lock(config.data_directory, restart_command_id=arguments.restart_command_id):
            use_tray = not arguments.no_tray and sys.platform == "win32"
            if use_tray:
                try:
                    import pystray  # noqa: F401
                except ImportError:
                    print("Note: 'pystray' is not installed; running agent in console mode.", flush=True)
                    use_tray = False

            if not use_tray:
                agent = DistributedCrawlerAgent(
                    project_root=project_root,
                    config=config,
                    restart_command_id=arguments.restart_command_id,
                    on_status=lambda status: print(json.dumps(
                        {key: value for key, value in status.items() if key != "dashboard"},
                        ensure_ascii=False,
                    ), flush=True),
                )
                asyncio.run(agent.run())
                return 0

            from .client_tray import TrayApplication

            agent = DistributedCrawlerAgent(project_root=project_root, config=config,
                restart_command_id=arguments.restart_command_id)
            TrayApplication(agent, config.data_directory, start_minimized=arguments.start_minimized).run()
        return 0
    except KeyboardInterrupt:
        return 130
    except AgentAlreadyRunningError as error:
        if sys.platform == "win32" and not arguments.no_tray:
            from .client_activation import request_activation

            if arguments.start_minimized:
                return 0
            # The first instance may still be creating its Tk window and activation event.
            for _attempt in range(20):
                if request_activation(config.data_directory):
                    return 0
                time.sleep(0.1)
        print(redact(error), file=sys.stderr)
        return 2
    except Exception as error:
        print(f"FFP Amazon Crawler could not start: {redact(error)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
