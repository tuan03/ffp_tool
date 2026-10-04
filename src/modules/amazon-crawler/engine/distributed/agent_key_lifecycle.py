"""Audited, atomic replacement and revocation of agent credentials."""
import hashlib
import secrets
import uuid

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .agent_keys import AgentKey, CreateAgentKey, key_metadata
from .agent_identity import AgentEnrollment
from .coordinator_models import ClientRecord
from .operator_authorization import OperatorAudit
from .protocol import utc_now


class ReplaceAgentKey(CreateAgentKey):
    rebind: bool = False
    adoptAgentId: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")


def install_key_lifecycle_routes(app, sessions, operator_username: str):
    def audit_action(session, request, key_id, reason):
        audit = session.get(OperatorAudit, request.state.operator_audit_id)
        if audit is None or audit.actor != operator_username or audit.outcome != "authorized":
            raise RuntimeError("Operator authorization audit is required")
        audit.target_id, audit.reason = key_id, reason

    @app.post("/api/v1/agent-keys/{key_id}/revoke")
    def revoke(key_id: str, request: Request):
        with sessions.begin() as session:
            key = session.scalar(select(AgentKey).where(AgentKey.id == key_id).with_for_update())
            if key is None:
                raise HTTPException(404, detail="AGENT_KEY_NOT_FOUND")
            key.status = "revoked"
            audit_action(session, request, key_id, "AGENT_KEY_REVOKED")
        return JSONResponse({"status": "revoked"}, headers={"Cache-Control": "no-store"})

    @app.post("/api/v1/agent-keys/{key_id}/rotate")
    def rotate(key_id: str, payload: ReplaceAgentKey, request: Request):
        if (payload.expiresAt.tzinfo is None or payload.expiresAt <= utc_now()
                or not payload.name.strip() or len(set(payload.crawlers)) != len(payload.crawlers)):
            raise HTTPException(400, detail="AGENT_KEY_CONFIGURATION_INVALID")
        replacement_id = uuid.uuid4().hex
        raw_key = f"ffp_agent_{replacement_id}_{secrets.token_urlsafe(32)}"
        try:
            with sessions.begin() as session:
                old = session.scalar(select(AgentKey).where(AgentKey.id == key_id).with_for_update())
                if old is None:
                    raise HTTPException(404, detail="AGENT_KEY_NOT_FOUND")
                if session.scalar(select(AgentKey.id).where(AgentKey.request_id == payload.requestId.hex)):
                    raise HTTPException(409, detail="AGENT_KEY_ALREADY_CREATED")
                if old.status == "revoked" and not payload.rebind:
                    raise HTTPException(409, detail="AGENT_KEY_REVOKED_REBIND_REQUIRED")
                agent_id = old.agent_id
                if payload.adoptAgentId:
                    if not payload.rebind or agent_id is not None or session.get(ClientRecord, payload.adoptAgentId) is None:
                        raise HTTPException(409, detail="AGENT_ADOPTION_INVALID")
                    agent_id = payload.adoptAgentId
                if agent_id:
                    # Serialize replacements for one identity, including adoption/reinstall.
                    session.scalar(select(ClientRecord).where(ClientRecord.id == agent_id).with_for_update())
                    enrollment = session.get(AgentEnrollment, agent_id)
                    if enrollment is None:
                        session.add(AgentEnrollment(agent_id=agent_id, request_id=None))
                    elif payload.rebind:
                        enrollment.request_id = None
                    for active in session.scalars(select(AgentKey).where(AgentKey.agent_id == agent_id)):
                        active.status = "revoked"
                old.status = "revoked"
                replacement = AgentKey(id=replacement_id, request_id=payload.requestId.hex,
                    name=payload.name.strip(), verifier=hashlib.sha256(raw_key.encode("ascii")).hexdigest(),
                    status="active" if agent_id else "unbound", agent_id=agent_id,
                    max_workers=payload.maxWorkers, crawlers=list(payload.crawlers), environment=payload.environment,
                    created_by=operator_username, expires_at=payload.expiresAt)
                session.add(replacement)
                session.flush()
                audit_action(session, request, replacement_id, "AGENT_KEY_REBOUND" if payload.rebind else "AGENT_KEY_ROTATED")
                metadata = key_metadata(replacement)
        except IntegrityError:
            raise HTTPException(409, detail="AGENT_KEY_REQUEST_CONFLICT") from None
        return JSONResponse({"key": raw_key, "metadata": metadata}, status_code=201,
            headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
