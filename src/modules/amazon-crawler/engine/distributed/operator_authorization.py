"""Opt-in Coordinator operator boundary and durable, payload-free audit."""
from __future__ import annotations

import base64
import binascii
import hmac
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from fastapi.responses import JSONResponse
from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from starlette.routing import Match

from .coordinator_models import Base
from .protocol import utc_now


@dataclass(frozen=True)
class OperatorCredentials:
    username: str
    password: str = field(repr=False)

    def __post_init__(self):
        if not self.username or len(self.username) > 200 or not self.password or ":" in self.username:
            raise ValueError("Complete operator credentials are required")

    def accepts(self, authorization: str) -> bool:
        scheme, _, encoded = authorization.partition(" ")
        if scheme.lower() != "basic" or len(encoded) > 8192:
            return False
        try:
            supplied = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            return False
        expected = f"{self.username}:{self.password}".encode("utf-8")
        return hmac.compare_digest(supplied, expected)


class OperatorAudit(Base):
    __tablename__ = "crawler_operator_audit"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    actor: Mapped[str] = mapped_column(String(200))
    method: Mapped[str] = mapped_column(String(16))
    route: Mapped[str] = mapped_column(String(300))
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    outcome: Mapped[str] = mapped_column(String(24))
    reason: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)


def install_operator_authorization(app, sessions, credentials: OperatorCredentials) -> None:
    @app.middleware("http")
    async def authorize(request, call_next):
        path = request.scope["path"]
        if path in {"/api/v1/health", "/api/v1/ready", "/api/v1/agent-release"} or path.startswith(("/api/v1/worker/", "/api/v1/internal/")):
            # These have distinct worker/pipeline contracts, not operator rights.
            return await call_next(request)
        authenticated = credentials.accepts(request.headers.get("authorization", ""))
        origin = request.headers.get("origin")
        unsafe_method = request.method not in {"GET", "HEAD", "OPTIONS"}
        cross_origin = unsafe_method and (
            (origin is not None and origin != str(request.base_url).rstrip("/"))
            or request.headers.get("sec-fetch-site") == "cross-site"
        )
        allowed = authenticated and not cross_origin
        denial_status = 403 if authenticated else 401
        denial_reason = "OPERATOR_ORIGIN_DENIED" if authenticated else "OPERATOR_AUTH_REQUIRED"
        route_name, target = "unmatched", None
        for route in app.router.routes:
            match, scope = route.matches(request.scope)
            if match == Match.FULL:
                route_name = getattr(route, "path", "unmatched")
                for value in scope.get("path_params", {}).values():
                    if re.fullmatch(r"[0-9a-f]{32}", str(value)):
                        target = str(value)
                        break
                break
        audit_id = uuid.uuid4().hex
        try:
            with sessions.begin() as session:
                session.add(OperatorAudit(id=audit_id, actor=credentials.username if authenticated else "unauthenticated",
                    method=request.method, route=route_name, target_id=target,
                    outcome="authorized" if allowed else "denied", status_code=None if allowed else denial_status,
                    reason="OPERATOR_AUTH_ACCEPTED" if allowed else denial_reason))
        except Exception:
            # No management side effect when mandatory audit cannot be persisted.
            return JSONResponse({"error": {"code": "OPERATOR_AUDIT_UNAVAILABLE"}}, status_code=503)
        if not allowed:
            return JSONResponse({"error": {"code": denial_reason}}, status_code=denial_status,
                headers={"WWW-Authenticate": 'Basic realm="FFP Operator"', "X-Request-Id": audit_id})
        try:
            response = await call_next(request)
        except Exception:
            # Keep the durable authorization attempt as an unknown outcome.
            return JSONResponse({"error": {"code": "OPERATOR_OPERATION_FAILED", "requestId": audit_id}}, status_code=500)
        try:
            with sessions.begin() as session:
                audit = session.get(OperatorAudit, audit_id)
                audit.outcome = "completed" if response.status_code < 400 else "rejected"
                audit.status_code = response.status_code
                audit.reason = "HTTP_RESPONSE_RECORDED"
        except Exception:
            # Action may already have committed: never report it was rolled back.
            return JSONResponse({"error": {"code": "OPERATOR_OUTCOME_UNKNOWN", "requestId": audit_id}}, status_code=503)
        response.headers["X-Request-Id"] = audit_id
        return response
