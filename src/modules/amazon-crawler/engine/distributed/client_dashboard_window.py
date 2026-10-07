"""Windows-style local dashboard. All Tk calls belong to the main UI thread."""

from __future__ import annotations

import tkinter as tk
import os
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from tkinter import messagebox, ttk

from .client_storage_pressure import storage_warning_text

STATE_LABELS = {
    "queued": "Đang chờ", "recovering": "Đang đối chiếu", "running": "Đang xử lý",
    "captcha": "Chờ CAPTCHA", "completed": "Hoàn tất", "failed": "Lỗi",
    "cancelled": "Đã hủy", "interrupted": "Gián đoạn",
}
DELIVERY_LABELS = {
    "none": "—", "pending": "Chờ gửi", "uploading": "Đang gửi", "sent": "Đã gửi",
    "retry": "Chờ thử lại", "cancelled": "Đã hủy",
}
PHASE_LABELS = {
    "queued": "Đang chờ", "recovering": "Đang đối chiếu", "starting": "Khởi tạo",
    "product": "Cào sản phẩm", "parent": "Cào sản phẩm chính", "variant_matrix": "Tìm variants",
    "customization": "Amazon Customize", "captcha": "Chờ CAPTCHA", "pinterest": "Pinterest POD",
    "completed": "Hoàn tất", "failed": "Lỗi", "cancelled": "Đã hủy", "interrupted": "Gián đoạn",
}


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, dict) else {}


def _rows(value: object) -> list[dict[str, object]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def display_time(value: object) -> str:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone().strftime("%d/%m %H:%M:%S")
    except (ValueError, TypeError):
        return "—"


def elapsed_time(task: Mapping[str, object], now: datetime | None = None) -> str:
    try:
        start = datetime.fromisoformat(str(task.get("startedAt") or "").replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(task["finishedAt"]).replace("Z", "+00:00")) if task.get("finishedAt") else (now or datetime.now(timezone.utc))
        seconds = max(0, int((end - start).total_seconds()))
        return f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"
    except (ValueError, TypeError):
        return "—"


def variant_progress(task: Mapping[str, object]) -> str:
    total = task.get("variantTotal")
    completed = task.get("variantCompleted")
    if task.get("channel") == "amazon" and isinstance(total, int) and total > 0:
        return f"{completed if isinstance(completed, int) else 0}/{total} variants"
    return "Đang xử lý…" if task.get("state") in {"running", "captcha"} else "—"


class AgentDashboardWindow:
    def __init__(self, snapshot: Callable[[], Mapping[str, object]], action: Callable[[str], None], *, start_minimized: bool = False) -> None:
        self._snapshot = snapshot
        self._action = action
        self._task_rows: dict[str, dict[str, object]] = {}
        self._selected_key = ""
        self._is_closed = False
        if os.name == "nt":
            import ctypes

            # Avoid Windows bitmap scaling and mismatched window/screen coordinates at 125–150% DPI.
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            try:
                user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
            except AttributeError:
                user32.SetProcessDPIAware()
        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title("FFP Agent — Công việc và trạng thái")
        self.root.geometry("1100x780")
        self.root.minsize(860, 650)
        self.root.protocol("WM_DELETE_WINDOW", self.root.withdraw)
        self.root.bind("<Escape>", lambda _event: self.root.withdraw())
        self.root.option_add("*Font", "{Segoe UI} 10")
        style = ttk.Style(self.root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("Treeview", rowheight=28)
        style.configure("Title.TLabel", font=("Segoe UI", 15, "bold"))
        style.configure("Warning.TLabel", foreground="#9a3412")

        shell = ttk.Frame(self.root, padding=16)
        shell.pack(fill="both", expand=True)
        shell.columnconfigure(0, weight=1)
        shell.rowconfigure(4, weight=1)
        self.title = ttk.Label(shell, text="FFP Agent", style="Title.TLabel", font=("Segoe UI", 15, "bold"))
        self.title.grid(row=0, column=0, sticky="w")
        self.connection = ttk.Label(shell, text="Đang khởi động…")
        self.connection.grid(row=1, column=0, sticky="w", pady=(5, 3))
        self.counters = ttk.Label(shell, text="")
        self.counters.grid(row=2, column=0, sticky="w", pady=(0, 5))
        self.warning = ttk.Label(shell, style="Warning.TLabel", wraplength=1000)
        self.warning.grid(row=3, column=0, sticky="w", pady=(0, 8))

        self.notebook = ttk.Notebook(shell)
        self.notebook.grid(row=4, column=0, sticky="nsew")
        work = ttk.Frame(self.notebook, padding=10)
        history = ttk.Frame(self.notebook, padding=10)
        info = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(work, text="Công việc")
        self.notebook.add(history, text="Lịch sử")
        self.notebook.add(info, text="Thông tin agent")
        history.columnconfigure(0, weight=1)
        history.rowconfigure(0, weight=1)
        self.history_notebook = ttk.Notebook(history)
        self.history_notebook.grid(row=0, column=0, sticky="nsew")
        task_history = ttk.Frame(self.history_notebook, padding=8)
        activity_history = ttk.Frame(self.history_notebook, padding=8)
        self.history_notebook.add(task_history, text="Các lượt công việc")
        self.history_notebook.add(activity_history, text="Hoạt động agent")
        for history_panel in (task_history, activity_history):
            history_panel.columnconfigure(0, weight=1)
            history_panel.rowconfigure(1, weight=1)
        info.columnconfigure(0, weight=1)
        info.rowconfigure(0, weight=1)
        self.empty = ttk.Label(work, text="Chưa có công việc. Agent sẽ tự nhận việc khi server phân công.")
        self.empty.pack(anchor="w", pady=(0, 8))
        columns = ("Loại", "ASIN / Tác vụ", "Trạng thái", "Bước", "Tiến độ", "Thời gian", "Gửi kết quả")
        self.work_tree = self._tree(work, columns, height=9)

        filters = ttk.Frame(task_history)
        filters.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        ttk.Label(filters, text="Loại tác vụ:").pack(side="left")
        self.channel_filter = ttk.Combobox(filters, values=("Tất cả", "Amazon", "Pinterest"), state="readonly", width=12)
        self.channel_filter.set("Tất cả")
        self.channel_filter.pack(side="left", padx=(6, 16))
        ttk.Label(filters, text="Trạng thái:").pack(side="left")
        self.state_filter = ttk.Combobox(filters, values=("Tất cả", *STATE_LABELS.values()), state="readonly", width=18)
        self.state_filter.set("Tất cả")
        self.state_filter.pack(side="left", padx=6)
        for combo in (self.channel_filter, self.state_filter):
            combo.bind("<<ComboboxSelected>>", lambda _event: self.render(self._snapshot()))
        self.history_tree = self._tree(task_history, ("Loại", "ASIN / Tác vụ", "Trạng thái", "Gửi kết quả", "Nhận lúc", "Bắt đầu", "Kết thúc"), height=5, grid_row=1)
        ttk.Label(activity_history, text="Hoạt động gần đây — tối đa 500 sự kiện mới nhất").grid(row=0, column=0, sticky="w", pady=(0, 4))
        self.events_tree = self._tree(activity_history, ("Thời điểm", "Tác vụ", "Hoạt động"), height=5, grid_row=1)
        self.events_tree.column("Hoạt động", width=420)
        self.info = self._text(info, height=15, grid_row=0)
        self.copy_agent_button = ttk.Button(info, text="Sao chép ID agent", command=lambda: self._copy(str(self._snapshot().get("clientId", ""))))
        self.copy_agent_button.grid(row=1, column=0, sticky="w", pady=6)

        details = ttk.LabelFrame(shell, text="Chi tiết công việc được chọn", padding=8)
        details.grid(row=5, column=0, sticky="ew", pady=(10, 8))
        self.details = self._text(details, height=5)
        copy_buttons = ttk.Frame(details)
        copy_buttons.pack(fill="x", pady=(4, 0))
        ttk.Button(copy_buttons, text="Sao chép Task ID", command=lambda: self._copy_selected("taskId")).pack(side="left")
        ttk.Button(copy_buttons, text="Sao chép Job ID", command=lambda: self._copy_selected("jobId")).pack(side="left", padx=6)
        for tree in (self.work_tree, self.history_tree):
            tree.bind("<<TreeviewSelect>>", lambda _event, selected_tree=tree: self._select(selected_tree))

        controls = ttk.Frame(shell)
        controls.grid(row=6, column=0, sticky="ew", pady=(4, 0))
        self.pause_button = ttk.Button(controls, text="Tạm ngưng nhận việc", command=lambda: self._action("pause"))
        self.pause_button.pack(side="left")
        ttk.Button(controls, text="Dừng và loại bỏ việc local…", command=self.confirm_stop).pack(side="left", padx=8)
        ttk.Button(controls, text="Mở thư mục dữ liệu", command=lambda: self._action("folder")).pack(side="left")
        ttk.Button(controls, text="Thoát agent", command=lambda: self._action("exit")).pack(side="right")
        ttk.Label(shell, text="Đóng bằng X để tiếp tục chạy trong khay hệ thống.").grid(row=7, column=0, sticky="w", pady=(8, 0))
        self.root.bind("<Configure>", self._resize)
        self.render(snapshot())
        if not start_minimized:
            self.show()

    def _resize(self, event: tk.Event) -> None:
        if event.widget is not self.root:
            return
        self.details.configure(height=2 if event.height < 700 else (3 if event.height < 740 else 5))
        wraplength = max(360, event.width - 48)
        self.warning.configure(wraplength=wraplength)
        self.counters.configure(wraplength=wraplength)

    def _tree(self, parent: ttk.Frame, columns: tuple[str, ...], *, height: int, grid_row: int | None = None) -> ttk.Treeview:
        frame = ttk.Frame(parent)
        if grid_row is None:
            frame.pack(fill="both", expand=True)
        else:
            frame.grid(row=grid_row, column=0, sticky="nsew")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        tree = ttk.Treeview(frame, columns=columns, show="headings", height=height, selectmode="browse")
        for column in columns:
            tree.heading(column, text=column)
            tree.column(column, width=135, minwidth=100, stretch=True)
        tree.grid(row=0, column=0, sticky="nsew")
        vertical = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
        vertical.grid(row=0, column=1, sticky="ns")
        horizontal = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
        horizontal.grid(row=1, column=0, sticky="ew")
        tree.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
        return tree

    def _text(self, parent: ttk.Frame, *, height: int, grid_row: int | None = None) -> tk.Text:
        frame = ttk.Frame(parent)
        if grid_row is None:
            frame.pack(fill="both", expand=True)
        else:
            frame.grid(row=grid_row, column=0, sticky="nsew")
        text = tk.Text(frame, height=height, wrap="word", relief="flat", background="#ffffff", padx=8, pady=6, state="disabled")
        text.pack(side="left", fill="both", expand=True)
        scroll = ttk.Scrollbar(frame, command=text.yview)
        scroll.pack(side="right", fill="y")
        text.configure(yscrollcommand=scroll.set)
        return text

    def _set_text(self, widget: tk.Text, content: str) -> None:
        if widget.get("1.0", "end-1c") == content:
            return
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", content)
        widget.configure(state="disabled")

    def _copy(self, text: str) -> None:
        if text:
            self.root.clipboard_clear()
            self.root.clipboard_append(text)

    def _copy_selected(self, field: str) -> None:
        self._copy(str(self._task_rows.get(self._selected_key, {}).get(field, "")))

    def _select(self, tree: ttk.Treeview) -> None:
        selected = tree.selection()
        if selected:
            self._selected_key = selected[0]
            self._render_details()

    def _render_details(self) -> None:
        task = self._task_rows.get(self._selected_key)
        if not task:
            self._set_text(self.details, "Chọn một công việc để xem ASIN, tiến độ và các ID liên quan.")
            return
        variants = task.get("activeVariants")
        active = ", ".join(str(asin) for asin in variants) if isinstance(variants, list) else ""
        self._set_text(self.details, "\n".join((
            str(task.get("message") or ""),
            f"ASIN được giao: {task.get('asin') or '—'}    |    ASIN hiện tại: {task.get('currentAsin') or '—'}",
            f"Variants đang xử lý: {active or '—'}    |    {variant_progress(task)}",
            f"Task ID: {task.get('taskId')}    |    Job ID: {task.get('jobId')}",
            f"ZIP: {task.get('amazonZip') or '—'}    |    Route: {task.get('networkRoute') or '—'}    |    Profile: {task.get('browserProfile') or '—'}",
            f"Bước: {PHASE_LABELS.get(str(task.get('phase')), 'Đang xử lý')}    |    Gửi kết quả: {DELIVERY_LABELS.get(str(task.get('delivery')), '—')}",
        )))

    def _update_tree(self, tree: ttk.Treeview, rows: list[tuple[str, tuple[object, ...]]]) -> None:
        keys = {key for key, _values in rows}
        removed = [key for key in tree.get_children() if key not in keys]
        if removed:
            tree.delete(*removed)
        for index, (key, values) in enumerate(rows):
            if tree.exists(key):
                if tuple(str(value) for value in tree.item(key, "values")) != tuple(str(value) for value in values):
                    tree.item(key, values=values)
                tree.move(key, "", index)
            else:
                tree.insert("", index, iid=key, values=values)

    def render(self, snapshot: Mapping[str, object]) -> None:
        dashboard = _mapping(snapshot.get("dashboard"))
        self.title.configure(text=f"FFP Agent — {snapshot.get('displayName', '')}")
        connected = "Đã kết nối server" if snapshot.get("isConnected") else "Mất kết nối / đang kết nối lại"
        if snapshot.get("isPaused"):
            operating = (
                "Đang trả việc chưa hoàn tất về hàng đợi"
                if int(snapshot.get("releasingTasks") or 0) > 0
                else "Đã tạm ngưng; không nhận việc"
            )
        else:
            operating = "Đang làm việc" if snapshot.get("activeTasks") else "Sẵn sàng nhận việc"
        if _mapping(snapshot.get("storage")).get("blocked"):
            operating = "Tạm ngưng nhận việc do lưu trữ"
        self.connection.configure(text=f"{connected}  •  {operating}")
        self.counters.configure(text=f"Chạy: {snapshot.get('runningTasks', 0)}  |  Chờ: {snapshot.get('queuedTasks', 0)}  |  Slot: {snapshot.get('activeTasks', 0)}/{snapshot.get('maxConcurrentInputs', 0)}  |  Chờ gửi: {snapshot.get('pendingProducts', 0)} sản phẩm + {snapshot.get('pendingResults', 0)} kết quả  |  Cách ly: {snapshot.get('quarantinedUploads', 0)}")
        warnings = []
        storage_warning = storage_warning_text(snapshot.get("storage"))
        if storage_warning:
            warnings.append(storage_warning)
        if snapshot.get("agentStopped"):
            warnings.append("Agent đã dừng do lỗi. Hãy thoát và mở lại agent; xem log trong thư mục dữ liệu.")
        if snapshot.get("waitingCaptcha"):
            warnings.append("Cần giải CAPTCHA trong cửa sổ trình duyệt; task sẽ tự tiếp tục.")
        elif snapshot.get("captchaDetected"):
            warnings.append("Lượt hiện tại đã gặp CAPTCHA chưa xác định được ASIN; kiểm tra cửa sổ trình duyệt nếu cần.")
        if snapshot.get("pendingCancellations"):
            warnings.append(f"{snapshot['pendingCancellations']} job còn chờ server xác nhận yêu cầu hủy.")
        if snapshot.get("dashboardUnavailable"):
            warnings.append("Lịch sử local tạm thời không khả dụng; agent vẫn tiếp tục xử lý.")
        self.warning.configure(text="  ".join(warnings))
        if warnings:
            self.warning.grid()
        else:
            self.warning.grid_remove()
        self.pause_button.configure(text="Tiếp tục nhận việc" if snapshot.get("isPaused") else "Tạm ngưng nhận việc")
        history = _rows(dashboard.get("history"))
        self._task_rows = {f"{task.get('taskId')}/{task.get('leaseId')}": task for task in history}
        work = _rows(dashboard.get("tasks"))
        self.empty.configure(text="Chưa có công việc. Agent sẽ tự nhận việc khi server phân công." if not work else "Chọn một dòng để xem chi tiết ASIN và các variants đang xử lý.")
        self._update_tree(self.work_tree, [(f"{task.get('taskId')}/{task.get('leaseId')}", (
            str(task.get("channel", "")).title(), task.get("label", ""), STATE_LABELS.get(str(task.get("state")), "—"),
            PHASE_LABELS.get(str(task.get("phase")), "Đang xử lý"), variant_progress(task), elapsed_time(task),
            DELIVERY_LABELS.get(str(task.get("delivery")), "—"))) for task in work])
        selected_channel = self.channel_filter.get().lower()
        selected_state = self.state_filter.get()
        filtered = [task for task in history if (selected_channel == "tất cả" or task.get("channel") == selected_channel)
                    and (selected_state == "Tất cả" or STATE_LABELS.get(str(task.get("state"))) == selected_state)]
        self._update_tree(self.history_tree, [(f"{task.get('taskId')}/{task.get('leaseId')}", (
            str(task.get("channel", "")).title(), task.get("label", ""), STATE_LABELS.get(str(task.get("state")), "—"),
            DELIVERY_LABELS.get(str(task.get("delivery")), "—"), display_time(task.get("receivedAt")),
            display_time(task.get("startedAt")), display_time(task.get("finishedAt")))) for task in filtered])
        self._update_tree(self.events_tree, [(str(event["id"]), (display_time(event.get("timestamp")), event.get("label") or "Agent", event.get("message", "")))
            for event in _rows(dashboard.get("events")) if selected_channel == "tất cả" or not event.get("channel") or event.get("channel") == selected_channel])
        resources = _mapping(_mapping(snapshot.get("observability")).get("resources"))
        cache = _mapping(snapshot.get("cache"))
        ram = resources.get("rssBytes")
        ram_text = f"{ram / 1024 / 1024:.0f} MiB" if isinstance(ram, (int, float)) else "Chưa có dữ liệu"
        self._set_text(self.info, "\n".join((
            f"Agent: {snapshot.get('displayName', '')}", f"ID: {snapshot.get('clientId', '')}",
            f"Phiên bản: {snapshot.get('agentVersion', '')}", f"Server: {snapshot.get('serverUrl', '')}",
            f"Khởi động: {display_time(snapshot.get('startedAt'))}",
            f"Giới hạn: {json_limits(_mapping(snapshot.get('limits')))}",
            f"RAM agent và tiến trình con: {ram_text}" + (" (số đo chưa đầy đủ)" if ram is not None and not resources.get("isComplete") else ""),
            f"Browser contexts: {resources.get('browserContexts', 'Chưa có dữ liệu')}  |  Pages: {resources.get('browserPages', 'Chưa có dữ liệu')}  |  Browser processes: {resources.get('browserProcesses', 'Chưa có dữ liệu')}",
            f"Đo tài nguyên lúc: {display_time(resources.get('sampledAt'))}",
            f"Cache: {cache.get('files', 0)} files  |  {cache.get('bytes', 0)} bytes  |  Hit: {cache.get('hit', 0)}  |  Miss: {cache.get('miss', 0)}",
            "Lịch sử: giữ 7 ngày; tối đa 1.000 lượt task và 5.000 sự kiện, bảo vệ dữ liệu công việc local còn tồn tại.",
        )))
        self._render_details()

    def confirm_stop(self) -> None:
        snapshot = self._snapshot()
        tasks = _rows(_mapping(snapshot.get("dashboard")).get("tasks"))
        jobs = {task.get("jobId") for task in tasks}
        question = ("Không đọc được đầy đủ lịch sử local. Dừng và loại bỏ toàn bộ công việc local, bao gồm kết quả đang chờ gửi?"
                    if snapshot.get("dashboardUnavailable") else f"Dừng và loại bỏ {len(tasks)} công việc thuộc {len(jobs)} job?")
        if messagebox.askyesno("Dừng công việc local", question + "\n\nYêu cầu hủy sẽ được gửi tới server khi kết nối lại. Cache sản phẩm được giữ nguyên.", parent=self.root, icon="warning"):
            self._action("stop")

    def show(self) -> None:
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def close(self) -> None:
        if not self._is_closed:
            self._is_closed = True
            self.root.destroy()


def json_limits(limits: Mapping[str, object]) -> str:
    return "  |  ".join(f"{key}: {value}" for key, value in limits.items())
