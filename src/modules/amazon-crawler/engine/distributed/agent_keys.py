"""Operator-only key creation; raw keys are never recoverable from storage."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime
from typing import Literal

from fastapi import HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, String, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from .coordinator_models import Base, JSON_VALUE
from .operator_authorization import OperatorAudit
from .protocol import utc_now


class AgentKey(Base):
    __tablename__ = "crawler_agent_keys"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    verifier: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="unbound")
    agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    max_workers: Mapped[int] = mapped_column(Integer)
    crawlers: Mapped[list[str]] = mapped_column(JSON_VALUE)
    environment: Mapped[str] = mapped_column(String(20))
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CreateAgentKey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    maxWorkers: int = Field(strict=True, ge=1, le=2147483647)
    crawlers: list[Literal["amazon", "pinterest"]] = Field(min_length=1, max_length=2)
    environment: Literal["test", "production"]
    expiresAt: datetime


def key_metadata(key: AgentKey) -> dict:
    # Explicit allowlist: never serialize an ORM instance or its verifier.
    return {"id": key.id, "name": key.name, "status": key.status, "agentId": key.agent_id,
            "maxWorkers": key.max_workers, "crawlers": key.crawlers, "environment": key.environment,
            "createdAt": key.created_at.isoformat(), "expiresAt": key.expires_at.isoformat(),
            "lastUsedAt": key.last_used_at.isoformat() if key.last_used_at else None}


def install_agent_key_routes(app, sessions, operator_username: str) -> None:
    @app.post("/api/v1/agent-keys", status_code=201)
    def create_key(payload: CreateAgentKey, request: Request):
        if payload.expiresAt.tzinfo is None or payload.expiresAt <= utc_now() or not payload.name.strip():
            raise HTTPException(status_code=400, detail="Future timezone-aware expiry and a nonblank name are required.")
        if len(set(payload.crawlers)) != len(payload.crawlers):
            raise HTTPException(status_code=400, detail="Crawler permissions must be unique.")
        request_id = payload.requestId.hex
        key_id = uuid.uuid4().hex
        raw_key = f"ffp_agent_{key_id}_{secrets.token_urlsafe(32)}"
        try:
            with sessions.begin() as session:
                key = AgentKey(id=key_id, request_id=request_id, name=payload.name.strip(),
                    verifier=hashlib.sha256(raw_key.encode("ascii")).hexdigest(),
                    max_workers=payload.maxWorkers, crawlers=list(payload.crawlers), environment=payload.environment,
                    created_by=operator_username, expires_at=payload.expiresAt)
                session.add(key)
                session.flush()
                audit = session.get(OperatorAudit, request.state.operator_audit_id)
                if audit is None or audit.actor != operator_username or audit.outcome != "authorized":
                    raise RuntimeError("Operator authorization audit is required")
                audit.target_id = key_id
                audit.reason = "AGENT_KEY_CREATED"
                metadata = key_metadata(key)
        except IntegrityError:
            with sessions() as session:
                existing = session.scalar(select(AgentKey).where(AgentKey.request_id == request_id))
                if existing is None:
                    raise
                return JSONResponse({"error": {"code": "AGENT_KEY_ALREADY_CREATED", "keyId": existing.id,
                    "message": "The raw key cannot be shown again. Do not retry with a new request ID blindly."}},
                    status_code=409, headers={"Cache-Control": "no-store"})
        return JSONResponse({"key": raw_key, "metadata": metadata}, status_code=201,
                            headers={"Cache-Control": "no-store", "Pragma": "no-cache"})

    @app.get("/api/v1/agent-keys")
    def list_keys(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
        with sessions() as session:
            keys = session.scalars(select(AgentKey).order_by(AgentKey.created_at, AgentKey.id).offset(offset).limit(limit))
            total = int(session.scalar(select(func.count(AgentKey.id))) or 0)
            return JSONResponse({"keys": [key_metadata(key) for key in keys], "total": total}, headers={"Cache-Control": "no-store"})
