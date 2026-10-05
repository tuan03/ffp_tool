"""Durable fleet-wide breaker for repeated parser failures."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from pydantic import BaseModel, ConfigDict, Field

from .coordinator_models import CoordinatorState
from .protocol import utc_now

STATE_KEY = "fleet_circuit_breaker"
FAILURE_THRESHOLD = 5
FAILURE_WINDOW_SECONDS = 300
OPEN_SECONDS = 60
PROBE_LIMIT = 1


class FleetCircuitBreakerResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=10, max_length=500)


def _default_state() -> dict[str, Any]:
    return {"state": "CLOSED", "failures": [], "openedAt": None, "openUntil": None,
            "probeStartedAt": None, "reason": None, "revision": 0}


def _load(session, *, lock: bool = False) -> tuple[CoordinatorState, dict[str, Any]]:
    row = session.scalar(select(CoordinatorState).where(CoordinatorState.key == STATE_KEY)
        .with_for_update() if lock else select(CoordinatorState).where(CoordinatorState.key == STATE_KEY))
    if row is None:
        row = CoordinatorState(key=STATE_KEY, value=json.dumps(_default_state()))
        session.add(row)
        return row, _default_state()
    try:
        value = json.loads(row.value)
    except (TypeError, ValueError):
        value = None
    if not isinstance(value, dict) or value.get("state") not in {"CLOSED", "OPEN", "HALF_OPEN"}:
        return row, _default_state()
    state = {**_default_state(), **value}
    return row, state


def _save(row: CoordinatorState, state: dict[str, Any]) -> None:
    state["revision"] = int(state.get("revision") or 0) + 1
    row.value = json.dumps(state, separators=(",", ":"))
    row.updated_at = utc_now()


def snapshot(session) -> dict[str, Any]:
    _, state = _load(session)
    now = utc_now()
    open_until = _parse_time(state.get("openUntil"))
    return {key: state.get(key) for key in ("state", "openedAt", "openUntil", "probeStartedAt", "reason", "revision")} | {
        "failureCount": len(state.get("failures") or []), "sampledAt": now.isoformat(),
        "probeLimit": PROBE_LIMIT,
        "cooldownElapsed": state["state"] == "OPEN" and open_until is not None and open_until <= now,
    }


def acquire_capacity(session, requested: int, active_probe_count: int, *, now: datetime | None = None) -> int:
    row, state = _load(session)
    if state["state"] != "CLOSED":
        row, state = _load(session, lock=True)
    now = now or utc_now()
    if state["state"] == "OPEN":
        open_until = _parse_time(state.get("openUntil"))
        if open_until is None or open_until > now:
            return 0
        state["state"] = "HALF_OPEN"
        state["probeStartedAt"] = now.isoformat()
        state["reason"] = "cooldown_elapsed"
        active_probe_count = 0
    if state["state"] == "HALF_OPEN":
        if active_probe_count >= PROBE_LIMIT:
            return 0
        _save(row, state)
        return min(1, max(0, requested))
    return max(0, requested)


def record_failure(session, error: dict[str, Any]) -> dict[str, Any]:
    code = str(error.get("errorCode") or error.get("code") or "").upper()
    status = str(error.get("status") or "").lower()
    if code not in {"PARSER_ERROR", "PARSER_FAILED"} and status != "parser_error":
        return snapshot(session)
    row, state = _load(session, lock=True)
    now = utc_now()
    cutoff = now - timedelta(seconds=FAILURE_WINDOW_SECONDS)
    failures = [stamp for stamp in state.get("failures", []) if (parsed := _parse_time(stamp)) and parsed >= cutoff]
    failures.append(now.isoformat())
    state["failures"] = failures[-64:]
    if state["state"] == "HALF_OPEN":
        state["state"] = "OPEN"
        state["openedAt"] = now.isoformat()
        state["openUntil"] = (now + timedelta(seconds=OPEN_SECONDS)).isoformat()
        state["reason"] = "probe_failed"
    elif len(failures) >= FAILURE_THRESHOLD:
        state["state"] = "OPEN"
        state["openedAt"] = now.isoformat()
        state["openUntil"] = (now + timedelta(seconds=OPEN_SECONDS)).isoformat()
        state["reason"] = "parser_failure_threshold"
    _save(row, state)
    return snapshot(session)


def record_success(session, attempt_started_at: datetime | None) -> None:
    row, state = _load(session, lock=True)
    probe_started_at = _parse_time(state.get("probeStartedAt"))
    attempt_time = _as_utc(attempt_started_at)
    if state["state"] != "HALF_OPEN" or probe_started_at is None or attempt_time is None or attempt_time < probe_started_at:
        return
    state.update({"state": "CLOSED", "failures": [], "openedAt": None, "openUntil": None,
                  "probeStartedAt": None, "reason": "probe_succeeded"})
    _save(row, state)


def reset(session, *, actor: str, reason: str) -> dict[str, Any]:
    row, state = _load(session, lock=True)
    state.update({"state": "CLOSED", "failures": [], "openedAt": None, "openUntil": None,
                  "probeStartedAt": None, "reason": f"operator_reset:{actor}:{reason[:120]}"})
    _save(row, state)
    return snapshot(session)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=utc_now().tzinfo) if value.tzinfo is None else value


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _as_utc(parsed)
