"""Minimal Windows tray shell for the distributed crawler agent."""

from __future__ import annotations

import asyncio
import os
import threading
from pathlib import Path
from typing import Any

from .client_agent import DistributedCrawlerAgent


def format_status(status: dict[str, Any]) -> str:
    connection = str(status.get("connection") or "offline").replace("_", " ").title()
    if status.get("waitingCaptcha"):
        connection = "Waiting for CAPTCHA"
    active = max(0, int(status.get("activeTasks") or 0))
    pending = max(0, int(status.get("pendingUploads") or 0))
    pending_label = "pending upload" if pending == 1 else "pending uploads"
    return f"{connection} — {active} active — {pending} {pending_label}"


def should_notify_captcha(previous_waiting: bool, status: dict[str, Any]) -> bool:
    return bool(status.get("waitingCaptcha")) and not previous_waiting


class TrayApplication:
    def __init__(self, agent: DistributedCrawlerAgent, data_directory: Path) -> None:
        self.agent = agent
        self.data_directory = data_directory
        self.status: dict[str, Any] = agent.status_snapshot()
        self.status_text = format_status(self.status)
        self._was_waiting_captcha = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._icon: Any = None
        self._lock = threading.Lock()

    def handle_status(self, status: dict[str, Any]) -> None:
        notify = False
        with self._lock:
            notify = should_notify_captcha(self._was_waiting_captcha, status)
            self._was_waiting_captcha = bool(status.get("waitingCaptcha"))
            self.status = dict(status)
            self.status_text = format_status(status)
            icon = self._icon
        if icon is not None:
            icon.title = f"FFP Amazon Crawler — {self.status_text}"[:127]
            icon.update_menu()
            if notify:
                icon.notify(
                    "Amazon requires a manual CAPTCHA. Complete it in the browser window; the task lease remains active.",
                    "FFP Amazon Crawler",
                )

    def _run_agent(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self.agent.run())
        finally:
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

    def _stop_agent(self) -> None:
        loop = self._loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(self.agent.stop)

    def _open_data_directory(self, _icon: Any, _item: Any) -> None:
        self.data_directory.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            startfile = getattr(os, "startfile", None)
            if callable(startfile):
                startfile(str(self.data_directory))

    def _exit(self, icon: Any, _item: Any) -> None:
        self._stop_agent()
        icon.stop()

    @staticmethod
    def _create_icon_image() -> Any:
        from PIL import Image, ImageDraw

        image = Image.new("RGBA", (64, 64), (13, 22, 42, 255))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((7, 7, 57, 57), radius=12, fill=(6, 182, 212, 255))
        draw.rectangle((19, 20, 45, 25), fill=(255, 255, 255, 255))
        draw.rectangle((19, 31, 40, 36), fill=(255, 255, 255, 255))
        draw.rectangle((19, 42, 34, 47), fill=(255, 255, 255, 255))
        return image

    def run(self) -> None:
        import pystray

        menu = pystray.Menu(
            pystray.MenuItem(lambda _item: self.status_text, None, enabled=False),
            pystray.MenuItem("Open data folder", self._open_data_directory),
            pystray.MenuItem("Exit", self._exit),
        )
        self._icon = pystray.Icon(
            "ffp-amazon-crawler",
            self._create_icon_image(),
            f"FFP Amazon Crawler — {self.status_text}"[:127],
            menu,
        )
        self.agent.on_status = self.handle_status
        self._thread = threading.Thread(target=self._run_agent, name="ffp-amazon-agent", daemon=True)
        self._thread.start()
        try:
            self._icon.run()
        finally:
            self._stop_agent()
            if self._thread is not None:
                self._thread.join(timeout=15)
