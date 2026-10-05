"""Persistent desired state for global crawler task admission."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .coordinator_models import Base
from .protocol import utc_now


GLOBAL_ADMISSION_GATE_ID = "crawler"


class GlobalAdmissionGateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requestId: str = Field(pattern=r"^[0-9a-fA-F]{32}$")
    state: Literal["OPEN", "STOPPED"]
    reason: str = Field(min_length=3, max_length=500)


class GlobalAdmissionGate(Base):
    __tablename__ = "crawler_global_admission_gate"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    state: Mapped[str] = mapped_column(String(16), default="OPEN")
    scope: Mapped[str] = mapped_column(String(32), default="crawler")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    actor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class GlobalAdmissionGateEvent(Base):
    __tablename__ = "crawler_global_admission_gate_events"

    request_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    from_state: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(16))
    scope: Mapped[str] = mapped_column(String(32), default="crawler")
    revision: Mapped[int] = mapped_column(Integer)
    actor: Mapped[str] = mapped_column(String(200))
    reason: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
