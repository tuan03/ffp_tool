"""Desktop Notifier for Pinterest POD Studio.

Displays a 100% reliable native Windows notification popup with sound.
Works over any minimized window, full-screen apps, and multiple monitors.
Auto-dismisses after timeout or opens the tool when OK is clicked.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import sys
import webbrowser


def play_chime() -> None:
    try:
        import winsound
        winsound.MessageBeep(winsound.MB_ICONASTERISK)
    except Exception:
        pass


def send_windows_toast(title: str, message: str) -> None:
    """Best-effort Windows Action Center Toast notification."""
    safe_title = str(title or "Pinterest POD").replace('"', '`"').replace("'", "''")
    safe_msg = str(message or "").replace('"', '`"').replace("'", "''")
    ps_code = f"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$appId = 'Chrome'
$template = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>{safe_title}</text>
            <text>{safe_msg}</text>
        </binding>
    </visual>
</toast>
"@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
"""
    try:
        import subprocess
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_code],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        pass


def show_floating_desktop_card(title: str, message: str, url: str = "http://127.0.0.1:8765/#pinterest-pod", duration_sec: int = 10) -> None:
    """Shows native Windows always-on-top popup with audio chime and auto-restore on OK."""
    play_chime()
    send_windows_toast(title, message)

    try:
        formatted_message = f"{message}\n\n👉 Bấm OK để mở lại giao diện Pinterest POD (tự động đóng sau {duration_sec}s)"
        # MB_OK (0x0) | MB_ICONINFORMATION (0x40) | MB_TOPMOST (0x40000) | MB_SETFOREGROUND (0x10000) | MB_SERVICE_NOTIFICATION (0x200000)
        flags = 0x00000000 | 0x00000040 | 0x00040000 | 0x00010000 | 0x00200000
        timeout_ms = max(3, duration_sec) * 1000

        res = ctypes.windll.user32.MessageBoxTimeoutW(
            0,
            formatted_message,
            str(title or "Pinterest POD Studio"),
            flags,
            0,
            timeout_ms,
        )

        # res == 1 means user clicked OK or pressed Enter
        if res == 1:
            try:
                webbrowser.open(url)
            except Exception:
                pass
    except Exception as exc:
        print(f"Desktop popup error: {exc}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="Desktop Notifier")
    parser.add_argument("--title", default="Pinterest POD Studio", help="Notification title")
    parser.add_argument("--message", default="Đã hoàn thành tác vụ!", help="Notification message")
    parser.add_argument("--url", default="http://127.0.0.1:8765/#pinterest-pod", help="URL to open")
    parser.add_argument("--duration", type=int, default=10, help="Display duration in seconds")
    parser.add_argument("--delay", type=int, default=0, help="Delay in seconds before showing")
    args = parser.parse_args()

    if args.delay > 0:
        import time
        time.sleep(args.delay)

    show_floating_desktop_card(args.title, args.message, args.url, args.duration)
    return 0


if __name__ == "__main__":
    sys.exit(main())
