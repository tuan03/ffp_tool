"""Connection form. Background validation never calls Tk APIs."""
from __future__ import annotations

import os
import socket
import threading
import tkinter as tk
from tkinter import filedialog, ttk
from collections.abc import Callable, Mapping
from queue import Empty, Queue

from .client_setup import build_setup_payload
from .instance_lock import AgentAlreadyRunningError


def setup_error_message(error: Exception) -> str:
    if isinstance(error, AgentAlreadyRunningError):
        return "Một Agent khác đang dùng dữ liệu của server này. Mở Agent đó hoặc thoát trước khi kết nối."
    if isinstance(error, PermissionError):
        return "Không có quyền ghi cấu hình hoặc thư mục dữ liệu. Kiểm tra quyền thư mục trên máy."
    if isinstance(error, FileNotFoundError):
        return "Không tìm thấy file cấu hình proxy. Mở Nâng cao để chọn lại file hoặc bỏ đường dẫn."
    return {
        "AGENT_NEED_REAUTH": "Agent Key bị từ chối hoặc đã thu hồi. Nhập khóa được cấp cho đúng server.",
        "AGENT_KEY_INVALID": "Agent Key không đúng định dạng. Sao chép đầy đủ khóa, không dùng token SEO Worker.",
        "AGENT_CREDENTIAL_UNAVAILABLE": "Chưa có khóa đã lưu cho server này hoặc tài khoản Windows này. Nhập Agent Key để đăng ký.",
        "AGENT_ENROLLMENT_FAILED": "Server chưa chấp nhận đăng ký Agent. Kiểm tra URL và kết nối mạng.",
    }.get(str(error), "Không thể chuẩn bị kết nối. Kiểm tra cấu hình, Agent Key, mạng và quyền ghi dữ liệu.")


class AgentConnectionWindow:
    def __init__(self, original: Mapping[str, object], connect: Callable[[dict[str, object], str], None], *, error: str = "") -> None:
        self.original = dict(original)
        self.connect = connect
        self.result: dict[str, object] | None = None
        self._results: Queue[tuple[dict[str, object] | None, str]] = Queue()
        self._busy = False
        self.root = tk.Tk()
        self.root.title("FFP Agent — Kết nối")
        self.root.geometry("590x550")
        self.root.minsize(540, 510)
        self.root.option_add("*Font", "{Segoe UI} 10")
        style = ttk.Style(self.root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("SetupTitle.TLabel", font=("Segoe UI", 20, "bold"), foreground="#0e7490")
        style.configure("SetupError.TLabel", foreground="#b91c1c")
        shell = ttk.Frame(self.root, padding=24)
        shell.pack(fill="both", expand=True)
        shell.columnconfigure(0, weight=1)
        ttk.Label(shell, text="FFP Agent", style="SetupTitle.TLabel", font=("Segoe UI", 20, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(shell, text="Kết nối máy này với server để nhận công việc.").grid(row=1, column=0, sticky="w", pady=(4, 16))
        configured_url = str(original.get("serverUrl") or "")
        self.server = tk.StringVar(value="" if configured_url == "https://crawler.example.com" else configured_url)
        self.name = tk.StringVar(value=str(original.get("displayName") or socket.gethostname()))
        self.concurrency = tk.StringVar(value="1" if not self.server.get() else str(original.get("maxConcurrentInputs") or 1))
        for row, label, variable in ((2, "Địa chỉ server", self.server), (4, "Tên agent", self.name)):
            ttk.Label(shell, text=label).grid(row=row, column=0, sticky="w")
            ttk.Entry(shell, textvariable=variable).grid(row=row + 1, column=0, sticky="ew", pady=(4, 12))
        settings = ttk.Frame(shell)
        settings.grid(row=6, column=0, sticky="ew", pady=(0, 12))
        ttk.Label(settings, text="Số link chạy đồng thời").pack(side="left")
        ttk.Spinbox(settings, from_=1, to=16, textvariable=self.concurrency, width=5).pack(side="right")
        self.auto_connect = tk.BooleanVar(value=original.get("autoConnect") is True)
        ttk.Checkbutton(shell, text="Tự kết nối khi mở Agent", variable=self.auto_connect).grid(row=7, column=0, sticky="w")
        ttk.Button(shell, text="Nâng cao…", command=self.show_advanced).grid(row=7, column=0, sticky="e")
        self.auth_key_mode = tk.BooleanVar(value=original.get("authMode") == "key")
        ttk.Checkbutton(shell, text="Server yêu cầu Agent Key (HTTPS)", variable=self.auth_key_mode,
                        command=self._toggle_key).grid(row=8, column=0, sticky="w", pady=(10, 4))
        self.key = tk.StringVar()
        self.key_entry = ttk.Entry(shell, textvariable=self.key, show="•")
        self.key_entry.grid(row=9, column=0, sticky="ew")
        self._toggle_key()
        ttk.Label(shell, text="Nếu máy đã đăng ký Agent Key, để trống để dùng khóa đã lưu.\nCấu hình nâng cao được giữ từ agent.json; không lưu khóa vào JSON.",
                  wraplength=510, foreground="#64748b").grid(row=10, column=0, sticky="w", pady=(8, 6))
        self.message = ttk.Label(shell, text=error, wraplength=510, style="SetupError.TLabel")
        self.message.grid(row=11, column=0, sticky="ew", pady=(4, 10))
        controls = ttk.Frame(shell)
        controls.grid(row=12, column=0, sticky="ew")
        self.connect_button = ttk.Button(controls, text="Kết nối", command=self.submit)
        self.connect_button.pack(side="right")
        self.cancel_button = ttk.Button(controls, text="Thoát", command=self.close)
        self.cancel_button.pack(side="right", padx=8)
        if os.environ.get("AMAZON_COORDINATOR_URL"):
            self.server.set(os.environ["AMAZON_COORDINATOR_URL"])
            self.message.configure(text="Địa chỉ server đang được đặt bằng biến môi trường AMAZON_COORDINATOR_URL.")
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.bind("<Return>", lambda _event: self.submit())
        self.root.update_idletasks()
        # Match content at 125–150% font scaling without clipping the Connect button.
        width = max(590, self.root.winfo_reqwidth())
        height = max(550, self.root.winfo_reqheight())
        self.root.geometry(f"{width}x{height}")
        self._poll_id = self.root.after(100, self._poll)

    def _toggle_key(self) -> None:
        self.key_entry.configure(state="normal" if self.auth_key_mode.get() else "disabled")

    def show_advanced(self) -> None:
        if self._busy:
            return
        window = tk.Toplevel(self.root)
        window.title("FFP Agent — Cấu hình nâng cao")
        window.transient(self.root)
        window.grab_set()
        shell = ttk.Frame(window, padding=20)
        shell.pack(fill="both", expand=True)
        raw_limits = self.original.get("limits")
        limits = dict(raw_limits) if isinstance(raw_limits, dict) else {}
        variables = {}
        for row, (field, caption, default, maximum) in enumerate((
                ("productThreads", "Luồng sản phẩm", 4, 16), ("variantThreads", "Luồng variants", 8, 32),
                ("urllibThreads", "Luồng HTTP", 12, 64), ("browserProfiles", "Browser profiles", 4, 8),
                ("browserTabs", "Tab mỗi browser", 2, 12))):
            variable = tk.StringVar(value=str(limits.get(field, default)))
            variables[field] = (variable, maximum)
            ttk.Label(shell, text=caption).grid(row=row, column=0, sticky="w", pady=6)
            ttk.Spinbox(shell, from_=1, to=maximum, textvariable=variable, width=6).grid(row=row, column=1, sticky="e", padx=16)
        headless = tk.BooleanVar(value=limits.get("headless") is True)
        ttk.Checkbutton(shell, text="Ẩn trình duyệt khi chạy (headless)", variable=headless).grid(row=5, column=0, columnspan=2, sticky="w", pady=8)
        proxy = tk.StringVar(value=str(self.original.get("proxyConfigPath") or ""))
        ttk.Label(shell, text="File cấu hình proxy (không bắt buộc)").grid(row=6, column=0, columnspan=2, sticky="w")
        ttk.Entry(shell, textvariable=proxy, width=45).grid(row=7, column=0, sticky="ew", pady=6)
        def choose_proxy() -> None:
            chosen = filedialog.askopenfilename(parent=window, filetypes=[("JSON", "*.json")])
            if chosen:
                proxy.set(chosen)
        ttk.Button(shell, text="Chọn…", command=choose_proxy).grid(row=7, column=1, padx=8)
        ttk.Label(shell, text="Dữ liệu và danh tính được giữ riêng theo server.\nCấu hình quản trị trên server có thể ghi đè giới hạn này.", wraplength=410).grid(row=8, column=0, columnspan=2, sticky="w", pady=8)
        error = ttk.Label(shell, foreground="#b91c1c")
        error.grid(row=9, column=0, columnspan=2, sticky="w")
        def save() -> None:
            try:
                updated = {field: int(variable.get()) for field, (variable, _maximum) in variables.items()}
                if any(not 1 <= updated[field] <= maximum for field, (_variable, maximum) in variables.items()):
                    raise ValueError()
            except ValueError:
                error.configure(text="Nhập giới hạn là số nguyên trong phạm vi cho phép.")
                return
            self.original["limits"] = {**limits, **updated, "headless": headless.get()}
            self.original["proxyConfigPath"] = proxy.get().strip()
            window.destroy()
        ttk.Button(shell, text="Áp dụng", command=save).grid(row=10, column=1, sticky="e", pady=8)

    def submit(self) -> None:
        if self._busy:
            return
        try:
            payload = build_setup_payload(self.original, server_url=self.server.get(), display_name=self.name.get(),
                concurrency=self.concurrency.get(), auto_connect=self.auto_connect.get(), auth_mode="key" if self.auth_key_mode.get() else "legacy")
        except ValueError:
            self.message.configure(text="Kiểm tra URL server, tên agent và số link (1–16). Agent Key chỉ dùng với HTTPS.")
            return
        key = self.key.get().strip() if self.auth_key_mode.get() else ""
        self.key.set("")
        self._busy = True
        self.connect_button.configure(state="disabled")
        self.cancel_button.configure(state="disabled")
        self.message.configure(text="Đang kiểm tra cấu hình / đăng ký khóa…")
        def prepare() -> None:
            try:
                self.connect(payload, key)
                self._results.put((payload, ""))
            except Exception as error:
                # No raw exception: it can contain a path, credential or server response.
                self._results.put((None, setup_error_message(error)))
        threading.Thread(target=prepare, name="ffp-agent-connection-setup", daemon=True).start()

    def _poll(self) -> None:
        try:
            payload, error = self._results.get_nowait()
        except Empty:
            self._poll_id = self.root.after(100, self._poll)
            return
        self._busy = False
        if payload is not None:
            self.result = payload
            self.root.quit()
            return
        self.message.configure(text=error)
        self.connect_button.configure(state="normal")
        self.cancel_button.configure(state="normal")
        self._poll_id = self.root.after(100, self._poll)

    def close(self) -> None:
        if not self._busy:
            self.root.quit()

    def run(self) -> dict[str, object] | None:
        try:
            self.root.mainloop()
            return self.result
        finally:
            self.destroy()

    def destroy(self) -> None:
        self.root.after_cancel(self._poll_id)
        self.root.destroy()
