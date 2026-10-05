"""Durable, ordered PAUSE/RESUME commands for authenticated crawler agents."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Index, Integer, JSON, String, Text, UniqueConstraint, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .coordinator_models import Base, ClientRecord
from .agent_runtime_config import AgentRuntimeConfig
from .protocol import utc_now


JSON_VALUE = JSON().with_variant(JSONB, "postgresql")
COMMAND_PRIORITY = {"PAUSE": 4, "RESUME": 4, "RELOAD_CONFIG": 4, "DRAIN": 5, "RUN_SELF_TEST": 4, "PURGE_PENDING_TASKS": 5, "PURGE_ALL_LOCAL_TASKS": 5,
                    "RESTART_WORKERS": 5, "RESTART_AGENT": 6}
TERMINAL_STATUSES = {"SUCCESS", "FAILED", "EXPIRED"}
ALLOWED_UPDATES = {"ACKED", "RUNNING", "SUCCESS", "FAILED", "EXPIRED"}


class AgentCommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requestId: uuid.UUID
    type: Literal["PAUSE", "RESUME", "RELOAD_CONFIG", "DRAIN", "RUN_SELF_TEST", "PURGE_PENDING_TASKS", "PURGE_ALL_LOCAL_TASKS", "RESTART_WORKERS", "RESTART_AGENT"]
    expiresInSeconds: int = Field(default=86400, strict=True, ge=5, le=86400)
    taskIds: list[str] = Field(default_factory=list, max_length=500)
    includeRunning: bool = Field(default=False, strict=True)
    expectedPendingCount: int | None = Field(default=None, strict=True, ge=1, le=500)
    confirmation: str | None = Field(default=None, min_length=1, max_length=80)
    reason: str | None = Field(default=None, min_length=10, max_length=500)
    config: dict[str, Any] | None = None
    dryRun: bool = False


class AgentCommand(Base):
    __tablename__ = "crawler_agent_commands"
    __table_args__ = (
        UniqueConstraint("agent_id", "sequence", name="uq_agent_command_sequence"),
        UniqueConstraint("agent_id", "request_id", name="uq_agent_command_request"),
        Index("ix_agent_commands_replay", "agent_id", "sequence", "status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(64), index=True)
    request_id: Mapped[str] = mapped_column(String(32))
    sequence: Mapped[int] = mapped_column(Integer)
    command_type: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON_VALUE, default=dict)
    priority: Mapped[int] = mapped_column(Integer, default=4)
    status: Mapped[str] = mapped_column(String(16), default="PENDING", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AgentCommandEvent(Base):
    __tablename__ = "crawler_agent_command_events"
    __table_args__ = (Index("ix_agent_command_events_timeline", "command_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    command_id: Mapped[str] = mapped_column(String(32), index=True)
    agent_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(16))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON_VALUE, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _bounded_count(value: Any) -> int:
    try:
        return max(0, min(500, int(value)))
    except (TypeError, ValueError, OverflowError):
        return 0


def _bounded_self_test_checks(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    checks: dict[str, dict[str, Any]] = {}
    for name in ("authentication", "disk", "worker", "serialization"):
        check = value.get(name)
        if not isinstance(check, dict):
            continue
        status = check.get("status")
        if status not in {"PASS", "DEGRADED", "FAIL"}:
            status = "FAIL"
        detail = check.get("detail")
        if isinstance(detail, dict):
            safe_detail = {}
            for key in ("databaseIntegrity", "freeBytes", "blocked", "reasons", "warnings",
                        "state", "failuresInWindow", "effectiveConcurrency", "bytes"):
                if key not in detail:
                    continue
                item = detail.get(key)
                if type(item) is int:
                    safe_detail[key] = _bounded_count(item)
                elif type(item) is bool or item is None or isinstance(item, str):
                    safe_detail[key] = item if not isinstance(item, str) else item[:80]
                elif isinstance(item, list):
                    safe_detail[key] = [str(entry)[:64] for entry in item[:8]]
            detail = safe_detail
        else:
            detail = str(detail or "")[:160]
        checks[name] = {"status": status, "detail": detail}
    return checks


def command_payload(command: AgentCommand) -> dict[str, Any]:
    return {
        "commandId": command.id,
        "agentId": command.agent_id,
        "sequence": command.sequence,
        "type": command.command_type,
        "payload": dict(command.payload or {}),
        "priority": command.priority,
        "status": command.status,
        "createdAt": _iso(command.created_at),
        "expiresAt": _iso(command.expires_at),
    }


class AgentCommandLedger:
    def __init__(self, sessions):
        self.sessions = sessions

    def submit(self, agent_id: str, request_id: str, command_type: str, expires_in_seconds: int,
               command_payload_value: dict[str, Any] | None = None) -> dict[str, Any]:
        if command_type not in COMMAND_PRIORITY:
            raise HTTPException(422, detail="Unsupported agent command.")
        target_state = "PAUSED" if command_type == "PAUSE" else "RUNNING" if command_type == "RESUME" else "DRAINING" if command_type == "DRAIN" else None
        with self.sessions.begin() as session:
            existing = session.scalar(select(AgentCommand).where(
                AgentCommand.agent_id == agent_id, AgentCommand.request_id == request_id,
            ))
            if existing is not None:
                if existing.command_type != command_type:
                    raise HTTPException(409, detail="Command requestId was reused with a different command.")
                if command_type in {"DRAIN", "RUN_SELF_TEST", "PURGE_PENDING_TASKS", "PURGE_ALL_LOCAL_TASKS", "RESTART_WORKERS", "RESTART_AGENT"} and existing.payload != (command_payload_value or {}):
                    raise HTTPException(409, detail="Command requestId was reused with a different command scope.")
                return self._snapshot(session, existing)
            agent = session.get(ClientRecord,
                                agent_id, with_for_update=True)
            if agent is None:
                raise HTTPException(404, detail="Crawler agent was not found.")
            now = utc_now()
            sequence = agent.command_sequence + 1
            expires_at = now + (timedelta(days=36500) if command_type == "DRAIN"
                                else timedelta(seconds=expires_in_seconds))
            command = AgentCommand(
                id=uuid.uuid4().hex, agent_id=agent_id, request_id=request_id,
                sequence=sequence, command_type=command_type,
                payload=(dict(command_payload_value or {}) if command_type in {
                    "DRAIN", "RUN_SELF_TEST", "PURGE_PENDING_TASKS", "PURGE_ALL_LOCAL_TASKS", "RESTART_WORKERS", "RESTART_AGENT",
                }
                         else {"desiredExecutionState": target_state}),
                priority=COMMAND_PRIORITY[command_type], status="PENDING",
                created_at=now, expires_at=expires_at,
            )
            session.add(command)
            agent.command_sequence = sequence
            if target_state is not None:
                agent.desired_execution_state = target_state
            self._event(session, command, "PENDING", {"source": "operator"}, now)
            session.flush()
            return self._snapshot(session, command)

    def submit_config(self, agent_id: str, request_id: str, expires_in_seconds: int,
                      config: AgentRuntimeConfig) -> dict[str, Any]:
        normalized = config.to_payload()
        with self.sessions.begin() as session:
            existing = session.scalar(select(AgentCommand).where(
                AgentCommand.agent_id == agent_id, AgentCommand.request_id == request_id,
            ))
            if existing is not None:
                expected = existing.payload.get("config") if existing.command_type == "RELOAD_CONFIG" else None
                if expected != normalized:
                    raise HTTPException(409, detail="Command requestId was reused with a different configuration.")
                return self._snapshot(session, existing)
            agent = session.get(ClientRecord, agent_id, with_for_update=True)
            if agent is None:
                raise HTTPException(404, detail="Crawler agent was not found.")
            version = agent.desired_config_version + 1
            now = utc_now()
            command = AgentCommand(
                id=uuid.uuid4().hex, agent_id=agent_id, request_id=request_id,
                sequence=agent.command_sequence + 1, command_type="RELOAD_CONFIG",
                payload={"configVersion": version, "config": normalized},
                priority=COMMAND_PRIORITY["RELOAD_CONFIG"], status="PENDING",
                created_at=now, expires_at=now + timedelta(seconds=expires_in_seconds),
            )
            agent.desired_agent_config = normalized
            agent.desired_config_version = version
            agent.command_sequence = command.sequence
            session.add(command)
            self._event(session, command, "PENDING", {"source": "operator", "configVersion": version}, now)
            session.flush()
            return self._snapshot(session, command)

    def request_snapshot(self, agent_id: str, request_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            command = session.scalar(select(AgentCommand).where(
                AgentCommand.agent_id == agent_id,
                AgentCommand.request_id == request_id,
            ))
            return self._snapshot(session, command) if command is not None else None

    def purge_allowed(self, agent_id: str) -> bool:
        with self.sessions() as session:
            agent = session.get(ClientRecord, agent_id)
            return bool(agent is not None and agent.applied_execution_state == "PAUSED"
                        and agent.capabilities.get("durablePendingPurgeV1") is True)

    def restart_allowed(self, agent_id: str) -> bool:
        with self.sessions() as session:
            agent = session.get(ClientRecord, agent_id)
            return bool(agent is not None and agent.applied_execution_state == "PAUSED"
                        and agent.capabilities.get("durableRestartV1") is True)

    def commands_after(self, agent_id: str, sequence: int, *, limit: int = 500) -> tuple[list[dict[str, Any]], int, str, str, int]:
        now = utc_now()
        with self.sessions.begin() as session:
            agent = session.get(ClientRecord, agent_id)
            if agent is None:
                raise HTTPException(404, detail="Crawler agent was not found.")
            latest = agent.command_sequence
            if sequence < 0 or sequence > latest:
                raise HTTPException(409, detail="Agent command sequence is outside the server ledger.")
            rows = list(session.scalars(select(AgentCommand).where(
                AgentCommand.agent_id == agent_id, AgentCommand.sequence > sequence,
            ).order_by(AgentCommand.sequence).limit(limit)))
            for command in rows:
                if command.status not in TERMINAL_STATUSES and command.command_type != "DRAIN" and _expired(command.expires_at, now):
                    self._finish(session, agent, command, "EXPIRED", "Command expired before execution.", now)
            payloads = [command_payload(command) for command in rows]
            return (payloads, latest, agent.desired_execution_state,
                    agent.applied_execution_state, agent.last_processed_command_sequence)

    def mark_delivered(self, agent_id: str, command_id: str) -> dict[str, Any] | None:
        now = utc_now()
        with self.sessions.begin() as session:
            command = session.scalar(select(AgentCommand).where(
                AgentCommand.id == command_id, AgentCommand.agent_id == agent_id,
            ).with_for_update())
            if command is None or command.status in TERMINAL_STATUSES:
                return None
            agent = session.get(ClientRecord, agent_id)
            if agent is None:
                return None
            if command.command_type != "DRAIN" and _expired(command.expires_at, now):
                self._finish(session, agent, command, "EXPIRED", "Command expired before delivery.", now)
                return command_payload(command)
            if command.status == "PENDING":
                command.status = "DELIVERED"
                command.delivered_at = now
                self._event(session, command, "DELIVERED", {"transport": "websocket"}, now)
            return command_payload(command)

    def update(self, agent_id: str, update: dict[str, Any]) -> dict[str, Any]:
        command_id = str(update.get("commandId") or "")
        status = str(update.get("status") or "")
        try:
            sequence = int(update.get("sequence"))
        except (TypeError, ValueError):
            raise HTTPException(400, detail="Command sequence must be an integer.") from None
        if status not in ALLOWED_UPDATES:
            raise HTTPException(400, detail="Unsupported command update status.")
        now = utc_now()
        with self.sessions.begin() as session:
            command = session.scalar(select(AgentCommand).where(
                AgentCommand.id == command_id, AgentCommand.agent_id == agent_id,
                AgentCommand.sequence == sequence,
            ).with_for_update())
            if command is None:
                raise HTTPException(404, detail="Agent command was not found.")
            agent = session.get(ClientRecord,
                                agent_id, with_for_update=True)
            if agent is None:
                raise HTTPException(404, detail="Crawler agent was not found.")
            if command.status in TERMINAL_STATUSES:
                if command.sequence == agent.last_processed_command_sequence + 1:
                    agent.last_processed_command_sequence = command.sequence
                return self._snapshot(session, command)
            if status == "EXPIRED" and not _expired(command.expires_at, now):
                raise HTTPException(409, detail="Agent cannot expire a command before its deadline.")
            if status == "SUCCESS" and command.command_type == "RELOAD_CONFIG":
                result = update.get("result")
                expected_version = int(command.payload.get("configVersion") or 0)
                try:
                    applied_version = int(result.get("appliedConfigVersion")) if isinstance(result, dict) else 0
                except (TypeError, ValueError):
                    applied_version = 0
                if expected_version <= 0 or applied_version != expected_version:
                    raise HTTPException(409, detail="Agent config acknowledgement does not match the requested version.")
                agent.applied_agent_config = dict(command.payload.get("config") or {})
                agent.applied_config_version = expected_version
            if status == "SUCCESS" and command.command_type == "DRAIN":
                result = update.get("result")
                if not isinstance(result, dict) or result.get("drained") is not True:
                    raise HTTPException(409, detail="DRAIN success requires a confirmed drained result.")
                if any(type(result.get(field)) is not int or result.get(field) != 0
                       for field in ("activeTaskCount", "pendingOutboxCount")):
                    raise HTTPException(409, detail="DRAIN cannot complete while tasks or outbox entries remain.")
            if command.command_type != "DRAIN" and status in {"ACKED", "RUNNING", "SUCCESS", "FAILED"} and _expired(command.expires_at, now):
                self._finish(session, agent, command, "EXPIRED", "Command expired before execution.", now)
                return self._snapshot(session, command)
            allowed = {
                "PENDING": {"ACKED", "RUNNING", "SUCCESS", "FAILED", "EXPIRED"},
                "DELIVERED": {"ACKED", "RUNNING", "SUCCESS", "FAILED", "EXPIRED"},
                "ACKED": {"RUNNING", "SUCCESS", "FAILED", "EXPIRED"},
                "RUNNING": {"SUCCESS", "FAILED", "EXPIRED"},
            }
            if status == command.status:
                return self._snapshot(session, command)
            if status not in allowed.get(command.status, set()):
                raise HTTPException(409, detail="Invalid agent command status transition.")
            if status in {"SUCCESS", "FAILED", "EXPIRED"} and sequence != agent.last_processed_command_sequence + 1:
                raise HTTPException(409, detail="Agent command acknowledgement has a sequence gap.")
            detail = str(update.get("error") or "")[:500] if status == "FAILED" else ""
            result = update.get("result") if command.command_type in {
                "PURGE_PENDING_TASKS", "PURGE_ALL_LOCAL_TASKS", "RESTART_WORKERS", "RESTART_AGENT",
                "RELOAD_CONFIG", "DRAIN", "RUN_SELF_TEST",
            } else None
            event_detail = {"error": detail} if detail else {}
            if isinstance(result, dict):
                if command.command_type == "RUN_SELF_TEST":
                    event_detail["result"] = {
                        "status": result.get("status") if result.get("status") in {"PASS", "DEGRADED", "FAIL"} else "FAIL",
                        "checks": _bounded_self_test_checks(result.get("checks")),
                    }
                else:
                    event_detail["result"] = {
                    **({
                        "scope": "all-local" if command.command_type == "PURGE_ALL_LOCAL_TASKS" else "pending",
                        "beforeCount": _bounded_count(result.get("beforeCount")),
                        "purgedCount": _bounded_count(result.get("purgedCount")),
                        "afterCount": _bounded_count(result.get("afterCount")),
                    } if command.command_type in {"PURGE_PENDING_TASKS", "PURGE_ALL_LOCAL_TASKS"} else {
                        **({"appliedConfigVersion": _bounded_count(result.get("appliedConfigVersion"))}
                           if command.command_type == "RELOAD_CONFIG" else {}),
                        **({"drained": result.get("drained") is True,
                            "activeTaskCount": _bounded_count(result.get("activeTaskCount")),
                            "pendingOutboxCount": _bounded_count(result.get("pendingOutboxCount"))}
                           if command.command_type == "DRAIN" else {}),
                        "bootId": str(result.get("bootId") or "")[:64],
                        "identityRetained": bool(result.get("identityRetained")),
                        "pendingOutboxCount": _bounded_count(result.get("pendingOutboxCount")),
                        "restartedWorkers": _bounded_count(result.get("restartedWorkers")),
                        "clearedWorkerFailures": _bounded_count(result.get("clearedWorkerFailures")),
                    }),
                    }
            if status == "ACKED":
                command.acknowledged_at = now
            elif status == "RUNNING":
                command.started_at = command.started_at or now
            elif status in TERMINAL_STATUSES:
                self._finish(session, agent, command, status, detail, now, event_detail)
            else:
                command.status = status
            if status not in TERMINAL_STATUSES:
                self._event(session, command, status, {}, now)
            session.flush()
            return self._snapshot(session, command)

    def expire_pending(self) -> int:
        now = utc_now()
        expired = 0
        with self.sessions.begin() as session:
            rows = list(session.scalars(select(AgentCommand).where(
                AgentCommand.status.in_(["PENDING", "DELIVERED", "ACKED", "RUNNING"]),
                AgentCommand.command_type != "DRAIN",
                AgentCommand.expires_at <= now,
            ).with_for_update()))
            for command in rows:
                agent = session.get(ClientRecord,
                                    command.agent_id, with_for_update=True)
                if agent is not None:
                    self._finish(session, agent, command, "EXPIRED", "Command expired before completion.", now)
                    expired += 1
        return expired

    def admission_open(self, agent_id: str, reported_sequence: int, reported_state: str) -> bool:
        with self.sessions() as session:
            agent = session.get(ClientRecord, agent_id)
            return bool(agent is not None
                        and reported_state == agent.applied_execution_state
                        and agent.desired_execution_state == "RUNNING"
                        and agent.applied_execution_state == "RUNNING"
                        and agent.last_processed_command_sequence == agent.command_sequence
                        and reported_sequence >= agent.command_sequence)

    def history(self, agent_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        with self.sessions() as session:
            rows = list(session.scalars(select(AgentCommand).where(
                AgentCommand.agent_id == agent_id,
            ).order_by(AgentCommand.sequence.desc()).limit(limit)))
            result = []
            for command in reversed(rows):
                entry = self._snapshot(session, command)
                events = session.scalars(select(AgentCommandEvent).where(
                    AgentCommandEvent.command_id == command.id,
                ).order_by(AgentCommandEvent.created_at, AgentCommandEvent.id)).all()
                entry["events"] = [{"status": event.status, "at": _iso(event.created_at),
                                    "detail": dict(event.detail or {})} for event in events]
                result.append(entry)
            return result

    @staticmethod
    def _event(session, command: AgentCommand, status: str, detail: dict[str, Any], now: datetime) -> None:
        session.add(AgentCommandEvent(id=uuid.uuid4().hex, command_id=command.id,
            agent_id=command.agent_id, status=status, detail=detail, created_at=now))

    @classmethod
    def _finish(cls, session, agent, command: AgentCommand, status: str, error: str, now: datetime,
                event_detail: dict[str, Any] | None = None) -> None:
        command.status = status
        command.completed_at = now
        command.error = error or None
        if command.sequence == agent.last_processed_command_sequence + 1:
            agent.last_processed_command_sequence = command.sequence
        if status == "SUCCESS" and command.command_type in {"PAUSE", "RESUME"}:
            agent.applied_execution_state = command.payload["desiredExecutionState"]
        elif status == "SUCCESS" and command.command_type == "DRAIN":
            agent.applied_execution_state = "DRAINED"
            if agent.desired_execution_state == "DRAINING":
                agent.desired_execution_state = "DRAINED"
        elif (status in {"FAILED", "EXPIRED"} and command.command_type in {"PAUSE", "RESUME"}
              and agent.desired_execution_state == command.payload["desiredExecutionState"]):
            previous = session.scalar(select(AgentCommand).where(
                AgentCommand.agent_id == command.agent_id,
                AgentCommand.sequence < command.sequence,
                AgentCommand.status.in_(["PENDING", "DELIVERED", "ACKED", "RUNNING", "SUCCESS"]),
            ).order_by(AgentCommand.sequence.desc()).limit(1))
            agent.desired_execution_state = (
                str(previous.payload.get("desiredExecutionState")) if previous is not None
                else agent.applied_execution_state
            )
        cls._event(session, command, status, {**({"error": error} if error else {}), **(event_detail or {})}, now)

    @classmethod
    def _snapshot(cls, session, command: AgentCommand) -> dict[str, Any]:
        result = command_payload(command)
        result.update({
            "requestId": command.request_id,
            "deliveredAt": _iso(command.delivered_at),
            "acknowledgedAt": _iso(command.acknowledged_at),
            "startedAt": _iso(command.started_at),
            "completedAt": _iso(command.completed_at),
            "error": command.error,
        })
        return result


def _expired(expires_at: datetime, now: datetime) -> bool:
    aware = expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at
    return aware <= now
