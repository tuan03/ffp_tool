"""Windows tray shell for the distributed Amazon and Pinterest crawler agent."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from . import AGENT_VERSION
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
        self._pinterest_action_running = False
        self._lifecycle_action_running = False
        self._latest_agent_version: str | None = None

    def handle_status(self, status: dict[str, Any]) -> None:
        notify = False
        with self._lock:
            notify = should_notify_captcha(self._was_waiting_captcha, status)
            self._was_waiting_captcha = bool(status.get("waitingCaptcha"))
            self.status = dict(status)
            self.status_text = format_status(status)
            icon = self._icon
        if icon is not None:
            icon.title = f"FFP Crawler Agent — {self.status_text}"[:127]
            icon.update_menu()
            if notify:
                icon.notify(
                    "Amazon requires a manual CAPTCHA. Complete it in the browser window; the task lease remains active.",
                    "FFP Crawler Agent",
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
        latest = self._latest_agent_version
        if latest and self._version_parts(latest) > self._version_parts(AGENT_VERSION):
            return f"Có bản cập nhật {latest} (đang dùng {AGENT_VERSION})"
        return f"Phiên bản {AGENT_VERSION} — mới nhất" if latest else f"Phiên bản {AGENT_VERSION}"

    def _check_for_update(self, *, notify: bool) -> None:
        try:
            request = urllib.request.Request(
                f"{self.agent.config.server_url}/api/v1/agent-release",
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
            latest = str(payload.get("version") or "").strip()
            if not latest:
                raise ValueError("Máy chủ không trả về phiên bản Agent.")
            self._latest_agent_version = latest
            if self._icon is not None:
                self._icon.update_menu()
            if notify:
                message = (
                    f"Có bản cập nhật Agent {latest}."
                    if self._version_parts(latest) > self._version_parts(AGENT_VERSION)
                    else f"Agent {AGENT_VERSION} hiện là phiên bản mới nhất."
                )
                self._notify(message)
        except Exception as error:
            if notify:
                self._notify(f"Không thể kiểm tra cập nhật: {error}")

    def _start_update_check(self, _icon: Any = None, _item: Any = None) -> None:
        threading.Thread(
            target=self._check_for_update,
            kwargs={"notify": True},
            name="ffp-agent-update-check",
            daemon=True,
        ).start()

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
        self._stop_agent()
        if self._icon is not None:
            self._icon.stop()

    def _update_agent(self, _icon: Any, _item: Any) -> None:
        if not self._confirm("Cập nhật Agent và tự khởi động lại ngay bây giờ?"):
            return
        self._launch_lifecycle_script("update-agent.ps1", [
            "-ServerUrl", self.agent.config.server_url,
            "-InstallDirectory", str(self.agent.project_root),
            "-AgentProcessId", str(os.getpid()),
        ])

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
        self._uninstall_agent(keep_data=True)

    def _uninstall_all(self, _icon: Any, _item: Any) -> None:
        self._uninstall_agent(keep_data=False)

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
            loop.call_soon_threadsafe(self.agent.set_paused, not bool(self.agent.status_snapshot().get("isPaused")))

    def _stop_local_work(self, _icon: Any, _item: Any) -> None:
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
        self.agent.on_status = self.handle_status
        self._thread = threading.Thread(target=self._run_agent, name="ffp-amazon-agent", daemon=True)
        self._thread.start()
        threading.Thread(
            target=self._check_for_update,
            kwargs={"notify": False},
            name="ffp-agent-update-check",
            daemon=True,
        ).start()
        try:
            self._icon.run()
        finally:
            self._stop_agent()
            if self._thread is not None:
                self._thread.join(timeout=15)
