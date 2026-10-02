"""Durable Pinterest POD job metadata storage.

PostgreSQL is used in the production container. SQLite remains supported for
local development and isolated tests; generated binaries stay on the runtime
volume and are referenced by the JSON job snapshot.
"""

from __future__ import annotations

import copy
import os
import threading
import time
from pathlib import Path
from typing import Any

from sqlalchemy import Float, JSON, String, create_engine, delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class PinterestPodJob(Base):
    __tablename__ = "pinterest_pod_jobs"

    job_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)


def database_url() -> str:
    return str(
        os.getenv("PINTEREST_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or "sqlite:///./.runtime/pinterest-pod/jobs.sqlite3"
    ).strip()


class PinterestJobRepository:
    def __init__(self, url: str | None = None) -> None:
        resolved_url = url or database_url()
        connect_args = {"check_same_thread": False} if resolved_url.startswith("sqlite") else {}
        if resolved_url.startswith("sqlite"):
            sqlite_database = make_url(resolved_url).database
            if sqlite_database and sqlite_database != ":memory:":
                Path(sqlite_database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(resolved_url, pool_pre_ping=True, connect_args=connect_args)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)

    def save(self, job_id: str, snapshot: dict[str, Any]) -> None:
        now = time.time()
        with self.sessions.begin() as session:
            record = session.get(PinterestPodJob, job_id)
            if record is None:
                record = PinterestPodJob(
                    job_id=job_id,
                    status=str(snapshot.get("status") or "unknown"),
                    snapshot=copy.deepcopy(snapshot),
                    created_at=float(snapshot.get("created_at") or now),
                    updated_at=now,
                )
                session.add(record)
            else:
                record.status = str(snapshot.get("status") or record.status)
                record.snapshot = copy.deepcopy(snapshot)
                record.updated_at = now

    def load(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            record = session.get(PinterestPodJob, job_id)
            return copy.deepcopy(record.snapshot) if record is not None else None

    def delete(self, job_id: str) -> bool:
        with self.sessions.begin() as session:
            result = session.execute(delete(PinterestPodJob).where(PinterestPodJob.job_id == job_id))
            return bool(result.rowcount)

    def recent(self, limit: int = 100) -> list[tuple[str, dict[str, Any], float]]:
        statement = select(PinterestPodJob).order_by(PinterestPodJob.updated_at.desc()).limit(limit)
        with self.sessions() as session:
            records = session.scalars(statement).all()
            return [(record.job_id, copy.deepcopy(record.snapshot), record.updated_at) for record in records]

    def recover_interrupted(self) -> int:
        recovered = 0
        now = time.time()
        with self.sessions.begin() as session:
            records = session.scalars(
                select(PinterestPodJob).where(PinterestPodJob.status.in_(("running", "producing")))
            ).all()
            for record in records:
                snapshot = copy.deepcopy(record.snapshot)
                snapshot["status"] = "failed"
                snapshot["error"] = "Tiến trình bị gián đoạn do Pinterest POD service khởi động lại."
                snapshot.setdefault("logs", []).append(
                    "Service đã khởi động lại; job cũ được đánh dấu thất bại an toàn và có thể chạy lại."
                )
                record.status = "failed"
                record.snapshot = snapshot
                record.updated_at = now
                recovered += 1
        return recovered

    def is_ready(self) -> bool:
        try:
            with self.sessions() as session:
                session.execute(select(1))
            return True
        except Exception:
            return False


_repository: PinterestJobRepository | None = None
_repository_lock = threading.Lock()


def get_job_repository() -> PinterestJobRepository:
    global _repository
    if _repository is None:
        with _repository_lock:
            if _repository is None:
                _repository = PinterestJobRepository()
    return _repository
