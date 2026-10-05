"""Small, bounded trace events; raw crawl documents never enter telemetry."""
from __future__ import annotations

import contextlib
import contextvars
import functools
import json
import re
import time
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

TRACE_FIELDS = (
    "requestId", "familyRequestId", "jobId", "taskId", "leaseId", "agentId",
    "asin", "rootAsin", "cacheKey", "cacheKind", "stage", "route", "profile",
    "attempt", "taskAttempt", "durationMs", "result", "reason", "error", "httpStatus",
    "captchaEncountered", "isRetryable", "retryAfter", "browserContexts", "browserPages",
)
LOG_FIELDS = set(TRACE_FIELDS) | {
    "eventId", "timestamp", "event", "component", "clientId", "cancellationId",
    "cacheGeneration", "connectedClientIds", "pendingAgentCount", "pendingPipelineItemCount",
    "pendingCleanupCount", "removedFiles", "removedBytes", "purgedJobs", "taskIds",
    "activeTaskIds", "executingTaskIds", "discard", "isPaused",
    "hasRunningCrawler",
}
ERROR_LOG_FIELDS = set(TRACE_FIELDS) | {
    "code", "errorCode", "message", "source", "status", "retryable", "elapsedMs", "notFoundConfirmed",
    "completedAsins", "failedAsins", "retryableAsins", "nonRetryableAsins",
}
_trace: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar("crawl_trace", default={})
_attempt: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("crawl_trace_attempt", default=None)
_secrets: tuple[str, ...] = ()
_secrets_lock = threading.Lock()


def register_redactions(values: list[str | None]) -> None:
    global _secrets
    with _secrets_lock:
        _secrets = tuple(sorted(set(_secrets) | {value for value in values if value and 3 <= len(value) <= 4096}, key=len, reverse=True)[:512])


def redact(value: Any, *, limit: int = 512, hide_known: bool = True) -> str:
    message = str(value)
    if hide_known:
        for secret in _secrets:
            message = message.replace(secret, "[redacted]")
    # Apply redaction before truncation: a long secret must not leave a visible prefix.
    message = re.sub(r"<(?:!doctype|html|head|body|script|div|form)\b[\s\S]*", "[HTML omitted]", message, flags=re.I)
    message = re.sub(r"([a-z][a-z0-9+.-]*://)[^\s/@]+@", r"\1[credentials]@", message, flags=re.I)
    message = re.sub(r"\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*", "[header redacted]", message, flags=re.I)
    message = re.sub(r"\bBearer\s+[^\s,;]+", "Bearer [redacted]", message, flags=re.I)
    message = re.sub(r"((?:[?&]|\b)(?:access[_-]?token|api[_-]?key|password|passwd|secret|token)[\"']?\s*[:=]\s*[\"']?)[^\s&\"',;]+", r"\1[redacted]", message, flags=re.I)
    return message[:limit]


def safe_fields(payload: dict[str, Any], allowed: set[str] = LOG_FIELDS) -> dict[str, Any]:
    output = {}
    for key, value in payload.items():
        if key not in allowed:
            continue
        if isinstance(value, str):
            output[key] = redact(value, hide_known=key in {"error", "message", "reason", "profile"})
        elif value is None or isinstance(value, (bool, int)):
            output[key] = value
        elif isinstance(value, float) and value == value and abs(value) < 1e16:
            output[key] = value
        elif isinstance(value, list):
            output[key] = [redact(item, limit=100) for item in value[:30] if isinstance(item, str)]
    return output


def trace_fields() -> dict[str, Any]:
    return safe_fields(_trace.get(), set(TRACE_FIELDS))


@contextlib.contextmanager
def trace_scope(*, on_event: Callable[[dict[str, Any]], None] | None = None, **fields: Any) -> Iterator[None]:
    context = {**_trace.get(), **fields}
    if on_event is not None:
        context["_callback"] = on_event
    token = _trace.set(context)
    try:
        yield
    finally:
        _trace.reset(token)


@contextlib.contextmanager
def asin_scope(asin: str) -> Iterator[None]:
    context = _trace.get()
    root = str(context.get("rootAsin") or context.get("asin") or asin)
    family_id = str(context.get("familyRequestId") or context.get("requestId") or "")
    request_id = family_id if asin == root else uuid.uuid5(uuid.NAMESPACE_URL, f"{family_id}:{asin}").hex
    key = str(context.get("cacheKey") or "")
    suffix = key.split(":", 1)[1] if ":" in key else ""
    with trace_scope(asin=asin, rootAsin=root, familyRequestId=family_id, requestId=request_id,
                     cacheKey=f"{asin}:{suffix}" if suffix else key):
        yield


def emit_event(event: str, **fields: Any) -> dict[str, Any]:
    context = trace_fields()
    event_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{context.get('jobId')}:{context.get('leaseId')}:{context.get('requestId')}:{event}").hex if event in {"family_started", "family_completed", "family_cache"} else uuid.uuid4().hex
    payload = safe_fields({**context, **fields, "event": event, "eventId": event_id,
                           "timestamp": datetime.now(timezone.utc).isoformat()})
    callback = _trace.get().get("_callback")
    if callback is not None:
        callback(payload)
    return payload


def mark_captcha() -> None:
    attempt = _attempt.get()
    if attempt is not None:
        attempt["captchaEncountered"] = True


def error_result(error: BaseException) -> str:
    reason = str(getattr(error, "reason", ""))
    message = str(error).casefold()
    if reason == "captcha" or "captcha" in message:
        return "captcha"
    if isinstance(error, InterruptedError):
        return "cancelled"
    if type(error).__name__ in {"CrawlTimeout", "TimeoutError"}:
        return "timeout"
    if reason in {"parser_error", "selector_missing"}:
        return "parser_error"
    return "error"


@contextlib.contextmanager
def observe_attempt(event: str, **fields: Any) -> Iterator[dict[str, Any]]:
    started = time.monotonic()
    flags = {"captchaEncountered": False}
    token = _attempt.set(flags)
    outcome = "success"
    error_fields = {}
    try:
        with trace_scope(**fields):
            yield flags
    except BaseException as error:
        outcome = error_result(error)
        flags["captchaEncountered"] |= outcome == "captcha"
        error_fields = {"error": redact(error), "reason": getattr(error, "reason", None),
                        "httpStatus": getattr(error, "http_status", None)}
        raise
    finally:
        _attempt.reset(token)
        emit_event(event, **{**fields, **flags, **error_fields, "result": flags.get("result", outcome),
                            "durationMs": round((time.monotonic() - started) * 1000)})


def observed_stage(stage: str, *, event: str = "stage_completed"):
    def decorate(method):
        @functools.wraps(method)
        def wrapped(self, *args, **kwargs):
            asin = getattr(args[0], "asin", None) if args else None
            scope = asin_scope(asin) if asin else contextlib.nullcontext()
            with scope, trace_scope(stage=stage):
                started = time.monotonic()
                if event == "page_fetch":
                    emit_event("page_fetch_started", result="running")
                try:
                    output = method(self, *args, **kwargs)
                except BaseException as error:
                    emit_event(event, result=error_result(error), error=redact(error),
                               durationMs=round((time.monotonic() - started) * 1000))
                    raise
                outcome = "success"
                if event == "page_fetch":
                    parsed, diagnostics = output
                    outcome = diagnostics.get("fetchMode", "http")
                    diagnostics.update(trace_fields())
                emit_event(event, result=outcome, durationMs=round((time.monotonic() - started) * 1000))
                return output
        return wrapped
    return decorate


def write_log(path: Path, payload: dict[str, Any], *, max_bytes: int = 5 * 1024 * 1024, backups: int = 3) -> bool:
    # The lock also coordinates rotation between disposable worker processes.
    from .cache_storage import file_lock
    encoded = (json.dumps(safe_fields(payload), ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if len(encoded) > max_bytes:
        return False
    try:
        with file_lock(path.with_suffix(".lock"), blocking=False) as acquired:
            if not acquired:
                return False
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists() and path.stat().st_size + len(encoded) > max_bytes:
                for index in range(backups, 0, -1):
                    target = path.with_name(f"{path.name}.{index}")
                    source = path if index == 1 else path.with_name(f"{path.name}.{index - 1}")
                    if source.exists():
                        source.replace(target)
            with path.open("ab") as stream:
                stream.write(encoded)
        return True
    except OSError:
        return False  # Telemetry storage must not turn a successful crawl into a failed product.
