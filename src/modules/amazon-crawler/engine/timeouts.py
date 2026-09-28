"""Cumulative crawl deadlines shared by HTTP, browser and family workers."""

from __future__ import annotations

import contextlib
import contextvars
import asyncio
import queue
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from functools import wraps
from typing import Any, Callable, Iterator, TypeVar


TIMEOUT_FIELDS = ("stage", "attempt", "route", "profile", "elapsedMs", "isRetryable", "retryAfter")
_transport: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar("crawl_transport", default={})
_observer: contextvars.ContextVar[Callable[[dict[str, Any]], None] | None] = contextvars.ContextVar("crawl_deadline_observer", default=None)


class CrawlTimeout(TimeoutError):
    def __init__(self, stage: str, *, started: float, attempt: int | None = None,
                 route: str | None = None, profile: str | None = None) -> None:
        super().__init__(f"Amazon crawl exceeded the {stage} deadline.")
        transport = _transport.get()
        retryable = stage != "job"
        retry_seconds = 120 if stage == "captcha" else 30
        self.details = {
            "stage": stage, "attempt": attempt if attempt is not None else transport.get("attempt", 1),
            "route": route if route is not None else transport.get("route"),
            "profile": profile if profile is not None else transport.get("profile"),
            "elapsedMs": max(0, round((monotonic() - started) * 1000)),
            "isRetryable": retryable,
            "retryAfter": (datetime.now(timezone.utc) + timedelta(seconds=retry_seconds)).isoformat() if retryable else None,
        }

    def as_error(self, source: str) -> dict[str, Any]:
        captcha = self.details["stage"] == "captcha"
        return {"source": source, "code": "CRAWL_TIMEOUT", "status": "temporarily_blocked" if captcha else "network_error", "reason": "captcha" if captcha else "timeout",
                "message": str(self), "retryable": self.details["isRetryable"], **self.details}


@dataclass(frozen=True)
class Deadline:
    stage: str
    started: float
    expires: float


_deadlines: contextvars.ContextVar[tuple[Deadline, ...]] = contextvars.ContextVar("crawl_deadlines", default=())


@contextlib.contextmanager
def timeout_scope(stage: str, seconds: float) -> Iterator[None]:
    started = monotonic()
    token = _deadlines.set((*_deadlines.get(), Deadline(stage, started, started + seconds)))
    observer = _observer.get()
    scope_id = uuid.uuid4().hex if observer else None
    try:
        if observer:
            observer({"id": scope_id, "state": "started", "stage": stage, "started": started, "expires": started + seconds, **_transport.get()})
        check_deadline()
        yield
    finally:
        _deadlines.reset(token)
        if observer:
            observer({"id": scope_id, "state": "finished"})


@contextlib.contextmanager
def observe_deadlines(observer: Callable[[dict[str, Any]], None]) -> Iterator[None]:
    token = _observer.set(observer)
    try:
        yield
    finally:
        _observer.reset(token)


@contextlib.contextmanager
def transport_context(**values: Any) -> Iterator[None]:
    token = _transport.set({**_transport.get(), **values})
    try:
        yield
    finally:
        _transport.reset(token)


def check_deadline() -> None:
    deadlines = _deadlines.get()
    if deadlines:
        deadline = min(deadlines, key=lambda value: value.expires)
        if monotonic() >= deadline.expires:
            raise CrawlTimeout(deadline.stage, started=deadline.started)


def remaining_seconds(default: float) -> float:
    check_deadline()
    deadlines = _deadlines.get()
    return min(default, max(0.001, min(value.expires for value in deadlines) - monotonic())) if deadlines else default


@contextlib.contextmanager
def acquire_slot(slot: threading.Semaphore, cancel_event: threading.Event | None = None) -> Iterator[None]:
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Crawler cancelled while waiting for capacity.")
        if slot.acquire(timeout=remaining_seconds(0.05)):
            break
    try:
        check_deadline()
        yield
    finally:
        slot.release()


T = TypeVar("T")


def wait_blocking(operation: Callable[[], T], *, cancel_event: threading.Event | None = None,
                  abandon: Callable[[], None] | None = None) -> T:
    """Bound the caller; the production process supervisor also contains stuck native calls."""
    outcome: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)
    context = contextvars.copy_context()
    def work() -> None:
        try:
            outcome.put((True, context.run(operation)))
        except Exception as error:
            outcome.put((False, error))
    threading.Thread(target=work, name="amazon-bounded-io", daemon=True).start()
    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                raise InterruptedError("Crawler I/O cancelled.")
            try:
                succeeded, value = outcome.get(timeout=remaining_seconds(0.05))
            except queue.Empty:
                continue
            check_deadline()
            if not succeeded:
                raise value
            return value
    except BaseException:
        if abandon is not None:
            abandon()
        raise


async def await_stage(operation, stage: str, seconds: float):
    with timeout_scope(stage, seconds):
        started = monotonic()
        try:
            return await asyncio.wait_for(operation, timeout=remaining_seconds(seconds))
        except CrawlTimeout:
            raise
        except asyncio.TimeoutError as error:
            check_deadline()
            raise CrawlTimeout(stage, started=started) from error
        except Exception as error:
            if error.__class__.__name__ == "TimeoutError":
                check_deadline()
                raise CrawlTimeout(stage, started=started) from error
            raise


def bounded_method(stage: str, setting: str):
    def decorate(operation):
        @wraps(operation)
        def bounded(self, *args, **kwargs):
            normalized = args[0] if args else kwargs.get("normalized")
            transport = {"sourceAsin": normalized.asin} if stage == "asin" and normalized is not None else {}
            with transport_context(**transport), timeout_scope(stage, getattr(self.settings, setting)):
                result = operation(self, *args, **kwargs)
                check_deadline()
                return result
        return bounded
    return decorate


def async_bounded_method(stage: str, setting: str):
    def decorate(operation):
        @wraps(operation)
        async def bounded(self, *args, **kwargs):
            return await await_stage(operation(self, *args, **kwargs), stage, getattr(self, setting))
        return bounded
    return decorate
