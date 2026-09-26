"""Transactional scheduling and persistence for the crawler coordinator."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import Counter
from datetime import timedelta
from threading import Lock
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import selectinload

from ..crawler_core import CrawlSettings, normalize_amazon_input
from .coordinator_models import (
    ClientRecord,
    CoordinatorState,
    CrawlJobControl,
    DeletedCrawlJob,
    CrawlJob,
    CrawlProductItem,
    CrawlTask,
    InvalidJobInput,
    JobStopClientCleanup,
    JobEvent,
    ShopifyOperationIdempotency,
    ShopifyProductLink,
    TaskAttempt,
    TaskResult,
)
from .protocol import CLIENT_OFFLINE_SECONDS, LEASE_SECONDS, MAX_CRAWL_FAILURES, settings_fingerprint, utc_iso, utc_now


TERMINAL_TASK_STATUSES = {"completed", "failed", "cancelled"}
TERMINAL_PRODUCT_STATUSES = {"completed", "failed", "reconciliation_required", "cancelled", "rejected", "deleted"}
ACTIVE_PRODUCT_STATUSES = {
    "received", "normalizing", "seo", "image_processing", "syncing",
    "shopify_writing", "stopping_after_write", "retry_wait", "sync_queued",
}
SEO_READY_PRODUCT_STATUSES = {
    "waiting_review", "sync_queued", "syncing", "shopify_writing",
    "stopping_after_write", "completed", "rejected", "reconciliation_required", "deleted",
}
CANCELLABLE_PRODUCT_STATUSES = ACTIVE_PRODUCT_STATUSES | {"cancelling"}
CANCELLATION_UNCONFIRMED_ATTEMPT_STATUSES = {
    "cancelled_unconfirmed",
    "cancelled_received_unconfirmed",
}
CANCELLATION_PENDING_ATTEMPT_STATUSES = {
    "cancelling",
    "cancelling_received",
    *CANCELLATION_UNCONFIRMED_ATTEMPT_STATUSES,
}
TOMBSTONE_RETENTION_DAYS = 30
ACTIVE_JOB_STATUSES = {"queued", "running", "cancelling"}
CACHE_GENERATION_KEY = "agent_cache_generation"


class ActiveJobExistsError(RuntimeError):
    def __init__(self, job_id: str) -> None:
        super().__init__(f"Crawl job {job_id} is still active.")
        self.job_id = job_id


def _id() -> str:
    return uuid.uuid4().hex


def _as_utc(value):
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=utc_now().tzinfo)


def _source_key(product: dict[str, Any]) -> str:
    explicit = str(product.get("sourceKey") or "").strip()
    if explicit:
        return explicit
    split = product.get("splitContext") if isinstance(product.get("splitContext"), dict) else {}
    parent_asin = str(product.get("parentAsin") or "unknown").strip().upper()
    attribute = str(split.get("attribute") or "none").strip().casefold()
    value = str(split.get("value") or "none").strip().casefold()
    return f"amazon:{parent_asin}:{attribute}:{value}"


def _shopify_sync_request_id(source_key: str) -> str:
    digest = hashlib.sha256(source_key.encode("utf-8")).hexdigest()
    return f"product-sync:{digest}"


def _shopify_sync_lock_key(store_id: str, source_key: str) -> int:
    digest = hashlib.sha256(f"{store_id}\0{source_key}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


class CoordinatorStore:
    def __init__(self, session_factory) -> None:
        self.sessions = session_factory
        self._product_claim_lock = Lock()
        self._job_creation_lock = Lock()

    @staticmethod
    def _event(session, job_id: str, event_type: str, payload: dict[str, Any]) -> None:
        session.add(JobEvent(job_id=job_id, event_type=event_type, payload=payload))

    @staticmethod
    def _refresh_job(session, job_id: str) -> None:
        job = session.get(CrawlJob, job_id)
        if job is None:
            return
        statuses = Counter(session.scalars(select(CrawlTask.status).where(CrawlTask.job_id == job_id)).all())
        total = sum(statuses.values())
        if job.status == "cancelled":
            return
        if job.status == "cancelling":
            pending_tasks = session.scalar(select(func.count(CrawlTask.id)).where(
                CrawlTask.job_id == job_id,
                CrawlTask.status == "cancelling",
            )) or 0
            pending_products = session.scalar(select(func.count(CrawlProductItem.id)).where(
                CrawlProductItem.job_id == job_id,
                CrawlProductItem.status.in_(["cancelling", "stopping_after_write"]),
            )) or 0
            pending_attempts = session.scalar(
                select(func.count(TaskAttempt.id))
                .join(CrawlTask, TaskAttempt.task_id == CrawlTask.id)
                .where(
                    CrawlTask.job_id == job_id,
                    TaskAttempt.status.in_(CANCELLATION_PENDING_ATTEMPT_STATUSES),
                )
            ) or 0
            pending_cleanups = session.scalar(select(func.count(JobStopClientCleanup.id)).where(
                JobStopClientCleanup.job_id == job_id,
                JobStopClientCleanup.status == "pending",
            )) or 0
            if not pending_tasks and not pending_products and not pending_attempts and not pending_cleanups:
                job.status = "cancelled"
                job.completed_at = utc_now()
                control = session.get(CrawlJobControl, job_id)
                if control is not None:
                    control.state = "cancelled"
                    control.cancelled_at = job.completed_at
            return
        if total == 0:
            job.status = "partial" if job.rejected_inputs else "completed"
            job.completed_at = utc_now()
        elif statuses.get("completed", 0) + statuses.get("failed", 0) + statuses.get("cancelled", 0) == total:
            product_statuses = Counter(session.scalars(
                select(CrawlProductItem.status).where(CrawlProductItem.job_id == job_id)
            ).all())
            has_review_work = any(
                product_statuses.get(status, 0)
                for status in {"waiting_review", "sync_queued"}
            )
            has_pre_review_work = any(
                product_statuses.get(status, 0)
                for status in {"received", "normalizing", "seo", "image_processing", "retry_wait"}
            )
            if has_pre_review_work:
                job.status = "running"
                job.started_at = job.started_at or utc_now()
                job.completed_at = None
            elif has_review_work:
                job.status = "review_pending"
                job.started_at = job.started_at or utc_now()
                job.completed_at = utc_now()
            elif any(product_statuses.get(status, 0) for status in ACTIVE_PRODUCT_STATUSES):
                job.status = "running"
                job.started_at = job.started_at or utc_now()
                job.completed_at = None
            else:
                product_failed = any(
                    product_statuses.get(status, 0)
                    for status in {"failed", "reconciliation_required", "cancelled", "rejected"}
                )
                job.status = "partial" if statuses.get("failed", 0) or job.rejected_inputs or product_failed else "completed"
                job.completed_at = utc_now()
        elif statuses.get("leased", 0) or statuses.get("running", 0) or statuses.get("completed", 0):
            job.status = "running"
            job.started_at = job.started_at or utc_now()
        else:
            job.status = "queued"

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw_urls = payload.get("urls")
        if not isinstance(raw_urls, list) or not raw_urls or not all(isinstance(value, str) for value in raw_urls):
            raise ValueError("urls must be a non-empty array of strings.")
        if len(raw_urls) > 200:
            raise ValueError("A job may contain at most 200 inputs.")
        settings = CrawlSettings.from_api(payload).api_dict()
        external_request_id = str(payload.get("externalRequestId") or "").strip() or None
        with self._job_creation_lock, self.sessions.begin() as session:
            if external_request_id:
                existing = session.scalar(select(CrawlJob).where(CrawlJob.external_request_id == external_request_id))
                if existing is not None:
                    return self._job_snapshot(session, existing)
            active_job_id = session.scalar(
                select(CrawlJob.id)
                .where(CrawlJob.status.in_(ACTIVE_JOB_STATUSES))
                .order_by(CrawlJob.created_at)
                .limit(1)
            )
            if active_job_id:
                raise ActiveJobExistsError(str(active_job_id))
            job = CrawlJob(
                id=_id(),
                external_request_id=external_request_id,
                status="queued",
                settings=settings,
                requested_inputs=len(raw_urls),
            )
            session.add(job)
            session.add(CrawlJobControl(
                job_id=job.id,
                state="active",
                priority=max(0, min(100, int(payload.get("schedulerPriority") or 0))),
                replacement_of_job_id=str(payload.get("replacementOfJobId") or "").strip() or None,
            ))
            seen_asins: set[str] = set()
            accepted = 0
            rejected = 0
            for ordinal, source in enumerate(raw_urls):
                try:
                    normalized = normalize_amazon_input(source)
                    if normalized.asin in seen_asins:
                        continue
                    seen_asins.add(normalized.asin)
                    session.add(CrawlTask(
                        id=_id(), job_id=job.id, ordinal=ordinal, source=source,
                        asin=normalized.asin, canonical_url=normalized.canonical_url, status="queued",
                    ))
                    accepted += 1
                except ValueError as error:
                    session.add(InvalidJobInput(
                        id=_id(), job_id=job.id, ordinal=ordinal, source=source, message=str(error),
                    ))
                    rejected += 1
            job.accepted_inputs = accepted
            job.rejected_inputs = rejected
            self._event(session, job.id, "job_created", {"accepted": accepted, "rejected": rejected})
            self._refresh_job(session, job.id)
            return self._job_snapshot(session, job)

    @staticmethod
    def _cache_generation(session) -> int:
        state = session.get(CoordinatorState, CACHE_GENERATION_KEY)
        if state is None:
            return 0
        try:
            return max(0, int(state.value))
        except ValueError:
            return 0

    @classmethod
    def _next_cache_generation(cls, session) -> int:
        generation = cls._cache_generation(session) + 1
        state = session.get(CoordinatorState, CACHE_GENERATION_KEY)
        if state is None:
            session.add(CoordinatorState(key=CACHE_GENERATION_KEY, value=str(generation)))
        else:
            state.value = str(generation)
        return generation

    def current_cache_generation(self) -> int:
        with self.sessions() as session:
            return self._cache_generation(session)

    def register_client(self, hello: dict[str, Any]) -> dict[str, Any]:
        client_id = str(hello.get("clientId") or "").strip()
        if not client_id:
            raise ValueError("clientId is required.")
        now = utc_now()
        with self.sessions.begin() as session:
            client = session.get(ClientRecord, client_id)
            if client is None:
                client = ClientRecord(id=client_id, display_name=str(hello.get("displayName") or client_id))
                session.add(client)
            client.display_name = str(hello.get("displayName") or client.display_name)
            client.status = "online"
            client.agent_version = str(hello.get("agentVersion") or "unknown")
            client.protocol_version = str(hello.get("protocolVersion") or "unknown")
            client.max_concurrent_inputs = max(
                1,
                min(32, int(hello.get("maxConcurrentInputs") or hello.get("availableSlots") or 1)),
            )
            client.capabilities = dict(hello.get("capabilities") or {})
            client.limits = dict(hello.get("limits") or {})
            client.connected_at = now
            client.last_seen_at = now
            return self._client_snapshot(client)

    def heartbeat(self, client_id: str, running: list[dict[str, Any]], status: str = "online") -> list[str]:
        now = utc_now()
        lease_until = now + timedelta(seconds=LEASE_SECONDS)
        cancelled_job_ids: set[str] = set()
        active_leases = {
            (str(active.get("taskId") or ""), str(active.get("leaseId") or ""))
            for active in running
            if isinstance(active, dict)
        }
        with self.sessions.begin() as session:
            client = session.get(ClientRecord, client_id)
            if client is None:
                return []
            client.status = status if status in {"online", "busy", "waiting_captcha", "paused"} else "online"
            client.last_seen_at = now
            for active in running:
                task_id = str(active.get("taskId") or "")
                lease_id = str(active.get("leaseId") or "")
                task = session.get(CrawlTask, task_id)
                if task and task.lease_id == lease_id and task.assigned_client_id == client_id and task.status in {"leased", "running"}:
                    task.status = "running"
                    task.lease_expires_at = lease_until
                elif (
                    task
                    and task.status in {"cancelling", "cancelled"}
                    and task.lease_id == lease_id
                    and task.assigned_client_id == client_id
                ):
                    cancelled_job_ids.add(task.job_id)
            released_job_ids: set[str] = set()
            unconfirmed_attempts = session.execute(
                select(TaskAttempt, CrawlTask.job_id)
                .join(CrawlTask, TaskAttempt.task_id == CrawlTask.id)
                .where(
                    TaskAttempt.client_id == client_id,
                    TaskAttempt.status.in_(CANCELLATION_UNCONFIRMED_ATTEMPT_STATUSES),
                    CrawlTask.status == "cancelled",
                )
            ).all()
            for attempt, job_id in unconfirmed_attempts:
                if (attempt.task_id, attempt.lease_id) in active_leases:
                    continue
                attempt.status = "cancelled"
                attempt.finished_at = attempt.finished_at or now
                released_job_ids.add(job_id)
                self._event(session, job_id, "task_cancel_confirmed_by_heartbeat", {
                    "taskId": attempt.task_id,
                    "clientId": client_id,
                })
            for job_id in released_job_ids:
                self._refresh_job(session, job_id)
        return sorted(cancelled_job_ids)

    def mark_client_disconnected(self, client_id: str) -> None:
        with self.sessions.begin() as session:
            client = session.get(ClientRecord, client_id)
            if client is not None:
                client.status = "offline"
            now = utc_now()
            job_ids = set(session.scalars(select(JobStopClientCleanup.job_id).where(
                JobStopClientCleanup.client_id == client_id,
                JobStopClientCleanup.status == "pending",
            )).all())
            session.execute(
                JobStopClientCleanup.__table__.update()
                .where(
                    JobStopClientCleanup.client_id == client_id,
                    JobStopClientCleanup.status == "pending",
                )
                .values(status="offline", updated_at=now)
            )
            for task in session.scalars(select(CrawlTask).where(
                CrawlTask.assigned_client_id == client_id,
                CrawlTask.status == "cancelling",
            )):
                task.status = "cancelled"
                task.completed_at = now
                task.lease_expires_at = None
                job_ids.add(task.job_id)
                if task.lease_id:
                    attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == task.lease_id))
                    if attempt is not None:
                        attempt.status = "cancelled"
                        attempt.finished_at = now
            for job_id in job_ids:
                self._refresh_job(session, job_id)

    def lease_tasks(self, client_id: str, available_slots: int) -> list[dict[str, Any]]:
        count = max(0, min(32, int(available_slots)))
        if count == 0:
            return []
        now = utc_now()
        leases: list[dict[str, Any]] = []
        with self.sessions.begin() as session:
            client = session.get(ClientRecord, client_id)
            if client is None or client.status == "paused":
                return []
            active_count = session.scalar(
                select(func.count(CrawlTask.id)).where(
                    CrawlTask.assigned_client_id == client_id,
                    CrawlTask.status.in_(["leased", "running", "cancelling"]),
                )
            ) or 0
            count = min(count, max(0, client.max_concurrent_inputs - int(active_count)))
            if count == 0:
                return []
            tasks = session.scalars(
                select(CrawlTask)
                .join(CrawlJob, CrawlTask.job_id == CrawlJob.id)
                .outerjoin(CrawlJobControl, CrawlJobControl.job_id == CrawlJob.id)
                .where(CrawlTask.status == "queued", CrawlJob.status.in_(["queued", "running"]))
                .order_by(func.coalesce(CrawlJobControl.priority, 0).desc(), CrawlJob.created_at, CrawlTask.ordinal)
                .limit(count)
                .with_for_update(skip_locked=True)
            ).all()
            for task in tasks:
                lease_id = _id()
                task.status = "leased"
                task.assigned_client_id = client_id
                task.lease_id = lease_id
                task.lease_expires_at = now + timedelta(seconds=LEASE_SECONDS)
                task.started_at = task.started_at or now
                attempt = TaskAttempt(
                    id=_id(), task_id=task.id, client_id=client_id,
                    lease_id=lease_id, status="leased", leased_at=now,
                )
                session.add(attempt)
                self._refresh_job(session, task.job_id)
                job = session.get(CrawlJob, task.job_id)
                leases.append({
                    "type": "assignment",
                    "taskId": task.id,
                    "jobId": task.job_id,
                    "leaseId": lease_id,
                    "source": task.source,
                    "asin": task.asin,
                    "url": task.canonical_url,
                    "settings": dict(job.settings if job else {}),
                    "settingsFingerprint": settings_fingerprint(dict(job.settings if job else {})),
                    "leaseExpiresAt": utc_iso(task.lease_expires_at),
                })
                self._event(session, task.job_id, "task_leased", {"taskId": task.id, "clientId": client_id})
            if leases:
                client.status = "busy"
                client.last_seen_at = now
        return leases

    def update_progress(self, client_id: str, payload: dict[str, Any]) -> None:
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, task_id)
            if task is None:
                return
            # Progress messages travel over WebSocket while results use a separate
            # HTTP request, so an already-buffered progress message can arrive
            # after the result transaction commits. A persisted result is the
            # source of truth and must never be reopened by late progress.
            if task.result is not None:
                task.status = "completed"
                task.completed_at = task.completed_at or task.result.received_at
                task.lease_expires_at = None
                self._refresh_job(session, task.job_id)
                return
            if task.status in TERMINAL_TASK_STATUSES or task.status == "cancelling":
                return
            if task.assigned_client_id != client_id or task.lease_id != lease_id:
                return
            task.status = "running"
            task.lease_expires_at = utc_now() + timedelta(seconds=LEASE_SECONDS)
            self._event(session, task.job_id, "task_progress", {
                "taskId": task.id, "clientId": client_id, "progress": payload.get("progress") or {},
            })

    def fail_task(self, client_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        error = payload.get("error") if isinstance(payload.get("error"), dict) else {"message": str(payload.get("error") or "Unknown crawler error")}
        retryable = bool(error.get("retryable", True))
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, task_id)
            if task is None:
                return {"status": "missing"}
            if task.status in TERMINAL_TASK_STATUSES or task.status == "cancelling":
                if task.status == "cancelling":
                    return {"status": "cancelled"}
                return {"status": "duplicate"}
            if task.assigned_client_id != client_id or task.lease_id != lease_id:
                return {"status": "stale"}
            task.failure_count += 1
            task.last_error = error
            task.status = "queued" if retryable and task.failure_count < MAX_CRAWL_FAILURES else "failed"
            if task.status == "failed":
                task.completed_at = utc_now()
            attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == lease_id))
            if attempt:
                attempt.status = "failed"
                attempt.error = error
                attempt.finished_at = utc_now()
            task.assigned_client_id = None
            task.lease_id = None
            task.lease_expires_at = None
            self._event(session, task.job_id, "task_failed", {"taskId": task.id, "retry": task.status == "queued", "error": error})
            self._refresh_job(session, task.job_id)
            return {"status": task.status, "failureCount": task.failure_count}

    def accept_result(self, task_id: str, client_id: str, lease_id: str, checksum: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.sessions.begin() as session:
            task = session.scalar(
                select(CrawlTask).where(CrawlTask.id == task_id).with_for_update()
            )
            if task is None:
                return {"status": "missing"}
            if task.status == "completed" or task.result is not None:
                return {"status": "duplicate", "taskId": task.id}
            if task.status in {"cancelling", "cancelled"}:
                return {"status": "cancelled", "taskId": task.id}
            attempt = session.scalar(select(TaskAttempt).where(
                TaskAttempt.task_id == task.id,
                TaskAttempt.client_id == client_id,
                TaskAttempt.lease_id == lease_id,
            ))
            if attempt is None:
                return {"status": "stale", "taskId": task.id}
            if str(payload.get("jobId") or "") != task.job_id:
                return {"status": "invalid", "taskId": task.id, "reason": "job_identity"}
            products = payload.get("products") if isinstance(payload.get("products"), list) else []
            retained_products: list[Any] = []
            for product in products:
                if isinstance(product, dict) and product.get("id"):
                    item, _created = self._upsert_product_item(
                        session,
                        task=task,
                        client_id=client_id,
                        lease_id=lease_id,
                        product=product,
                        checksum=str(product.get("productChecksum") or ""),
                    )
                    if item.status != "completed":
                        retained_products.append(product)
                else:
                    retained_products.append(product)
            stored_payload = dict(payload)
            stored_payload["products"] = retained_products
            session.add(TaskResult(
                task_id=task.id, client_id=client_id, lease_id=lease_id,
                checksum=checksum, payload=stored_payload,
            ))
            task.status = "completed"
            task.completed_at = utc_now()
            task.assigned_client_id = client_id
            task.lease_id = lease_id
            task.lease_expires_at = None
            attempt.status = "completed"
            attempt.finished_at = utc_now()
            self._event(session, task.job_id, "task_completed", {"taskId": task.id, "clientId": client_id})
            self._refresh_job(session, task.job_id)
            return {"status": "accepted", "taskId": task.id}

    @staticmethod
    def _upsert_product_item(
        session,
        *,
        task: CrawlTask,
        client_id: str,
        lease_id: str,
        product: dict[str, Any],
        checksum: str,
    ) -> tuple[CrawlProductItem, bool]:
        source_key = _source_key(product)
        existing = session.scalar(select(CrawlProductItem).where(
            CrawlProductItem.job_id == task.job_id,
            CrawlProductItem.source_key == source_key,
        ))
        product_checksum = checksum or hashlib.sha256(
            json.dumps(product, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        if existing is not None:
            return existing, False
        item = CrawlProductItem(
            id=_id(),
            job_id=task.job_id,
            task_id=task.id,
            source_key=source_key,
            product_id=str(product.get("id") or source_key),
            client_id=client_id,
            lease_id=lease_id,
            checksum=product_checksum,
            raw_payload=product,
            status="received",
        )
        session.add(item)
        session.flush()
        return item, True

    def accept_product(
        self,
        task_id: str,
        client_id: str,
        lease_id: str,
        product_key: str,
        checksum: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            if task is None:
                return {"status": "missing"}
            if task.status in {"cancelling", "cancelled"}:
                return {"status": "cancelled"}
            attempt = session.scalar(select(TaskAttempt).where(
                TaskAttempt.task_id == task.id,
                TaskAttempt.client_id == client_id,
                TaskAttempt.lease_id == lease_id,
            ))
            if attempt is None:
                return {"status": "stale"}
            if str(payload.get("jobId") or "") != task.job_id:
                return {"status": "invalid", "reason": "job_identity"}
            product = payload.get("product")
            if not isinstance(product, dict):
                return {"status": "invalid", "reason": "product_payload"}
            source_key = _source_key(product)
            if product_key not in {source_key, str(product.get("id") or "")}:
                return {"status": "invalid", "reason": "product_identity"}
            item, created = self._upsert_product_item(
                session,
                task=task,
                client_id=client_id,
                lease_id=lease_id,
                product=product,
                checksum=str(payload.get("productChecksum") or checksum),
            )
            if created:
                self._event(session, task.job_id, "product_received", {
                    "taskId": task.id,
                    "productItemId": item.id,
                    "sourceKey": item.source_key,
                    "productId": item.product_id,
                    "status": item.status,
                })
            self._refresh_job(session, task.job_id)
            return {
                "status": "accepted" if created else "duplicate",
                "productItemId": item.id,
                "sourceKey": item.source_key,
            }

    def claim_product_items(
        self,
        *,
        worker_id: str,
        store_id: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        now = utc_now()
        claim_until = now + timedelta(seconds=90)
        count = max(1, min(20, int(limit)))
        claimed: list[dict[str, Any]] = []
        with self._product_claim_lock, self.sessions.begin() as session:
            candidates = session.scalars(
                select(CrawlProductItem)
                .where(
                    (
                        CrawlProductItem.status == "received"
                    ) | (
                        (CrawlProductItem.status == "retry_wait")
                        & (CrawlProductItem.next_attempt_at <= now)
                    ) | (
                        CrawlProductItem.status == "sync_queued"
                    ) | (
                        CrawlProductItem.status.in_(["normalizing", "seo", "image_processing", "syncing"])
                        & (CrawlProductItem.claim_expires_at < now)
                    )
                )
                .order_by(CrawlProductItem.created_at)
                .limit(min(100, count * 10))
                .with_for_update(skip_locked=True)
            ).all()
            dialect_name = session.get_bind().dialect.name
            if dialect_name == "postgresql":
                candidates.sort(key=lambda candidate: _shopify_sync_lock_key(store_id, candidate.source_key))
            for item in candidates:
                if len(claimed) >= count:
                    break
                job = session.get(CrawlJob, item.job_id)
                job_settings = dict(job.settings) if job is not None and isinstance(job.settings, dict) else {}
                effective_store = str(job_settings.get("storeId") or "").strip() or store_id
                pipeline_result = dict(item.shopify_result or {})
                review = dict(pipeline_result.get("review") or {})
                is_sync_claim = item.status == "sync_queued" or (
                    item.status == "syncing" and bool(review)
                )
                if is_sync_claim:
                    if dialect_name == "postgresql":
                        session.execute(
                            text("SELECT pg_advisory_xact_lock(:lock_key)"),
                            {"lock_key": _shopify_sync_lock_key(effective_store, item.source_key)},
                        )
                    request_id = _shopify_sync_request_id(item.source_key)
                    operation = session.scalar(
                        select(ShopifyOperationIdempotency)
                        .where(
                            ShopifyOperationIdempotency.store_id == effective_store,
                            ShopifyOperationIdempotency.request_id == request_id,
                        )
                        .with_for_update()
                    )
                    operation_owner = (
                        str((operation.response_payload or {}).get("itemId") or "")
                        if operation is not None
                        else ""
                    )
                    if operation is not None and operation.state == "pending" and operation_owner != item.id:
                        continue
                    if operation is None:
                        operation = ShopifyOperationIdempotency(
                            id=_id(),
                            store_id=effective_store,
                            request_id=request_id,
                            operation="product.sync",
                            payload_hash=item.checksum,
                            state="pending",
                            response_payload={"itemId": item.id, "sourceKey": item.source_key},
                        )
                        session.add(operation)
                    else:
                        operation.operation = "product.sync"
                        operation.payload_hash = item.checksum
                        operation.state = "pending"
                        operation.response_payload = {"itemId": item.id, "sourceKey": item.source_key}
                item.status = "syncing" if is_sync_claim else "normalizing"
                item.claimed_by = worker_id
                item.claim_expires_at = claim_until
                item.attempt_count += 1
                link = session.scalar(select(ShopifyProductLink).where(
                    ShopifyProductLink.store_id == effective_store,
                    ShopifyProductLink.source_key == item.source_key,
                ))
                task = session.get(CrawlTask, item.task_id)
                if task is None:
                    raise RuntimeError(f"Crawl task {item.task_id} is missing for product item {item.id}.")
                claimed.append({
                    "id": item.id,
                    "jobId": item.job_id,
                    "taskId": item.task_id,
                    "sourceKey": item.source_key,
                    "productId": item.product_id,
                    "checksum": item.checksum,
                    "attempt": item.attempt_count,
                    "stage": "sync" if is_sync_claim else "prepare",
                    "inputAsin": task.asin,
                    "product": item.normalized_payload if is_sync_claim else item.raw_payload,
                    "settings": job_settings,
                    "review": review if is_sync_claim else None,
                    "existingShopify": None if link is None else {
                        "productId": link.shopify_product_id,
                        "productHandle": link.shopify_product_handle,
                        "normalizedChecksum": link.normalized_checksum,
                        "managedResources": link.managed_resources,
                    },
                })
                self._event(session, item.job_id, "product_sync_claimed" if is_sync_claim else "product_normalizing", {
                    "productItemId": item.id,
                    "sourceKey": item.source_key,
                    "attempt": item.attempt_count,
                })
                self._refresh_job(session, item.job_id)
        return claimed

    def mark_product_review_ready(
        self,
        item_id: str,
        *,
        worker_id: str,
        normalized_payload: dict[str, Any],
        seo_summary: dict[str, Any],
        image_summary: dict[str, Any],
        review_summary: dict[str, Any],
    ) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status != "image_processing":
                return False
            current = dict(item.shopify_result or {})
            current["seo"] = seo_summary
            current["imageProcessing"] = image_summary
            current["review"] = {
                **review_summary,
                "decision": "pending",
                "syncStatus": "idle",
                "version": 1,
                "rejectionReason": None,
                "syncError": None,
                "readyAt": utc_iso(utc_now()),
                "updatedAt": utc_iso(utc_now()),
            }
            item.normalized_payload = normalized_payload
            item.shopify_result = current
            item.status = "waiting_review"
            item.claimed_by = None
            item.claim_expires_at = None
            item.next_attempt_at = None
            item.completed_at = None
            self._event(session, item.job_id, "product_review_ready", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "review": current["review"],
            })
            self._refresh_job(session, item.job_id)
            return True

    @staticmethod
    def _review_snapshot(item: CrawlProductItem, job: CrawlJob | None) -> dict[str, Any]:
        pipeline_result = dict(item.shopify_result or {})
        review = dict(pipeline_result.get("review") or {})
        product = CoordinatorStore._product_pipeline_snapshot(item)
        settings = dict(job.settings or {}) if job is not None and isinstance(job.settings, dict) else {}
        return {
            "id": item.id,
            "jobId": item.job_id,
            "sourceKey": item.source_key,
            "storeId": str(review.get("storeId") or settings.get("storeId") or ""),
            "decision": str(review.get("decision") or "pending"),
            "syncStatus": str(review.get("syncStatus") or "idle"),
            "version": int(review.get("version") or 1),
            "rejectionReason": review.get("rejectionReason"),
            "syncError": review.get("syncError"),
            "readyAt": review.get("readyAt"),
            "updatedAt": review.get("updatedAt"),
            "target": {
                "collectionIds": list(settings.get("collectionIds") or ([settings["collectionId"]] if settings.get("collectionId") else [])),
                "productType": settings.get("productType"),
                "priceAddition": float(settings.get("priceAddition") or 0),
                "discountPercent": float(settings.get("discountPercent") or 0),
            },
            "product": product,
        }

    def list_product_reviews(self) -> list[dict[str, Any]]:
        with self.sessions() as session:
            items = session.scalars(
                select(CrawlProductItem)
                .where(CrawlProductItem.status.in_([
                    "waiting_review", "sync_queued", "syncing", "shopify_writing", "completed", "failed", "rejected",
                    "reconciliation_required",
                ]))
                .order_by(CrawlProductItem.updated_at.desc())
            ).all()
            result: list[dict[str, Any]] = []
            for item in items:
                review = dict((item.shopify_result or {}).get("review") or {})
                if review:
                    result.append(self._review_snapshot(item, session.get(CrawlJob, item.job_id)))
            return result

    def delete_all_product_reviews(self) -> dict[str, int]:
        deleted = 0
        skipped = 0
        job_ids: set[str] = set()
        with self.sessions.begin() as session:
            items = session.scalars(
                select(CrawlProductItem)
                .where(CrawlProductItem.status != "deleted")
                .with_for_update(skip_locked=True)
            ).all()
            for item in items:
                pipeline_result = dict(item.shopify_result or {})
                review = dict(pipeline_result.get("review") or {})
                if not review:
                    continue
                if item.status not in {"waiting_review", "rejected", "completed", "failed"}:
                    skipped += 1
                    continue
                review["deletedAt"] = utc_iso(utc_now())
                review["version"] = int(review.get("version") or 1) + 1
                pipeline_result["review"] = review
                item.shopify_result = pipeline_result
                item.status = "deleted"
                item.completed_at = utc_now()
                job_ids.add(item.job_id)
                deleted += 1
                self._event(session, item.job_id, "product_review_deleted", {"productItemId": item.id})
            for job_id in job_ids:
                self._refresh_job(session, job_id)
        return {"deleted": deleted, "skipped": skipped}

    def review_image_tokens(self) -> set[str]:
        """Return processed image tokens that still belong to unsynced reviews."""
        with self.sessions() as session:
            items = session.scalars(
                select(CrawlProductItem).where(CrawlProductItem.status.in_([
                    "waiting_review", "sync_queued", "syncing", "shopify_writing", "failed", "rejected",
                    "reconciliation_required",
                ]))
            ).all()
            tokens: set[str] = set()
            for item in items:
                review = dict((item.shopify_result or {}).get("review") or {})
                if not review or str(review.get("syncStatus") or "idle") == "synced":
                    continue
                product = dict(item.normalized_payload or {})
                for media in product.get("media") or []:
                    if not isinstance(media, dict):
                        continue
                    token = str(media.get("processedFileToken") or "")
                    if token:
                        tokens.add(token)
            return tokens

    def update_product_review(
        self,
        item_id: str,
        *,
        expected_version: int,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.id == item_id).with_for_update())
            if item is None:
                return None
            if item.status == "deleted":
                return {"deleted": True}
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            if not review or int(review.get("version") or 1) != expected_version:
                return {"conflict": True}
            if str(review.get("syncStatus") or "idle") in {"queued", "syncing"}:
                return {"locked": True}
            product = dict(item.normalized_payload or {})
            field_map = {
                "productTitle": "title",
                "productDescription": "descriptionHtml",
                "handle": "handle",
            }
            for public_name, product_name in field_map.items():
                if public_name in patch and isinstance(patch[public_name], str):
                    product[product_name] = patch[public_name].strip()
            seo = dict(product.get("seo") or {})
            if isinstance(patch.get("seoTitle"), str):
                seo["title"] = patch["seoTitle"].strip()
            if isinstance(patch.get("seoDescription"), str):
                seo["description"] = patch["seoDescription"].strip()
            product["seo"] = seo
            image_alts = patch.get("imageAlts")
            if isinstance(image_alts, list):
                alt_by_id = {
                    str(entry.get("id") or entry.get("url") or ""): str(entry.get("alt") or "").strip()
                    for entry in image_alts if isinstance(entry, dict)
                }
                media = []
                for index, raw_media in enumerate(product.get("media") or []):
                    if not isinstance(raw_media, dict):
                        media.append(raw_media)
                        continue
                    key = str(raw_media.get("id") or raw_media.get("url") or index)
                    media.append({**raw_media, **({"alt": alt_by_id[key]} if key in alt_by_id else {})})
                product["media"] = media
            review.update({
                "decision": "pending",
                "rejectionReason": None,
                "syncError": None,
                "syncStatus": "idle",
                "version": expected_version + 1,
                "updatedAt": utc_iso(utc_now()),
            })
            item.normalized_payload = product
            item.status = "waiting_review"
            item.checksum = hashlib.sha256(json.dumps(product, sort_keys=True).encode("utf-8")).hexdigest()
            pipeline_result["review"] = review
            item.shopify_result = pipeline_result
            self._event(session, item.job_id, "product_review_updated", {
                "productItemId": item.id,
                "version": review["version"],
            })
            self._refresh_job(session, item.job_id)
            return self._review_snapshot(item, session.get(CrawlJob, item.job_id))

    def decide_product_review(
        self,
        item_id: str,
        *,
        expected_version: int,
        decision: str,
        reason: str | None,
    ) -> dict[str, Any] | None:
        if decision not in {"pending", "approved", "rejected"}:
            raise ValueError("decision must be pending, approved, or rejected.")
        with self.sessions.begin() as session:
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.id == item_id).with_for_update())
            if item is None:
                return None
            if item.status == "deleted":
                return {"deleted": True}
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            if not review or int(review.get("version") or 1) != expected_version:
                return {"conflict": True}
            if str(review.get("syncStatus") or "idle") in {"queued", "syncing"}:
                return {"locked": True}
            review.update({
                "decision": decision,
                "rejectionReason": reason.strip() if decision == "rejected" and reason else None,
                "version": expected_version + 1,
                "updatedAt": utc_iso(utc_now()),
            })
            item.status = "rejected" if decision == "rejected" else "waiting_review"
            item.completed_at = utc_now() if decision == "rejected" else None
            pipeline_result["review"] = review
            item.shopify_result = pipeline_result
            self._event(session, item.job_id, "product_review_decided", {
                "productItemId": item.id,
                "decision": decision,
                "version": review["version"],
            })
            self._refresh_job(session, item.job_id)
            return self._review_snapshot(item, session.get(CrawlJob, item.job_id))

    def queue_product_review_sync(self, item_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.id == item_id).with_for_update())
            if item is None:
                return None
            if item.status == "deleted":
                return {"deleted": True}
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            if str(review.get("decision") or "pending") != "approved":
                return {"notApproved": True}
            if item.status == "reconciliation_required":
                return {"reconciliationRequired": True}
            if str(review.get("syncStatus") or "idle") in {"queued", "syncing"}:
                return self._review_snapshot(item, session.get(CrawlJob, item.job_id))
            review.update({
                "syncStatus": "queued",
                "syncError": None,
                "updatedAt": utc_iso(utc_now()),
            })
            pipeline_result["review"] = review
            item.shopify_result = pipeline_result
            item.status = "sync_queued"
            item.completed_at = None
            self._event(session, item.job_id, "product_review_sync_queued", {"productItemId": item.id})
            self._refresh_job(session, item.job_id)
            return self._review_snapshot(item, session.get(CrawlJob, item.job_id))

    def queue_all_approved_reviews(self) -> list[str]:
        queued: list[str] = []
        with self.sessions.begin() as session:
            items = session.scalars(
                select(CrawlProductItem)
                .where(CrawlProductItem.status.in_(["waiting_review", "rejected", "failed", "reconciliation_required"]))
                .with_for_update(skip_locked=True)
            ).all()
            job_ids: set[str] = set()
            for item in items:
                pipeline_result = dict(item.shopify_result or {})
                review = dict(pipeline_result.get("review") or {})
                if str(review.get("decision") or "pending") != "approved":
                    continue
                if str(review.get("syncStatus") or "idle") not in {"idle", "failed"}:
                    continue
                review.update({"syncStatus": "queued", "syncError": None, "updatedAt": utc_iso(utc_now())})
                pipeline_result["review"] = review
                item.shopify_result = pipeline_result
                item.status = "sync_queued"
                item.completed_at = None
                queued.append(item.id)
                job_ids.add(item.job_id)
                self._event(session, item.job_id, "product_review_sync_queued", {"productItemId": item.id})
            for job_id in job_ids:
                self._refresh_job(session, job_id)
        return queued

    def mark_product_seo(
        self,
        item_id: str,
        *,
        worker_id: str,
        normalized_payload: dict[str, Any],
        seo_summary: dict[str, Any],
    ) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status != "normalizing":
                return False
            item.normalized_payload = normalized_payload
            item.shopify_result = {"seo": seo_summary}
            item.status = "seo"
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            self._event(session, item.job_id, "product_seo", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "seo": seo_summary,
            })
            self._refresh_job(session, item.job_id)
            return True

    def mark_product_syncing(
        self,
        item_id: str,
        *,
        worker_id: str,
        normalized_payload: dict[str, Any],
        proxy_profile: str,
        seo_summary: dict[str, Any] | None = None,
    ) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status not in {"normalizing", "seo", "image_processing", "syncing"}:
                return False
            item.normalized_payload = normalized_payload
            pipeline_result = dict(item.shopify_result or {})
            if seo_summary is not None:
                pipeline_result["seo"] = seo_summary
                item.shopify_result = pipeline_result
            item.proxy_profile = proxy_profile
            item.status = "syncing"
            review = dict(pipeline_result.get("review") or {})
            if review:
                review.update({"syncStatus": "syncing", "syncError": None, "updatedAt": utc_iso(utc_now())})
                pipeline_result["review"] = review
                item.shopify_result = pipeline_result
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            self._event(session, item.job_id, "product_syncing", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "proxyProfile": proxy_profile,
            })
            self._refresh_job(session, item.job_id)
            return True

    def heartbeat_product_item(self, item_id: str, *, worker_id: str) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status not in {"normalizing", "seo", "image_processing", "syncing"}:
                return False
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            return True

    def mark_shopify_write_started(self, item_id: str, *, worker_id: str) -> bool:
        """Durably cross the cancellation boundary before the first Shopify mutation."""
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status != "syncing":
                return False
            item.status = "shopify_writing"
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            self._event(session, item.job_id, "product_shopify_write_started", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "workerId": worker_id,
            })
            self._refresh_job(session, item.job_id)
            return True

    def mark_product_image_processing(
        self,
        item_id: str,
        *,
        worker_id: str,
        normalized_payload: dict[str, Any],
        image_summary: dict[str, Any],
    ) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status not in {"seo", "image_processing"}:
                return False
            item.normalized_payload = normalized_payload
            current = dict(item.shopify_result or {})
            current["imageProcessing"] = image_summary
            item.shopify_result = current
            item.status = "image_processing"
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            self._event(session, item.job_id, "product_image_processing", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "imageProcessing": image_summary,
            })
            self._refresh_job(session, item.job_id)
            return True

    def checkpoint_shopify_product(
        self,
        item_id: str,
        *,
        worker_id: str,
        store_id: str,
        normalized_checksum: str,
        shopify_result: dict[str, Any],
    ) -> bool | None:
        """Persist a confirmed Shopify write before SEO corpus registration completes."""
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if (
                item is None
                or item.claimed_by != worker_id
                or item.status not in {"syncing", "shopify_writing", "stopping_after_write"}
            ):
                return None
            was_stopping = item.status == "stopping_after_write"
            self._upsert_shopify_link(
                session,
                item=item,
                store_id=store_id,
                normalized_checksum=normalized_checksum,
                shopify_result=shopify_result,
            )
            pipeline_result = dict(item.shopify_result or {})
            pipeline_result.update(shopify_result)
            item.shopify_result = pipeline_result
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            self._event(session, item.job_id, "product_shopify_checkpointed", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "shopifyProductId": str(shopify_result.get("productId") or "") or None,
            })
            operation = session.scalar(select(ShopifyOperationIdempotency).where(
                ShopifyOperationIdempotency.store_id == store_id,
                ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(item.source_key),
            ))
            if operation is None:
                session.add(ShopifyOperationIdempotency(
                    id=_id(),
                    store_id=store_id,
                    request_id=_shopify_sync_request_id(item.source_key),
                    operation="product.sync",
                    payload_hash=normalized_checksum,
                    state="completed",
                    response_payload={
                        "itemId": item.id,
                        "sourceKey": item.source_key,
                        "productId": str(shopify_result.get("productId") or "") or None,
                    },
                ))
            else:
                operation.state = "completed"
                operation.response_payload = {
                    "itemId": item.id,
                    "sourceKey": item.source_key,
                    "productId": str(shopify_result.get("productId") or "") or None,
                }
            return was_stopping

    def complete_product_item(
        self,
        item_id: str,
        *,
        worker_id: str,
        store_id: str,
        normalized_checksum: str,
        normalized_payload: dict[str, Any],
        shopify_result: dict[str, Any],
    ) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status not in {
                "normalizing", "seo", "syncing", "shopify_writing",
            }:
                return False
            product_id = self._upsert_shopify_link(
                session,
                item=item,
                store_id=store_id,
                normalized_checksum=normalized_checksum,
                shopify_result=shopify_result,
            )
            # The normalized payload is the temporary public result. The raw
            # crawler copy is no longer needed after Shopify confirms the write.
            item.raw_payload = {}
            task = session.get(CrawlTask, item.task_id)
            if task is not None and task.result is not None:
                result_payload = dict(task.result.payload or {})
                products = result_payload.get("products")
                if isinstance(products, list):
                    result_payload["products"] = [
                        product for product in products
                        if not (
                            isinstance(product, dict)
                            and (
                                _source_key(product) == item.source_key
                                or str(product.get("id") or "") == item.product_id
                            )
                        )
                    ]
                    task.result.payload = result_payload
            item.normalized_payload = normalized_payload
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            if review:
                review.update({
                    "syncStatus": "synced",
                    "syncError": None,
                    "syncedAt": utc_iso(utc_now()),
                    "updatedAt": utc_iso(utc_now()),
                })
                pipeline_result["review"] = review
            pipeline_result.update(shopify_result)
            item.shopify_result = pipeline_result
            item.status = "completed"
            item.last_error = None
            item.next_attempt_at = None
            item.claim_expires_at = None
            item.completed_at = utc_now()
            operation = session.scalar(select(ShopifyOperationIdempotency).where(
                ShopifyOperationIdempotency.store_id == store_id,
                ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(item.source_key),
            ))
            if operation is None:
                session.add(ShopifyOperationIdempotency(
                    id=_id(),
                    store_id=store_id,
                    request_id=_shopify_sync_request_id(item.source_key),
                    operation="product.sync",
                    payload_hash=normalized_checksum,
                    state="completed",
                    response_payload={
                        "itemId": item.id,
                        "sourceKey": item.source_key,
                        "productId": product_id or None,
                    },
                ))
            else:
                operation.state = "completed"
                operation.response_payload = {
                    "itemId": item.id,
                    "sourceKey": item.source_key,
                    "productId": product_id or None,
                }
            self._event(session, item.job_id, "product_completed", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "shopifyProductId": product_id or None,
                "noOp": bool(shopify_result.get("noOp")),
            })
            self._refresh_job(session, item.job_id)
            return True

    @staticmethod
    def _upsert_shopify_link(
        session,
        *,
        item: CrawlProductItem,
        store_id: str,
        normalized_checksum: str,
        shopify_result: dict[str, Any],
    ) -> str:
        product_id = str(shopify_result.get("productId") or "").strip()
        if not product_id:
            return ""
        product_handle = str(shopify_result.get("productHandle") or "").strip() or None
        link = session.scalar(select(ShopifyProductLink).where(
            ShopifyProductLink.store_id == store_id,
            ShopifyProductLink.source_key == item.source_key,
        ))
        if link is None:
            link = ShopifyProductLink(
                id=_id(),
                store_id=store_id,
                source_key=item.source_key,
                shopify_product_id=product_id,
                shopify_product_handle=product_handle,
                normalized_checksum=normalized_checksum,
                managed_resources=dict(shopify_result.get("managedResources") or {}),
            )
            session.add(link)
        else:
            link.shopify_product_id = product_id
            link.shopify_product_handle = product_handle
            link.normalized_checksum = normalized_checksum
            link.managed_resources = dict(shopify_result.get("managedResources") or {})
        return product_id

    def cleanup_history(self, *, retention_minutes: int, now=None) -> dict[str, int]:
        """Remove expired coordinator history while preserving Shopify mappings."""
        retention = max(1, int(retention_minutes))
        current_time = now or utc_now()
        cutoff = current_time - timedelta(minutes=retention)
        with self.sessions.begin() as session:
            job_ids = list(session.scalars(select(CrawlJob.id).where(
                CrawlJob.status.in_(["completed", "partial", "cancelled"]),
                CrawlJob.completed_at.is_not(None),
                CrawlJob.completed_at < cutoff,
            )).all())
            if job_ids:
                protected_job_ids = set(session.scalars(select(CrawlProductItem.job_id).where(
                    CrawlProductItem.job_id.in_(job_ids),
                    CrawlProductItem.status.in_([
                        "waiting_review", "sync_queued", "syncing", "shopify_writing", "rejected",
                        "reconciliation_required",
                    ]),
                )).all())
                job_ids = [job_id for job_id in job_ids if job_id not in protected_job_ids]
            if job_ids:
                task_ids = list(session.scalars(select(CrawlTask.id).where(
                    CrawlTask.job_id.in_(job_ids),
                )).all())
                session.execute(delete(JobEvent).where(JobEvent.job_id.in_(job_ids)))
                session.execute(delete(InvalidJobInput).where(InvalidJobInput.job_id.in_(job_ids)))
                session.execute(delete(CrawlProductItem).where(CrawlProductItem.job_id.in_(job_ids)))
                if task_ids:
                    session.execute(delete(TaskResult).where(TaskResult.task_id.in_(task_ids)))
                    session.execute(delete(TaskAttempt).where(TaskAttempt.task_id.in_(task_ids)))
                session.execute(delete(CrawlTask).where(CrawlTask.job_id.in_(job_ids)))
                session.execute(delete(CrawlJobControl).where(CrawlJobControl.job_id.in_(job_ids)))
                session.execute(delete(CrawlJob).where(CrawlJob.id.in_(job_ids)))

            operation_result = session.execute(delete(ShopifyOperationIdempotency).where(
                ShopifyOperationIdempotency.state != "pending",
                ShopifyOperationIdempotency.updated_at < cutoff,
            ))
            tombstone_result = session.execute(delete(DeletedCrawlJob).where(
                DeletedCrawlJob.expires_at < current_time,
            ))
            return {
                "jobs": len(job_ids),
                "idempotencyOperations": int(operation_result.rowcount or 0),
                "tombstones": int(tombstone_result.rowcount or 0),
            }

    def fail_product_item(
        self,
        item_id: str,
        *,
        worker_id: str,
        store_id: str,
        error: dict[str, Any],
        retryable: bool,
        reconciliation_required: bool,
        retry_after_seconds: int | None = None,
    ) -> str | None:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id:
                return None
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            if review and not reconciliation_required:
                review.update({
                    "syncStatus": "failed",
                    "syncError": str(error.get("message") or "Shopify sync failed."),
                    "updatedAt": utc_iso(utc_now()),
                })
                pipeline_result["review"] = review
                item.shopify_result = pipeline_result
                item.status = "waiting_review"
                item.last_error = error
                item.claimed_by = None
                item.claim_expires_at = None
                item.next_attempt_at = None
                item.completed_at = None
                self._event(session, item.job_id, "product_review_sync_failed", {
                    "productItemId": item.id,
                    "sourceKey": item.source_key,
                    "error": error,
                })
                self._refresh_job(session, item.job_id)
                return "waiting_review"
            if review and reconciliation_required:
                review.update({
                    "syncStatus": "failed",
                    "syncError": str(error.get("message") or "Shopify write needs reconciliation."),
                    "updatedAt": utc_iso(utc_now()),
                })
                pipeline_result["review"] = review
                item.shopify_result = pipeline_result
            if reconciliation_required:
                next_status = "reconciliation_required"
            elif retryable and item.attempt_count < 3:
                next_status = "retry_wait"
            else:
                next_status = "failed"
            item.status = next_status
            item.last_error = error
            if str(error.get("phase") or "") == "seo":
                pipeline_result["seo"] = {
                    "status": "failed",
                    "error": str(error.get("message") or "SEO pipeline failed."),
                }
                item.shopify_result = pipeline_result
            elif str(error.get("phase") or "") == "image_processing":
                pipeline_result["imageProcessing"] = {
                    "status": "failed",
                    "error": str(error.get("message") or "Image processing failed."),
                }
                item.shopify_result = pipeline_result
            item.claimed_by = None
            item.claim_expires_at = None
            if next_status == "retry_wait":
                retry_delays = (5, 30, 120)
                delay = retry_after_seconds or retry_delays[min(item.attempt_count - 1, len(retry_delays) - 1)]
                item.next_attempt_at = utc_now() + timedelta(seconds=max(1, delay))
            else:
                item.next_attempt_at = None
                item.completed_at = utc_now()
            operation = session.scalar(select(ShopifyOperationIdempotency).where(
                ShopifyOperationIdempotency.store_id == store_id,
                ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(item.source_key),
            ))
            if operation is not None:
                operation.state = "pending" if next_status == "retry_wait" else next_status
                operation.response_payload = {
                    "itemId": item.id,
                    "sourceKey": item.source_key,
                    "error": error,
                }
            self._event(session, item.job_id, "product_failed", {
                "productItemId": item.id,
                "sourceKey": item.source_key,
                "status": next_status,
                "attempt": item.attempt_count,
                "error": error,
            })
            self._refresh_job(session, item.job_id)
            return next_status

    def reap_expired(self) -> dict[str, int]:
        now = utc_now()
        offline_before = now - timedelta(seconds=CLIENT_OFFLINE_SECONDS)
        offline = 0
        requeued = 0
        with self.sessions.begin() as session:
            job_ids: set[str] = set()
            clients = session.scalars(select(ClientRecord).where(ClientRecord.status != "offline")).all()
            for client in clients:
                if _as_utc(client.last_seen_at) < offline_before:
                    client.status = "offline"
                    offline += 1
                    for cleanup in session.scalars(select(JobStopClientCleanup).where(
                        JobStopClientCleanup.client_id == client.id,
                        JobStopClientCleanup.status == "pending",
                    )):
                        cleanup.status = "offline"
                        job_ids.add(cleanup.job_id)
            tasks = session.scalars(
                select(CrawlTask).where(
                    CrawlTask.status.in_(["leased", "running", "cancelling"]),
                    CrawlTask.lease_expires_at.is_not(None),
                    CrawlTask.lease_expires_at < now,
                )
            ).all()
            for task in tasks:
                old_lease = task.lease_id
                if task.status == "cancelling":
                    task.status = "cancelled"
                    task.completed_at = now
                    task.lease_expires_at = None
                    job_ids.add(task.job_id)
                    if old_lease:
                        attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == old_lease))
                        if attempt:
                            attempt.status = "cancelled"
                            attempt.finished_at = now
                    continue
                # Repair tasks reopened by a delayed progress message from an
                # older coordinator version. Never requeue work whose result is
                # already durable.
                if task.result is not None:
                    task.status = "completed"
                    task.completed_at = task.completed_at or task.result.received_at
                    task.lease_expires_at = None
                    job_ids.add(task.job_id)
                    if old_lease:
                        attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == old_lease))
                        if attempt and attempt.status not in {"completed", "failed"}:
                            attempt.status = "abandoned"
                            attempt.finished_at = now
                    continue
                task.status = "queued"
                task.assigned_client_id = None
                task.lease_id = None
                task.lease_expires_at = None
                job_ids.add(task.job_id)
                requeued += 1
                if old_lease:
                    attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == old_lease))
                    if attempt:
                        attempt.status = "abandoned"
                        attempt.finished_at = now
                self._event(session, task.job_id, "task_requeued", {"taskId": task.id, "reason": "lease_expired"})
            stopped_items = session.scalars(select(CrawlProductItem).where(
                CrawlProductItem.status == "cancelling",
                CrawlProductItem.claim_expires_at.is_not(None),
                CrawlProductItem.claim_expires_at < now,
            )).all()
            for item in stopped_items:
                item.status = "cancelled"
                item.claimed_by = None
                item.claim_expires_at = None
                item.completed_at = now
                job_ids.add(item.job_id)
                self._event(session, item.job_id, "product_cancel_claim_expired", {
                    "productItemId": item.id,
                })
            for job_id in job_ids:
                self._refresh_job(session, job_id)
        return {"offlineClients": offline, "requeuedTasks": requeued}

    def cancel_job(
        self,
        job_id: str,
        connected_client_ids: set[str] | None = None,
    ) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is None:
                return None
            if job.status in {"completed", "partial", "cancelled"}:
                return self._job_snapshot(session, job)
            now = utc_now()
            control = session.get(CrawlJobControl, job_id)
            if control is None:
                control = CrawlJobControl(job_id=job_id, state="active")
                session.add(control)
            if control.state == "cancelling" and control.cancellation_id:
                return self._job_snapshot(session, job)
            should_track_client_cleanup = connected_client_ids is not None
            if connected_client_ids is None:
                connected_client_ids = set(session.scalars(
                    select(ClientRecord.id).where(ClientRecord.status != "offline")
                ).all())
            if not control.cancellation_id:
                control.cancellation_id = _id()
                control.cancel_requested_at = now
            control.state = "cancelling"
            job.status = "cancelling"
            job.completed_at = None
            cache_generation = self._next_cache_generation(session)
            session.merge(DeletedCrawlJob(
                job_id=job_id,
                cancellation_id=control.cancellation_id,
                deleted_at=now,
                expires_at=now + timedelta(days=TOMBSTONE_RETENTION_DAYS),
            ))
            for client_id in connected_client_ids if should_track_client_cleanup else set():
                session.add(JobStopClientCleanup(
                    id=_id(),
                    job_id=job_id,
                    client_id=client_id,
                    cache_generation=cache_generation,
                    status="pending",
                ))
            for task in session.scalars(select(CrawlTask).where(
                CrawlTask.job_id == job_id,
                CrawlTask.status.not_in(TERMINAL_TASK_STATUSES),
            )):
                should_wait_for_agent = (
                    task.status in {"leased", "running"}
                    and bool(task.lease_id)
                    and task.assigned_client_id in connected_client_ids
                )
                if should_wait_for_agent:
                    task.status = "cancelling"
                    attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == task.lease_id))
                    if attempt is not None:
                        attempt.status = "cancelling"
                else:
                    task.status = "cancelled"
                    task.completed_at = now
                    task.lease_expires_at = None
                    if task.lease_id:
                        attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == task.lease_id))
                        if attempt is not None:
                            attempt.status = "cancelled"
                            attempt.finished_at = now
            for item in session.scalars(select(CrawlProductItem).where(
                CrawlProductItem.job_id == job_id,
                CrawlProductItem.status.in_(list(ACTIVE_PRODUCT_STATUSES)),
            )):
                previous_status = item.status
                if previous_status == "shopify_writing":
                    pipeline_result = dict(item.shopify_result or {})
                    pipeline_result["cancellation"] = {
                        "phase": previous_status,
                        "requestedAt": utc_iso(now),
                        "receivedAt": None,
                    }
                    item.shopify_result = pipeline_result
                    item.status = "stopping_after_write"
                elif item.claimed_by and previous_status in {"normalizing", "seo", "image_processing", "syncing"}:
                    pipeline_result = dict(item.shopify_result or {})
                    pipeline_result["cancellation"] = {
                        "phase": previous_status,
                        "requestedAt": utc_iso(now),
                        "receivedAt": None,
                    }
                    item.shopify_result = pipeline_result
                    item.status = "cancelling"
                else:
                    item.status = "cancelled"
                    item.completed_at = now
                    item.claimed_by = None
                    item.claim_expires_at = None
                if previous_status != "shopify_writing":
                    request_id = _shopify_sync_request_id(item.source_key)
                    operations = session.scalars(select(ShopifyOperationIdempotency).where(
                        ShopifyOperationIdempotency.request_id == request_id,
                        ShopifyOperationIdempotency.state == "pending",
                    )).all()
                    for operation in operations:
                        owner = str((operation.response_payload or {}).get("itemId") or "")
                        if owner == item.id:
                            operation.state = "cancelled"
                            operation.response_payload = {
                                "itemId": item.id,
                                "sourceKey": item.source_key,
                            }
            self._event(session, job_id, "job_cancel_requested", {
                "cancellationId": control.cancellation_id,
                "cacheGeneration": cache_generation,
                "connectedClients": sorted(connected_client_ids),
            })
            self._refresh_job(session, job_id)
            return self._job_snapshot(session, job)

    def acknowledge_stop_cleanup(
        self,
        client_id: str,
        *,
        job_id: str,
        cache_generation: int,
        error: str | None = None,
    ) -> bool:
        with self.sessions.begin() as session:
            cleanup = session.scalar(select(JobStopClientCleanup).where(
                JobStopClientCleanup.job_id == job_id,
                JobStopClientCleanup.client_id == client_id,
            ))
            if cleanup is None or cleanup.cache_generation != cache_generation:
                return False
            cleanup.status = "pending" if error else "completed"
            cleanup.error = error
            if not error:
                self._refresh_job(session, job_id)
            return not error

    def acknowledge_client_cache_generation(self, client_id: str, cache_generation: int) -> list[str]:
        """Complete pending Stop cleanups proven by a reconnect generation ACK."""
        with self.sessions.begin() as session:
            cleanups = session.scalars(select(JobStopClientCleanup).where(
                JobStopClientCleanup.client_id == client_id,
                JobStopClientCleanup.status == "pending",
                JobStopClientCleanup.cache_generation <= cache_generation,
            )).all()
            job_ids = sorted({cleanup.job_id for cleanup in cleanups})
            for cleanup in cleanups:
                cleanup.status = "completed"
                cleanup.error = None
            for job_id in job_ids:
                self._refresh_job(session, job_id)
            return job_ids

    def acknowledge_task_cancel(self, client_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, task_id)
            if task is None:
                return {"status": "discarded"}
            attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == lease_id))
            if task.status == "cancelled":
                if (
                    task.assigned_client_id == client_id
                    and task.lease_id == lease_id
                    and attempt is not None
                    and attempt.status in CANCELLATION_UNCONFIRMED_ATTEMPT_STATUSES
                ):
                    now = utc_now()
                    attempt.status = "cancelled"
                    attempt.finished_at = attempt.finished_at or now
                    self._event(session, task.job_id, "task_cancel_acknowledged", {
                        "taskId": task.id,
                        "clientId": client_id,
                    })
                    self._refresh_job(session, task.job_id)
                    return {"status": "cancelled", "jobId": task.job_id}
                return {"status": "duplicate", "jobId": task.job_id}
            if (
                task.status != "cancelling"
                or task.assigned_client_id != client_id
                or task.lease_id != lease_id
            ):
                return {"status": "stale", "jobId": task.job_id}
            now = utc_now()
            task.status = "cancelled"
            task.completed_at = now
            task.lease_expires_at = None
            if attempt is not None:
                attempt.status = "cancelled"
                attempt.finished_at = now
            self._event(session, task.job_id, "task_cancel_acknowledged", {
                "taskId": task.id,
                "clientId": client_id,
            })
            self._refresh_job(session, task.job_id)
            return {"status": "cancelled", "jobId": task.job_id}

    def acknowledge_task_cancel_received(self, client_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, task_id)
            if task is None:
                return {"status": "discarded"}
            if (
                task.status != "cancelling"
                or task.assigned_client_id != client_id
                or task.lease_id != lease_id
            ):
                return {"status": "stale", "jobId": task.job_id}
            attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == lease_id))
            if attempt is not None and attempt.status == "cancelling":
                attempt.status = "cancelling_received"
                self._event(session, task.job_id, "task_cancel_received", {
                    "taskId": task.id,
                    "clientId": client_id,
                })
            return {"status": "received", "jobId": task.job_id}

    def reconcile_tasks(self, client_id: str, local_tasks: list[dict[str, Any]]) -> dict[str, list[str]]:
        resume: list[str] = []
        discard: list[str] = []
        cancelled_jobs: set[str] = set()
        refreshed_job_ids: set[str] = set()
        now = utc_now()
        with self.sessions.begin() as session:
            for local in local_tasks:
                task_id = str(local.get("taskId") or "")
                lease_id = str(local.get("leaseId") or "")
                job_id = str(local.get("jobId") or "")
                task = session.get(CrawlTask, task_id)
                job = session.get(CrawlJob, job_id) if job_id else None
                tombstone = session.get(DeletedCrawlJob, job_id) if job_id else None
                if tombstone is not None:
                    discard.append(task_id)
                    cancelled_jobs.add(job_id)
                    if task is not None and task.assigned_client_id == client_id and task.lease_id == lease_id:
                        task.status = "cancelled"
                        task.completed_at = task.completed_at or now
                        task.lease_expires_at = None
                        attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == lease_id))
                        if attempt is not None:
                            attempt.status = "cancelled"
                            attempt.finished_at = attempt.finished_at or now
                        refreshed_job_ids.add(job_id)
                    continue
                if task is None or job is None:
                    discard.append(task_id)
                    continue
                if job.status in {"cancelling", "cancelled"} or task.status in {"cancelling", "cancelled"}:
                    discard.append(task_id)
                    cancelled_jobs.add(job_id)
                    if task.assigned_client_id == client_id and task.lease_id == lease_id:
                        task.status = "cancelled"
                        task.completed_at = task.completed_at or now
                        task.lease_expires_at = None
                        attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == lease_id))
                        if attempt is not None:
                            attempt.status = "cancelled"
                            attempt.finished_at = attempt.finished_at or now
                        refreshed_job_ids.add(job_id)
                    continue
                if (
                    task.job_id == job_id
                    and task.assigned_client_id == client_id
                    and task.lease_id == lease_id
                    and task.status in {"leased", "running"}
                ):
                    task.lease_expires_at = now + timedelta(seconds=LEASE_SECONDS)
                    resume.append(task_id)
                    continue
                discard.append(task_id)
            for refreshed_job_id in refreshed_job_ids:
                self._refresh_job(session, refreshed_job_id)
        return {
            "resumeTaskIds": resume,
            "discardTaskIds": discard,
            "cancelledJobIds": sorted(cancelled_jobs),
        }

    def product_cancellation_state(self, item_id: str, *, worker_id: str) -> str | None:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id:
                return None
            if item.status == "cancelling":
                pipeline_result = dict(item.shopify_result or {})
                cancellation = dict(pipeline_result.get("cancellation") or {})
                cancellation["receivedAt"] = cancellation.get("receivedAt") or utc_iso(utc_now())
                pipeline_result["cancellation"] = cancellation
                item.shopify_result = pipeline_result
                return "cancelled"
            if item.status == "stopping_after_write":
                item.claim_expires_at = utc_now() + timedelta(seconds=180)
                return "draining"
            if item.status not in {"normalizing", "seo", "image_processing", "syncing", "shopify_writing"}:
                return None
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            return "active"

    def acknowledge_product_cancel(self, item_id: str, *, worker_id: str) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status not in {
                "cancelling", "stopping_after_write",
            }:
                return False
            was_stopping_after_write = item.status == "stopping_after_write"
            item.status = "cancelled"
            item.claimed_by = None
            item.claim_expires_at = None
            item.completed_at = utc_now()
            if was_stopping_after_write:
                for operation in session.scalars(select(ShopifyOperationIdempotency).where(
                    ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(item.source_key),
                    ShopifyOperationIdempotency.state == "pending",
                )):
                    operation.state = "reconciliation_required"
                    operation.response_payload = {
                        "itemId": item.id,
                        "sourceKey": item.source_key,
                        "reason": "Job stopped after Shopify write started without a confirmed checkpoint.",
                    }
            self._event(session, item.job_id, "product_cancel_acknowledged", {
                "productItemId": item.id,
                "workerId": worker_id,
            })
            self._refresh_job(session, item.job_id)
            return True

    @staticmethod
    def _purge_job_rows(session, job_id: str) -> None:
        task_ids = session.scalars(select(CrawlTask.id).where(CrawlTask.job_id == job_id)).all()
        session.execute(delete(JobEvent).where(JobEvent.job_id == job_id))
        session.execute(delete(InvalidJobInput).where(InvalidJobInput.job_id == job_id))
        session.execute(delete(CrawlProductItem).where(CrawlProductItem.job_id == job_id))
        if task_ids:
            session.execute(delete(TaskResult).where(TaskResult.task_id.in_(task_ids)))
            session.execute(delete(TaskAttempt).where(TaskAttempt.task_id.in_(task_ids)))
        session.execute(delete(CrawlTask).where(CrawlTask.job_id == job_id))
        session.execute(delete(JobStopClientCleanup).where(JobStopClientCleanup.job_id == job_id))
        session.execute(delete(CrawlJobControl).where(CrawlJobControl.job_id == job_id))
        session.execute(delete(CrawlJob).where(CrawlJob.id == job_id))

    def purge_stopped_jobs(self) -> int:
        """Remove terminally stopped jobs while retaining tombstones and Shopify mappings."""
        with self.sessions.begin() as session:
            job_ids = list(session.scalars(select(CrawlJob.id).where(CrawlJob.status == "cancelled")).all())
            for job_id in job_ids:
                control = session.get(CrawlJobControl, job_id)
                cancellation_id = control.cancellation_id if control and control.cancellation_id else _id()
                session.merge(DeletedCrawlJob(
                    job_id=job_id,
                    cancellation_id=cancellation_id,
                    deleted_at=utc_now(),
                    expires_at=utc_now() + timedelta(days=TOMBSTONE_RETENTION_DAYS),
                ))
                self._purge_job_rows(session, job_id)
            return len(job_ids)

    def delete_job(self, job_id: str) -> bool:
        with self.sessions.begin() as session:
            existing_tombstone = session.get(DeletedCrawlJob, job_id)
            job = session.get(CrawlJob, job_id)
            if job is None:
                return existing_tombstone is not None
        snapshot = self.cancel_job(job_id)
        if snapshot is None:
            return False
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is None:
                return True
            control = session.get(CrawlJobControl, job_id)
            cancellation_id = control.cancellation_id if control and control.cancellation_id else _id()
            session.merge(DeletedCrawlJob(
                job_id=job_id,
                cancellation_id=cancellation_id,
                deleted_at=utc_now(),
                expires_at=utc_now() + timedelta(days=TOMBSTONE_RETENTION_DAYS),
            ))
            self._purge_job_rows(session, job_id)
            return True

    def retry_failed(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is None:
                return None
            retried = 0
            for task in session.scalars(select(CrawlTask).where(CrawlTask.job_id == job_id, CrawlTask.status == "failed")):
                task.status = "queued"
                task.failure_count = 0
                task.last_error = None
                task.completed_at = None
                retried += 1
            if retried:
                job.status = "queued"
                job.completed_at = None
            self._event(session, job_id, "failed_tasks_retried", {"count": retried})
            snapshot = self._job_snapshot(session, job)
            snapshot["retried"] = retried
            return snapshot

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            job = session.get(CrawlJob, job_id)
            return self._job_snapshot(session, job) if job else None

    def list_jobs(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.sessions() as session:
            jobs = session.scalars(select(CrawlJob).order_by(CrawlJob.created_at.desc()).limit(max(1, min(limit, 500)))).all()
            return [self._job_snapshot(session, job) for job in jobs]

    def list_clients(self) -> list[dict[str, Any]]:
        with self.sessions() as session:
            clients = session.scalars(select(ClientRecord).order_by(ClientRecord.display_name)).all()
            active_counts = dict(session.execute(
                select(CrawlTask.assigned_client_id, func.count(CrawlTask.id))
                .where(CrawlTask.status.in_(["leased", "running", "cancelling"]))
                .group_by(CrawlTask.assigned_client_id)
            ).all())
            return [self._client_snapshot(client, active_tasks=int(active_counts.get(client.id, 0))) for client in clients]

    @staticmethod
    def _product_pipeline_snapshot(item: CrawlProductItem) -> dict[str, Any]:
        pipeline_result = dict(item.shopify_result or {})
        seo = pipeline_result.pop("seo", None)
        image_processing = pipeline_result.pop("imageProcessing", None)
        public_seo = (
            {
                key: seo[key]
                for key in ("status", "engine", "fieldsApplied", "fallbackStages", "warnings", "error", "performance")
                if key in seo
            }
            if isinstance(seo, dict)
            else {
                "status": "running" if item.status == "seo" else (
                    "completed" if item.status in {
                        "image_processing", "waiting_review", "rejected", "sync_queued",
                        "syncing", "shopify_writing", "completed",
                    } else "pending"
                ),
            }
        )
        shopify = pipeline_result
        shopify.update({
            "attempts": item.attempt_count,
            "proxyProfile": item.proxy_profile,
            "error": None if item.last_error is None else str(item.last_error.get("message") or "Pipeline failed."),
        })
        error_timings = (item.last_error or {}).get("timings")
        if isinstance(error_timings, dict):
            shopify["timings"] = {"pipeline": error_timings}
        product = dict(item.normalized_payload or item.raw_payload)
        product["sourceKey"] = item.source_key
        product["pipeline"] = {
            "status": item.status,
            "normalization": {
                "status": "completed" if item.normalized_payload is not None else (
                    "running" if item.status == "normalizing" else "pending"
                ),
                "assetsNormalized": int(shopify.get("assetsNormalized") or 0),
            },
            "seo": public_seo,
            "imageProcessing": image_processing if isinstance(image_processing, dict) else {
                "status": "running" if item.status == "image_processing" else (
                    "completed" if item.status in {
                        "waiting_review", "rejected", "sync_queued", "syncing",
                        "shopify_writing", "completed",
                    } else "pending"
                ),
            },
            "shopify": shopify,
        }
        return product

    def job_products(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            if session.get(CrawlJob, job_id) is None:
                return None
            items = session.scalars(
                select(CrawlProductItem)
                .where(CrawlProductItem.job_id == job_id)
                .order_by(CrawlProductItem.created_at)
            ).all()
            return {
                "jobId": job_id,
                "products": [self._product_pipeline_snapshot(item) for item in items],
            }

    def retry_failed_syncs(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is None:
                return None
            items = session.scalars(select(CrawlProductItem).where(
                CrawlProductItem.job_id == job_id,
                CrawlProductItem.status.in_(["failed", "reconciliation_required"]),
            )).all()
            for item in items:
                item.status = "received"
                item.attempt_count = 0
                item.next_attempt_at = None
                item.claimed_by = None
                item.claim_expires_at = None
                item.last_error = None
                item.completed_at = None
            if items:
                job.status = "running"
                job.completed_at = None
                self._event(session, job_id, "failed_product_syncs_retried", {"count": len(items)})
            self._refresh_job(session, job_id)
            snapshot = self._job_snapshot(session, job)
            snapshot["retried"] = len(items)
            return snapshot

    def job_results(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            job = session.get(CrawlJob, job_id)
            if job is None:
                return None
            tasks = session.scalars(
                select(CrawlTask).where(CrawlTask.job_id == job_id).options(selectinload(CrawlTask.result)).order_by(CrawlTask.ordinal)
            ).all()
            invalid = session.scalars(select(InvalidJobInput).where(InvalidJobInput.job_id == job_id).order_by(InvalidJobInput.ordinal)).all()
            products: dict[str, dict[str, Any]] = {}
            warnings: list[str] = []
            errors: list[dict[str, Any]] = [
                {"source": entry.source, "code": "INVALID_INPUT", "message": entry.message, "retryable": False}
                for entry in invalid
            ]
            pipeline_items = session.scalars(
                select(CrawlProductItem)
                .where(CrawlProductItem.job_id == job_id)
                .order_by(CrawlProductItem.created_at)
            ).all()
            if pipeline_items:
                for item in pipeline_items:
                    if item.status in {
                        "waiting_review", "rejected", "sync_queued", "syncing",
                        "shopify_writing", "completed",
                    } and item.normalized_payload is not None:
                        product = self._product_pipeline_snapshot(item)
                        products[str(product.get("id") or item.source_key)] = product
                    elif item.status in {"failed", "reconciliation_required", "cancelled"}:
                        errors.append({
                            "source": item.source_key,
                            "code": "SHOPIFY_RECONCILIATION_REQUIRED" if item.status == "reconciliation_required" else "PRODUCT_PIPELINE_FAILED",
                            "message": str((item.last_error or {}).get("message") or f"Product pipeline ended with {item.status}."),
                            "retryable": item.status in {"failed", "reconciliation_required"},
                        })
            for task in tasks:
                if task.result:
                    result = dict(task.result.payload)
                    if not pipeline_items:
                        for product in result.get("products", []):
                            if isinstance(product, dict) and product.get("id"):
                                products[str(product["id"])] = product
                    errors.extend(error for error in result.get("errors", []) if isinstance(error, dict))
                    warnings.extend(str(warning) for warning in result.get("warnings", []) if isinstance(warning, str))
                elif task.status == "failed":
                    errors.append({
                        "source": task.source, "code": "CRAWL_FAILED",
                        "message": str((task.last_error or {}).get("message") or "Crawler failed."), "retryable": True,
                    })
            product_values = list(products.values())
            started_at = _as_utc(job.started_at or job.created_at)
            completed_at = _as_utc(job.completed_at or utc_now())
            duration_ms = max(0, int((completed_at - started_at).total_seconds() * 1000))
            return {
                "version": "distributed-2",
                "jobId": job.id,
                "status": job.status,
                "startedAt": utc_iso(started_at),
                "completedAt": utc_iso(completed_at),
                "settings": job.settings,
                "products": product_values,
                "errors": errors,
                "warnings": list(dict.fromkeys(warnings)),
                "statistics": {
                    "requestedInputs": job.requested_inputs,
                    "acceptedInputs": job.accepted_inputs,
                    "rejectedInputs": job.rejected_inputs,
                    "products": len(product_values),
                    "sourceVariants": sum(len(product.get("sourceVariants", [])) for product in product_values),
                    "finalVariants": sum(len(product.get("variants", [])) for product in product_values),
                    "durationMs": duration_ms,
                },
                "exportFilename": f"amazon-crawl-{job.id}.json",
            }

    def events_after(self, job_id: str, after_id: int) -> list[dict[str, Any]]:
        with self.sessions() as session:
            events = session.scalars(
                select(JobEvent).where(JobEvent.job_id == job_id, JobEvent.id > after_id).order_by(JobEvent.id).limit(200)
            ).all()
            return [
                {"id": event.id, "type": event.event_type, "payload": event.payload, "createdAt": utc_iso(event.created_at)}
                for event in events
            ]

    @staticmethod
    def _client_snapshot(client: ClientRecord, *, active_tasks: int = 0) -> dict[str, Any]:
        return {
            "id": client.id, "displayName": client.display_name, "status": client.status,
            "agentVersion": client.agent_version, "protocolVersion": client.protocol_version,
            "maxConcurrentInputs": client.max_concurrent_inputs, "capabilities": client.capabilities,
            "activeTasks": active_tasks,
            "limits": client.limits, "connectedAt": utc_iso(client.connected_at) if client.connected_at else None,
            "lastSeenAt": utc_iso(client.last_seen_at),
        }

    @staticmethod
    def _job_snapshot(session, job: CrawlJob) -> dict[str, Any]:
        counts = dict(session.execute(
            select(CrawlTask.status, func.count(CrawlTask.id)).where(CrawlTask.job_id == job.id).group_by(CrawlTask.status)
        ).all())
        completed = int(counts.get("completed", 0))
        failed = int(counts.get("failed", 0))
        cancelled = int(counts.get("cancelled", 0))
        tasks = session.scalars(
            select(CrawlTask)
            .options(selectinload(CrawlTask.result))
            .where(CrawlTask.job_id == job.id)
            .order_by(CrawlTask.ordinal)
        ).all()
        progress_events = session.scalars(
            select(JobEvent)
            .where(JobEvent.job_id == job.id, JobEvent.event_type == "task_progress")
            .order_by(JobEvent.id)
        ).all()
        latest_progress: dict[str, dict[str, Any]] = {}
        latest_batch_progress: dict[str, Any] = {}
        for event in progress_events:
            payload = event.payload if isinstance(event.payload, dict) else {}
            task_id = str(payload.get("taskId") or "")
            progress = payload.get("progress") if isinstance(payload.get("progress"), dict) else {}
            if task_id:
                latest_progress[task_id] = progress
                latest_batch_progress = progress
        progress_items: list[dict[str, Any]] = []
        for task in tasks:
            task_progress = latest_progress.get(task.id, {})
            raw_items = task_progress.get("items") if isinstance(task_progress.get("items"), list) else []
            item = next((dict(value) for value in raw_items if isinstance(value, dict)), {})
            public_status = task.status if task.status in TERMINAL_TASK_STATUSES | {"cancelling"} else ("running" if task.status in {"leased", "running"} else "queued")
            item.update({
                "source": task.source,
                "asin": task.asin,
                "status": public_status,
                "phase": str(item.get("phase") or task_progress.get("phase") or ("queued" if public_status == "queued" else "product")),
                "message": str(item.get("message") or task_progress.get("message") or ("Đang chờ client xử lý." if public_status == "queued" else "Đang xử lý trên client.")),
                "variantCompleted": int(item.get("variantCompleted") or 0),
                "variantTotal": int(item.get("variantTotal") or 0),
            })
            if public_status == "completed":
                result_payload = task.result.payload if task.result and isinstance(task.result.payload, dict) else {}
                products = result_payload.get("products") if isinstance(result_payload.get("products"), list) else []
                source_variant_count = sum(
                    len(product.get("sourceVariants", []))
                    for product in products
                    if isinstance(product, dict) and isinstance(product.get("sourceVariants"), list)
                )
                item.update({
                    "phase": "product",
                    "message": "Đã hoàn tất sản phẩm.",
                    "variantCompleted": source_variant_count,
                    "variantTotal": source_variant_count,
                    "activeVariants": [],
                })
                item.pop("currentAsin", None)
                item.pop("currentOptions", None)
            progress_items.append(item)
        product_counts = dict(session.execute(
            select(CrawlProductItem.status, func.count(CrawlProductItem.id))
            .where(CrawlProductItem.job_id == job.id)
            .group_by(CrawlProductItem.status)
        ).all())
        product_total = sum(product_counts.values())
        seo_ready_count = sum(int(product_counts.get(status, 0)) for status in SEO_READY_PRODUCT_STATUSES)
        retry_errors = session.scalars(
            select(CrawlProductItem.last_error).where(
                CrawlProductItem.job_id == job.id,
                CrawlProductItem.status == "retry_wait",
            )
        ).all()
        retry_phases = {
            str(error.get("phase") or "shopify")
            for error in retry_errors
            if isinstance(error, dict)
        }
        is_terminal = job.status in {"completed", "partial", "cancelled", "review_pending"}
        has_pipeline_work = any(product_counts.get(status, 0) for status in ACTIVE_PRODUCT_STATUSES)
        if job.status == "review_pending":
            phase = "review"
        elif is_terminal:
            phase = "export"
        elif any(product_counts.get(status, 0) for status in {
            "syncing", "shopify_writing", "stopping_after_write",
        }) or "shopify" in retry_phases:
            phase = "shopify"
        elif product_counts.get("image_processing", 0) or "image_processing" in retry_phases:
            phase = "image_processing"
        elif product_counts.get("seo", 0) or "seo" in retry_phases:
            phase = "seo"
        elif product_counts.get("normalizing", 0) or product_counts.get("received", 0):
            phase = "normalization"
        else:
            phase = str(latest_batch_progress.get("phase") or ("product" if progress_events else "queued"))
        terminal_count = completed + failed + cancelled
        if job.status == "review_pending":
            progress_message = f"SEO hoàn tất {seo_ready_count}/{product_total} sản phẩm; đã chuyển sang SEO Review."
        elif is_terminal:
            progress_message = f"Đã xử lý {terminal_count}/{job.accepted_inputs} link."
        elif has_pipeline_work and terminal_count == job.accepted_inputs:
            progress_message = (
                f"Đang xử lý pipeline {phase.upper()}: SEO hoàn tất {seo_ready_count}/{product_total} sản phẩm."
            )
        else:
            progress_message = str(
                latest_batch_progress.get("message")
                or f"Đang xử lý {terminal_count}/{job.accepted_inputs} link trên các client."
            )
        progress = {
            "phase": phase,
            "completed": terminal_count,
            "total": job.accepted_inputs,
            "message": progress_message,
            "items": progress_items,
            "productCounts": product_counts,
        }
        if isinstance(latest_batch_progress.get("browserPool"), dict):
            progress["browserPool"] = latest_batch_progress["browserPool"]
        control = session.get(CrawlJobControl, job.id)
        pending_attempts = session.execute(
            select(TaskAttempt.client_id, TaskAttempt.status, func.count(TaskAttempt.id))
            .join(CrawlTask, TaskAttempt.task_id == CrawlTask.id)
            .where(
                CrawlTask.job_id == job.id,
                TaskAttempt.status.in_(CANCELLATION_PENDING_ATTEMPT_STATUSES),
            )
            .group_by(TaskAttempt.client_id, TaskAttempt.status)
        ).all()
        pending_agent_counts: dict[str, dict[str, int]] = {}
        for client_id, attempt_status, task_count in pending_attempts:
            counts_by_status = pending_agent_counts.setdefault(client_id, {})
            counts_by_status[attempt_status] = int(task_count)
        pending_agents = []
        for client_id, counts_by_status in pending_agent_counts.items():
            client = session.get(ClientRecord, client_id)
            task_count = sum(counts_by_status.values())
            received_task_count = (
                counts_by_status.get("cancelling_received", 0)
                + counts_by_status.get("cancelled_received_unconfirmed", 0)
            )
            pending_agents.append({
                "clientId": client_id,
                "displayName": client.display_name if client else client_id,
                "status": client.status if client else "offline",
                "taskCount": task_count,
                "receivedTaskCount": received_task_count,
                "hasReceived": received_task_count == task_count,
            })
        pending_pipeline = []
        for item in session.scalars(select(CrawlProductItem).where(
            CrawlProductItem.job_id == job.id,
            CrawlProductItem.status.in_(["cancelling", "stopping_after_write"]),
        ).order_by(CrawlProductItem.created_at)):
            pipeline_result = item.shopify_result if isinstance(item.shopify_result, dict) else {}
            cancellation = pipeline_result.get("cancellation") if isinstance(pipeline_result.get("cancellation"), dict) else {}
            pending_pipeline.append({
                "itemId": item.id,
                "sourceKey": item.source_key,
                "phase": str(cancellation.get("phase") or "pipeline"),
                "workerId": item.claimed_by,
                "receivedAt": cancellation.get("receivedAt"),
            })
        pending_cleanups = []
        cleanup_generation = None
        for cleanup in session.scalars(select(JobStopClientCleanup).where(
            JobStopClientCleanup.job_id == job.id,
            JobStopClientCleanup.status == "pending",
        ).order_by(JobStopClientCleanup.created_at)):
            client = session.get(ClientRecord, cleanup.client_id)
            cleanup_generation = cleanup.cache_generation
            pending_cleanups.append({
                "clientId": cleanup.client_id,
                "displayName": client.display_name if client else cleanup.client_id,
                "status": cleanup.status,
                "error": cleanup.error,
            })
        return {
            "id": job.id, "externalRequestId": job.external_request_id, "status": job.status,
            "settings": job.settings, "settingsFingerprint": settings_fingerprint(job.settings),
            "inputs": [task.source for task in tasks],
            "requestedInputs": job.requested_inputs, "acceptedInputs": job.accepted_inputs,
            "rejectedInputs": job.rejected_inputs, "taskCounts": counts,
            "productCounts": product_counts,
            "progress": progress,
            "replacementOfJobId": control.replacement_of_job_id if control else None,
            "cancellation": {
                "id": control.cancellation_id if control else None,
                "requestedAt": utc_iso(control.cancel_requested_at) if control and control.cancel_requested_at else None,
                "pendingAgents": pending_agents,
                "pendingPipeline": pending_pipeline,
                "pendingPipelineItems": len(pending_pipeline),
                "pendingCleanupAgents": pending_cleanups,
                "cacheGeneration": cleanup_generation,
                "isExecutionConfirmed": not pending_agents and not pending_pipeline and not pending_cleanups,
            },
            "createdAt": utc_iso(job.created_at), "startedAt": utc_iso(job.started_at) if job.started_at else None,
            "completedAt": utc_iso(job.completed_at) if job.completed_at else None,
        }
