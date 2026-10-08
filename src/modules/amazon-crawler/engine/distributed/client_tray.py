"""Windows tray and dashboard lifecycle for the distributed crawler agent."""

from __future__ import annotations

import asyncio
import gc
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from copy import deepcopy
import urllib.request
import uuid
from pathlib import Path
from queue import Empty, Queue
from typing import Any

from . import AGENT_VERSION
from .client_agent import DistributedCrawlerAgent
from .client_storage_pressure import storage_warning_text


def format_status(status: dict[str, Any]) -> str:
    connection = str(status.get("connection") or "offline").replace("_", " ").title()
    if status.get("waitingCaptcha"):
        connection = "Waiting for CAPTCHA"
    if (status.get("storage") or {}).get("blocked"):
        connection = "Storage blocked"
    active = max(0, int(status.get("activeTasks") or 0))
    pending = max(0, int(status.get("pendingUploads") or 0))
    pending_label = "pending upload" if pending == 1 else "pending uploads"
    warning = storage_warning_text(status.get("storage"))
    return f"{connection} — {active} active — {pending} {pending_label}" + (f" — {warning}" if warning else "")


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

        self._pinterest_action_running = False
        self._lifecycle_action_running = False
        self._latest_agent_version: str | None = None
        self._latest_release_payload: dict | None = None
        self._update_message = ""
        self._update_receipt = self.data_directory / "last-zip-update.json"
        if self._update_receipt.is_file():
            try:
                receipt = json.loads(self._update_receipt.read_text(encoding="utf-8"))
                stage = receipt.get("stage")
                if stage == "INSTALLED_AWAITING_CONNECTION":
                    self._update_message = f"Đã cài {AGENT_VERSION}; đang chờ kết nối server, agent vẫn tạm ngưng."
                elif stage == "FAILED_OR_ROLLED_BACK":
                    self._update_message = "Cập nhật lỗi; đã khởi động lại bản trước. Xem nhật ký cập nhật."
            except (OSError, ValueError):
                self._update_message = "Không đọc được kết quả cập nhật trước."

    def _status_snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {**self.status, "updateMessage": self._update_message}

    def handle_status(self, status: dict[str, Any]) -> None:
        if status.get("isConnected") and "đang chờ kết nối server" in self._update_message:
            self._update_message = f"Đã cập nhật {AGENT_VERSION} và kết nối server. Bấm tiếp tục khi sẵn sàng."
        notify = False
        with self._lock:
            notify = should_notify_captcha(self._was_waiting_captcha, status)
            self._was_waiting_captcha = bool(status.get("waitingCaptcha") or status.get("captchaDetected"))
            self.status = deepcopy(status)
            self.status_text = format_status(status)
            icon = self._icon
        if icon is not None:
            icon.title = f"FFP Crawler Agent — {self.status_text}"[:127]
            icon.update_menu()
            if notify:
                icon.notify(
                    "Đã phát hiện CAPTCHA. Kiểm tra cửa sổ trình duyệt và giải CAPTCHA nếu cần; agent sẽ tự tiếp tục.",
                    "FFP Amazon Crawler",
                )

    def _notify(self, message: str, title: str = "FFP Crawler Agent") -> None:
        icon = self._icon
        if icon is not None:
            try:
                icon.notify(message, title)
            except Exception:
                pass

    def _pinterest_login_script(self) -> Path:
        return self.agent.project_root / "src" / "modules" / "pinterest-pod" / "server" / "pinterest" / "pinterest_browser_login.py"

    def _pinterest_profile_dir(self) -> Path:
        return self.agent.project_root / "src" / "modules" / "pinterest-pod" / "server" / "pinterest" / ".pinterest_browser_profile"

    def _has_active_tasks(self) -> bool:
        return int(self.agent.status_snapshot().get("activeTasks") or 0) > 0

    def _has_pending_uploads(self) -> bool:
        return int(self.agent.status_snapshot().get("pendingUploads") or 0) > 0

    @staticmethod
    def _version_parts(value: str) -> tuple[int, ...]:
        try:
            return tuple(int(part) for part in value.split("."))
        except ValueError:
            return (0,)

    def _channel_status_text(self, channel: str) -> str:
        tasks = self.status.get("currentTasks") if isinstance(self.status.get("currentTasks"), list) else []
        active = sum(1 for task in tasks if isinstance(task, dict) and task.get("channel") == channel)
        label = "Pinterest" if channel == "pinterest" else "Amazon"
        return f"{label}: {active} job đang chạy" if active else f"{label}: Sẵn sàng"

    def _update_status_text(self, _item: Any) -> str:
        if self._update_message and self._lifecycle_action_running:
            return self._update_message
        latest = self._latest_agent_version
        if latest and self._version_parts(latest) > self._version_parts(AGENT_VERSION):
            return f"Có bản cập nhật {latest} (đang dùng {AGENT_VERSION})"
        if self._update_message:
            return self._update_message
        return f"Phiên bản {AGENT_VERSION} — mới nhất" if latest else f"Phiên bản {AGENT_VERSION} — chưa kiểm tra được cập nhật"

    def _check_for_update(self, *, notify: bool) -> str | None:
        try:
            request = urllib.request.Request(
                f"{self.agent.config.server_url}/api/v1/agent-release",
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = json.loads(response.read(65537).decode("utf-8"))
            from .zip_release import verify_release
            manifest = verify_release(payload.get("release"))
            latest = manifest["version"]
            if not latest:
                raise ValueError("Máy chủ không trả về phiên bản Agent.")
            self._latest_agent_version = latest
            self._latest_release_payload = payload
            if self._icon is not None:
                self._icon.update_menu()
            if notify:
                message = (
                    f"Có bản cập nhật Agent {latest}."
                    if self._version_parts(latest) > self._version_parts(AGENT_VERSION)
                    else f"Agent {AGENT_VERSION} hiện là phiên bản mới nhất."
                )
                self._notify(message)
            return latest
        except Exception as error:
            self._latest_agent_version = None
            self._latest_release_payload = None
            if notify:
                self._notify(f"Không thể kiểm tra cập nhật: {error}")
            return None

    def _start_update_check(self, _icon: Any = None, _item: Any = None) -> None:
        threading.Thread(
            target=self._check_for_update,
            kwargs={"notify": True},
            name="ffp-agent-update-check",
            daemon=True,
        ).start()

    def _periodic_update_check(self) -> None:
        while not self.agent.stop_event.is_set():
            self._check_for_update(notify=False)
            # A short sleep keeps shutdown prompt; checks run every 30 minutes.
            for _ in range(1800):
                if self.agent.stop_event.is_set():
                    return
                time.sleep(1)

    def _lifecycle_is_safe(self) -> bool:
        if self._has_active_tasks():
            self._notify("Không thể cập nhật hoặc gỡ khi Agent đang chạy job.")
            return False
        if self._has_pending_uploads():
            self._notify("Không thể cập nhật hoặc gỡ khi còn kết quả đang chờ gửi lên FFP.")
            return False
        return True

    @staticmethod
    def _confirm(message: str, *, dangerous: bool = False) -> bool:
        if os.name != "nt":
            return True
        import ctypes

        icon = 0x00000010 if dangerous else 0x00000030
        return ctypes.windll.user32.MessageBoxW(0, message, "FFP Crawler Agent", 0x00000004 | icon) == 6

    def _launch_lifecycle_script(self, script_name: str, arguments: list[str], *, copy_to_temp: bool = False) -> None:
        if self._lifecycle_action_running or not self._lifecycle_is_safe():
            return
        source = self.agent.project_root / "scripts" / script_name
        if not source.is_file():
            self._notify(f"Không tìm thấy công cụ vòng đời: {script_name}")
            return
        script = source
        if copy_to_temp:
            script = Path(tempfile.gettempdir()) / f"ffp-{uuid.uuid4().hex}-{script_name}"
            shutil.copy2(source, script)
        self._lifecycle_action_running = True
        creation_flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        try:
            subprocess.Popen(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), *arguments],
                cwd=str(script.parent if copy_to_temp else self.agent.project_root),
                creationflags=creation_flags,
            )
        except Exception as error:
            self._lifecycle_action_running = False
            self._notify(f"Không thể mở công cụ: {error}")
            return
        if self._window is not None:
            # Lifecycle callbacks run outside Tk's thread; close the dashboard on its UI loop.
            self._actions.put("exit")
            return
        self._stop_agent()
        if self._icon is not None:
            self._icon.stop()

    @staticmethod
    def _defer_menu_action(action: Any, *, name: str) -> None:
        """Let the native tray menu close before opening a modal Windows dialog."""
        timer = threading.Timer(0.2, action)
        timer.name = name
        timer.daemon = True
        timer.start()

    def _run_update_agent(self) -> None:
        latest = self._check_for_update(notify=False)
        if latest is None:
            self._notify("Không thể xác định phiên bản Agent mới nhất. Hãy kiểm tra kết nối rồi thử lại.")
            return
        if self._version_parts(latest) <= self._version_parts(AGENT_VERSION):
            self._notify(f"Agent {AGENT_VERSION} hiện là phiên bản mới nhất. Không cần cập nhật.")
            return
        if self._lifecycle_action_running:
            return
        if not self._confirm(f"Cập nhật Agent lên {latest}? Tool sẽ chờ task và kết quả gửi xong, rồi tự khởi động lại ở trạng thái tạm ngưng."):
            return
        self._lifecycle_action_running = True
        def report(message: str) -> None:
            self._update_message = message
            if self._icon:
                self._icon.update_menu()
        try:
            from .zip_release import verify_release, require_compatible, download_zip
            payload = self._latest_release_payload
            if payload is None or self._loop is None or not self._loop.is_running():
                raise ValueError("Không có thông tin phát hành hoặc agent chưa chạy.")
            manifest = verify_release(payload["release"])
            require_compatible(manifest, AGENT_VERSION, payload["serverVersion"], payload["protocolVersion"])
            with tempfile.TemporaryDirectory(prefix="ffp-release-download-") as temporary:
                archive = Path(temporary) / "release.zip"
                download_zip(manifest, archive, lambda count, total: report(f"Đang tải bản {latest}: {count * 100 // total}%"))
                future = asyncio.run_coroutine_threadsafe(
                    self.agent.install_zip_release(payload["release"], archive, report), self._loop)
                future.result()
            self._actions.put("exit")
        except Exception:
            report("Cập nhật chưa hoàn tất — kiểm tra kênh phát hành, dung lượng và trạng thái agent.")
            self._notify(self._update_message)
        finally:
            self._lifecycle_action_running = False

    def _update_agent(self, _icon: Any, _item: Any) -> None:
        self._defer_menu_action(self._run_update_agent, name="ffp-agent-update-confirm")

    def _uninstall_agent(self, *, keep_data: bool) -> None:
        message = (
            "Gỡ chương trình nhưng giữ cấu hình, profile Pinterest và dữ liệu runtime?"
            if keep_data
            else "GỠ TOÀN BỘ Agent, cấu hình, profile Pinterest và dữ liệu cục bộ? Thao tác này không thể hoàn tác."
        )
        if not self._confirm(message, dangerous=not keep_data):
            return
        arguments = [
            "-InstallDirectory", str(self.agent.project_root),
            "-AgentProcessId", str(os.getpid()),
            "-ServerUrl", self.agent.config.server_url,
            "-ClientId", self.agent.client_id,
        ]
        if keep_data:
            arguments.append("-KeepData")
        self._launch_lifecycle_script("uninstall-agent.ps1", arguments, copy_to_temp=True)

    def _uninstall_keep_data(self, _icon: Any, _item: Any) -> None:
        self._defer_menu_action(
            lambda: self._uninstall_agent(keep_data=True),
            name="ffp-agent-uninstall-keep-data-confirm",
        )

    def _uninstall_all(self, _icon: Any, _item: Any) -> None:
        self._defer_menu_action(
            lambda: self._uninstall_agent(keep_data=False),
            name="ffp-agent-uninstall-all-confirm",
        )

    def _run_pinterest_action(self, action: str) -> None:
        if self._pinterest_action_running:
            self._notify("Một thao tác Pinterest khác đang chạy.")
            return
        if self._has_active_tasks():
            self._notify("Hãy chờ Agent cào xong hoặc tạm dừng công việc trước khi thay đổi phiên Pinterest.")
            return
        self._pinterest_action_running = True
        try:
            if action == "login":
                script = self._pinterest_login_script()
                if not script.is_file():
                    self._notify(f"Không tìm thấy script đăng nhập: {script}")
                    return
                completed = subprocess.run(
                    [sys.executable, str(script)],
                    cwd=str(self.agent.project_root),
                    check=False,
                )
                if completed.returncode == 0 and self.agent.pinterest_browser_logged_in():
                    self._notify("Đăng nhập Pinterest thành công. Trạng thái sẽ cập nhật lên FFP trong vài giây.")
                else:
                    self._notify("Chưa đăng nhập Pinterest thành công. Hãy mở lại menu Agent và thử lại.")
            elif action == "logout":
                profile_dir = self._pinterest_profile_dir().resolve()
                expected_parent = (self.agent.project_root / "src" / "modules" / "pinterest-pod" / "server" / "pinterest").resolve()
                if profile_dir.parent != expected_parent or profile_dir.name != ".pinterest_browser_profile":
                    self._notify("Từ chối xóa profile Pinterest ngoài thư mục Agent.")
                    return
                if profile_dir.exists():
                    shutil.rmtree(profile_dir)
                self._notify("Đã đăng xuất Pinterest khỏi Agent này.")
        except Exception as error:
            self._notify(f"Thao tác Pinterest thất bại: {error}")
        finally:
            self._pinterest_action_running = False
            self.handle_status(self.agent.status_snapshot())

    def _start_pinterest_action(self, action: str) -> None:
        threading.Thread(
            target=self._run_pinterest_action,
            args=(action,),
            name=f"ffp-pinterest-{action}",
            daemon=True,
        ).start()

    def _login_pinterest(self, _icon: Any, _item: Any) -> None:
        self._start_pinterest_action("login")

    def _pinterest_status_text(self, _item: Any) -> str:
        capabilities = self.status.get("capabilities") if isinstance(self.status.get("capabilities"), dict) else {}
        return "Pinterest: Đã đăng nhập" if capabilities.get("pinterestBrowserLoggedIn") else "Pinterest: Chưa đăng nhập"

    def _logout_pinterest(self, _icon: Any, _item: Any) -> None:
        should_logout = True
        if os.name == "nt":
            import ctypes

            response = ctypes.windll.user32.MessageBoxW(
                0,
                "Đăng xuất Pinterest trên Agent này? Các job đang chạy phải hoàn tất trước.",
                "FFP Crawler Agent",
                0x00000004 | 0x00000030,
            )
            should_logout = response == 6
        if should_logout:
            self._start_pinterest_action("logout")

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
            if self.agent._update_exit_requested:
                if self._window is not None:
                    self._actions.put("exit")
                elif self._icon is not None:
                    self._icon.stop()
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

    def _request_agent_restart_exit(self) -> None:
        if self._window is not None:
            self._actions.put("exit")
        elif self._icon is not None:
            self._icon.stop()

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
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Amazon Crawler", pystray.Menu(
                pystray.MenuItem(lambda _item: self._channel_status_text("amazon"), None, enabled=False),
                pystray.MenuItem("CAPTCHA sẽ mở trình duyệt khi cần", None, enabled=False),
            )),
            pystray.MenuItem("Pinterest Crawler", pystray.Menu(
                pystray.MenuItem(self._pinterest_status_text, None, enabled=False),
                pystray.MenuItem("Đăng nhập Pinterest", self._login_pinterest),
                pystray.MenuItem("Đăng xuất / đổi tài khoản", self._logout_pinterest),
            )),
            pystray.MenuItem("Điều khiển Agent", pystray.Menu(
                pystray.MenuItem("Tạm dừng / Tiếp tục nhận việc", self._toggle_pause),
                pystray.MenuItem("Dừng và xóa việc cục bộ", self._stop_local_work),
            )),
            pystray.MenuItem("Ứng dụng", pystray.Menu(
                pystray.MenuItem(self._update_status_text, None, enabled=False),
                pystray.MenuItem("Kiểm tra cập nhật", self._start_update_check),
                pystray.MenuItem("Cập nhật và khởi động lại", self._update_agent),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Mở thư mục dữ liệu", self._open_data_directory),
                pystray.MenuItem("Gỡ cài đặt", pystray.Menu(
                    pystray.MenuItem("Gỡ nhưng giữ dữ liệu", self._uninstall_keep_data),
                    pystray.MenuItem("Gỡ toàn bộ dữ liệu", self._uninstall_all),
                )),
            )),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Thoát Agent", self._exit),
        )
        self._icon = pystray.Icon(
            "ffp-crawler-agent",
            self._create_icon_image(),
            f"FFP Crawler Agent — {self.status_text}"[:127],
            menu,
        )
        self.agent.on_restart_requested = self._request_agent_restart_exit
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
        threading.Thread(
            target=self._periodic_update_check,
            name="ffp-agent-update-check",
            daemon=True,
        ).start()
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
