"""Validated, secret-free configuration that may be sent to crawler agents."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AgentRuntimeLimits(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    productThreads: int = Field(default=4, ge=1, le=16)
    variantThreads: int = Field(default=8, ge=1, le=32)
    urllibThreads: int = Field(default=12, ge=1, le=64)
    browserProfiles: int = Field(default=4, ge=1, le=8)
    browserTabs: int = Field(default=2, ge=1, le=12)
    headless: bool = False


class AgentRuntimeConfig(BaseModel):
    """Operational fields safe to distribute; credentials and local paths are excluded."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    maxConcurrentInputs: int = Field(default=4, ge=1, le=16)
    heartbeatIntervalSeconds: int = Field(default=10, ge=5, le=30)
    clientOfflineAfterSeconds: int = Field(default=30, ge=15, le=180)
    leaseSeconds: int = Field(default=60, ge=30, le=600)
    limits: AgentRuntimeLimits = Field(default_factory=AgentRuntimeLimits)

    @model_validator(mode="after")
    def validate_timeout_relationships(self) -> "AgentRuntimeConfig":
        if self.clientOfflineAfterSeconds < self.heartbeatIntervalSeconds * 3:
            raise ValueError("clientOfflineAfterSeconds must allow at least three heartbeats")
        if self.leaseSeconds < self.clientOfflineAfterSeconds * 2:
            raise ValueError("leaseSeconds must be at least twice clientOfflineAfterSeconds")
        return self

    @classmethod
    def from_payload(cls, payload: object) -> "AgentRuntimeConfig":
        if not isinstance(payload, dict):
            raise ValueError("Agent configuration must be an object")
        return cls.model_validate(payload)

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
