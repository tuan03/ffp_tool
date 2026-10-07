"""Local, bounded task summaries. No product documents enter dashboard history."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timedelta, timezone
from threading import RLock

from ..observability import redact
from .client_store import ClientStore


TASK_LIMIT = 1000
EVENT_LIMIT = 5000
RETENTION_DAYS = 7
TERMINAL_STATES = {"completed", "failed", "cancelled", "interrupted"}
EVENT_MESSAGES = {
    "received": "Đã nhận công việc", "running": "Bắt đầu xử lý", "completed": "Đã xử lý xong",
    "failed": "Xử lý gặp lỗi", "cancelled": "Đã hủy công việc", "sent": "Server đã nhận kết quả",
    "retry": "Gửi kết quả gặp lỗi; sẽ tự thử lại", "connected": "Đã kết nối server",
    "offline": "Mất kết nối server; đang thử kết nối lại",
    "paused": "Tạm ngưng và trả việc chưa hoàn tất về hàng đợi",
    "resumed": "Tiếp tục nhận việc mới", "captcha": "Cần giải CAPTCHA trong trình duyệt",
    "recovering": "Đang đối chiếu công việc sau khi khởi động lại",
    "interrupted": "Lượt xử lý trước không còn công việc local",
    "uploading": "Đang gửi kết quả", "pending": "Kết quả đang chờ gửi",
}
ERROR_MESSAGES = {
    "CRAWL_TIMEOUT": "Crawl vượt thời gian cho phép; xem cấu hình timeout hoặc thử lại trên web.",
    "TIMEOUT": "Crawl vượt thời gian cho phép; có thể thử lại trên web.",
    "CAPTCHA": "Amazon yêu cầu CAPTCHA; kiểm tra cửa sổ trình duyệt.",
    "NOT_FOUND": "Không tìm thấy sản phẩm trên Amazon.",
    "INVALID_INPUT": "ASIN hoặc đường dẫn đầu vào không hợp lệ.",
    "NETWORK_ERROR": "Không tải được dữ liệu từ Amazon; kiểm tra kết nối mạng.",
    "TEMPORARILY_BLOCKED": "Amazon tạm chặn truy cập; cần đợi trước khi thử lại.",
    "PARTIAL": "Dữ liệu crawl chưa đầy đủ; có thể thử lại trên web.",
}


def _clean(value: object, *, limit: int = 256) -> str:
    return redact(value, limit=limit) if isinstance(value, str) else ""


def _count(value: object) -> int | None:
    return max(0, value) if isinstance(value, int) and not isinstance(value, bool) else None


def _camel_name(name: str) -> str:
    first, *parts = name.split("_")
    return first + "".join(part.title() for part in parts)


@dataclass
class DashboardTask:
    task_id: str
    lease_id: str
    job_id: str
    channel: str
    label: str
    asin: str
    received_at: str
    state: str = "queued"
    phase: str = "queued"
    message: str = "Đang chờ xử lý"
    started_at: str = ""
    finished_at: str = ""
    updated_at: str = ""
    delivery: str = "none"
    current_asin: str = ""
    variant_completed: int | None = None
    variant_total: int | None = None
    active_variants: tuple[str, ...] = ()
    network_route: str = ""
    browser_profile: str = ""
    amazon_zip: str = ""
    action: str = ""

    def payload(self) -> dict[str, object]:
        return {_camel_name(key): list(value) if isinstance(value, tuple) else value
                for key, value in asdict(self).items()}


class DashboardState:
    def __init__(self, store: ClientStore, *, now: Callable[[], datetime] | None = None) -> None:
        self.store = store
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._lock = RLock()
        self._tasks: dict[tuple[str, str], DashboardTask] = {}
        self._unattributed_captcha_tasks: set[tuple[str, str]] = set()
        self._last_activity = ""
        self._last_prune = self._now()
        with self.store._connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS dashboard_tasks (
                    task_id TEXT NOT NULL, lease_id TEXT NOT NULL, job_id TEXT NOT NULL,
                    updated_at TEXT NOT NULL, payload_json TEXT NOT NULL,
                    PRIMARY KEY(task_id, lease_id)
                );
                CREATE TABLE IF NOT EXISTS dashboard_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
                    event TEXT NOT NULL, task_id TEXT NOT NULL, lease_id TEXT NOT NULL,
                    channel TEXT NOT NULL, label TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS dashboard_tasks_updated ON dashboard_tasks(updated_at);
                CREATE INDEX IF NOT EXISTS dashboard_events_timestamp ON dashboard_events(timestamp);
            """)
            rows = connection.execute("SELECT payload_json FROM dashboard_tasks ORDER BY updated_at").fetchall()
        for row in rows:
            try:
                payload = json.loads(row[0])
                if not isinstance(payload, dict):
                    continue
                string_fields = [field.name for field in fields(DashboardTask)
                                 if field.name not in {"variant_completed", "variant_total", "active_variants"}]
                if any(not isinstance(payload.get(name, ""), str) for name in string_fields):
                    continue
                if not isinstance(payload.get("active_variants", []), list):
                    continue
                if any(not isinstance(asin, str) for asin in payload.get("active_variants", [])):
                    continue
                task = DashboardTask(**payload)
                task.active_variants = tuple(task.active_variants)
                self._tasks[(task.task_id, task.lease_id)] = task
            except (ValueError, TypeError):
                continue
        local = {(str(entry["assignment"]["taskId"]), str(entry["assignment"]["leaseId"])): entry
                 for entry in self.store.dashboard_local_tasks()}
        for key, task in list(self._tasks.items()):
            entry = local.get(key)
            if entry:
                task.delivery = "pending" if entry["status"] == "completed_pending_upload" else task.delivery
                task.state = "completed" if task.delivery == "pending" else "recovering"
                task.phase = "recovering"
                task.message = EVENT_MESSAGES["pending" if task.delivery == "pending" else "recovering"]
                task.active_variants = ()
                self._save(task)
            elif task.state not in TERMINAL_STATES or task.delivery in {"pending", "uploading", "retry"}:
                task.state = "interrupted"
                task.delivery = "none"
                task.message = EVENT_MESSAGES["interrupted"]
                task.finished_at = self._timestamp()
                self._save(task, "interrupted")
        for key, entry in local.items():
            if key not in self._tasks:
                self.receive(entry["assignment"])
                task = self._tasks[key]
                task.state = "completed" if entry["status"] == "completed_pending_upload" else "recovering"
                task.delivery = "pending" if task.state == "completed" else "none"
                task.message = EVENT_MESSAGES["pending" if task.delivery == "pending" else "recovering"]
                self._save(task)
        self.prune()

    def _timestamp(self) -> str:
        return self._now().isoformat()

    def _save(self, task: DashboardTask, event: str = "") -> None:
        task.updated_at = self._timestamp()
        with self.store._connection() as connection:
            connection.execute("""INSERT INTO dashboard_tasks VALUES (?,?,?,?,?)
                ON CONFLICT(task_id,lease_id) DO UPDATE SET updated_at=excluded.updated_at,
                payload_json=excluded.payload_json""",
                (task.task_id, task.lease_id, task.job_id, task.updated_at,
                 json.dumps(asdict(task), ensure_ascii=False)))
            if event:
                self._insert_event(connection, event, task)

    def _insert_event(self, connection: sqlite3.Connection, event: str, task: DashboardTask | None = None) -> None:
        cursor = connection.execute("INSERT INTO dashboard_events(timestamp,event,task_id,lease_id,channel,label) VALUES (?,?,?,?,?,?)",
            (self._timestamp(), event, task.task_id if task else "", task.lease_id if task else "",
             task.channel if task else "", task.label if task else ""))
        if cursor.lastrowid is not None:
            connection.execute("DELETE FROM dashboard_events WHERE id <= ?", (cursor.lastrowid - EVENT_LIMIT,))

    def receive(self, assignment: Mapping[str, object]) -> None:
        with self._lock:
            key = (_clean(assignment.get("taskId")), _clean(assignment.get("leaseId")))
            if not all(key) or key in self._tasks:
                return
            channel = "pinterest" if assignment.get("channel") == "pinterest" else "amazon"
            asin = _clean(assignment.get("asin"), limit=10) if channel == "amazon" else ""
            settings = assignment.get("settings")
            settings = settings if isinstance(settings, dict) else {}
            task = DashboardTask(*key, job_id=_clean(assignment.get("jobId")), channel=channel,
                label=asin or _clean(assignment.get("source")) or "Pinterest POD", asin=asin,
                received_at=self._timestamp(), amazon_zip=_clean(settings.get("amazonZip")),
                action=_clean(assignment.get("action")))
            self._tasks[key] = task
            self._save(task, "received")

    def start(self, assignment: Mapping[str, object]) -> None:
        with self._lock:
            self.receive(assignment)
            task = self._tasks.get((str(assignment.get("taskId")), str(assignment.get("leaseId"))))
            if task is None or task.state in TERMINAL_STATES:
                return
            task.state = "running"
            task.phase = "starting"
            task.started_at = self._timestamp()
            self._save(task, "running")

    def progress(self, assignments: Sequence[Mapping[str, object]], progress: Mapping[str, object]) -> None:
        with self._lock:
            source = progress.get("source")
            items = progress.get("items")
            items = items if isinstance(items, list) else []
            if progress.get("phase") == "captcha" and not source and not any(
                isinstance(item, dict) and item.get("phase") == "captcha" for item in items
            ):
                # Some CAPTCHA events have no ASIN (for example a delivery-location page).
                # Keep a detection notice without claiming that every task is blocked.
                self._unattributed_captcha_tasks.update((str(task.get("taskId")), str(task.get("leaseId"))) for task in assignments)
                self.activity("captcha")
            for assignment in assignments:
                task = self._tasks.get((str(assignment.get("taskId")), str(assignment.get("leaseId"))))
                if task is None or task.state in TERMINAL_STATES:
                    continue
                identities = {assignment.get(key) for key in ("source", "asin", "url") if isinstance(assignment.get(key), str)}
                matched = next((item for item in items if isinstance(item, dict) and
                    (item.get("source") in identities or item.get("asin") in identities)), None)
                if matched is None and source and source not in identities:
                    continue
                if matched is None and not source and task.channel != "pinterest":
                    continue  # A batch-wide update cannot identify a specific ASIN or CAPTCHA.
                fields = matched if matched is not None else progress
                old_phase = task.phase
                task.phase = _clean(fields.get("phase")) or task.phase
                task.message = _clean(fields.get("message")) or task.message
                task.state = "captcha" if task.phase == "captcha" else "running"
                task.current_asin = _clean(fields.get("currentAsin"), limit=10) or task.current_asin
                task.variant_completed = _count(fields.get("variantCompleted")) if "variantCompleted" in fields else task.variant_completed
                task.variant_total = _count(fields.get("variantTotal")) if "variantTotal" in fields else task.variant_total
                variants = fields.get("activeVariants")
                if isinstance(variants, list):
                    task.active_variants = tuple(_clean(variant.get("asin"), limit=10) for variant in variants[:64]
                        if isinstance(variant, dict) and isinstance(variant.get("asin"), str))
                task.network_route = _clean(fields.get("networkRoute")) or task.network_route
                task.browser_profile = _clean(fields.get("browserProfile")) or task.browser_profile
                # Frequent variant updates remain in memory; persist at phase transitions and completion.
                if old_phase != task.phase:
                    self._save(task, "captcha" if task.phase == "captcha" else "")

    @property
    def waiting_captcha(self) -> bool:
        with self._lock:
            return any(task.state == "captcha" for task in self._tasks.values())

    @property
    def has_unattributed_captcha(self) -> bool:
        with self._lock:
            return any(key in self._tasks and self._tasks[key].state not in TERMINAL_STATES
                       for key in self._unattributed_captcha_tasks)

    def finish(self, assignment: Mapping[str, object], state: str, error: Mapping[str, object] | None = None) -> None:
        with self._lock:
            self.receive(assignment)
            task = self._tasks.get((str(assignment.get("taskId")), str(assignment.get("leaseId"))))
            if task is None or task.state in TERMINAL_STATES:
                return
            task.state = state if state in TERMINAL_STATES else "failed"
            self._unattributed_captcha_tasks.discard((task.task_id, task.lease_id))
            task.phase = task.state
            task.message = EVENT_MESSAGES[task.state]
            if task.state == "failed":
                task.message = ERROR_MESSAGES.get(str((error or {}).get("code", "")),
                    "Không xử lý được công việc. Xem log trong thư mục dữ liệu hoặc thử lại trên web.")
            task.finished_at = self._timestamp()
            task.active_variants = ()
            task.delivery = task.delivery if task.delivery == "sent" else ("pending" if state == "completed" else "none")
            self._save(task, task.state)
            if len(self._tasks) > TASK_LIMIT:
                self.prune()

    def delivery(self, task_id: str, lease_id: str, state: str) -> None:
        with self._lock:
            task = self._tasks.get((task_id, lease_id))
            if task is None or task.delivery == state or task.delivery in {"sent", "cancelled"}:
                return
            task.delivery = state
            if state in {"sent", "cancelled"}:
                self._unattributed_captcha_tasks.discard((task_id, lease_id))
            if state == "cancelled":
                task.state = "cancelled"
                task.finished_at = task.finished_at or self._timestamp()
            elif state == "sent" and task.state not in TERMINAL_STATES:
                task.state = "completed"
                task.phase = "completed"
                task.finished_at = self._timestamp()
                task.active_variants = ()
            self._save(task, state)

    def activity(self, event: str) -> None:
        with self._lock:
            if event not in EVENT_MESSAGES or event == self._last_activity:
                return
            self._last_activity = event
            with self.store._connection() as connection:
                self._insert_event(connection, event)

    def prune(self) -> None:
        with self._lock:
            live_keys = {(str(entry["assignment"]["taskId"]), str(entry["assignment"]["leaseId"]))
                         for entry in self.store.dashboard_local_tasks()}
            cutoff = (self._now() - timedelta(days=RETENTION_DAYS)).isoformat()
            terminal = sorted((task for key, task in self._tasks.items()
                               if key not in live_keys and task.state in TERMINAL_STATES),
                              key=lambda task: task.updated_at, reverse=True)
            removed = [(task.task_id, task.lease_id) for index, task in enumerate(terminal)
                       if index >= TASK_LIMIT or task.updated_at < cutoff]
            with self.store._connection() as connection:
                connection.executemany("DELETE FROM dashboard_tasks WHERE task_id=? AND lease_id=?", removed)
                connection.execute("DELETE FROM dashboard_events WHERE timestamp < ?", (cutoff,))
                connection.execute("DELETE FROM dashboard_events WHERE id NOT IN (SELECT id FROM dashboard_events ORDER BY id DESC LIMIT ?)", (EVENT_LIMIT,))
            for key in removed:
                self._tasks.pop(key, None)
                self._unattributed_captcha_tasks.discard(key)
            self._last_prune = self._now()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            if self._now() - self._last_prune >= timedelta(minutes=1):
                self.prune()
            with self.store._connection() as connection:
                events = connection.execute("SELECT * FROM dashboard_events ORDER BY id DESC LIMIT 500").fetchall()
            tasks = [task.payload() for task in self._tasks.values()]
            return {
                "hasUnattributedCaptcha": self.has_unattributed_captcha,
                "tasks": [task for task in tasks if task["state"] not in TERMINAL_STATES or
                          task["delivery"] in {"pending", "uploading", "retry"}],
                "history": list(reversed(tasks)),
                "events": [{"id": row["id"], "timestamp": row["timestamp"], "event": row["event"],
                            "message": EVENT_MESSAGES.get(row["event"], ""), "taskId": row["task_id"],
                            "channel": row["channel"], "label": row["label"]} for row in events],
            }
