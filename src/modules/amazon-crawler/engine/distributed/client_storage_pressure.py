"""Non-destructive admission limits for the remote agent's durable outbox."""
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import shutil
import sqlite3

from .protocol import utc_now


@dataclass(frozen=True)
class OutboxLimits:
    max_bytes: int = 1024**3
    max_records: int = 10000
    min_free_bytes: int = 2 * 1024**3
    warn_age_seconds: int = 86400

    def __post_init__(self):
        if any(type(value) is not int or value <= 0 for value in vars(self).values()):
            raise ValueError("Outbox limits must be positive integers")

    @classmethod
    def from_payload(cls, payload):
        if not isinstance(payload, dict):
            raise ValueError("outbox must be an object")
        mapping = {"maxBytes": "max_bytes", "maxRecords": "max_records",
                   "minFreeBytes": "min_free_bytes", "warnAgeSeconds": "warn_age_seconds"}
        return cls(**{field: payload[key] for key, field in mapping.items() if key in payload})


def storage_pressure(store, limits: OutboxLimits, output_directory: Path) -> dict:
    reasons = []
    warnings = []
    snapshot = {"records": None, "bytes": None, "freeBytes": None, "oldestAgeSeconds": None}
    if store.storage_fault:
        reasons.append("STORAGE_IO_FAILED")
    try:
        stats = store.outbox_usage()
        free = min(shutil.disk_usage(path).free for path in {store.path.parent, output_directory})
        oldest = stats["oldest"]
        age = max(0, (utc_now() - datetime.fromisoformat(oldest.replace("Z", "+00:00"))).total_seconds()) if oldest else 0
        snapshot.update(records=stats["records"], bytes=stats["bytes"], freeBytes=free, oldestAgeSeconds=int(age))
        if stats["records"] >= limits.max_records:
            reasons.append("OUTBOX_RECORD_LIMIT")
        if stats["bytes"] >= limits.max_bytes:
            reasons.append("OUTBOX_BYTE_LIMIT")
        if free < limits.min_free_bytes:
            reasons.append("LOW_DISK_SPACE")
        if age >= limits.warn_age_seconds:
            warnings.append("OUTBOX_AGE_WARNING")
    except (OSError, sqlite3.Error, ValueError, TypeError):
        reasons.append("STORAGE_PROBE_FAILED")
    return {**snapshot, "blocked": bool(reasons), "reasons": reasons, "warnings": warnings}


def storage_warning_text(health) -> str:
    if not isinstance(health, dict):
        return ""
    messages = []
    if health.get("blocked"):
        labels = {"OUTBOX_RECORD_LIMIT": "quá số kết quả", "OUTBOX_BYTE_LIMIT": "quá dung lượng outbox",
                  "LOW_DISK_SPACE": "thiếu đĩa trống", "STORAGE_IO_FAILED": "lỗi lưu trữ; cần kiểm tra và khởi động lại",
                  "STORAGE_PROBE_FAILED": "không kiểm tra được lưu trữ"}
        reasons = ", ".join(labels.get(reason, "lỗi lưu trữ") for reason in health.get("reasons", []))
        messages.append(f"Tạm ngừng nhận việc: {reasons}. Không tự xóa kết quả chưa gửi.")
    if health.get("warnings"):
        messages.append("Có kết quả chờ gửi quá thời hạn cảnh báo; kiểm tra kết nối và quarantine.")
    return " ".join(messages)
