"""Transactional scheduling and persistence for the crawler coordinator."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import Counter
from datetime import timedelta
from threading import Lock
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import selectinload

from ..crawler_core import CrawlSettings, normalize_amazon_input
from .coordinator_models import (
    ClientRecord,
    CrawlJob,
    CrawlProductItem,
    CrawlTask,
    InvalidJobInput,
    JobEvent,
    ShopifyOperationIdempotency,
    ShopifyProductLink,
    TaskAttempt,
    TaskResult,
)
from .protocol import CLIENT_OFFLINE_SECONDS, LEASE_SECONDS, MAX_CRAWL_FAILURES, settings_fingerprint, utc_iso, utc_now


TERMINAL_TASK_STATUSES = {"completed", "failed", "cancelled"}
TERMINAL_PRODUCT_STATUSES = {"completed", "failed", "reconciliation_required", "cancelled"}
ACTIVE_PRODUCT_STATUSES = {"received", "normalizing", "syncing", "retry_wait"}


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
        if total == 0:
            job.status = "partial" if job.rejected_inputs else "completed"
            job.completed_at = utc_now()
        elif statuses.get("completed", 0) + statuses.get("failed", 0) + statuses.get("cancelled", 0) == total:
            product_statuses = Counter(session.scalars(
                select(CrawlProductItem.status).where(CrawlProductItem.job_id == job_id)
            ).all())
            if any(product_statuses.get(status, 0) for status in ACTIVE_PRODUCT_STATUSES):
                job.status = "running"
                job.started_at = job.started_at or utc_now()
                job.completed_at = None
            else:
                product_failed = any(
                    product_statuses.get(status, 0)
                    for status in {"failed", "reconciliation_required", "cancelled"}
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
        with self.sessions.begin() as session:
            if external_request_id:
                existing = session.scalar(select(CrawlJob).where(CrawlJob.external_request_id == external_request_id))
                if existing is not None:
                    return self._job_snapshot(session, existing)
            job = CrawlJob(
                id=_id(),
                external_request_id=external_request_id,
                status="queued",
                settings=settings,
                requested_inputs=len(raw_urls),
            )
            session.add(job)
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

    def heartbeat(self, client_id: str, running: list[dict[str, Any]], status: str = "online") -> None:
        now = utc_now()
        lease_until = now + timedelta(seconds=LEASE_SECONDS)
        with self.sessions.begin() as session:
            client = session.get(ClientRecord, client_id)
            if client is None:
                return
            client.status = status if status in {"online", "busy", "waiting_captcha", "paused"} else "online"
            client.last_seen_at = now
            for active in running:
                task_id = str(active.get("taskId") or "")
                lease_id = str(active.get("leaseId") or "")
                task = session.get(CrawlTask, task_id)
                if task and task.lease_id == lease_id and task.assigned_client_id == client_id and task.status in {"leased", "running"}:
                    task.status = "running"
                    task.lease_expires_at = lease_until

    def mark_client_disconnected(self, client_id: str) -> None:
        with self.sessions.begin() as session:
            client = session.get(ClientRecord, client_id)
            if client is not None and client.status != "paused":
                # The reaper changes this to offline after the reconnect grace period.
                client.status = "online"

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
                    CrawlTask.status.in_(["leased", "running"]),
                )
            ) or 0
            count = min(count, max(0, client.max_concurrent_inputs - int(active_count)))
            if count == 0:
                return []
            tasks = session.scalars(
                select(CrawlTask)
                .join(CrawlJob, CrawlTask.job_id == CrawlJob.id)
                .where(CrawlTask.status == "queued", CrawlJob.status.in_(["queued", "running"]))
                .order_by(CrawlJob.created_at, CrawlTask.ordinal)
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
            if task.status in TERMINAL_TASK_STATUSES:
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
            if task.status in TERMINAL_TASK_STATUSES:
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
            if task.status == "cancelled":
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
            for product in products:
                if isinstance(product, dict) and product.get("id"):
                    self._upsert_product_item(
                        session,
                        task=task,
                        client_id=client_id,
                        lease_id=lease_id,
                        product=product,
                        checksum=str(product.get("productChecksum") or ""),
                    )
            session.add(TaskResult(
                task_id=task.id, client_id=client_id, lease_id=lease_id,
                checksum=checksum, payload=payload,
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
            if task.status == "cancelled":
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
                        CrawlProductItem.status.in_(["normalizing", "syncing"])
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
                if dialect_name == "postgresql":
                    session.execute(
                        text("SELECT pg_advisory_xact_lock(:lock_key)"),
                        {"lock_key": _shopify_sync_lock_key(store_id, item.source_key)},
                    )
                request_id = _shopify_sync_request_id(item.source_key)
                operation = session.scalar(
                    select(ShopifyOperationIdempotency)
                    .where(
                        ShopifyOperationIdempotency.store_id == store_id,
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
                        store_id=store_id,
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
                item.status = "normalizing"
                item.claimed_by = worker_id
                item.claim_expires_at = claim_until
                item.attempt_count += 1
                link = session.scalar(select(ShopifyProductLink).where(
                    ShopifyProductLink.store_id == store_id,
                    ShopifyProductLink.source_key == item.source_key,
                ))
                claimed.append({
                    "id": item.id,
                    "jobId": item.job_id,
                    "taskId": item.task_id,
                    "sourceKey": item.source_key,
                    "productId": item.product_id,
                    "checksum": item.checksum,
                    "attempt": item.attempt_count,
                    "product": item.raw_payload,
                    "existingShopify": None if link is None else {
                        "productId": link.shopify_product_id,
                        "productHandle": link.shopify_product_handle,
                        "normalizedChecksum": link.normalized_checksum,
                        "managedResources": link.managed_resources,
                    },
                })
                self._event(session, item.job_id, "product_normalizing", {
                    "productItemId": item.id,
                    "sourceKey": item.source_key,
                    "attempt": item.attempt_count,
                })
                self._refresh_job(session, item.job_id)
        return claimed

    def mark_product_syncing(
        self,
        item_id: str,
        *,
        worker_id: str,
        normalized_payload: dict[str, Any],
        proxy_profile: str,
    ) -> bool:
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status != "normalizing":
                return False
            item.normalized_payload = normalized_payload
            item.proxy_profile = proxy_profile
            item.status = "syncing"
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
            if item is None or item.claimed_by != worker_id or item.status not in {"normalizing", "syncing"}:
                return False
            item.claim_expires_at = utc_now() + timedelta(seconds=180)
            return True

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
            if item is None or item.claimed_by != worker_id or item.status not in {"normalizing", "syncing"}:
                return False
            product_id = str(shopify_result.get("productId") or "").strip()
            product_handle = str(shopify_result.get("productHandle") or "").strip() or None
            if product_id:
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
            item.normalized_payload = normalized_payload
            item.shopify_result = shopify_result
            item.status = "completed"
            item.last_error = None
            item.next_attempt_at = None
            item.claim_expires_at = None
            item.completed_at = utc_now()
            operation = session.scalar(select(ShopifyOperationIdempotency).where(
                ShopifyOperationIdempotency.store_id == store_id,
                ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(item.source_key),
            ))
            if operation is not None:
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
            if reconciliation_required:
                next_status = "reconciliation_required"
            elif retryable and item.attempt_count < 3:
                next_status = "retry_wait"
            else:
                next_status = "failed"
            item.status = next_status
            item.last_error = error
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
            clients = session.scalars(select(ClientRecord).where(ClientRecord.status != "offline")).all()
            for client in clients:
                if _as_utc(client.last_seen_at) < offline_before:
                    client.status = "offline"
                    offline += 1
            tasks = session.scalars(
                select(CrawlTask).where(
                    CrawlTask.status.in_(["leased", "running"]),
                    CrawlTask.lease_expires_at.is_not(None),
                    CrawlTask.lease_expires_at < now,
                )
            ).all()
            job_ids: set[str] = set()
            for task in tasks:
                old_lease = task.lease_id
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
            for job_id in job_ids:
                self._refresh_job(session, job_id)
        return {"offlineClients": offline, "requeuedTasks": requeued}

    def cancel_job(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is None:
                return None
            job.status = "cancelled"
            job.completed_at = utc_now()
            for task in session.scalars(select(CrawlTask).where(CrawlTask.job_id == job_id, CrawlTask.status.not_in(TERMINAL_TASK_STATUSES))):
                task.status = "cancelled"
                task.completed_at = utc_now()
                task.lease_expires_at = None
            for item in session.scalars(select(CrawlProductItem).where(
                CrawlProductItem.job_id == job_id,
                CrawlProductItem.status.in_(["received", "normalizing", "retry_wait"]),
            )):
                item.status = "cancelled"
                item.completed_at = utc_now()
                item.claimed_by = None
                item.claim_expires_at = None
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
            self._event(session, job_id, "job_cancelled", {})
            return self._job_snapshot(session, job)

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
                .where(CrawlTask.status.in_(["leased", "running"]))
                .group_by(CrawlTask.assigned_client_id)
            ).all())
            return [self._client_snapshot(client, active_tasks=int(active_counts.get(client.id, 0))) for client in clients]

    @staticmethod
    def _product_pipeline_snapshot(item: CrawlProductItem) -> dict[str, Any]:
        shopify = dict(item.shopify_result or {})
        shopify.update({
            "attempts": item.attempt_count,
            "proxyProfile": item.proxy_profile,
            "error": None if item.last_error is None else str(item.last_error.get("message") or "Pipeline failed."),
        })
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
                    if item.status == "completed" and item.normalized_payload is not None:
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
            public_status = task.status if task.status in TERMINAL_TASK_STATUSES else ("running" if task.status in {"leased", "running"} else "queued")
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
        is_terminal = job.status in {"completed", "partial", "cancelled"}
        has_pipeline_work = any(product_counts.get(status, 0) for status in ACTIVE_PRODUCT_STATUSES)
        if is_terminal:
            phase = "export"
        elif product_counts.get("syncing", 0) or product_counts.get("retry_wait", 0):
            phase = "shopify"
        elif product_counts.get("normalizing", 0) or product_counts.get("received", 0):
            phase = "normalization"
        else:
            phase = str(latest_batch_progress.get("phase") or ("product" if progress_events else "queued"))
        terminal_count = completed + failed + cancelled
        progress = {
            "phase": phase,
            "completed": terminal_count,
            "total": job.accepted_inputs,
            "message": (
                f"Đã xử lý {terminal_count}/{job.accepted_inputs} link."
                if is_terminal else (
                    f"Đang xử lý pipeline Shopify: {int(product_counts.get('completed', 0))}/{sum(product_counts.values())} products."
                    if has_pipeline_work and terminal_count == job.accepted_inputs
                    else str(latest_batch_progress.get("message") or f"Đang xử lý {terminal_count}/{job.accepted_inputs} link trên các client.")
                )
            ),
            "items": progress_items,
            "productCounts": product_counts,
        }
        if isinstance(latest_batch_progress.get("browserPool"), dict):
            progress["browserPool"] = latest_batch_progress["browserPool"]
        return {
            "id": job.id, "externalRequestId": job.external_request_id, "status": job.status,
            "settings": job.settings, "settingsFingerprint": settings_fingerprint(job.settings),
            "requestedInputs": job.requested_inputs, "acceptedInputs": job.accepted_inputs,
            "rejectedInputs": job.rejected_inputs, "taskCounts": counts,
            "productCounts": product_counts,
            "progress": progress,
            "createdAt": utc_iso(job.created_at), "startedAt": utc_iso(job.started_at) if job.started_at else None,
            "completedAt": utc_iso(job.completed_at) if job.completed_at else None,
        }
