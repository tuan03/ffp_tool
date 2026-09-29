"""Windows tray and dashboard lifecycle for the distributed crawler agent."""

from __future__ import annotations

import asyncio
import gc
import os
import threading
import time
from copy import deepcopy
from pathlib import Path
from queue import Empty, Queue
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
    return bool(status.get("waitingCaptcha") or status.get("captchaDetected")) and not previous_waiting


class TrayApplication:
    def __init__(self, agent: DistributedCrawlerAgent, data_directory: Path, *, start_minimized: bool = False) -> None:
        self.agent = agent
        self.data_directory = data_directory
        self.status: dict[str, Any] = agent.status_snapshot()
        self.status_text = format_status(self.status)
        self._was_waiting_captcha = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._icon: Any = None
        self._lock = threading.Lock()
        self.start_minimized = start_minimized
        self._actions: Queue[str] = Queue()
        self._window = None
        self._activation = None
        self._last_render = 0.0
        self._is_exiting = False

    def _status_snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self.status

    def handle_status(self, status: dict[str, Any]) -> None:
        notify = False
        with self._lock:
            notify = should_notify_captcha(self._was_waiting_captcha, status)
            self._was_waiting_captcha = bool(status.get("waitingCaptcha") or status.get("captchaDetected"))
            self.status = deepcopy(status)
            self.status_text = format_status(status)
            icon = self._icon
        if icon is not None:
            icon.title = f"FFP Amazon Crawler — {self.status_text}"[:127]
            icon.update_menu()
            if notify:
                icon.notify(
                    "Đã phát hiện CAPTCHA. Kiểm tra cửa sổ trình duyệt và giải CAPTCHA nếu cần; agent sẽ tự tiếp tục.",
                    "FFP Amazon Crawler",
                )

    def _run_agent(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self.agent.run())
        except Exception as error:
            self.agent._debug_event("agent_loop_failed", error=str(error))
            with self._lock:
                self.status = {**self.status, "isConnected": False, "agentStopped": True}
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

    def _toggle_pause(self, _icon: Any, _item: Any) -> None:
        loop = self._loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(lambda: self.agent.set_paused(not bool(self.agent.status_snapshot().get("isPaused"))))

    def _stop_local_work(self, _icon: Any, _item: Any) -> None:
        if self._window is not None:
            self._actions.put("confirm_stop")
            return
        should_stop = True
        if os.name == "nt":
            import ctypes

            response = ctypes.windll.user32.MessageBoxW(
                0,
                "Stop and permanently discard every local crawler task? The cancellation will be sent to the coordinator when it reconnects.",
                "FFP Amazon Crawler",
                0x00000004 | 0x00000030,
            )
            should_stop = response == 6
        if not should_stop:
            return
        loop = self._loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(self.agent.stop_and_discard_local_work)

    def _exit(self, icon: Any, _item: Any) -> None:
        if self._window is not None:
            self._actions.put("exit")
            return
        self._stop_agent()
        icon.stop()

    def _show_window(self, _icon: Any, _item: Any) -> None:
        if self._window is not None:
            self._actions.put("show")
        elif os.name == "nt":
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, "Không mở được giao diện agent. Agent vẫn chạy trong khay hệ thống; hãy kiểm tra Python Tk/Tcl hoặc cài lại bản agent.", "FFP Agent", 0x10)

    def _dispatch_action(self, action: str) -> None:
        if action == "show" and self._window is not None:
            self._window.show()
        elif action == "confirm_stop" and self._window is not None:
            self._window.confirm_stop()
        elif action == "pause":
            self._toggle_pause(None, None)
        elif action == "folder":
            self._open_data_directory(None, None)
        elif action == "stop":
            loop = self._loop
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(self.agent.stop_and_discard_local_work)
        elif action == "exit":
            self._is_exiting = True
            self._stop_agent()
            if self._icon is not None:
                self._icon.stop()
            if self._window is not None:
                self._window.close()

    def _poll_ui(self) -> None:
        if self._is_exiting or self._window is None:
            return
        if self._activation is not None and self._activation.requested():
            self._window.show()
        try:
            while True:
                self._dispatch_action(self._actions.get_nowait())
                if self._is_exiting:
                    return
        except Empty:
            pass
        if time.monotonic() - self._last_render >= 1:
            self._window.render(self._status_snapshot())
            self._last_render = time.monotonic()
        self._window.root.after(100, self._poll_ui)

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
            pystray.MenuItem("Mở cửa sổ agent", self._show_window, default=True),
            pystray.MenuItem(lambda _item: self.status_text, None, enabled=False),
            pystray.MenuItem("Pause / Resume", self._toggle_pause),
            pystray.MenuItem("Stop & discard local work", self._stop_local_work),
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
        try:
            from .client_dashboard_window import AgentDashboardWindow

            self._window = AgentDashboardWindow(self._status_snapshot, self._actions.put, start_minimized=self.start_minimized)
        except Exception as error:
            # The tray remains usable on Python distributions without Tk/Tcl.
            self.agent._debug_event("dashboard_startup_failed", error=str(error))
            self._window = None
        if self._window is not None and os.name == "nt":
            from .client_activation import ActivationSignal

            try:
                self._activation = ActivationSignal(self.data_directory)
            except OSError:
                self._activation = None
        self._thread = threading.Thread(target=self._run_agent, name="ffp-amazon-agent", daemon=True)
        self._thread.start()
        try:
            if self._window is None:
                def notify_fallback(icon: Any) -> None:
                    icon.visible = True
                    icon.notify("Không mở được giao diện. Agent tiếp tục chạy trong khay hệ thống.", "FFP Agent")

                self._icon.run(setup=notify_fallback)
            else:
                self._icon.run_detached()
                self._poll_ui()
                self._window.root.mainloop()
        finally:
            self._stop_agent()
            self._icon.stop()
            if self._activation is not None:
                self._activation.close()
            if self._thread is not None:
                self._thread.join(timeout=15)
            if self._window is not None:
                self._window.close()
                self._window = None
                # Finalize Tcl on the UI thread, before any remaining crawler thread can run GC.
                gc.collect()
