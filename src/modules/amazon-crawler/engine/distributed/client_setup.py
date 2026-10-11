"""User-scoped connection preferences, with no credentials in JSON."""
from __future__ import annotations

import json
import os
import socket
import tempfile
from pathlib import Path
from collections.abc import Mapping
from urllib.parse import urlsplit, urlunsplit

from .client_config import server_data_scope


def setup_config_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / "FFP Amazon Crawler" / "connection.json"


def server_setup_config_path(server_url: str) -> Path:
    return setup_config_path().parent / "connections" / f"{server_data_scope(server_url)}.json"


def read_setup_payload(path: Path | None) -> dict[str, object]:
    if path is None or not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError("Cấu hình agent phải là một JSON object.")
    # Preserve legacy semantics: data was cwd-relative; proxy was config-relative.
    for field in ("dataDirectory", "proxyConfigPath"):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            if not Path(value).is_absolute():
                payload[field] = str((path.parent / value).resolve() if field == "proxyConfigPath" else Path(value).resolve())
    if "proxyConfigPath" not in payload:
        default_proxy = path.parent / "amazon-crawler-profiles.json"
        if default_proxy.is_file():
            payload["proxyConfigPath"] = str(default_proxy.resolve())
    return payload


def build_setup_payload(original: Mapping[str, object], *, server_url: str, display_name: str,
                        concurrency: str, auto_connect: bool, auth_mode: str | None = None) -> dict[str, object]:
    parsed = urlsplit(server_url.strip())
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
            or any(character.isspace() for character in server_url)):
        raise ValueError("Nhập địa chỉ server http:// hoặc https://, không kèm đường dẫn hay tài khoản.")
    _ = parsed.port
    origin = urlunsplit((parsed.scheme, parsed.netloc.lower(), "", "", ""))
    name = display_name.strip()
    if not name or len(name) > 100:
        raise ValueError("Tên agent cần từ 1 đến 100 ký tự.")
    try:
        count = int(concurrency)
    except ValueError:
        raise ValueError("Số link đồng thời phải là số nguyên từ 1 đến 16.") from None
    if not 1 <= count <= 16:
        raise ValueError("Số link đồng thời phải từ 1 đến 16.")
    payload = dict(original)
    previous = str(original.get("serverUrl") or "")
    try:
        same_server = bool(previous) and server_data_scope(previous) == server_data_scope(origin)
    except ValueError:
        same_server = False
    if not same_server:
        payload.pop("dataDirectory", None)
    payload.update(serverUrl=origin, displayName=name or socket.gethostname(),
                   maxConcurrentInputs=count, autoConnect=bool(auto_connect), authMode=auth_mode or str(original.get("authMode") or "legacy"))
    if payload["authMode"] == "key":
        from .client_credentials import validate_secure_origin
        validate_secure_origin(origin)
    return payload


def save_setup_payload(path: Path, payload: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="connection-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(dict(payload), stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def disconnect_block_reason(snapshot: Mapping[str, object]) -> str | None:
    storage = snapshot.get("storage")
    if (isinstance(storage, dict) and storage.get("blocked")) or snapshot.get("dashboardUnavailable"):
        return "Chưa đọc được đầy đủ dữ liệu local. Kiểm tra lưu trữ trước khi đổi kết nối."
    if not snapshot.get("isPaused"):
        return "Tạm ngưng nhận việc trước khi đổi kết nối."
    if any(int(snapshot.get(field) or 0) for field in
           ("activeTasks", "pendingUploads", "pendingProducts", "pendingResults", "releasingTasks", "pendingCancellations")):
        return "Còn công việc hoặc dữ liệu chờ server xác nhận. Chờ gửi xong rồi thử lại; không xóa dữ liệu."
    dashboard = snapshot.get("dashboard")
    tasks = dashboard.get("tasks", []) if isinstance(dashboard, dict) else []
    if isinstance(tasks, list) and any(isinstance(task, dict) and task.get("state") in
                                     {"queued", "recovering", "running", "captcha"} for task in tasks):
        return "Còn công việc local đang phục hồi. Chờ Agent trả việc về server rồi thử lại."
    if snapshot.get("drainState") in {"DRAINING", "UPDATING", "RESTARTING"}:
        return "Agent đang thực hiện lệnh quản trị. Chờ lệnh hoàn tất."
    return None
