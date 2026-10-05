"""Stable crawler error taxonomy and bounded retry scheduling helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math
from typing import Any

from ..observability import redact


ERROR_CODES = frozenset({
    "NETWORK_TIMEOUT", "CONNECTION_RESET", "DNS_ERROR", "SERVER_5XX", "RATE_LIMITED",
    "ACCESS_BLOCKED", "INVALID_URL", "NOT_FOUND", "PARSER_FAILED", "VALIDATION_FAILED",
    "BROWSER_CRASH", "WORKER_CRASH", "OUT_OF_MEMORY", "DISK_FULL", "RESULT_UPLOAD_FAILED",
    "AUTH_FAILED", "KEY_REVOKED", "CONFIG_INVALID", "VERSION_INCOMPATIBLE", "LEASE_EXPIRED", "UNKNOWN",
})

_REASON_CODES = {
    "timeout": "NETWORK_TIMEOUT", "network_timeout": "NETWORK_TIMEOUT", "read_timeout": "NETWORK_TIMEOUT",
    "connection_reset": "CONNECTION_RESET", "connectionreseterror": "CONNECTION_RESET",
    "dns": "DNS_ERROR", "dns_error": "DNS_ERROR", "http_5xx": "SERVER_5XX",
    "http_500": "SERVER_5XX", "http_502": "SERVER_5XX", "http_503": "SERVER_5XX",
    "http_504": "SERVER_5XX", "http_429": "RATE_LIMITED", "rate_limited": "RATE_LIMITED",
    "captcha": "ACCESS_BLOCKED", "blocked": "ACCESS_BLOCKED", "access_blocked": "ACCESS_BLOCKED",
    "invalid_url": "INVALID_URL", "not_found": "NOT_FOUND", "parser_error": "PARSER_FAILED",
    "parser_failed": "PARSER_FAILED", "validation_error": "VALIDATION_FAILED",
    "browser_crash": "BROWSER_CRASH", "worker_crash": "WORKER_CRASH", "out_of_memory": "OUT_OF_MEMORY",
    "disk_full": "DISK_FULL", "result_upload_failed": "RESULT_UPLOAD_FAILED", "auth_failed": "AUTH_FAILED",
    "key_revoked": "KEY_REVOKED", "config_invalid": "CONFIG_INVALID", "version_incompatible": "VERSION_INCOMPATIBLE",
    "lease_expired": "LEASE_EXPIRED",
}
_PERMANENT_CODES = {"INVALID_URL", "NOT_FOUND", "VALIDATION_FAILED", "AUTH_FAILED", "KEY_REVOKED", "CONFIG_INVALID", "VERSION_INCOMPATIBLE"}
_SAFE_ERROR_FIELDS = {
    "status", "reason", "code", "errorCode", "message", "retryable", "isRetryable", "retryAfter",
    "retryAfterSeconds", "httpStatus", "notFoundConfirmed", "stage", "attempt", "elapsedMs",
    "source", "route", "profile", "completedAsins", "failedAsins", "retryableAsins",
    "nonRetryableAsins", "resumeClientId", "taskAttempt", "durationMs", "requestId",
}


def parse_retry_after(value: Any, *, now: datetime) -> datetime | None:
    """Parse an ISO instant, HTTP date, or delta-seconds Retry-After value."""
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        seconds = float(raw)
        if not math.isfinite(seconds) or seconds < 0:
            return None
        from datetime import timedelta
        return now + timedelta(seconds=seconds)
    except (ValueError, OverflowError):
        pass
    try:
        instant = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            instant = parsedate_to_datetime(raw)
        except (TypeError, ValueError, OverflowError):
            return None
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    return instant.astimezone(timezone.utc)


def classify_task_error(raw: dict[str, Any]) -> dict[str, Any]:
    """Return a safe stable classification while retaining legacy retry hints."""
    error = {key: value for key, value in raw.items() if key in _SAFE_ERROR_FIELDS}
    supplied_code = str(error.get("errorCode") or error.get("code") or "").strip().upper()
    reason = str(error.get("reason") or error.get("status") or "").strip().lower()
    code = supplied_code if supplied_code in ERROR_CODES else _REASON_CODES.get(reason, "UNKNOWN")
    if code == "NOT_FOUND" and error.get("notFoundConfirmed") is not True:
        code = "NETWORK_TIMEOUT"
    retryable = code not in _PERMANENT_CODES and error.get("retryable") is not False and error.get("isRetryable") is not False
    error["errorCode"] = code
    error["retryable"] = retryable
    error["isRetryable"] = retryable
    if isinstance(error.get("message"), str):
        error["message"] = redact(error["message"], limit=1000)
    for key in ("source", "route", "profile"):
        if isinstance(error.get(key), str):
            error[key] = redact(error[key], limit=500)
    for key in ("completedAsins", "failedAsins", "retryableAsins", "nonRetryableAsins"):
        if isinstance(error.get(key), list):
            error[key] = [str(value)[:200] for value in error[key][:200] if isinstance(value, str)]
    return error
