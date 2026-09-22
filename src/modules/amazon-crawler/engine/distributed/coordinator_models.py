"""SQLAlchemy persistence model for the distributed coordinator."""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import NullPool

from .protocol import utc_now


JSON_VALUE = JSON().with_variant(JSONB, "postgresql")


class Base(DeclarativeBase):
    pass


class ClientRecord(Base):
    __tablename__ = "crawler_clients"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="offline", index=True)
    agent_version: Mapped[str] = mapped_column(String(32), default="unknown")
    protocol_version: Mapped[str] = mapped_column(String(16), default="1")
    max_concurrent_inputs: Mapped[int] = mapped_column(Integer, default=1)
    capabilities: Mapped[dict[str, Any]] = mapped_column(JSON_VALUE, default=dict)
    limits: Mapped[dict[str, Any]] = mapped_column(JSON_VALUE, default=dict)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    external_request_id: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON_VALUE, default=dict)
    requested_inputs: Mapped[int] = mapped_column(Integer, default=0)
    accepted_inputs: Mapped[int] = mapped_column(Integer, default=0)
    rejected_inputs: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    tasks: Mapped[list["CrawlTask"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class CrawlTask(Base):
    __tablename__ = "crawl_tasks"
    __table_args__ = (
        UniqueConstraint("job_id", "asin", name="uq_crawl_task_job_asin"),
        Index("ix_crawl_tasks_schedulable", "status", "ordinal", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("crawl_jobs.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(Text)
    asin: Mapped[str] = mapped_column(String(10), index=True)
    canonical_url: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    assigned_client_id: Mapped[str | None] = mapped_column(ForeignKey("crawler_clients.id"), nullable=True, index=True)
    lease_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_error: Mapped[dict[str, Any] | None] = mapped_column(JSON_VALUE, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped[CrawlJob] = relationship(back_populates="tasks")
    result: Mapped["TaskResult | None"] = relationship(back_populates="task", uselist=False, cascade="all, delete-orphan")
    attempts: Mapped[list["TaskAttempt"]] = relationship(back_populates="task", cascade="all, delete-orphan")


class TaskAttempt(Base):
    __tablename__ = "task_attempts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("crawl_tasks.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    lease_id: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(32), default="leased")
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON_VALUE, nullable=True)
    leased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped[CrawlTask] = relationship(back_populates="attempts")


class TaskResult(Base):
    __tablename__ = "task_results"

    task_id: Mapped[str] = mapped_column(ForeignKey("crawl_tasks.id", ondelete="CASCADE"), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    lease_id: Mapped[str] = mapped_column(String(40))
    checksum: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON_VALUE)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    task: Mapped[CrawlTask] = relationship(back_populates="result")


class JobEvent(Base):
    __tablename__ = "job_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("crawl_jobs.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON_VALUE, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)


class InvalidJobInput(Base):
    __tablename__ = "invalid_job_inputs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("crawl_jobs.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


def database_url() -> str:
    return os.environ.get("AMAZON_COORDINATOR_DATABASE_URL", "sqlite:///.runtime/coordinator.sqlite3")


def create_database_engine(url: str | None = None):
    selected = url or database_url()
    connect_args = {"check_same_thread": False} if selected.startswith("sqlite") else {}
    engine_options: dict[str, Any] = {"pool_pre_ping": True, "connect_args": connect_args}
    if selected.startswith("sqlite"):
        sqlite_database = make_url(selected).database
        if sqlite_database and sqlite_database != ":memory:":
            Path(sqlite_database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        engine_options["poolclass"] = NullPool
    return create_engine(selected, **engine_options)


def create_session_factory(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)
