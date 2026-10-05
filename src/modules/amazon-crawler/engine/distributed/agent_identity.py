"""Server-owned enrollment and reusable key verification for secure mode."""
from __future__ import annotations

import hashlib
import hmac
import re
import uuid
from dataclasses import dataclass
from datetime import timezone

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String, select
from sqlalchemy.orm import Mapped, mapped_column

from .agent_keys import AgentKey
from .coordinator_models import Base, ClientRecord
from .protocol import utc_now


class AgentEnrollment(Base):
    __tablename__ = "crawler_agent_enrollments"
    agent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[str | None] = mapped_column(String(32), nullable=True)


class RegisterAgent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: uuid.UUID
    displayName: str = Field(min_length=1, max_length=200)


@dataclass(frozen=True)
class AgentPrincipal:
    key_id: str
    agent_id: str
    max_workers: int
    crawlers: tuple[str, ...]
    agent_group: str


class AgentSecurity:
    def __init__(self, sessions, environment: str):
        if environment not in {"test", "production"}:
            raise ValueError("Explicit test or production agent environment is required")
        self.sessions = sessions
        self.environment = environment

    def verified_key(self, session, authorization: str, *, lock: bool = False) -> AgentKey:
        match = re.fullmatch(r"Bearer (ffp_agent_([0-9a-f]{32})_[A-Za-z0-9_-]{43})", authorization)
        if not match:
            raise HTTPException(401, detail={"code": "AGENT_AUTH_REQUIRED"})
        statement = select(AgentKey).where(AgentKey.id == match[2])
        key = session.scalar(statement.with_for_update() if lock else statement)
        if key is None or not hmac.compare_digest(key.verifier, hashlib.sha256(match[1].encode("ascii")).hexdigest()):
            raise HTTPException(401, detail={"code": "AGENT_AUTH_REQUIRED"})
        expiry = key.expires_at.replace(tzinfo=timezone.utc) if key.expires_at.tzinfo is None else key.expires_at
        if key.status == "revoked" or expiry <= utc_now():
            raise HTTPException(401, detail={"code": "AGENT_NEED_REAUTH"})
        if key.environment != self.environment:
            raise HTTPException(403, detail={"code": "AGENT_ENVIRONMENT_DENIED"})
        return key

    def authenticate(self, authorization: str) -> AgentPrincipal:
        with self.sessions.begin() as session:
            key = self.verified_key(session, authorization)
            if key.agent_id is None or key.status != "active":
                raise HTTPException(401, detail={"code": "AGENT_ENROLLMENT_REQUIRED"})
            key.last_used_at = utc_now()
            return AgentPrincipal(key.id, key.agent_id, key.max_workers, tuple(key.crawlers), key.agent_group)

    def register(self, authorization: str, payload: RegisterAgent) -> dict:
        with self.sessions.begin() as session:
            key = self.verified_key(session, authorization, lock=True)
            if key.agent_id is None:
                key.agent_id = uuid.uuid4().hex
                session.add(AgentEnrollment(agent_id=key.agent_id, request_id=payload.requestId.hex))
                session.add(ClientRecord(id=key.agent_id, display_name=payload.displayName,
                    max_concurrent_inputs=min(16, key.max_workers), agent_group=key.agent_group))
            else:
                enrollment = session.get(AgentEnrollment, key.agent_id)
                if enrollment is None or enrollment.request_id not in {None, payload.requestId.hex}:
                    raise HTTPException(409, detail={"code": "AGENT_REBIND_REQUIRED"})
                enrollment.request_id = payload.requestId.hex
            key.status = "active"
            key.last_used_at = utc_now()
            return {"agentId": key.agent_id, "authProtocol": 1, "maxWorkers": min(16, key.max_workers),
                    "crawlers": key.crawlers, "environment": key.environment, "agentGroup": key.agent_group}


def install_enrollment_routes(app, security: AgentSecurity):
    @app.get("/api/v1/worker/security")
    def security_contract():
        return {"authRequired": True, "authProtocol": 1, "environment": security.environment}

    @app.post("/api/v1/worker/register")
    def register(payload: RegisterAgent, request: Request):
        return security.register(request.headers.get("authorization", ""), payload)
