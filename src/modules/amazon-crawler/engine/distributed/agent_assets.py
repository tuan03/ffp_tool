"""Lease-fenced writes to durable Pinterest asset namespaces."""
from datetime import timezone
from pathlib import Path
import os
import re
import uuid

from fastapi import HTTPException
from sqlalchemy import String, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from .coordinator_models import Base, CrawlJob, CrawlTask
from .protocol import utc_now


class AgentAssetNamespace(Base):
    __tablename__ = "crawler_agent_asset_namespaces"
    name: Mapped[str] = mapped_column(String(128), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(40), index=True)


def save_agent_asset(security, authorization: str, root: Path, namespace: str,
                     filename: str, task_id: str, lease_id: str, body: bytes) -> None:
    if (not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", namespace)
            or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}", filename)):
        raise HTTPException(400, detail="ASSET_PATH_INVALID")
    directory = (root / namespace).resolve()
    if not directory.is_relative_to(root.resolve()):
        raise HTTPException(400, detail="ASSET_PATH_INVALID")
    try:
        with security.sessions.begin() as session:
            key = security.verified_key(session, authorization, lock=True)
            if key.status != "active" or "pinterest" not in key.crawlers:
                raise HTTPException(403, detail="ASSET_PERMISSION_DENIED")
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            expiry = task.lease_expires_at if task else None
            if expiry and expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if (task is None or task.assigned_client_id != key.agent_id or task.lease_id != lease_id
                    or task.status not in {"leased", "running"} or expiry is None or expiry <= utc_now()):
                raise HTTPException(403, detail="ASSET_LEASE_DENIED")
            job = session.get(CrawlJob, task.job_id)
            if not job or str((job.settings or {}).get("channel", "amazon")) != "pinterest":
                raise HTTPException(403, detail="ASSET_JOB_DENIED")
            if session.bind.dialect.name == "postgresql":
                session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:name, 0))"), {"name": "asset:" + namespace})
            owner = session.get(AgentAssetNamespace, namespace)
            if owner is None:
                # Existing legacy folders are not proof of ownership. Keep them intact.
                existing_job = session.get(CrawlJob, namespace)
                if directory.exists() or (existing_job is not None and existing_job.id != task.job_id):
                    raise HTTPException(409, detail="ASSET_NAMESPACE_REQUIRES_OPERATOR_BINDING")
                session.add(AgentAssetNamespace(name=namespace, task_id=task.id))
                session.flush()
            elif owner.task_id != task.id:
                raise HTTPException(403, detail="ASSET_NAMESPACE_OWNED_BY_ANOTHER_TASK")
            directory.mkdir(parents=True, exist_ok=True)
            temporary = directory / (".upload-" + uuid.uuid4().hex + ".part")
            try:
                with temporary.open("xb") as stream:
                    stream.write(body)
                    stream.flush()
                    os.fsync(stream.fileno())
                temporary.replace(directory / filename)
            finally:
                temporary.unlink(missing_ok=True)
    except IntegrityError:
        raise HTTPException(409, detail="ASSET_NAMESPACE_CONFLICT") from None
