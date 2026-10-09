"""Transactional scheduling and persistence for the crawler coordinator."""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from collections import Counter
from datetime import datetime, timedelta
from threading import Lock
from typing import Any, Callable

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import selectinload

from ..crawler_core import CrawlSettings, normalize_amazon_input
from ..review_engine import normalize_review_source
from ..timeouts import CrawlTimeout, TIMEOUT_FIELDS
from ..retry_policy import RETRY_FIELDS, retry_delay
from .coordinator_models import (
    AmazonAsinRegistry,
    ClientRecord,
    CoordinatorState,
    CrawlJobControl,
    DeletedCrawlJob,
    CrawlJob,
    CrawlProductItem,
    CrawlTask,
    ArchivedTaskAttempt,
    CrawlerDlqAction,
    InvalidJobInput,
    JobStopClientCleanup,
    JobEvent,
    ShopifyOperationIdempotency,
    ShopifyProductLink,
    TaskAttempt,
    TaskResult,
    UploadReceipt,
    CrawlTelemetryEvent,
)
from .protocol import payload_checksum, settings_fingerprint, utc_iso, utc_now
from .agent_runtime_config import AgentRuntimeConfig
from .protocol import product_source_key as _source_key
from .global_admission_gate import GlobalAdmissionGate, GlobalAdmissionGateEvent, GLOBAL_ADMISSION_GATE_ID
from .coordinator_observability import CoordinatorObservability, bounded_agent_telemetry
from .retry_taxonomy import classify_task_error, parse_retry_after
from .fleet_circuit_breaker import acquire_capacity as acquire_fleet_capacity, record_failure as record_fleet_failure, record_success as record_fleet_success, snapshot as fleet_breaker_snapshot
from ..observability import ERROR_LOG_FIELDS, redact, safe_fields


TERMINAL_TASK_STATUSES = {"completed", "failed", "dead_letter", "dead_letter_deleted", "cancelled"}
TERMINAL_PRODUCT_STATUSES = {"completed", "failed", "reconciliation_required", "cancelled", "rejected", "deleted"}
ACTIVE_PRODUCT_STATUSES = {
    "received", "normalizing", "seo", "image_processing", "syncing",
    "shopify_writing", "stopping_after_write", "retry_wait", "sync_queued",
}
SEO_READY_PRODUCT_STATUSES = {
    "waiting_review", "sync_queued", "syncing", "shopify_writing",
    "stopping_after_write", "completed", "rejected", "reconciliation_required", "deleted",
}
SEO_QUEUE_HANDOFF_DOWNSTREAM_STATUSES = {
    "image_processing", "waiting_review", "sync_queued", "syncing",
    "shopify_writing", "stopping_after_write", "completed", "rejected",
    "reconciliation_required", "deleted",
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
PRODUCT_INVALIDATION_GENERATION_KEY = "product_cache_invalidation_generation"
PRODUCT_INVALIDATION_PREFIX = "product_cache_invalidation:"
TEMPORARY_CLEANUP_GENERATION_KEY = "agent_temporary_cleanup_generation"
NEGATIVE_CACHE_PREFIX = "amazon-negative:"
CLIENT_RATE_COOLDOWN_PREFIX = f"{NEGATIVE_CACHE_PREFIX}client-rate:"
CAPTCHA_COOLDOWN_KEY = "amazon-captcha-cooldown"


def _bounded_progress(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    progress = {
        key: redact(payload[key], limit=240)
        for key in ("phase", "message", "source", "status")
        if isinstance(payload.get(key), str)
    }
    for key in ("completed", "total"):
        if isinstance(payload.get(key), int):
            progress[key] = max(0, payload[key])
    items = payload.get("items")
    if isinstance(items, list):
        progress["items"] = []
        for raw_item in items[:20]:
            if not isinstance(raw_item, dict):
                continue
            item = {
                key: redact(raw_item[key], limit=240)
                for key in ("source", "asin", "phase", "status", "message", "currentAsin", "networkRoute", "browserProfile")
                if isinstance(raw_item.get(key), str)
            }
            for key in ("variantCompleted", "variantTotal"):
                if isinstance(raw_item.get(key), int):
                    item[key] = max(0, raw_item[key])
            options = raw_item.get("currentOptions")
            if isinstance(options, dict):
                item["currentOptions"] = {
                    str(key)[:80]: str(value)[:80]
                    for key, value in list(options.items())[:8]
                }
            variants = raw_item.get("activeVariants")
            if isinstance(variants, list):
                item["activeVariants"] = [
                    {"asin": str(variant.get("asin") or "")[:10], "options": {
                        str(key)[:80]: str(value)[:80]
                        for key, value in list((variant.get("options") or {}).items())[:8]
                    }}
                    for variant in variants[:16]
                    if isinstance(variant, dict) and isinstance(variant.get("options") or {}, dict)
                ]
            progress["items"].append(item)
    pool = payload.get("browserPool")
    if isinstance(pool, dict):
        bounded_pool = {}
        for key in (
            "directProfiles", "proxyProfiles", "tabsPerProfile", "directActive", "proxyActive",
            "directQueued", "proxyQueued",
        ):
            value = pool.get(key)
            if isinstance(value, int):
                bounded_pool[key] = max(0, value)
        progress["browserPool"] = bounded_pool
    return progress


class ActiveJobExistsError(RuntimeError):
    def __init__(self, job_id: str) -> None:
        super().__init__(f"Crawl job {job_id} is still active.")
        self.job_id = job_id


class ProductPipelineActiveError(RuntimeError):
    def __init__(self, job_id: str, statuses: set[str]) -> None:
        ordered_statuses = ", ".join(sorted(statuses))
        super().__init__(f"Crawl job {job_id} still owns nonterminal product pipeline work: {ordered_statuses}.")
        self.job_id = job_id
        self.statuses = statuses


def _id() -> str:
    return uuid.uuid4().hex


def _as_utc(value):
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=utc_now().tzinfo)


def _shopify_sync_request_id(source_key: str) -> str:
    digest = hashlib.sha256(source_key.encode("utf-8")).hexdigest()
    return f"product-sync:{digest}"


def _shopify_sync_lock_key(store_id: str, source_key: str) -> int:
    digest = hashlib.sha256(f"{store_id}\0{source_key}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


class CoordinatorStore(CoordinatorObservability):
    ATTEMPT_HISTORY_RETENTION_DAYS = 7

    def __init__(self, session_factory) -> None:
        self.sessions = session_factory
        self._product_claim_lock = Lock()
        self._job_creation_lock = Lock()
        self._review_mutation_lock = Lock()

    @staticmethod
    def _product_family_identity(product: dict[str, Any]) -> tuple[str, list[str]] | None:
        source_key = _source_key(product)
        source_key_parts = source_key.split(":", 3)
        raw_parent = product.get("parentAsin")
        if not isinstance(raw_parent, str) and len(source_key_parts) >= 2:
            raw_parent = source_key_parts[1]
        parent_asin = str(raw_parent or "").strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{10}", parent_asin):
            return None
        member_asins = {parent_asin}
        product_asin = str(product.get("asin") or "").strip().upper()
        if re.fullmatch(r"[A-Z0-9]{10}", product_asin):
            member_asins.add(product_asin)
        for variant in product.get("sourceVariants") or []:
            if not isinstance(variant, dict):
                continue
            asin = str(variant.get("asin") or "").strip().upper()
            if re.fullmatch(r"[A-Z0-9]{10}", asin):
                member_asins.add(asin)
        return parent_asin, sorted(member_asins)

    @staticmethod
    def _product_exact_asins(product: dict[str, Any]) -> set[str]:
        primary_asin = str(product.get("asin") or "").strip().upper()
        parent_asin = str(product.get("parentAsin") or "").strip().upper()
        exact_asins: set[str] = set()
        if re.fullmatch(r"[A-Z0-9]{10}", primary_asin):
            exact_asins.add(primary_asin)
        for variant in product.get("sourceVariants") or []:
            if not isinstance(variant, dict):
                continue
            asin = str(variant.get("asin") or "").strip().upper()
            if re.fullmatch(r"[A-Z0-9]{10}", asin) and asin != parent_asin:
                exact_asins.add(asin)
        return exact_asins

    @classmethod
    def _existing_shopify_product(
        cls,
        session,
        job: CrawlJob | None,
        product: dict[str, Any],
    ) -> tuple[set[str], list[str]] | None:
        store_id = str((job.settings if job else {}).get("storeId") or "").strip()
        exact_asins = cls._product_exact_asins(product)
        preflight_shopify_asins = {
            str(asin).strip().upper()
            for asin in ((job.settings if job else {}).get("existingShopifyAsins") or [])
            if re.fullmatch(r"[A-Z0-9]{10}", str(asin).strip().upper())
        }
        existing_shopify_rows = []
        if store_id and exact_asins:
            existing_shopify_rows = session.scalars(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == store_id,
                AmazonAsinRegistry.marketplace == "amazon-us",
                AmazonAsinRegistry.asin.in_(exact_asins),
                AmazonAsinRegistry.status == "synced",
            )).all()
            existing_shopify_rows = [row for row in existing_shopify_rows if row.shopify_product_ids]
        if not existing_shopify_rows and not (exact_asins & preflight_shopify_asins):
            return None
        shopify_product_ids = sorted({
            product_id
            for row in existing_shopify_rows
            for product_id in (row.shopify_product_ids or [])
        })
        return exact_asins, shopify_product_ids

    @staticmethod
    def _upsert_asin_registry(
        session,
        *,
        store_id: str,
        job_id: str | None,
        product: dict[str, Any],
        status: str,
        shopify_product_id: str | None = None,
    ) -> None:
        normalized_store_id = store_id.strip()
        identity = CoordinatorStore._product_family_identity(product)
        if not normalized_store_id or identity is None:
            return
        parent_asin, member_asins = identity
        now = utc_now()
        insert_factory = postgres_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
        for asin in member_asins:
            existing_row = session.scalar(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == normalized_store_id,
                AmazonAsinRegistry.marketplace == "amazon-us",
                AmazonAsinRegistry.asin == asin,
            ))
            preserves_synced_member = status == "crawled" and existing_row is not None and existing_row.status == "synced"
            statement = insert_factory(AmazonAsinRegistry).values(
                id=_id(),
                store_id=normalized_store_id,
                marketplace="amazon-us",
                asin=asin,
                parent_asin=parent_asin,
                status=status,
                last_job_id=job_id,
                shopify_product_ids=[shopify_product_id] if shopify_product_id else [],
                synced_at=now if status == "synced" else None,
                created_at=now,
                updated_at=now,
            )
            update_values: dict[str, Any] = {
                "parent_asin": parent_asin,
                "status": "synced" if preserves_synced_member else status,
                "updated_at": now,
            }
            if job_id and not preserves_synced_member:
                update_values["last_job_id"] = job_id
            if status == "synced":
                update_values["synced_at"] = now
            session.execute(statement.on_conflict_do_update(
                index_elements=["store_id", "marketplace", "asin"],
                set_=update_values,
            ))
        if shopify_product_id:
            for row in session.scalars(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == normalized_store_id,
                AmazonAsinRegistry.marketplace == "amazon-us",
                AmazonAsinRegistry.asin.in_(member_asins),
            )).all():
                product_ids = set(row.shopify_product_ids or [])
                product_ids.add(shopify_product_id)
                row.shopify_product_ids = sorted(product_ids)

    @classmethod
    def _retained_pipeline_product(cls, session, job: CrawlJob | None, product: dict[str, Any]) -> str | None:
        if job is None:
            return None
        store_id = str((job.settings or {}).get("storeId") or "").strip()
        identity = cls._product_family_identity(product)
        if not store_id or identity is None:
            return None
        aliases = cls._product_exact_asins(product)
        for retained in session.scalars(select(CrawlProductItem).join(CrawlJob).where(
            CrawlJob.settings["storeId"].as_string() == store_id,
            CrawlProductItem.job_id != job.id,
            CrawlProductItem.status != "deleted",
            CrawlProductItem.source_key.like(f"amazon:{identity[0]}:%"),
        )).all():
            if retained.source_key == _source_key(product) or aliases & cls._product_exact_asins(retained.raw_payload or retained.normalized_payload or {}):
                return retained.id
        return None

    def resolve_asin_families(self, store_id: str, asins: list[str]) -> dict[str, Any]:
        normalized_store_id = store_id.strip()
        normalized_asins = list(dict.fromkeys(str(asin).strip().upper() for asin in asins))
        if not normalized_store_id:
            raise ValueError("storeId is required.")
        if not normalized_asins or len(normalized_asins) > 200 or any(
            re.fullmatch(r"[A-Z0-9]{10}", asin) is None for asin in normalized_asins
        ):
            raise ValueError("asins must contain 1 to 200 normalized Amazon ASINs.")
        with self.sessions() as session:
            registry_rows = session.scalars(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == normalized_store_id,
                AmazonAsinRegistry.marketplace == "amazon-us",
                AmazonAsinRegistry.asin.in_(normalized_asins),
            )).all()
            by_asin = {row.asin: row for row in registry_rows}
            parent_asins = {row.parent_asin for row in registry_rows}
            family_members: dict[str, list[str]] = {}
            family_rows: dict[str, list[AmazonAsinRegistry]] = {}
            family_has_synced_members: dict[str, bool] = {}
            if parent_asins:
                for row in session.scalars(select(AmazonAsinRegistry).where(
                    AmazonAsinRegistry.store_id == normalized_store_id,
                    AmazonAsinRegistry.marketplace == "amazon-us",
                    AmazonAsinRegistry.parent_asin.in_(parent_asins),
                )).all():
                    family_members.setdefault(row.parent_asin, []).append(row.asin)
                    family_rows.setdefault(row.parent_asin, []).append(row)
                    if row.status == "synced" and row.shopify_product_ids:
                        family_has_synced_members[row.parent_asin] = True
            task_asins = set(normalized_asins)
            for member_asins in family_members.values():
                task_asins.update(member_asins)
            active_tasks = session.execute(
                select(CrawlTask, CrawlJob).join(CrawlJob, CrawlTask.job_id == CrawlJob.id).where(
                    CrawlTask.asin.in_(task_asins),
                    CrawlTask.status.in_(["queued", "leased", "running", "cancelling"]),
                )
            ).all()
            active_by_asin = {
                task.asin: (task, job)
                for task, job in active_tasks
                if str((job.settings or {}).get("storeId") or "").strip() == normalized_store_id
            }
            candidate_job_ids = {
                row.last_job_id
                for rows in family_rows.values()
                for row in rows
                if row.last_job_id
            }
            retained_asins_by_job: dict[str, set[str]] = {}
            retained_items_by_family: dict[str, list[CrawlProductItem]] = {}
            existing_job_ids: set[str] = set()
            if candidate_job_ids:
                existing_job_ids = set(session.scalars(select(CrawlJob.id).where(
                    CrawlJob.id.in_(candidate_job_ids),
                )).all())
                for item in session.scalars(select(CrawlProductItem).where(
                    CrawlProductItem.job_id.in_(candidate_job_ids),
                    CrawlProductItem.status != "deleted",
                )).all():
                    product = item.normalized_payload if isinstance(item.normalized_payload, dict) else item.raw_payload
                    if not isinstance(product, dict):
                        continue
                    identity = self._product_family_identity(product)
                    if identity is not None:
                        retained_asins_by_job.setdefault(item.job_id, set()).update(identity[1])
                        retained_items_by_family.setdefault(identity[0], []).append(item)
            grouped: dict[str, dict[str, Any]] = {}
            for asin in normalized_asins:
                row = by_asin.get(asin)
                parent_asin = row.parent_asin if row is not None else asin
                def is_stale_crawled(candidate: AmazonAsinRegistry) -> bool:
                    return bool(
                        candidate.status == "crawled"
                        and not (candidate.shopify_product_ids or [])
                        and (
                            not candidate.last_job_id
                            or candidate.last_job_id not in existing_job_ids
                            or candidate.asin not in retained_asins_by_job.get(candidate.last_job_id, set())
                        )
                    )

                recovered_stale_registry = bool(row is not None and is_stale_crawled(row))
                pending_family_rows = [
                    candidate
                    for candidate in family_rows.get(parent_asin, [])
                    if candidate.status == "crawled" and not is_stale_crawled(candidate)
                ]
                pending_job_ids = {candidate.last_job_id for candidate in pending_family_rows}
                pending_items = [
                    item for item in retained_items_by_family.get(parent_asin, [])
                    if item.job_id in pending_job_ids
                ]
                is_queue_cleared = any(
                    self._is_operator_cleared_seo_item(item) for item in pending_items
                )
                # A deliberate partial release opens traversal, not downstream
                # duplicates: uploads still preserve live sibling pipeline items.
                if any(candidate.status == "released" for candidate in family_rows.get(parent_asin, [])):
                    family_database_status = "released"
                elif pending_family_rows:
                    family_database_status = "queue_cleared" if is_queue_cleared else "crawled"
                elif recovered_stale_registry:
                    family_database_status = None
                else:
                    family_database_status = row.status if row is not None else None
                family_job_id = (
                    pending_family_rows[0].last_job_id
                    if pending_family_rows
                    else None if recovered_stale_registry else (row.last_job_id if row is not None else None)
                )
                family = grouped.setdefault(parent_asin, {
                    "parentAsin": parent_asin,
                    "inputAsins": [],
                    "memberAsins": sorted(set(family_members.get(parent_asin, [asin]))),
                    "isResolved": row is not None,
                    "databaseStatus": family_database_status,
                    "jobId": family_job_id,
                    "recoveredStaleRegistry": recovered_stale_registry,
                    "hasSyncedFamilyMembers": family_has_synced_members.get(parent_asin, False),
                    "inputSyncedAsins": [],
                })
                family["inputAsins"].append(asin)
                if row is not None and asin != parent_asin and row.status == "synced" and row.shopify_product_ids:
                    family["inputSyncedAsins"].append(asin)
                active = next(
                    (
                        active_by_asin[member_asin]
                        for member_asin in family["memberAsins"]
                        if member_asin in active_by_asin
                    ),
                    None,
                )
                if active is not None:
                    task, job = active
                    family["databaseStatus"] = task.status
                    family["jobId"] = job.id
                    family["recoveredStaleRegistry"] = False
            return {"families": list(grouped.values())}

    @staticmethod
    def _is_operator_cleared_seo_item(item: CrawlProductItem) -> bool:
        error = item.last_error if isinstance(item.last_error, dict) else {}
        return (
            item.status == "failed"
            and error.get("phase") == "seo"
            and error.get("message") == "GPT SEO job cancelled: Removed from Queue by operator"
        )

    def recover_cleared_family(
        self, store_id: str, parent_asin: str, action: str, *, actor: str, reason: str,
        verify_shopify: Callable[[str, str, set[str], set[str]], dict[str, set[str]]] | None = None,
    ) -> dict[str, int]:
        normalized_store_id = store_id.strip()
        normalized_parent = parent_asin.strip().upper()
        if not normalized_store_id or re.fullmatch(r"[A-Z0-9]{10}", normalized_parent) is None:
            raise ValueError("A valid store and parent ASIN are required.")
        if action not in {"retry", "recrawl"} or len(reason.strip()) < 10:
            raise ValueError("A supported recovery action and audit reason of at least 10 characters are required.")
        with self._job_creation_lock, self.sessions.begin() as session:
            rows = session.scalars(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == normalized_store_id,
                AmazonAsinRegistry.marketplace == "amazon-us",
                AmazonAsinRegistry.parent_asin == normalized_parent,
            ).with_for_update()).all()
            if not rows:
                raise ValueError("Amazon family was not found.")
            member_asins = {row.asin for row in rows}
            active_task = session.scalar(select(CrawlTask.id).join(CrawlJob).where(
                CrawlTask.asin.in_(member_asins),
                CrawlTask.status.in_(["queued", "leased", "running", "cancelling"]),
                CrawlJob.settings["storeId"].as_string() == normalized_store_id,
            ).limit(1))
            if active_task is not None:
                raise ValueError("Family still has an active crawl task.")
            job_ids = {row.last_job_id for row in rows if row.last_job_id}
            retained_items = session.scalars(select(CrawlProductItem).join(CrawlJob).where(
                CrawlProductItem.source_key.like(f"amazon:{normalized_parent}:%"),
                CrawlJob.settings["storeId"].as_string() == normalized_store_id,
            ).with_for_update()).all()
            family_items = [
                item for item in retained_items
                if (identity := self._product_family_identity(
                    item.normalized_payload if isinstance(item.normalized_payload, dict) else item.raw_payload
                )) is not None and identity[0] == normalized_parent
                and item.job_id in job_ids
                and not (item.shopify_result or {}).get("recrawlReleased")
            ]
            source_keys = {item.source_key for item in family_items}
            links = session.scalars(select(ShopifyProductLink).where(
                ShopifyProductLink.store_id == normalized_store_id,
                or_(ShopifyProductLink.source_key.in_(source_keys),
                    ShopifyProductLink.source_key.like(f"amazon:{normalized_parent}:%")),
            ).with_for_update()).all()
            links_by_source = {link.source_key: link for link in links}
            product_ids = {pid for row in rows for pid in (row.shopify_product_ids or [])}
            product_ids.update(link.shopify_product_id for link in links)
            product_ids.update(str((item.shopify_result or {}).get("productId")) for item in family_items
                               if (item.shopify_result or {}).get("productId"))
            exact_asins = set().union(*(self._product_exact_asins(item.raw_payload or item.normalized_payload or {}) for item in family_items))
            exact_asins.update(row.asin for row in rows)
            if verify_shopify is None:
                if product_ids:
                    raise ValueError("Live Shopify verification is required before recovering linked products.")
                verification = {"missingProductIds": set(), "existingAsins": set()}
            else:
                # This callback is server-owned, never populated from browser
                # claims. Any unavailable read rolls the entire transaction back.
                verification = verify_shopify(normalized_store_id, normalized_parent, exact_asins, product_ids)
            missing_ids = verification["missingProductIds"] & product_ids
            existing_asins = verification["existingAsins"]
            recoverable: list[CrawlProductItem] = []
            for item in family_items:
                aliases = self._product_exact_asins(item.raw_payload or item.normalized_payload or {})
                linked_ids = {pid for row in rows if row.asin in aliases for pid in (row.shopify_product_ids or [])}
                link = links_by_source.get(item.source_key)
                if link is not None:
                    linked_ids.add(link.shopify_product_id)
                if (item.shopify_result or {}).get("productId"):
                    linked_ids.add(str(item.shopify_result["productId"]))
                was_deleted_on_shopify = bool(linked_ids) and linked_ids <= missing_ids
                if aliases & existing_asins or (linked_ids and not was_deleted_on_shopify):
                    continue
                if self._is_operator_cleared_seo_item(item) or (item.status in {"completed", "deleted"} and was_deleted_on_shopify):
                    review = (item.shopify_result or {}).get("review") or {}
                    # Older sync completion cleared the expiry but retained the
                    # owner. A confirmed synced terminal record with no lease
                    # cannot be owned by an active pipeline claim.
                    has_legacy_sync_owner = (
                        item.status in {"completed", "deleted"}
                        and review.get("syncStatus") == "synced"
                        and bool((item.shopify_result or {}).get("productId"))
                        and item.claim_expires_at is None
                    )
                    if (item.claimed_by and not has_legacy_sync_owner) or item.claim_expires_at or review.get("syncStatus") in {"queued", "syncing"}:
                        raise ValueError("A selected product still has a pipeline claim.")
                    operation = session.scalar(select(ShopifyOperationIdempotency).where(
                        ShopifyOperationIdempotency.store_id == normalized_store_id,
                        ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(item.source_key),
                    ).with_for_update())
                    if operation is not None and operation.state in {"pending", "reconciliation_required"}:
                        raise ValueError("A selected product has an unresolved Shopify write; reconcile it before recovery.")
                    recoverable.append(item)
            retained_sources = {item.source_key for item in retained_items
                                if not (item.shopify_result or {}).get("recrawlReleased")}
            retained_aliases = set().union(*(self._product_exact_asins(item.raw_payload or item.normalized_payload or {}) for item in retained_items
                                            if not (item.shopify_result or {}).get("recrawlReleased")))
            orphan_aliases = {
                row.asin for row in rows
                if action == "recrawl"
                and row.shopify_product_ids and set(row.shopify_product_ids) <= missing_ids
                and row.asin not in retained_aliases and row.asin not in existing_asins
            }
            orphan_ids = {pid for row in rows if row.asin in orphan_aliases for pid in row.shopify_product_ids}
            orphan_ids -= {link.shopify_product_id for link in links if link.source_key in retained_sources}
            orphan_ids -= {pid for row in rows if row.asin != normalized_parent and row.asin not in orphan_aliases
                           for pid in (row.shopify_product_ids or [])}
            orphan_aliases = {row.asin for row in rows if row.asin in orphan_aliases
                              and set(row.shopify_product_ids) <= orphan_ids}
            if not recoverable and not orphan_aliases:
                raise ValueError("No eligible products: Shopify products and active SEO/Review records are preserved.")
            # Never supersede a source while a newer run owns it.
            recoverable_keys = {item.source_key for item in recoverable}
            newer_items = session.scalars(select(CrawlProductItem).join(CrawlJob).where(
                CrawlJob.settings["storeId"].as_string() == normalized_store_id,
                CrawlProductItem.source_key.in_(recoverable_keys),
                CrawlProductItem.id.not_in([item.id for item in recoverable]),
                CrawlProductItem.status != "deleted",
            ).with_for_update()).all()
            if newer_items:
                raise ValueError("A newer pipeline record exists for a selected product; reconcile it first.")
            released_aliases = set().union(*(self._product_exact_asins(item.raw_payload or item.normalized_payload or {}) for item in recoverable))
            released_aliases.update(orphan_aliases)
            obsolete_ids = {pid for row in rows if row.asin in released_aliases
                            for pid in (row.shopify_product_ids or []) if pid in missing_ids}
            obsolete_ids.update(link.shopify_product_id for link in links
                                if link.source_key in recoverable_keys and link.shopify_product_id in missing_ids)
            obsolete_ids.update(str((item.shopify_result or {}).get("productId")) for item in recoverable
                                if str((item.shopify_result or {}).get("productId")) in missing_ids)
            obsolete_ids.update(orphan_ids)
            # Remove only verified obsolete pointers; preserve their full history
            # in the product payload and audit event rather than deleting products.
            for link in links:
                if link.source_key in recoverable_keys or (link.shopify_product_id in orphan_ids and link.source_key not in retained_sources):
                    operation = session.scalar(select(ShopifyOperationIdempotency).where(
                        ShopifyOperationIdempotency.store_id == normalized_store_id,
                        ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(link.source_key),
                    ).with_for_update())
                    if operation is not None and operation.state in {"pending", "reconciliation_required"}:
                        raise ValueError("An obsolete mapping still has an unresolved Shopify write; reconcile it first.")
                    session.delete(link)
            released_count = 0
            for row in rows:
                remaining_ids = [pid for pid in (row.shopify_product_ids or []) if pid not in obsolete_ids]
                had_removed_ids = remaining_ids != (row.shopify_product_ids or [])
                row.shopify_product_ids = remaining_ids
                if not remaining_ids and (row.asin in released_aliases or had_removed_ids):
                    row.synced_at = None
                    row.status = "released" if action == "recrawl" else "crawled"
                    row.updated_at = utc_now()
                    released_count += 1
            # Job retention can remove JobEvent rows. This independent audit
            # preserves the reconciliation evidence after old history expires.
            session.add(CoordinatorState(key=f"family_recovery_audit:{_id()}", value=json.dumps({
                "storeId": normalized_store_id, "parentAsin": normalized_parent,
                "actor": actor, "reason": reason.strip(), "action": action,
                "timestamp": utc_iso(utc_now()), "releasedAsins": sorted(released_aliases),
                "sourceKeys": sorted(recoverable_keys), "confirmedMissingProductIds": sorted(obsolete_ids),
                "previousLinks": [{"sourceKey": link.source_key, "productId": link.shopify_product_id}
                                  for link in links if link.shopify_product_id in obsolete_ids],
            }, ensure_ascii=False)))
            for item in recoverable:
                self._event(session, item.job_id, "family_product_recovery", {
                    "parentAsin": normalized_parent, "sourceKey": item.source_key,
                    "actor": actor, "reason": reason.strip(), "action": action,
                    "previousShopifyResult": item.shopify_result or {},
                    "confirmedMissingProductIds": sorted(obsolete_ids),
                })
            if action == "retry":
                for item in recoverable:
                    pipeline_result = dict(item.shopify_result or {})
                    generation = max(int((pipeline_result.get("review") or {}).get("syncGeneration") or 0),
                                     int(pipeline_result.get("recoverySyncGeneration") or 0)) + 1
                    for key in ("externalSeo", "seo", "review", "productId", "productHandle", "managedResources"):
                        pipeline_result.pop(key, None)
                    pipeline_result["recoverySyncGeneration"] = generation
                    item.shopify_result = pipeline_result
                    item.status = "received"
                    item.attempt_count = 0
                    item.next_attempt_at = None
                    item.claimed_by = None
                    item.claim_expires_at = None
                    item.last_error = None
                    item.completed_at = None
                for job_id in {item.job_id for item in recoverable}:
                    self._event(session, job_id, "cleared_seo_family_retried", {
                        "parentAsin": normalized_parent, "actor": actor, "reason": reason.strip(),
                        "count": len([item for item in recoverable if item.job_id == job_id]),
                    })
                    self._refresh_job(session, job_id)
                return {"recovered": len(recoverable), "releasedAsins": 0}
            for item in recoverable:
                item.status = "deleted"
                item.claimed_by = None
                item.claim_expires_at = None
                item.shopify_result = {**(item.shopify_result or {}), "recrawlReleased": True}
            # Also release the unsynced parent alias when the entire family was
            # cleared, retaining compatibility with the original recovery flow.
            if family_items and len(recoverable) == len(family_items):
                for row in rows:
                    if row.status == "crawled" and not row.shopify_product_ids:
                        row.status = "released"
                        released_count += 1
            for job_id in {item.job_id for item in recoverable}:
                self._event(session, job_id, "cleared_seo_family_released", {
                    "parentAsin": normalized_parent, "actor": actor, "reason": reason.strip(),
                })
                self._refresh_job(session, job_id)
            return {"recovered": 0, "releasedAsins": released_count}

    def backfill_asin_registry(self) -> dict[str, int]:
        """Rebuild the durable alias ledger from retained pipeline data and Shopify links."""
        products = 0
        links = 0
        with self.sessions.begin() as session:
            for item, job in session.execute(
                select(CrawlProductItem, CrawlJob).join(CrawlJob, CrawlProductItem.job_id == CrawlJob.id)
            ).all():
                if (item.shopify_result or {}).get("recrawlReleased"):
                    continue
                store_id = str((job.settings or {}).get("storeId") or "").strip()
                product = item.normalized_payload if isinstance(item.normalized_payload, dict) else item.raw_payload
                if not store_id or not isinstance(product, dict) or self._product_family_identity(product) is None:
                    continue
                shopify_result = item.shopify_result if isinstance(item.shopify_result, dict) else {}
                shopify_product_id = str(shopify_result.get("productId") or "").strip() or None
                self._upsert_asin_registry(
                    session,
                    store_id=store_id,
                    job_id=item.job_id,
                    product=product,
                    status="synced" if item.status == "completed" else "crawled",
                    shopify_product_id=shopify_product_id,
                )
                products += 1
            for link in session.scalars(select(ShopifyProductLink)).all():
                parts = link.source_key.split(":", 3)
                parent_asin = parts[1].strip().upper() if len(parts) >= 2 else ""
                if re.fullmatch(r"[A-Z0-9]{10}", parent_asin) is None:
                    continue
                self._upsert_asin_registry(
                    session,
                    store_id=link.store_id,
                    job_id=None,
                    product={"parentAsin": parent_asin, "sourceKey": link.source_key},
                    status="synced",
                    shopify_product_id=link.shopify_product_id,
                )
                links += 1
        return {"products": products, "links": links}

    @staticmethod
    def _event(session, job_id: str, event_type: str, payload: dict[str, Any]) -> None:
        payload = dict(payload)
        if "error" in payload:
            error = payload["error"]
            payload["error"] = safe_fields(error, ERROR_LOG_FIELDS) if isinstance(error, dict) else redact(error)
        for key in ("message", "reason"):
            if isinstance(payload.get(key), str):
                payload[key] = redact(payload[key])
        session.add(JobEvent(job_id=job_id, event_type=event_type, payload=payload))

    @staticmethod
    def _job_execution_state(session, job_id: str, control: CrawlJobControl | None = None) -> str:
        control = control or session.get(CrawlJobControl, job_id)
        if control is None or control.state not in {"pausing", "paused"}:
            return "active"
        if control.state == "paused":
            return "paused"
        active_tasks = int(session.scalar(select(func.count(CrawlTask.id)).where(
            CrawlTask.job_id == job_id,
            CrawlTask.status.in_(("leased", "running")),
        )) or 0)
        return "pausing" if active_tasks else "paused"

    @staticmethod
    def _seo_queue_handoff_summary(session, job_id: str) -> dict[str, int]:
        rows = session.execute(select(
            CrawlProductItem.status,
            CrawlProductItem.shopify_result,
        ).where(CrawlProductItem.job_id == job_id)).all()
        handed_over = 0
        pending = 0
        not_handed_over = 0
        for status, raw_result in rows:
            pipeline_result = raw_result if isinstance(raw_result, dict) else {}
            if pipeline_result.get("skippedExistingShopify"):
                continue
            external_seo = pipeline_result.get("externalSeo")
            has_external_job = (
                isinstance(external_seo, dict)
                and isinstance(external_seo.get("jobId"), str)
                and bool(external_seo["jobId"].strip())
            )
            if has_external_job or status in SEO_QUEUE_HANDOFF_DOWNSTREAM_STATUSES:
                handed_over += 1
            elif status in {"failed", "cancelled"}:
                not_handed_over += 1
            else:
                pending += 1
        summary = {
            "totalProducts": handed_over + pending + not_handed_over,
            "handedOver": handed_over,
            "pending": pending,
            "notHandedOver": not_handed_over,
        }
        # Streamed uploads and the final result can report the same skipped
        # product repeatedly (including new leases). Count stable identities.
        skipped_sources = set(session.scalars(select(JobEvent.payload["sourceKey"].as_string()).where(
            JobEvent.job_id == job_id, JobEvent.event_type == "product_skipped_existing_shopify",
        )).all()) - {None, ""}
        accepted_sources = set(session.scalars(select(CrawlProductItem.source_key).where(
            CrawlProductItem.job_id == job_id,
            func.coalesce(CrawlProductItem.shopify_result["skippedExistingShopify"].as_boolean(), False) == False,
        )).all())
        skipped_count = len(skipped_sources - accepted_sources)
        protected_sources = set(session.scalars(select(JobEvent.payload["sourceKey"].as_string()).where(
            JobEvent.job_id == job_id, JobEvent.event_type == "product_skipped_existing_pipeline",
        )).all()) - {None, ""} - accepted_sources - skipped_sources
        if skipped_count or protected_sources:
            summary.update({"skippedExistingShopify": skipped_count,
                            "skippedExistingPipeline": len(protected_sources),
                            "totalDetected": summary["totalProducts"] + skipped_count + len(protected_sources)})
        return summary

    @staticmethod
    def _refresh_job(session, job_id: str) -> None:
        job = session.get(CrawlJob, job_id)
        if job is None:
            return
        control = session.get(CrawlJobControl, job_id)
        if control is not None and control.state == "pausing":
            active_tasks = int(session.scalar(select(func.count(CrawlTask.id)).where(
                CrawlTask.job_id == job_id,
                CrawlTask.status.in_(("leased", "running")),
            )) or 0)
            if active_tasks == 0:
                control.state = "paused"
                control.updated_at = utc_now()
                CoordinatorStore._event(session, job_id, "job_paused", {"remainingTasks": int(session.scalar(
                    select(func.count(CrawlTask.id)).where(
                        CrawlTask.job_id == job_id, CrawlTask.status == "queued",
                    )
                ) or 0)})
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
        elif statuses.get("completed", 0) + statuses.get("failed", 0) + statuses.get("dead_letter", 0) + statuses.get("dead_letter_deleted", 0) + statuses.get("cancelled", 0) == total:
            product_statuses = Counter(session.scalars(
                select(CrawlProductItem.status).where(CrawlProductItem.job_id == job_id)
            ).all())
            handoff = CoordinatorStore._seo_queue_handoff_summary(session, job_id)
            has_review_work = any(
                product_statuses.get(status, 0)
                for status in {"waiting_review", "sync_queued"}
            )
            has_pre_review_work = any(
                product_statuses.get(status, 0)
                for status in {"received", "normalizing", "seo", "image_processing", "retry_wait"}
            )
            has_active_pipeline_work = any(
                product_statuses.get(status, 0)
                for status in ACTIVE_PRODUCT_STATUSES
            )
            if (
                handoff["handedOver"] > 0
                and handoff["pending"] == 0
                and (has_pre_review_work or has_review_work or has_active_pipeline_work)
            ):
                job.status = "review_pending"
                job.started_at = job.started_at or utc_now()
                job.completed_at = job.completed_at or utc_now()
            elif has_pre_review_work:
                job.status = "running"
                job.started_at = job.started_at or utc_now()
                job.completed_at = None
            elif has_review_work:
                job.status = "review_pending"
                job.started_at = job.started_at or utc_now()
                job.completed_at = utc_now()
            elif has_active_pipeline_work:
                job.status = "running"
                job.started_at = job.started_at or utc_now()
                job.completed_at = None
            else:
                if (job.settings or {}).get("channel") == "pinterest":
                    if statuses.get("failed", 0) + statuses.get("dead_letter", 0) + statuses.get("dead_letter_deleted", 0) == total:
                        job.status = "failed"
                    elif (job.settings or {}).get("stage") in {"crawl", "crawl_and_review"}:
                        job.status = "ready_for_review"
                    else:
                        job.status = "completed"
                    job.completed_at = utc_now()
                else:
                    product_failed = any(
                        product_statuses.get(status, 0)
                        for status in {"failed", "reconciliation_required", "cancelled", "rejected"}
                    )
                    job.status = "partial" if statuses.get("failed", 0) or statuses.get("dead_letter", 0) or statuses.get("dead_letter_deleted", 0) or job.rejected_inputs or product_failed else "completed"
                    job.completed_at = utc_now()
        elif statuses.get("leased", 0) or statuses.get("running", 0) or statuses.get("completed", 0):
            job.status = "running"
            job.started_at = job.started_at or utc_now()
        else:
            job.status = "queued"
        if control is not None and control.state in {"pausing", "paused"} and job.status in {
            "completed", "partial", "failed", "cancelled", "review_pending", "ready_for_review",
        }:
            control.state = "active"
            control.updated_at = utc_now()

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw_urls = payload.get("urls")
        if not isinstance(raw_urls, list) or not raw_urls or not all(isinstance(value, str) for value in raw_urls):
            raise ValueError("urls must be a non-empty array of strings.")
        if len(raw_urls) > 200:
            raise ValueError("A job may contain at most 200 inputs.")
        settings = CrawlSettings.from_api(payload).api_dict()
        raw_existing_shopify_asins = payload.get("existingShopifyAsins") or []
        if not isinstance(raw_existing_shopify_asins, list) or len(raw_existing_shopify_asins) > 200:
            raise ValueError("existingShopifyAsins must be an array of at most 200 ASINs.")
        existing_shopify_asins = list(dict.fromkeys(
            str(asin).strip().upper() for asin in raw_existing_shopify_asins
        ))
        if any(re.fullmatch(r"[A-Z0-9]{10}", asin) is None for asin in existing_shopify_asins):
            raise ValueError("existingShopifyAsins must contain normalized Amazon ASINs.")
        if existing_shopify_asins:
            settings["existingShopifyAsins"] = existing_shopify_asins
        raw_refresh_family_asins = payload.get("refreshFamilyAsins") or []
        if not isinstance(raw_refresh_family_asins, list) or len(raw_refresh_family_asins) > 200:
            raise ValueError("refreshFamilyAsins must be an array of at most 200 ASINs.")
        refresh_family_asins = list(dict.fromkeys(
            str(asin).strip().upper() for asin in raw_refresh_family_asins
        ))
        if any(re.fullmatch(r"[A-Z0-9]{10}", asin) is None for asin in refresh_family_asins):
            raise ValueError("refreshFamilyAsins must contain normalized Amazon ASINs.")
        if refresh_family_asins:
            settings["refreshFamilyAsins"] = refresh_family_asins
        allowed_agent_group = str(payload.get("allowedAgentGroup", payload.get("allowed_agent_group", "")) or "").strip()
        if allowed_agent_group and (len(allowed_agent_group) > 80
                or not allowed_agent_group[0].isalnum()
                or any(not (character.isalnum() or character in "_-") for character in allowed_agent_group)):
            raise ValueError("allowedAgentGroup must contain 1-80 letters, numbers, underscores, or hyphens.")
        if allowed_agent_group:
            settings["allowedAgentGroup"] = allowed_agent_group
        external_request_id = str(payload.get("externalRequestId") or "").strip() or None
        with self._job_creation_lock, self.sessions.begin() as session:
            if external_request_id:
                existing = session.scalar(select(CrawlJob).where(CrawlJob.external_request_id == external_request_id))
                if existing is not None:
                    return self._job_snapshot(session, existing)
            input_asins = []
            for source in raw_urls:
                try:
                    input_asins.append(normalize_amazon_input(source).asin)
                except ValueError:
                    continue
            # Serialize creation with audited family recovery across Coordinator
            # processes, not only the in-process creation lock.
            family_parents = select(AmazonAsinRegistry.parent_asin).where(
                AmazonAsinRegistry.store_id == str(settings.get("storeId") or "").strip(),
                AmazonAsinRegistry.asin.in_(input_asins),
            )
            session.scalars(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == str(settings.get("storeId") or "").strip(),
                AmazonAsinRegistry.parent_asin.in_(family_parents),
            ).order_by(AmazonAsinRegistry.asin).with_for_update()).all()
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
                created_at=utc_now(),
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
                    negative = self._active_negative(
                        session, self._negative_key(normalized.asin, str(settings["amazonZip"])), utc_now()
                    )
                    is_terminal = negative is not None and negative.get("retryable") is False
                    session.add(CrawlTask(
                        id=_id(), job_id=job.id, ordinal=ordinal, source=source,
                        asin=normalized.asin, canonical_url=normalized.canonical_url,
                        status="dead_letter" if is_terminal else "queued",
                        last_error=classify_task_error(negative) if negative is not None else None,
                        completed_at=utc_now() if is_terminal else None,
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

    def create_review_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        source = str(payload.get("source") or "").strip()
        asin, canonical_url = normalize_review_source(source)
        try:
            max_pages = int(payload.get("maxPages", 1))
        except (TypeError, ValueError) as error:
            raise ValueError("maxPages must be an integer.") from error
        if not 1 <= max_pages <= 1000:
            raise ValueError("maxPages must be between 1 and 1000.")
        settings = {**CrawlSettings.from_api(payload).api_dict(), "channel": "amazon_reviews", "maxPages": max_pages,
                    "contextOnly": True}
        with self._job_creation_lock, self.sessions.begin() as session:
            active_job_id = session.scalar(select(CrawlJob.id).where(CrawlJob.status.in_(ACTIVE_JOB_STATUSES)).limit(1))
            if active_job_id:
                raise ActiveJobExistsError(str(active_job_id))
            job = CrawlJob(id=_id(), status="queued", settings=settings, requested_inputs=1, accepted_inputs=1)
            session.add(job)
            session.add(CrawlJobControl(job_id=job.id, state="active", priority=0))
            session.add(CrawlTask(id=_id(), job_id=job.id, ordinal=0, source=source, asin=asin,
                                  canonical_url=canonical_url, status="queued"))
            self._event(session, job.id, "job_created", {"channel": "amazon_reviews", "asin": asin})
            self._refresh_job(session, job.id)
            return self._job_snapshot(session, job)

    def review_job(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            job = session.get(CrawlJob, job_id)
            if job is None or (job.settings or {}).get("channel") != "amazon_reviews":
                return None
            task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job_id).options(selectinload(CrawlTask.result)))
            if task is None:
                return None
            review_data = dict((task.result.payload or {}).get("reviewData") or {}) if task.result else {}
            state = session.get(CoordinatorState, f"review-samples:{job_id}")
            samples = json.loads(state.value) if state else []
            return {"jobId": job.id, "status": job.status, "asin": task.asin,
                    "sourceUrl": task.source, "progress": self._job_summary(session, job)["progress"],
                    "error": task.last_error, "reviewData": review_data, "samples": samples,
                    "createdAt": utc_iso(job.created_at)}

    def save_review_samples(self, job_id: str, samples: list[dict[str, Any]]) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is None or (job.settings or {}).get("channel") != "amazon_reviews":
                return None
            if len(samples) > 50 or any(not isinstance(sample, dict) or sample.get("synthetic") is not True
                                      or sample.get("verifiedPurchase") is not False or sample.get("source") != "ai_sample"
                                      or not str(sample.get("reviewId") or "").startswith("SYNTH-") for sample in samples):
                raise ValueError("Invalid synthetic review samples.")
            key = f"review-samples:{job_id}"
            state = session.get(CoordinatorState, key)
            prior = json.loads(state.value) if state else []
            by_id = {str(sample["reviewId"]): sample for sample in prior}
            by_id.update({str(sample["reviewId"]): sample for sample in samples})
            if len(by_id) > 500:
                raise ValueError("Too many synthetic reviews for this job.")
            encoded = json.dumps(list(by_id.values()), ensure_ascii=False)
            if state:
                state.value = encoded
            else:
                session.add(CoordinatorState(key=key, value=encoded))
            return {"saved": len(samples), "total": len(by_id)}

    def create_pinterest_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        niche = str(payload.get("niche") or payload.get("source") or "").strip()
        stage = str(payload.get("workflow_stage") or payload.get("stage") or "crawl").lower().strip()
        workflow_stage = "production" if stage in {"produce", "production"} else "crawl_and_review"
        settings = dict(payload)
        settings["channel"] = "pinterest"
        settings["stage"] = stage
        settings["action"] = stage
        settings["workflow_stage"] = workflow_stage
        external_request_id = str(payload.get("externalRequestId") or "").strip() or None
        with self._job_creation_lock, self.sessions.begin() as session:
            job = CrawlJob(
                id=_id(),
                external_request_id=external_request_id,
                status="queued",
                settings=settings,
                requested_inputs=1,
                accepted_inputs=1,
                rejected_inputs=0,
            )
            session.add(job)
            session.add(CrawlJobControl(
                job_id=job.id,
                state="active",
                priority=max(0, min(100, int(payload.get("schedulerPriority") or 10))),
            ))
            task = CrawlTask(
                id=_id(),
                job_id=job.id,
                ordinal=0,
                source=niche or f"pinterest-{stage}",
                asin=f"PIN_{stage[:6].upper()}",
                canonical_url=f"pinterest://{stage}/{niche}",
                status="queued",
            )
            session.add(task)
            self._event(session, job.id, "job_created", {"channel": "pinterest", "stage": stage})
            self._refresh_job(session, job.id)
            return self._job_snapshot(session, job)


    @staticmethod
    def _negative_key(asin: str, amazon_zip: str) -> str:
        return f"{NEGATIVE_CACHE_PREFIX}{asin}:{amazon_zip}"

    @staticmethod
    def _active_negative(session, key: str, now: datetime) -> dict[str, Any] | None:
        state = session.get(CoordinatorState, key)
        if state is None:
            return None
        try:
            failure = json.loads(state.value)
            retry_after = datetime.fromisoformat(str(failure["retryAfter"]).replace("Z", "+00:00"))
            is_expired = retry_after <= now
        except (ValueError, TypeError, KeyError):
            session.delete(state)
            return None
        if is_expired or (failure.get("status") == "not_found" and failure.get("notFoundConfirmed") is not True):
            session.delete(state)
            return None
        return failure if isinstance(failure, dict) else None

    @staticmethod
    def _store_negative(session, key: str, error: dict[str, Any]) -> None:
        if error.get("status") not in {"not_found", "temporarily_blocked", "network_error", "parser_error", "partial"}:
            return
        try:
            retry_after = datetime.fromisoformat(str(error["retryAfter"]).replace("Z", "+00:00"))
            is_expired = retry_after <= utc_now()
        except (ValueError, TypeError, KeyError):
            return
        if is_expired:
            return
        failure = {
            **{field: error[field] for field in (*TIMEOUT_FIELDS, *RETRY_FIELDS) if field in error},
            "status": error["status"], "reason": str(error.get("reason") or error["status"]),
            "retryable": bool(error.get("retryable")), "retryAfter": error["retryAfter"],
            "code": str(error.get("code") or error["status"]).upper(),
            "message": str(error.get("message") or "Amazon crawl failed."),
            **{key: error[key] for key in (
                "completedAsins", "failedAsins", "retryableAsins", "nonRetryableAsins",
            ) if isinstance(error.get(key), list)},
        }
        if error.get("status") == "partial" and error.get("resumeClientId"):
            failure["resumeClientId"] = str(error["resumeClientId"])
        dialect = session.get_bind().dialect.name
        if dialect == "postgresql":
            statement = postgres_insert(CoordinatorState).values(key=key, value=json.dumps(failure))
        else:
            statement = sqlite_insert(CoordinatorState).values(key=key, value=json.dumps(failure))
        session.execute(statement.on_conflict_do_update(
            index_elements=[CoordinatorState.key],
            set_={"value": json.dumps(failure), "updated_at": utc_now()},
        ))

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

    def advance_cache_generation(self) -> int:
        with self.sessions.begin() as session:
            return self._next_cache_generation(session)

    def active_job_id(self) -> str | None:
        with self.sessions() as session:
            return session.scalar(select(CrawlJob.id).where(CrawlJob.status.in_(ACTIVE_JOB_STATUSES)).limit(1))

    def retained_job_ids(self) -> set[str]:
        with self.sessions() as session:
            return set(session.scalars(select(CrawlJob.id)).all())

    def temporary_cleanup_generation(self) -> int:
        with self.sessions() as session:
            state = session.get(CoordinatorState, TEMPORARY_CLEANUP_GENERATION_KEY)
            try:
                return max(0, int(state.value)) if state else 0
            except ValueError:
                return 0

    def advance_temporary_cleanup_generation(self) -> int:
        with self.sessions.begin() as session:
            state = session.get(CoordinatorState, TEMPORARY_CLEANUP_GENERATION_KEY)
            try:
                generation = max(0, int(state.value)) + 1 if state else 1
            except ValueError:
                generation = 1
            if state is None:
                session.add(CoordinatorState(key=TEMPORARY_CLEANUP_GENERATION_KEY, value=str(generation)))
            else:
                state.value = str(generation)
            return generation

    def invalidate_product_cache(self, asin: str, amazon_zip: str) -> int:
        """Persist a targeted invalidation for agents that reconnect later."""
        with self.sessions.begin() as session:
            counter = session.get(CoordinatorState, PRODUCT_INVALIDATION_GENERATION_KEY)
            try:
                generation = max(0, int(counter.value)) + 1 if counter else 1
            except ValueError:
                generation = 1
            if counter is None:
                session.add(CoordinatorState(key=PRODUCT_INVALIDATION_GENERATION_KEY, value=str(generation)))
            else:
                counter.value = str(generation)
            key = f"{PRODUCT_INVALIDATION_PREFIX}{asin}:{amazon_zip}"
            record = session.get(CoordinatorState, key)
            payload = json.dumps({"asin": asin, "amazonZip": amazon_zip, "generation": generation})
            if record is None:
                session.add(CoordinatorState(key=key, value=payload))
            else:
                record.value = payload
            negative = session.get(CoordinatorState, self._negative_key(asin, amazon_zip))
            if negative is not None:
                session.delete(negative)
            return generation

    def product_invalidations_since(self, generation: int) -> list[dict[str, Any]]:
        with self.sessions() as session:
            records = session.scalars(select(CoordinatorState).where(
                CoordinatorState.key.like(f"{PRODUCT_INVALIDATION_PREFIX}%")
            )).all()
            invalidations = [json.loads(record.value) for record in records]
            return sorted(
                (value for value in invalidations if int(value["generation"]) > generation),
                key=lambda value: int(value["generation"]),
            )

    def clear_negative_cache(self) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(CoordinatorState).where(CoordinatorState.key.like(f"{NEGATIVE_CACHE_PREFIX}%")))
            session.execute(delete(CoordinatorState).where(CoordinatorState.key == CAPTCHA_COOLDOWN_KEY))

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
            client.agent_version = str(hello.get("agentVersion") or "unknown")[:32]
            client.crawler_version = str(hello.get("crawlerVersion") or client.agent_version or "unknown")[:64]
            client.parser_version = str(hello.get("parserVersion") or "unknown")[:64]
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

    def _task_deadline(self, session, task: CrawlTask) -> datetime | None:
        attempt_started = session.scalar(select(TaskAttempt.leased_at).where(TaskAttempt.lease_id == task.lease_id))
        job = session.get(CrawlJob, task.job_id)
        if attempt_started is None or job is None:
            return None
        return min(
            _as_utc(attempt_started) + timedelta(seconds=float(job.settings.get("asinTimeoutSeconds", 1800))),
            _as_utc(job.created_at) + timedelta(seconds=float(job.settings.get("jobTimeoutSeconds", 21600))),
        )

    def _task_lease_duration(self, session, task: CrawlTask) -> int:
        job = session.get(CrawlJob, task.job_id) if task.job_id else None
        client = session.get(ClientRecord, task.assigned_client_id) if task.assigned_client_id else None
        config = AgentRuntimeConfig.from_payload(client.applied_agent_config or {}) if client else AgentRuntimeConfig()
        if job and (job.settings or {}).get("channel") == "pinterest":
            return max(config.leaseSeconds, 300)
        return config.leaseSeconds

    def _renew_lease(self, session, task: CrawlTask, now: datetime) -> datetime:
        deadline = self._task_deadline(session, task)
        lease_seconds = self._task_lease_duration(session, task)
        renewed = now + timedelta(seconds=lease_seconds)
        return min(renewed, deadline) if deadline else renewed

    def heartbeat(
        self,
        client_id: str,
        running: list[dict[str, Any]],
        status: str = "online",
        telemetry: Any = None,
        capabilities: Any = None,
        executing_task_ids: set[str] | None = None,
    ) -> list[str]:
        now = utc_now()
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
            client.status = status if status in {"online", "busy", "waiting_captcha", "paused", "degraded"} else "online"
            client.last_seen_at = now
            if telemetry is not None:
                client.capabilities = {**client.capabilities, "observability": bounded_agent_telemetry(telemetry)}
            if isinstance(capabilities, dict):
                live_capabilities = {
                    key: bool(capabilities.get(key))
                    for key in ("amazon", "pinterest", "pinterestBrowserLoggedIn")
                    if key in capabilities
                }
                client.capabilities = {**client.capabilities, **live_capabilities}
            for active in running:
                if not isinstance(active, dict):
                    continue
                task_id = str(active.get("taskId") or "")
                lease_id = str(active.get("leaseId") or "")
                task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
                lease_now = utc_now()
                if (
                    task and task.lease_id == lease_id and task.assigned_client_id == client_id
                    and task.status in {"leased", "running"} and task.result is None
                    and task.lease_expires_at is not None and _as_utc(task.lease_expires_at) > lease_now
                ):
                    if executing_task_ids is None or task_id in executing_task_ids:
                        task.status = "running"
                    task.lease_expires_at = self._renew_lease(session, task, lease_now)
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

    @staticmethod
    def _admission_gate_payload(gate: GlobalAdmissionGate) -> dict[str, Any]:
        return {
            "state": gate.state,
            "scope": gate.scope,
            "revision": gate.revision,
            "actor": gate.actor,
            "reason": gate.reason,
            "requestId": gate.request_id,
            "updatedAt": utc_iso(gate.updated_at),
        }

    def get_global_admission_gate(self) -> dict[str, Any]:
        with self.sessions() as session:
            gate = session.get(GlobalAdmissionGate, GLOBAL_ADMISSION_GATE_ID)
            if gate is None:
                raise RuntimeError("Global crawler admission gate is not initialized.")
            return self._admission_gate_payload(gate)

    def set_global_admission_gate(
        self, state: str, *, request_id: str, actor: str, reason: str,
    ) -> dict[str, Any]:
        if state not in {"OPEN", "STOPPED"}:
            raise ValueError("Global admission state must be OPEN or STOPPED.")
        if not request_id or len(request_id) > 32 or not actor.strip() or not reason.strip():
            raise ValueError("request_id, actor and reason are required.")
        with self.sessions.begin() as session:
            gate = session.scalar(select(GlobalAdmissionGate)
                .where(GlobalAdmissionGate.id == GLOBAL_ADMISSION_GATE_ID).with_for_update())
            if gate is None:
                raise RuntimeError("Global crawler admission gate is not initialized.")
            prior_event = session.get(GlobalAdmissionGateEvent, request_id)
            if prior_event is not None:
                if (prior_event.state != state or prior_event.actor != actor
                        or prior_event.reason != reason.strip()):
                    raise ValueError("request_id was already used for a different admission-gate change.")
                return {
                    "state": prior_event.state,
                    "scope": prior_event.scope,
                    "revision": prior_event.revision,
                    "actor": prior_event.actor,
                    "reason": prior_event.reason,
                    "requestId": prior_event.request_id,
                    "updatedAt": utc_iso(prior_event.created_at),
                    "replayed": True,
                }
            previous_state = gate.state
            gate.state = state
            gate.scope = "crawler"
            gate.revision += 1
            gate.actor = actor.strip()
            gate.reason = reason.strip()
            gate.request_id = request_id
            gate.updated_at = utc_now()
            session.add(GlobalAdmissionGateEvent(
                request_id=request_id,
                from_state=previous_state,
                state=state,
                scope="crawler",
                revision=gate.revision,
                actor=actor.strip(),
                reason=reason.strip(),
                created_at=gate.updated_at,
            ))
            return {**self._admission_gate_payload(gate), "replayed": False}

    def acknowledge_global_admission_gate(self, client_id: str, revision: int, state: str) -> bool:
        if state not in {"OPEN", "STOPPED"} or revision < 0:
            return False
        with self.sessions.begin() as session:
            gate = session.get(GlobalAdmissionGate, GLOBAL_ADMISSION_GATE_ID)
            client = session.get(ClientRecord, client_id, with_for_update=True)
            if gate is None or client is None or revision != gate.revision or state != gate.state:
                return False
            client.global_admission_gate_revision = revision
            client.global_admission_gate_state = state
            return True

    def lease_tasks(self, client_id: str, available_slots: int) -> list[dict[str, Any]]:
        count = max(0, min(32, int(available_slots)))
        if count == 0:
            return []
        now = utc_now()
        leases: list[dict[str, Any]] = []
        with self.sessions.begin() as session:
            admission_gate = session.scalar(select(GlobalAdmissionGate)
                .where(GlobalAdmissionGate.id == GLOBAL_ADMISSION_GATE_ID)
                .with_for_update(read=True))
            if admission_gate is None or admission_gate.state != "OPEN":
                return []
            client = session.get(ClientRecord, client_id)
            if (client is None or client.status == "paused"
                    or client.global_admission_gate_revision != admission_gate.revision
                    or client.global_admission_gate_state != admission_gate.state):
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
            breaker = fleet_breaker_snapshot(session)
            probe_count = 0
            probe_started_at = breaker.get("probeStartedAt")
            if breaker.get("state") == "HALF_OPEN" and isinstance(probe_started_at, str):
                probe_started = datetime.fromisoformat(probe_started_at.replace("Z", "+00:00"))
                probe_count = int(session.scalar(select(func.count(TaskAttempt.id)).where(
                    TaskAttempt.leased_at >= probe_started,
                    TaskAttempt.status.in_(["leased", "running"]),
                )) or 0)
            count = acquire_fleet_capacity(session, count, probe_count, now=now)
            if count == 0:
                return []
            amazon_blocked = (
                self._active_negative(session, CAPTCHA_COOLDOWN_KEY, now) is not None
                or self._active_negative(session, f"{CLIENT_RATE_COOLDOWN_PREFIX}{client_id}", now) is not None
            )
            client_caps = client.capabilities if isinstance(client.capabilities, dict) else {}
            can_pinterest = bool(client_caps.get("pinterest", False))
            can_amazon = bool(client_caps.get("amazon", True))
            can_reviews = bool(client_caps.get("amazonReviews", False))
            task_ids = session.scalars(
                select(CrawlTask.id)
                .join(CrawlJob, CrawlTask.job_id == CrawlJob.id)
                .outerjoin(CrawlJobControl, CrawlJobControl.job_id == CrawlJob.id)
                .where(
                    CrawlTask.status == "queued", CrawlJob.status.in_(["queued", "running"]),
                    or_(CrawlJobControl.job_id.is_(None), CrawlJobControl.state == "active"),
                )
                .order_by(func.coalesce(CrawlJobControl.priority, 0).desc(), CrawlJob.created_at, CrawlTask.ordinal)
            ).all()
            pending_channels: set[str] = set()
            for pending_task_id in task_ids:
                pending_task = session.get(CrawlTask, pending_task_id)
                if pending_task is None:
                    continue
                pending_job = session.scalar(select(CrawlJob).where(
                    CrawlJob.id == pending_task.job_id,
                ).with_for_update(read=True, key_share=True))
                control = session.scalar(select(CrawlJobControl).where(
                    CrawlJobControl.job_id == pending_task.job_id,
                ).with_for_update(read=True, key_share=True))
                if control is not None and control.state != "active":
                    continue
                pending_settings = dict(pending_job.settings if pending_job else {})
                if (pending_settings.get("allowedAgentGroup") or pending_settings.get("allowed_agent_group")) \
                        and str(pending_settings.get("allowedAgentGroup") or pending_settings.get("allowed_agent_group")) != client.agent_group:
                    continue
                pending_channel = str(pending_settings.get("channel", "amazon")).lower()
                if (pending_channel == "amazon" and can_amazon and not amazon_blocked
                        or pending_channel == "amazon_reviews" and can_reviews and not amazon_blocked
                        or pending_channel == "pinterest" and can_pinterest):
                    pending_channels.add(pending_channel)
            if pending_channels:
                capability_signature = tuple(bool(client_caps.get(key, default)) for key, default in (
                    ("amazon", True), ("amazonReviews", False), ("pinterest", False),
                ))
                peers = session.scalars(select(ClientRecord).where(
                    ClientRecord.agent_group == client.agent_group,
                    ClientRecord.status.in_(("online", "busy", "waiting_captcha")),
                    ClientRecord.desired_execution_state == "RUNNING",
                    ClientRecord.global_admission_gate_revision == admission_gate.revision,
                    ClientRecord.global_admission_gate_state == admission_gate.state,
                )).all()
                cohort = []
                for peer in peers:
                    peer_capabilities = peer.capabilities if isinstance(peer.capabilities, dict) else {}
                    peer_signature = tuple(bool(peer_capabilities.get(key, default)) for key, default in (
                        ("amazon", True), ("amazonReviews", False), ("pinterest", False),
                    ))
                    if peer_signature != capability_signature:
                        continue
                    offline_after = AgentRuntimeConfig.from_payload(peer.applied_agent_config or {}).clientOfflineAfterSeconds
                    if _as_utc(peer.last_seen_at) < now - timedelta(seconds=offline_after):
                        continue
                    active_for_peer = int(session.scalar(select(func.count(CrawlTask.id)).where(
                        CrawlTask.assigned_client_id == peer.id,
                        CrawlTask.status.in_(("leased", "running", "cancelling")),
                    )) or 0)
                    cohort.append((peer.id, active_for_peer, max(1, peer.max_concurrent_inputs)))
                if len(cohort) > 1:
                    least_loaded_ratio = min(active / capacity for _, active, capacity in cohort)
                    own_ratio = next((active / capacity for peer_id, active, capacity in cohort if peer_id == client_id), 0.0)
                    if own_ratio > least_loaded_ratio:
                        return []
            for task_id in task_ids:
                if len(leases) >= count:
                    break
                # Lock only the task about to be leased; locking the whole queue
                # made simultaneous ready agents serialize behind one caller.
                task = session.scalar(select(CrawlTask).where(
                    CrawlTask.id == task_id, CrawlTask.status == "queued",
                ).with_for_update(skip_locked=True).execution_options(populate_existing=True))
                if task is None:
                    continue
                if task.next_retry_at is not None and _as_utc(task.next_retry_at) > now:
                    continue
                job = session.get(CrawlJob, task.job_id)
                job_settings = dict(job.settings if job else {})
                allowed_agent_group = str(job_settings.get("allowedAgentGroup") or "").strip()
                if allowed_agent_group and client.agent_group != allowed_agent_group:
                    continue
                channel = str(job_settings.get("channel", "amazon")).lower()
                if channel == "pinterest" and not can_pinterest:
                    continue
                if channel == "amazon" and (not can_amazon or amazon_blocked):
                    continue
                if channel == "amazon_reviews" and (not can_reviews or amazon_blocked):
                    continue
                amazon_zip = str(job_settings.get("amazonZip") or "90001")
                negative = self._active_negative(session, self._negative_key(task.asin, amazon_zip), now) if channel == "amazon" else None
                if negative is not None:
                    task.last_error = classify_task_error(negative)
                    if negative.get("retryable") is False:
                        task.status = "dead_letter"
                        task.completed_at = now
                        self._event(session, task.job_id, "task_dead_lettered", {
                            "taskId": task.id, "errorCode": task.last_error["errorCode"], "reason": "permanent_error",
                        })
                        self._refresh_job(session, task.job_id)
                        continue
                retry_after = (task.last_error or {}).get("retryAfter")
                if retry_after:
                    try:
                        if datetime.fromisoformat(str(retry_after).replace("Z", "+00:00")) > now:
                            continue
                    except (TypeError, ValueError):
                        pass
                resume_client_id = str((task.last_error or {}).get("resumeClientId") or "")
                if resume_client_id and resume_client_id != client_id:
                    resume_client = session.get(ClientRecord, resume_client_id)
                    if (
                        resume_client is not None
                        and resume_client.status in {"online", "busy", "waiting_captcha"}
                        and _as_utc(resume_client.last_seen_at) >= now - timedelta(seconds=(
                            AgentRuntimeConfig.from_payload(resume_client.applied_agent_config or {}).clientOfflineAfterSeconds
                        ))
                    ):
                        continue
                lease_id = _id()
                task.status = "leased"
                task.assigned_client_id = client_id
                task.lease_id = lease_id
                task.next_retry_at = None
                job_deadline = _as_utc(job.created_at) + timedelta(seconds=float(job.settings.get("jobTimeoutSeconds", 21600)))
                asin_deadline = now + timedelta(seconds=float(job.settings.get("asinTimeoutSeconds", 1800)))
                lease_seconds = self._task_lease_duration(session, task)
                task.lease_expires_at = min(now + timedelta(seconds=lease_seconds), job_deadline, asin_deadline)
                task.started_at = task.started_at or now
                ordinal = int(session.scalar(select(func.count(TaskAttempt.id)).where(TaskAttempt.task_id == task.id)) or 0) + 1
                attempt = TaskAttempt(
                    id=_id(), task_id=task.id, client_id=client_id,
                    lease_id=lease_id, status="leased", leased_at=now, started_at=now,
                    agent_version=client.agent_version or "unknown",
                    crawler_version=client.crawler_version or client.agent_version or "unknown",
                    parser_version=client.parser_version or "unknown",
                )
                session.add(attempt)
                self.record_task_trace(session, task, attempt, "task_retry" if ordinal > 1 else "task_leased", ordinal=ordinal)
                self._refresh_job(session, task.job_id)
                leases.append({
                    "type": "assignment",
                    "taskId": task.id,
                    "jobId": task.job_id,
                    "leaseId": lease_id,
                    "source": task.source,
                    "asin": task.asin,
                    "requestId": task.id,
                    "taskAttempt": ordinal,
                    "url": task.canonical_url,
                    "channel": channel,
                    "action": str(job_settings.get("action") or job_settings.get("stage", "crawl")),
                    "settings": job_settings,
                    "settingsFingerprint": settings_fingerprint(job_settings),
                    "leaseExpiresAt": utc_iso(task.lease_expires_at),
                    "jobDeadlineAt": utc_iso(job_deadline),
                    "asinDeadlineAt": utc_iso(asin_deadline),
                })
                self._event(session, task.job_id, "task_leased", {"taskId": task.id, "clientId": client_id})
                if len(leases) >= count:
                    break
            if leases:
                client.status = "busy"
                client.last_seen_at = now
        return leases

    def update_progress(self, client_id: str, payload: dict[str, Any]) -> None:
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            if task is None:
                return
            # Progress messages travel over WebSocket while results use a separate
            # HTTP request, so an already-buffered progress message can arrive
            # after the result transaction commits. A persisted result is the
            # source of truth and must never be reopened by late progress.
            if task.result is not None:
                return
            now = utc_now()
            if (
                task.status not in {"leased", "running"}
                or task.assigned_client_id != client_id or task.lease_id != lease_id
                or task.lease_expires_at is None or _as_utc(task.lease_expires_at) <= now
            ):
                return
            task.status = "running"
            task.lease_expires_at = self._renew_lease(session, task, now)
            self._event(session, task.job_id, "task_progress", {
                "taskId": task.id, "clientId": client_id, "progress": _bounded_progress(payload.get("progress")),
            })

    def fail_task(self, client_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        error = dict(payload["error"]) if isinstance(payload.get("error"), dict) else {"message": str(payload.get("error") or "Unknown crawler error")}
        if error.get("status") == "not_found" and error.get("notFoundConfirmed") is not True:
            error.update({"status": "network_error", "reason": "not_found_unverified", "code": "NETWORK_ERROR", "retryable": True, "isRetryable": True,
                          "retryAfter": utc_iso(utc_now() + timedelta(seconds=retry_delay(1, base=30)))})
        if error.get("status") == "partial":
            error["resumeClientId"] = client_id
        error = classify_task_error(error)
        retryable = bool(error["retryable"])
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            if task is None:
                return {"status": "missing"}
            if task.status in TERMINAL_TASK_STATUSES or task.status == "cancelling":
                if task.status == "cancelling":
                    return {"status": "cancelled"}
                return {"status": "duplicate"}
            if (
                task.status not in {"leased", "running"} or task.result is not None
                or task.assigned_client_id != client_id or task.lease_id != lease_id
                or task.lease_expires_at is None or _as_utc(task.lease_expires_at) <= utc_now()
            ):
                return {"status": "stale"}
            task.failure_count += 1
            if retryable:
                now = utc_now()
                retry_after = parse_retry_after(error.get("retryAfter"), now=now)
                minimum_delay = max(0, (retry_after - now).total_seconds()) if retry_after else 0
                seconds = retry_delay(task.failure_count, base=120 if error.get("reason") == "captcha" else 30, retry_after=minimum_delay)
                task.next_retry_at = now + timedelta(seconds=seconds)
                error["retryAfter"] = utc_iso(task.next_retry_at)
            else:
                task.next_retry_at = None
            task.last_error = error
            record_fleet_failure(session, error)
            job = session.get(CrawlJob, task.job_id)
            job_settings = job.settings if job else {}
            if str(job_settings.get("channel", "amazon")).lower() == "amazon":
                amazon_zip = str(job_settings.get("amazonZip") or "90001")
                self._store_negative(session, self._negative_key(task.asin, amazon_zip), error)
                if error.get("reason") == "captcha":
                    self._store_negative(session, CAPTCHA_COOLDOWN_KEY, error)
                if error.get("reason") in {"http_429", "http_503"}:
                    self._store_negative(session, f"{CLIENT_RATE_COOLDOWN_PREFIX}{client_id}", error)
            task.status = "queued" if retryable and task.failure_count < task.max_retry else "dead_letter"
            if task.status == "dead_letter":
                task.completed_at = utc_now()
            attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == lease_id))
            if attempt:
                attempt.status = "failed"
                attempt.error = error
                attempt.error_code = str(error["errorCode"])
                attempt.error_message = str(error.get("message") or "Crawler task failed.")[:1000]
                attempt.finished_at = utc_now()
                attempt.duration_ms = max(0, int((attempt.finished_at - _as_utc(attempt.started_at)).total_seconds() * 1000))
            task.assigned_client_id = None
            task.lease_id = None
            task.lease_expires_at = None
            event_payload = {"taskId": task.id, "retry": task.status == "queued", "error": error}
            # Keep the established failure event for existing observability consumers.
            self._event(session, task.job_id, "task_failed", event_payload)
            if task.status == "dead_letter":
                self._event(session, task.job_id, "task_dead_lettered", event_payload)
            self._refresh_job(session, task.job_id)
            return {"status": task.status, "failureCount": task.failure_count}

    def release_task(self, client_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Fence an unfinished lease and return its task to the scheduler without a failure."""
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        reason = str(payload.get("reason") or "AGENT_PAUSED")
        if reason != "AGENT_PAUSED":
            return {"status": "invalid", "reason": "unsupported_release_reason"}
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            if task is None:
                return {"status": "missing"}
            attempt = session.scalar(select(TaskAttempt).where(
                TaskAttempt.task_id == task_id,
                TaskAttempt.client_id == client_id,
                TaskAttempt.lease_id == lease_id,
            ).with_for_update())
            if attempt is not None and attempt.status == "released":
                return {"status": "duplicate", "jobId": task.job_id}
            if task.result is not None or task.status == "completed":
                return {"status": "completed", "jobId": task.job_id}
            if task.status in {"cancelling", "cancelled"}:
                return {"status": "cancelled", "jobId": task.job_id}
            if (
                task.status not in {"leased", "running"}
                or task.assigned_client_id != client_id
                or task.lease_id != lease_id
                or attempt is None
            ):
                return {"status": "stale", "jobId": task.job_id}

            now = utc_now()
            attempt.status = "released"
            attempt.finished_at = now
            attempt.duration_ms = max(
                0,
                int((now - _as_utc(attempt.started_at)).total_seconds() * 1000),
            )
            task.status = "queued"
            task.assigned_client_id = None
            task.lease_id = None
            task.lease_expires_at = None
            task.next_retry_at = None
            task.completed_at = None
            task.requeue_count += 1
            if task.last_error:
                retained_error = dict(task.last_error)
                retained_error.pop("resumeClientId", None)
                retained_error.pop("retryAfter", None)
                task.last_error = retained_error or None
            self._event(session, task.job_id, "task_released", {
                "taskId": task.id,
                "clientId": client_id,
                "reason": reason,
            })
            self._refresh_job(session, task.job_id)
            return {
                "status": "released",
                "jobId": task.job_id,
                "failureCount": task.failure_count,
                "requeueCount": task.requeue_count,
            }

    @staticmethod
    def _receipt_id(kind: str, task_id: str, client_id: str, lease_id: str, product_key: str = "") -> str:
        return payload_checksum([kind, task_id, client_id, lease_id, product_key])

    @staticmethod
    def _replay_receipt(session, receipt_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        receipt = session.get(UploadReceipt, receipt_id)
        if receipt is None:
            return None
        if receipt.checksum != payload_checksum(payload):
            return {"status": "conflict", "reason": "checksum_mismatch", "receiptId": receipt_id}
        return {**receipt.response, "status": "duplicate"}

    @staticmethod
    def _save_receipt(session, receipt_id: str, task_id: str, payload: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
        digest = payload_checksum(payload)
        acknowledged = {**response, "receiptId": receipt_id, "checksum": digest}
        session.add(UploadReceipt(id=receipt_id, task_id=task_id, checksum=digest, response=acknowledged))
        return acknowledged  # Caller transaction commits before the response escapes.

    def accept_result(self, task_id: str, client_id: str, lease_id: str, checksum: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.sessions.begin() as session:
            task = session.scalar(
                select(CrawlTask).where(CrawlTask.id == task_id).with_for_update()
            )
            if task is None:
                return {"status": "missing"}
            receipt_id = self._receipt_id("final", task_id, client_id, lease_id)
            receipt = self._replay_receipt(session, receipt_id, payload)
            if receipt is not None:
                return receipt
            if task.result is not None:
                # A lost ACK may be retried after completion cleared the lease.
                # Only the writer of the durable result can receive that ACK.
                if task.result.client_id != client_id or task.result.lease_id != lease_id:
                    return {"status": "stale", "taskId": task.id}
                if str(payload.get("jobId") or "") != task.job_id:
                    return {"status": "invalid", "taskId": task.id, "reason": "job_identity"}
                # Legacy results retain the original transport checksum even
                # when raw products have been pruned. Do not hash pruned data.
                if task.result.checksum != checksum:
                    return {"status": "conflict", "reason": "checksum_mismatch"}
                return self._save_receipt(session, receipt_id, task_id, payload, {"status": "duplicate", "taskId": task.id})
            if task.status in {"cancelling", "cancelled"}:
                return {"status": "cancelled", "taskId": task.id}
            # Historical attempts prove issuance, not current authority. Check
            # ownership and expiry under the task row lock, before any writes.
            if (
                task.status not in {"leased", "running"}
                or task.assigned_client_id != client_id
                or task.lease_id != lease_id
                or task.lease_expires_at is None
                or _as_utc(task.lease_expires_at) <= utc_now()
            ):
                return {"status": "stale", "taskId": task.id}
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
            job = session.get(CrawlJob, task.job_id)
            for product in products:
                if isinstance(product, dict) and product.get("id"):
                    existing_shopify_product = self._existing_shopify_product(session, job, product)
                    if existing_shopify_product is not None:
                        exact_asins, shopify_product_ids = existing_shopify_product
                        self._event(session, task.job_id, "product_skipped_existing_shopify", {
                            "taskId": task.id,
                            "sourceKey": _source_key(product),
                            "asins": sorted(exact_asins),
                            "shopifyProductIds": shopify_product_ids,
                            "transport": "final_result",
                        })
                        continue
                    retained_id = self._retained_pipeline_product(session, job, product)
                    if retained_id is not None:
                        self._event(session, task.job_id, "product_skipped_existing_pipeline", {
                            "sourceKey": _source_key(product), "productItemId": retained_id,
                        })
                        continue
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
            task.next_retry_at = None
            amazon_zip = str((job.settings if job else {}).get("amazonZip") or "90001")
            negative = session.get(CoordinatorState, self._negative_key(task.asin, amazon_zip))
            if negative is not None:
                session.delete(negative)
            task.completed_at = utc_now()
            task.assigned_client_id = client_id
            task.lease_id = lease_id
            task.lease_expires_at = None
            attempt.status = "completed"
            attempt.finished_at = utc_now()
            attempt.result_checksum = checksum
            attempt.duration_ms = max(0, int((attempt.finished_at - _as_utc(attempt.started_at)).total_seconds() * 1000))
            record_fleet_success(session, attempt.started_at)
            completion_event: dict[str, Any] = {"taskId": task.id, "clientId": client_id}
            if str((job.settings if job else {}).get("channel") or "").lower() == "pinterest":
                candidate_count = len(payload.get("candidates")) if isinstance(payload.get("candidates"), list) else 0
                completion_event["message"] = (
                    f"Agent đã gửi thành công {candidate_count} candidate về server."
                )
            self._event(session, task.job_id, "task_completed", completion_event)
            self._refresh_job(session, task.job_id)
            return self._save_receipt(session, receipt_id, task_id, payload, {"status": "accepted", "taskId": task.id})

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
        job = session.get(CrawlJob, task.job_id)
        released_alias = session.scalar(select(AmazonAsinRegistry.id).where(
            AmazonAsinRegistry.store_id == str((job.settings if job else {}).get("storeId") or "").strip(),
            AmazonAsinRegistry.asin.in_(CoordinatorStore._product_exact_asins(product)),
            AmazonAsinRegistry.status == "released",
        ).limit(1))
        if released_alias is not None:
            item.shopify_result = {"recoverySyncGeneration": 1}
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
            if str(payload.get("jobId") or "") != task.job_id:
                return {"status": "invalid", "reason": "job_identity"}
            product = payload.get("product")
            if not isinstance(product, dict):
                return {"status": "invalid", "reason": "product_payload"}
            source_key = _source_key(product)
            if product_key not in {source_key, str(product.get("id") or "")}:
                return {"status": "invalid", "reason": "product_identity"}
            receipt_id = self._receipt_id("product", task_id, client_id, lease_id, source_key)
            receipt = self._replay_receipt(session, receipt_id, payload)
            if receipt is not None:
                return receipt
            if task.status in {"cancelling", "cancelled"}:
                return {"status": "cancelled"}
            # Streaming writes must have current authority too; a historical
            # attempt must not enqueue downstream work after reassignment.
            if (
                task.status not in {"leased", "running"}
                or task.assigned_client_id != client_id
                or task.lease_id != lease_id
                or task.lease_expires_at is None
                or _as_utc(task.lease_expires_at) <= utc_now()
            ):
                return {"status": "stale"}
            attempt = session.scalar(select(TaskAttempt).where(
                TaskAttempt.task_id == task.id,
                TaskAttempt.client_id == client_id,
                TaskAttempt.lease_id == lease_id,
            ))
            if attempt is None:
                return {"status": "stale"}
            job = session.get(CrawlJob, task.job_id)
            existing_shopify_product = self._existing_shopify_product(session, job, product)
            if existing_shopify_product is not None:
                exact_asins, shopify_product_ids = existing_shopify_product
                self._event(session, task.job_id, "product_skipped_existing_shopify", {
                    "taskId": task.id,
                    "sourceKey": source_key,
                    "asins": sorted(exact_asins),
                    "shopifyProductIds": shopify_product_ids,
                })
                return self._save_receipt(session, receipt_id, task_id, payload, {
                    "status": "duplicate",
                    "reason": "existing_shopify_product",
                    "sourceKey": source_key,
                    "shopifyProductIds": shopify_product_ids,
                })
            existing = session.scalar(select(CrawlProductItem).where(
                CrawlProductItem.job_id == task.job_id, CrawlProductItem.source_key == source_key,
            ))
            retained_id = self._retained_pipeline_product(session, job, product)
            if retained_id is not None:
                self._event(session, task.job_id, "product_skipped_existing_pipeline", {
                    "sourceKey": source_key, "productItemId": retained_id,
                })
                return self._save_receipt(session, receipt_id, task_id, payload, {
                    "status": "duplicate", "reason": "existing_pipeline_product",
                    "sourceKey": source_key, "productItemId": retained_id,
                })
            if existing is not None:
                # sourceKey is the stable product identity within a crawl job.
                # Retries may legitimately change volatile diagnostics and
                # timestamps, so preserve the first accepted payload and ACK
                # the later lease without enqueueing duplicate pipeline work.
                return self._save_receipt(session, receipt_id, task_id, payload, {
                    "status": "duplicate",
                    "productItemId": existing.id,
                    "sourceKey": existing.source_key,
                })
            item, created = self._upsert_product_item(
                session,
                task=task,
                client_id=client_id,
                lease_id=lease_id,
                product=product,
                checksum=str(payload.get("productChecksum") or checksum),
            )
            self._upsert_asin_registry(
                session,
                store_id=str((job.settings if job else {}).get("storeId") or ""),
                job_id=task.job_id,
                product=product,
                status="crawled",
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
            return self._save_receipt(session, receipt_id, task_id, payload, {
                "status": "accepted" if created else "duplicate",
                "productItemId": item.id,
                "sourceKey": item.source_key,
            })

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
                .order_by(CrawlProductItem.next_attempt_at.asc().nulls_first(), CrawlProductItem.created_at)
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
                if not pipeline_result.get("externalSeo"):
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
                    "seoSourceRevision": (
                        f"{item.checksum}:recovery:{item.id}:{pipeline_result['recoverySyncGeneration']}"
                        if pipeline_result.get("recoverySyncGeneration") else item.checksum
                    ),
                    "attempt": item.attempt_count,
                    "isRecovery": bool(pipeline_result.get("recoverySyncGeneration")),
                    "stage": "sync" if is_sync_claim else "prepare",
                    "externalSeo": pipeline_result.get("externalSeo"),
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

    def skip_existing_shopify_product(
        self, item_id: str, *, worker_id: str, matches: list[dict[str, Any]],
    ) -> bool:
        with self.sessions.begin() as session:
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.id == item_id).with_for_update())
            if item is None or item.claimed_by != worker_id or item.status != "normalizing":
                return False
            pipeline_result = dict(item.shopify_result or {})
            if pipeline_result.get("externalSeo") or pipeline_result.get("recoverySyncGeneration"):
                return False
            exact_asins = self._product_exact_asins(item.raw_payload)
            matched_asins = {str(match.get("asin") or "") for match in matches}
            if not exact_asins or matched_asins != exact_asins or any(
                re.fullmatch(r"gid://shopify/Product/[0-9]+", str(match.get("productId") or "")) is None
                for match in matches
            ):
                return False
            job = session.get(CrawlJob, item.job_id)
            store_id = str((job.settings or {}).get("storeId") or "").strip() if job else ""
            if not store_id:
                return False
            for match in matches:
                self._upsert_asin_registry(
                    session, store_id=store_id, job_id=item.job_id,
                    product={**item.raw_payload, "asin": match["asin"], "sourceVariants": [{"asin": match["asin"]}]},
                    status="synced", shopify_product_id=match["productId"],
                )
            pipeline_result.update({"skippedExistingShopify": True, "existingShopifyMatches": matches})
            item.shopify_result = pipeline_result
            item.status = "completed"
            item.claimed_by = None
            item.claim_expires_at = None
            item.next_attempt_at = None
            item.last_error = None
            item.completed_at = utc_now()
            self._event(session, item.job_id, "product_skipped_existing_shopify", {
                "sourceKey": item.source_key, "productItemId": item.id,
                "asins": sorted(exact_asins), "shopifyProductIds": sorted({match["productId"] for match in matches}),
                "reason": "live_exact_asin_check",
            })
            session.flush()
            self._refresh_job(session, item.job_id)
            return True

    def defer_external_seo(
        self,
        item_id: str,
        *,
        worker_id: str,
        external_job_id: str,
        provider: str = "custom_gpt",
    ) -> bool:
        """Park the item without occupying a worker while a human-driven GPT processes it."""
        if provider not in {"custom_gpt", "codex_mcp"}:
            raise ValueError("Unsupported external SEO provider.")
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, item_id)
            if item is None or item.claimed_by != worker_id or item.status != "seo":
                return False
            item.shopify_result = {
                **dict(item.shopify_result or {}),
                "externalSeo": {"jobId": external_job_id, "provider": provider},
                "seo": {"status": "pending", "engine": provider},
            }
            item.status = "retry_wait"
            item.next_attempt_at = utc_now() + timedelta(seconds=60)
            item.claimed_by = None
            item.claim_expires_at = None
            self._refresh_job(session, item.job_id)
            return True

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
            checkpointed_image_summary = current.get("imageProcessing")
            if (
                not isinstance(checkpointed_image_summary, dict)
                or checkpointed_image_summary.get("status") != "completed"
                or image_summary.get("status") != "completed"
            ):
                return False
            current["seo"] = seo_summary
            current["imageProcessing"] = image_summary
            current["review"] = {
                **review_summary,
                "syncGeneration": int(current.get("recoverySyncGeneration") or 0),
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
            "syncGeneration": int(review.get("syncGeneration") or 0),
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
        with self._review_mutation_lock:
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
                session.flush()
                for job_id in job_ids:
                    self._refresh_job(session, job_id)
            return {"deleted": deleted, "skipped": skipped}

    def delete_product_review(self, item_id: str) -> dict[str, Any]:
        with self._review_mutation_lock, self.sessions.begin() as session:
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.id == item_id).with_for_update())
            if item is None or item.status == "deleted":
                return {"deleted": False, "reason": "not_found"}
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            if not review:
                return {"deleted": False, "reason": "not_found"}
            if item.status not in {"waiting_review", "rejected", "completed", "failed"}:
                return {"deleted": False, "reason": "sync_in_progress"}
            review["deletedAt"] = utc_iso(utc_now())
            review["version"] = int(review.get("version") or 1) + 1
            pipeline_result["review"] = review
            item.shopify_result = pipeline_result
            item.status = "deleted"
            item.completed_at = utc_now()
            self._event(session, item.job_id, "product_review_deleted", {"productItemId": item.id})
            session.flush()
            self._refresh_job(session, item.job_id)
            return {"deleted": True}

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

    def queue_product_review_sync(self, item_id: str, *, reconcile: bool = False) -> dict[str, Any] | None:
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
            if item.status == "reconciliation_required" and not reconcile:
                return {"reconciliationRequired": True}
            current_sync_status = str(review.get("syncStatus") or "idle")
            if current_sync_status == "synced" and not reconcile:
                return {"alreadySynced": True}
            if str(review.get("syncStatus") or "idle") in {"queued", "syncing"}:
                return self._review_snapshot(item, session.get(CrawlJob, item.job_id))
            if reconcile:
                legacy_product_id = str(pipeline_result.get("productId") or "").strip()
                if legacy_product_id:
                    job = session.get(CrawlJob, item.job_id)
                    settings = dict(job.settings or {}) if job is not None and isinstance(job.settings, dict) else {}
                    effective_store_id = str(review.get("storeId") or settings.get("storeId") or "").strip()
                    self._upsert_shopify_link(
                        session,
                        item=item,
                        store_id=effective_store_id,
                        normalized_checksum=item.checksum,
                        shopify_result=pipeline_result,
                    )
                    self._upsert_asin_registry(
                        session,
                        store_id=effective_store_id,
                        job_id=item.job_id,
                        product=dict(item.normalized_payload or item.raw_payload or {}),
                        status="synced",
                        shopify_product_id=legacy_product_id,
                    )
                review["syncGeneration"] = int(review.get("syncGeneration") or 0) + 1
                review["reconciliationRequestedAt"] = utc_iso(utc_now())
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

    def mark_product_review_synced(
        self,
        item_id: str,
        *,
        product_id: str | None = None,
        product_handle: str | None = None,
        admin_url: str | None = None,
    ) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.id == item_id).with_for_update())
            if item is None:
                return None
            if item.status == "deleted":
                return {"deleted": True}
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            now_iso = utc_iso(utc_now())
            review.update({
                "decision": "approved",
                "syncStatus": "synced",
                "syncError": None,
                "syncedAt": now_iso,
                "updatedAt": now_iso,
            })
            if product_id:
                pipeline_result["productId"] = product_id
            if product_handle:
                pipeline_result["productHandle"] = product_handle
            if admin_url:
                pipeline_result["adminUrl"] = admin_url
            pipeline_result["review"] = review
            if product_id:
                job = session.get(CrawlJob, item.job_id)
                settings = dict(job.settings or {}) if job is not None and isinstance(job.settings, dict) else {}
                effective_store_id = str(review.get("storeId") or settings.get("storeId") or "").strip()
                self._upsert_shopify_link(
                    session,
                    item=item,
                    store_id=effective_store_id,
                    normalized_checksum=item.checksum,
                    shopify_result=pipeline_result,
                )
                self._upsert_asin_registry(
                    session,
                    store_id=effective_store_id,
                    job_id=item.job_id,
                    product=dict(item.normalized_payload or item.raw_payload or {}),
                    status="synced",
                    shopify_product_id=product_id,
                )
            item.shopify_result = pipeline_result
            item.status = "completed"
            item.last_error = None
            item.next_attempt_at = None
            item.claim_expires_at = None
            item.claimed_by = None
            item.completed_at = utc_now()
            self._event(session, item.job_id, "product_review_synced", {
                "productItemId": item.id,
                "productId": product_id,
            })
            self._refresh_job(session, item.job_id)
            return self._review_snapshot(item, session.get(CrawlJob, item.job_id))

    def mark_product_review_sync_failed(
        self,
        item_id: str,
        *,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.id == item_id).with_for_update())
            if item is None:
                return None
            if item.status == "deleted":
                return {"deleted": True}
            pipeline_result = dict(item.shopify_result or {})
            review = dict(pipeline_result.get("review") or {})
            now_iso = utc_iso(utc_now())
            review.update({
                "syncStatus": "failed",
                "syncError": error or "Lỗi khi đẩy sản phẩm lên Shopify.",
                "updatedAt": now_iso,
            })
            pipeline_result["review"] = review
            item.shopify_result = pipeline_result
            item.status = "waiting_review"
            item.last_error = {"message": error or "Lỗi khi đẩy sản phẩm lên Shopify.", "code": "SYNC_FAILED"}
            self._event(session, item.job_id, "product_review_sync_failed", {
                "productItemId": item.id,
                "error": error,
            })
            self._refresh_job(session, item.job_id)
            return self._review_snapshot(item, session.get(CrawlJob, item.job_id))

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
            item.shopify_result = {**dict(item.shopify_result or {}), "seo": seo_summary}
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
            self._upsert_asin_registry(
                session,
                store_id=store_id,
                job_id=item.job_id,
                product=item.raw_payload,
                status="synced",
                shopify_product_id=str(shopify_result.get("productId") or "").strip() or None,
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
            self._upsert_asin_registry(
                session,
                store_id=store_id,
                job_id=item.job_id,
                product=item.raw_payload,
                status="synced",
                shopify_product_id=product_id or None,
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
            item.claimed_by = None
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
                session.execute(delete(CrawlTelemetryEvent).where(CrawlTelemetryEvent.job_id.in_(job_ids)))
                session.execute(delete(InvalidJobInput).where(InvalidJobInput.job_id.in_(job_ids)))
                session.execute(delete(CrawlProductItem).where(CrawlProductItem.job_id.in_(job_ids)))
                if task_ids:
                    for job_id in job_ids:
                        attempts = session.scalars(select(TaskAttempt).join(CrawlTask).where(
                            CrawlTask.job_id == job_id,
                        )).all()
                        for attempt in attempts:
                            self._archive_task_attempt(session, attempt, job_id=job_id)
                    session.execute(delete(UploadReceipt).where(UploadReceipt.task_id.in_(task_ids)))
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

    def cleanup_attempt_history(self, *, now=None) -> dict[str, int]:
        """Delete terminal attempt evidence after the approved seven-day window."""
        current_time = now or utc_now()
        cutoff = current_time - timedelta(days=self.ATTEMPT_HISTORY_RETENTION_DAYS)
        with self.sessions.begin() as session:
            live_attempts = session.execute(delete(TaskAttempt).where(
                TaskAttempt.finished_at.is_not(None),
                TaskAttempt.finished_at < cutoff,
            ))
            archived_attempts = session.execute(delete(ArchivedTaskAttempt).where(
                ArchivedTaskAttempt.archived_at < cutoff,
            ))
            return {
                "attempts": int(live_attempts.rowcount or 0),
                "archivedAttempts": int(archived_attempts.rowcount or 0),
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

    def _expire_jobs(self, now: datetime) -> None:
        with self.sessions() as session:
            expired = [job.id for job in session.scalars(select(CrawlJob).where(CrawlJob.status.in_(["queued", "running"])))
                       if now >= _as_utc(job.created_at) + timedelta(seconds=float(job.settings.get("jobTimeoutSeconds", 21600)))]
        for job_id in expired:
            with self.sessions.begin() as session:
                job = session.get(CrawlJob, job_id)
                if job is None or job.status not in {"queued", "running"}:
                    continue
                elapsed = (now - _as_utc(job.created_at)).total_seconds()
                error = CrawlTimeout("job", started=time.monotonic() - elapsed).as_error("")
                tasks = session.scalars(select(CrawlTask).where(CrawlTask.job_id == job_id)).all()
                unfinished = [task for task in tasks if task.status not in TERMINAL_TASK_STATUSES]
                for task in unfinished or tasks[:1]:
                    task.last_error = {**error, "source": task.source}
                self._event(session, job_id, "job_timed_out", error)
            # Reuse Stop's handling of in-flight Shopify writes and agent acknowledgements; it preserves product caches.
            self.cancel_job(job_id)

    def reap_expired(self) -> dict[str, int]:
        now = utc_now()
        self._expire_jobs(now)
        offline = 0
        requeued = 0
        with self.sessions.begin() as session:
            job_ids: set[str] = set()
            clients = session.scalars(select(ClientRecord).where(ClientRecord.status != "offline")).all()
            for client in clients:
                offline_seconds = AgentRuntimeConfig.from_payload(client.applied_agent_config or {}).clientOfflineAfterSeconds
                if _as_utc(client.last_seen_at) < now - timedelta(seconds=offline_seconds):
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
                deadline = self._task_deadline(session, task)
                if deadline is not None and now >= deadline:
                    attempt_started = session.scalar(select(TaskAttempt.leased_at).where(TaskAttempt.lease_id == old_lease))
                    elapsed = (now - _as_utc(attempt_started)).total_seconds() if attempt_started else 0
                    error = CrawlTimeout("asin", started=time.monotonic() - elapsed).as_error(task.source)
                    error.update({"elapsedMs": round(elapsed * 1000), "retryAfter": utc_iso(now + timedelta(seconds=retry_delay(task.failure_count + 1, base=30))),
                                  "attempt": task.failure_count + 1, "resumeClientId": task.assigned_client_id})
                else:
                    error = {"status": "network_error", "reason": "lease_expired", "retryable": True,
                             "message": "Agent lease expired before a durable result was accepted."}
                error = classify_task_error(error)
                task.failure_count += 1
                task.last_error = error
                retry_after = parse_retry_after(error.get("retryAfter"), now=now)
                minimum_delay = max(0, (retry_after - now).total_seconds()) if retry_after else 0
                task.next_retry_at = now + timedelta(seconds=retry_delay(
                    task.failure_count, base=30, retry_after=minimum_delay,
                ))
                error["retryAfter"] = utc_iso(task.next_retry_at)
                if task.status != "cancelling":
                    job = session.get(CrawlJob, task.job_id)
                    if deadline is not None and job is not None:
                        self._store_negative(session, self._negative_key(task.asin, str(job.settings.get("amazonZip", "90001"))), error)
                    self._event(session, task.job_id, "task_timed_out" if deadline is not None else "task_lease_expired",
                                {"taskId": task.id, "error": error})
                task.status = "queued" if task.failure_count < task.max_retry else "dead_letter"
                if task.status == "dead_letter":
                    task.completed_at = now
                task.assigned_client_id = None
                task.lease_id = None
                task.lease_expires_at = None
                job_ids.add(task.job_id)
                requeued += 1
                if old_lease:
                    attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == old_lease))
                    if attempt:
                        attempt.status = "failed"
                        attempt.error = task.last_error
                        attempt.error_code = str(task.last_error.get("errorCode") or "UNKNOWN")
                        attempt.error_message = str(task.last_error.get("message") or "Lease expired.")[:1000]
                        attempt.finished_at = now
                        attempt.duration_ms = max(0, int((now - _as_utc(attempt.started_at)).total_seconds() * 1000))
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
                    "sourceKey": item.source_key,
                })
            for job_id in job_ids:
                self._refresh_job(session, job_id)
        return {"offlineClients": offline, "requeuedTasks": requeued}

    def cancel_job(
        self,
        job_id: str,
        connected_client_ids: set[str] | None = None,
        force: bool = False,
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
                elapsed_seconds = (now - _as_utc(control.cancel_requested_at)).total_seconds() if control.cancel_requested_at else 999
                if not force and elapsed_seconds < 15:
                    return self._job_snapshot(session, job)
                # Stalled cancellation (>15s or re-requested by user with force): force-finalize remaining items and tasks
                for item in session.scalars(select(CrawlProductItem).where(
                    CrawlProductItem.job_id == job_id,
                    CrawlProductItem.status.in_(["cancelling", "stopping_after_write"]),
                )):
                    was_stopping = item.status == "stopping_after_write"
                    item.status = "cancelled"
                    item.claimed_by = None
                    item.claim_expires_at = None
                    item.completed_at = now
                    if was_stopping:
                        for operation in session.scalars(select(ShopifyOperationIdempotency).where(
                            ShopifyOperationIdempotency.request_id == _shopify_sync_request_id(item.source_key),
                            ShopifyOperationIdempotency.state == "pending",
                        )):
                            operation.state = "reconciliation_required"
                            operation.response_payload = {
                                "itemId": item.id,
                                "sourceKey": item.source_key,
                                "reason": "Job force-stopped after Shopify write started without a confirmed checkpoint.",
                            }
                for task in session.scalars(select(CrawlTask).where(
                    CrawlTask.job_id == job_id,
                    CrawlTask.status.in_(["cancelling", "leased", "running"]),
                )):
                    task.status = "cancelled"
                    task.lease_expires_at = None
                    task.completed_at = now
                    if task.lease_id:
                        attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == task.lease_id))
                        if attempt is not None:
                            attempt.status = "cancelled"
                            attempt.finished_at = now
                self._refresh_job(session, job_id)
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
            # A job cancellation only discards that job's work. Cache generations
            # are reserved for explicit cache invalidation.
            cache_generation = self._cache_generation(session)
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

    def cancel_task(self, task_id: str, connected_client_ids: set[str] | None = None) -> dict[str, Any] | None:
        """Cancel one crawl task without changing its job or sibling tasks."""
        now = utc_now()
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            if task is None:
                return None
            job = session.get(CrawlJob, task.job_id)
            if job is None:
                return None
            if task.status in TERMINAL_TASK_STATUSES:
                return {"taskId": task.id, "jobId": task.job_id, "status": task.status,
                        "clientId": task.assigned_client_id, "leaseId": task.lease_id}
            owner_is_connected = (
                task.status in {"leased", "running", "cancelling"}
                and bool(task.lease_id)
                and task.assigned_client_id is not None
                and (connected_client_ids is None or task.assigned_client_id in connected_client_ids)
            )
            if owner_is_connected:
                task.status = "cancelling"
                attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == task.lease_id))
                if attempt is not None and attempt.status not in {"cancelled", "completed"}:
                    attempt.status = "cancelling"
                status = "cancelling"
            else:
                task.status = "cancelled"
                task.completed_at = now
                task.lease_expires_at = None
                attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == task.lease_id)) if task.lease_id else None
                if attempt is not None:
                    attempt.status = "cancelled"
                    attempt.finished_at = now
                status = "cancelled"
            self._event(session, task.job_id, "task_cancel_requested", {
                "taskId": task.id,
                "clientId": task.assigned_client_id,
                "status": status,
            })
            self._refresh_job(session, task.job_id)
            return {"taskId": task.id, "jobId": task.job_id, "status": status,
                    "clientId": task.assigned_client_id, "leaseId": task.lease_id}

    def cancel_pending_tasks(self, client_id: str, task_ids: list[str],
                             executing_task_ids: set[str] | None = None) -> list[dict[str, Any]] | None:
        """Atomically fence a confirmed set of this agent's never-started leases."""
        unique_ids = list(dict.fromkeys(task_ids))
        if (not unique_ids or len(unique_ids) != len(task_ids)
                or bool(set(unique_ids) & (executing_task_ids or set()))):
            return None
        now = utc_now()
        with self.sessions.begin() as session:
            tasks = list(session.scalars(select(CrawlTask).where(
                CrawlTask.id.in_(unique_ids),
            ).order_by(CrawlTask.id).with_for_update()))
            if len(tasks) != len(unique_ids) or any(
                task.status != "leased" or task.assigned_client_id != client_id or not task.lease_id
                for task in tasks
            ):
                return None
            snapshots = []
            for task in tasks:
                task.status = "cancelled"
                task.completed_at = now
                task.lease_expires_at = None
                attempt = session.scalar(select(TaskAttempt).where(
                    TaskAttempt.task_id == task.id,
                    TaskAttempt.client_id == client_id,
                    TaskAttempt.lease_id == task.lease_id,
                ).with_for_update())
                if attempt is not None:
                    attempt.status = "cancelled"
                    attempt.finished_at = now
                self._event(session, task.job_id, "pending_task_purged", {
                    "taskId": task.id,
                    "clientId": client_id,
                    "scope": "pending",
                })
                snapshots.append({"taskId": task.id, "jobId": task.job_id,
                                  "leaseId": task.lease_id, "status": "cancelled"})
            for job_id in {task.job_id for task in tasks}:
                job = session.get(CrawlJob, job_id)
                if job is not None:
                    self._refresh_job(session, job_id)
            return snapshots

    def preview_pending_tasks(self, client_id: str, task_ids: list[str],
                              executing_task_ids: set[str] | None = None) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(task_ids))
        with self.sessions() as session:
            tasks = list(session.scalars(select(CrawlTask).where(CrawlTask.id.in_(unique_ids)))) if unique_ids else []
            eligible = [task.id for task in tasks if task.status == "leased"
                        and task.assigned_client_id == client_id and task.lease_id
                        and task.id not in (executing_task_ids or set())]
            return {"scope": "pending", "requestedCount": len(task_ids),
                    "pendingCount": len(eligible), "eligibleTaskIds": sorted(eligible),
                    "ineligibleCount": len(task_ids) - len(eligible)}

    def preview_all_local_pending_tasks(self, client_id: str,
                                        executing_task_ids: set[str] | None = None) -> dict[str, Any]:
        """Snapshot every unstarted lease owned by this agent, with a hard protocol bound."""
        with self.sessions() as session:
            tasks = list(session.scalars(select(CrawlTask).where(
                CrawlTask.assigned_client_id == client_id,
                CrawlTask.status == "leased",
            ).order_by(CrawlTask.id).limit(501)))
            eligible = [task.id for task in tasks if task.lease_id
                        and task.id not in (executing_task_ids or set())]
            overflow = len(tasks) > 500
            return {"scope": "all-local", "requestedCount": len(tasks),
                    "pendingCount": len(eligible), "eligibleTaskIds": sorted(eligible) if not overflow else [],
                    "ineligibleCount": len(tasks) - len(eligible), "overflow": overflow}

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

    def acknowledge_task_cancel(self, client_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or "")
        lease_id = str(payload.get("leaseId") or "")
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            if task is None:
                return {"status": "discarded"}
            attempt = session.scalar(select(TaskAttempt).where(
                TaskAttempt.task_id == task_id, TaskAttempt.client_id == client_id, TaskAttempt.lease_id == lease_id,
            ))
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
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
            if task is None:
                return {"status": "discarded"}
            if (
                task.status != "cancelling"
                or task.assigned_client_id != client_id
                or task.lease_id != lease_id
            ):
                return {"status": "stale", "jobId": task.job_id}
            attempt = session.scalar(select(TaskAttempt).where(
                TaskAttempt.task_id == task_id, TaskAttempt.client_id == client_id, TaskAttempt.lease_id == lease_id,
            ))
            if attempt is not None and attempt.status == "cancelling":
                attempt.status = "cancelling_received"
                self._event(session, task.job_id, "task_cancel_received", {
                    "taskId": task.id,
                    "clientId": client_id,
                })
            return {"status": "received", "jobId": task.job_id}

    def reconcile_tasks(self, client_id: str, local_tasks: list[dict[str, Any]]) -> dict[str, list[str]]:
        resume: list[str] = []
        upload: list[str] = []
        discard: list[str] = []
        cancel_tasks: list[str] = []
        cancelled_jobs: set[str] = set()
        refreshed_job_ids: set[str] = set()
        now = utc_now()
        with self.sessions.begin() as session:
            for local in local_tasks:
                task_id = str(local.get("taskId") or "")
                lease_id = str(local.get("leaseId") or "")
                job_id = str(local.get("jobId") or "")
                task = session.scalar(select(CrawlTask).where(CrawlTask.id == task_id).with_for_update())
                # A client-supplied job ID must not select another job's cancel
                # state/tombstone and apply it to this task.
                if task is not None and task.job_id != job_id:
                    discard.append(task_id)
                    continue
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
                if job.status in {"cancelling", "cancelled"} or task.status == "cancelled":
                    discard.append(task_id)
                    if job.status in {"cancelling", "cancelled"}:
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
                if task.status == "cancelling":
                    if task.assigned_client_id == client_id and task.lease_id == lease_id:
                        cancel_tasks.append(task_id)
                    else:
                        discard.append(task_id)
                    continue
                if task.result is not None and task.result.client_id == client_id and task.result.lease_id == lease_id:
                    upload.append(task_id)
                    continue
                if (
                    task.job_id == job_id
                    and task.assigned_client_id == client_id and task.lease_id == lease_id
                    and task.status in {"leased", "running"} and task.result is None
                    and task.lease_expires_at is not None and _as_utc(task.lease_expires_at) > utc_now()
                ):
                    # Reconnect may resume live authority, never claim a queued
                    # task or resurrect an expired lease. Only lease_tasks grants it.
                    task.status = "running"
                    task.lease_expires_at = self._renew_lease(session, task, utc_now())
                    resume.append(task_id)
                    continue
                discard.append(task_id)
            for refreshed_job_id in refreshed_job_ids:
                self._refresh_job(session, refreshed_job_id)
        return {
            "resumeTaskIds": resume,
            "uploadTaskIds": upload,
            "discardTaskIds": discard,
            "cancelTaskIds": cancel_tasks,
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
    def _archive_task_attempt(session, attempt: TaskAttempt, *, job_id: str) -> None:
        if session.get(ArchivedTaskAttempt, attempt.id) is not None:
            return
        session.add(ArchivedTaskAttempt(
            id=attempt.id,
            task_id=attempt.task_id,
            job_id=job_id,
            snapshot={
                "clientId": attempt.client_id, "leaseId": attempt.lease_id,
                "status": attempt.status, "error": attempt.error,
                "errorCode": attempt.error_code, "errorMessage": attempt.error_message,
                "agentVersion": attempt.agent_version, "crawlerVersion": attempt.crawler_version,
                "parserVersion": attempt.parser_version, "leasedAt": utc_iso(attempt.leased_at),
                "startedAt": utc_iso(attempt.started_at),
                "finishedAt": utc_iso(attempt.finished_at) if attempt.finished_at else None,
                "durationMs": attempt.duration_ms, "resultChecksum": attempt.result_checksum,
            },
        ))

    @staticmethod
    def _purge_job_rows(session, job_id: str) -> None:
        task_ids = session.scalars(select(CrawlTask.id).where(CrawlTask.job_id == job_id)).all()
        if task_ids:
            for attempt in session.scalars(select(TaskAttempt).where(TaskAttempt.task_id.in_(task_ids))).all():
                CoordinatorStore._archive_task_attempt(session, attempt, job_id=job_id)
        session.execute(delete(JobEvent).where(JobEvent.job_id == job_id))
        session.execute(delete(CrawlTelemetryEvent).where(CrawlTelemetryEvent.job_id == job_id))
        session.execute(delete(InvalidJobInput).where(InvalidJobInput.job_id == job_id))
        session.execute(delete(CrawlProductItem).where(CrawlProductItem.job_id == job_id))
        if task_ids:
            session.execute(delete(UploadReceipt).where(UploadReceipt.task_id.in_(task_ids)))
            session.execute(delete(TaskResult).where(TaskResult.task_id.in_(task_ids)))
            session.execute(delete(TaskAttempt).where(TaskAttempt.task_id.in_(task_ids)))
        session.execute(delete(CrawlTask).where(CrawlTask.job_id == job_id))
        session.execute(delete(JobStopClientCleanup).where(JobStopClientCleanup.job_id == job_id))
        session.execute(delete(CrawlJobControl).where(CrawlJobControl.job_id == job_id))
        session.execute(delete(CoordinatorState).where(CoordinatorState.key == f"review-samples:{job_id}"))
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

    def assert_job_deletable(self, job_id: str) -> bool:
        with self.sessions.begin() as session:
            existing_tombstone = session.get(DeletedCrawlJob, job_id)
            job = session.get(CrawlJob, job_id)
            if job is None:
                return existing_tombstone is not None
            statuses = set(session.scalars(select(CrawlProductItem.status).where(
                CrawlProductItem.job_id == job_id,
                CrawlProductItem.status.not_in(TERMINAL_PRODUCT_STATUSES),
            )).all())
            if statuses:
                raise ProductPipelineActiveError(job_id, statuses)
            return True

    def delete_job(self, job_id: str) -> bool:
        if not self.assert_job_deletable(job_id):
            return False
        with self.sessions() as session:
            if session.get(CrawlJob, job_id) is None:
                return session.get(DeletedCrawlJob, job_id) is not None
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

    def archive_job(self, job_id: str) -> bool:
        """Hide terminal crawler history without deleting downstream pipeline state."""
        with self.sessions.begin() as session:
            job = session.scalar(select(CrawlJob).where(CrawlJob.id == job_id).with_for_update())
            if job is None:
                return False
            if job.status in ACTIVE_JOB_STATUSES:
                raise ValueError("An active crawl job cannot be archived.")
            if job.archived_at is None:
                job.archived_at = utc_now()
                self._event(session, job_id, "job_archived", {"reason": "hidden_from_crawler_history"})
            return True

    def list_dead_letter_tasks(
        self, *, job_id: str | None = None, error_code: str | None = None, limit: int = 100, offset: int = 0,
    ) -> dict[str, Any]:
        query = select(CrawlTask).where(CrawlTask.status == "dead_letter")
        count_query = select(func.count(CrawlTask.id)).where(CrawlTask.status == "dead_letter")
        if job_id:
            query = query.where(CrawlTask.job_id == job_id)
            count_query = count_query.where(CrawlTask.job_id == job_id)
        if error_code:
            query = query.where(CrawlTask.last_error["errorCode"].as_string() == error_code.upper())
            count_query = count_query.where(CrawlTask.last_error["errorCode"].as_string() == error_code.upper())
        bounded_limit = max(1, min(100, int(limit)))
        bounded_offset = max(0, int(offset))
        with self.sessions() as session:
            total = int(session.scalar(count_query) or 0)
            tasks = session.scalars(query.order_by(CrawlTask.completed_at.desc(), CrawlTask.id).limit(bounded_limit).offset(bounded_offset)).all()
            items = []
            for task in tasks:
                attempt_count = int(session.scalar(select(func.count(TaskAttempt.id)).where(TaskAttempt.task_id == task.id)) or 0)
                items.append({
                    "taskId": task.id, "jobId": task.job_id, "asin": task.asin, "status": task.status,
                    "failureCount": task.failure_count, "maxRetry": task.max_retry,
                    "requeueCount": task.requeue_count, "attemptCount": attempt_count,
                    "errorCode": str((task.last_error or {}).get("errorCode") or "UNKNOWN"),
                    "errorMessage": str((task.last_error or {}).get("message") or "Crawler task failed.")[:1000],
                    "nextRetryAt": utc_iso(task.next_retry_at) if task.next_retry_at else None,
                    "createdAt": utc_iso(task.created_at),
                    "failedAt": utc_iso(task.completed_at) if task.completed_at else None,
                })
            return {"items": items, "total": total, "limit": bounded_limit, "offset": bounded_offset}

    def list_task_attempts(self, task_id: str) -> list[dict[str, Any]] | None:
        with self.sessions() as session:
            task = session.get(CrawlTask, task_id)
            archived = list(session.scalars(select(ArchivedTaskAttempt).where(
                ArchivedTaskAttempt.task_id == task_id,
            ).order_by(ArchivedTaskAttempt.archived_at, ArchivedTaskAttempt.id)))
            attempts = list(session.scalars(select(TaskAttempt).where(
                TaskAttempt.task_id == task_id,
            ).order_by(TaskAttempt.leased_at, TaskAttempt.id)))
            if task is None and not archived:
                return None
            result = [{"attemptId": entry.id, "taskId": entry.task_id, "jobId": entry.job_id,
                       **entry.snapshot, "archived": True} for entry in archived]
            result.extend({
                "attemptId": attempt.id, "taskId": attempt.task_id, "jobId": task.job_id if task else None,
                "clientId": attempt.client_id, "leaseId": attempt.lease_id, "status": attempt.status,
                "error": attempt.error, "errorCode": attempt.error_code, "errorMessage": attempt.error_message,
                "agentVersion": attempt.agent_version, "crawlerVersion": attempt.crawler_version,
                "parserVersion": attempt.parser_version, "leasedAt": utc_iso(attempt.leased_at),
                "startedAt": utc_iso(attempt.started_at),
                "finishedAt": utc_iso(attempt.finished_at) if attempt.finished_at else None,
                "durationMs": attempt.duration_ms, "resultChecksum": attempt.result_checksum, "archived": False,
            } for attempt in attempts)
            return result

    def _apply_dlq_action(
        self, *, action: str, task_ids: list[str] | None, job_id: str | None, error_code: str | None,
        expected_count: int, request_id: str, actor: str, reason: str,
    ) -> dict[str, Any]:
        normalized_id = request_id.strip().lower()
        normalized_reason = redact(reason, limit=500)
        if not normalized_id or len(normalized_id) > 64 or len(normalized_reason.strip()) < 10:
            raise ValueError("A request ID and audit reason of at least 10 characters are required.")
        requested_ids = list(dict.fromkeys(task_ids or []))
        if len(requested_ids) > 100 or any(not task_id or len(task_id) > 40 for task_id in requested_ids):
            raise ValueError("DLQ actions are limited to 100 valid task IDs.")
        if not requested_ids and not error_code:
            raise ValueError("Specify task IDs or an error-code filter.")
        scope_value = {"jobId": job_id, "errorCode": error_code.upper() if error_code else None,
                       "taskIds": requested_ids, "expectedCount": expected_count}
        with self.sessions.begin() as session:
            previous = session.get(CrawlerDlqAction, normalized_id)
            if previous is not None:
                if (previous.action != action or previous.actor != actor or previous.reason != normalized_reason
                        or previous.scope != scope_value):
                    raise ValueError("Request ID was already used for a different DLQ action.")
                return dict(previous.outcome)
            statement = select(CrawlTask).where(CrawlTask.status == "dead_letter").with_for_update()
            if requested_ids:
                statement = statement.where(CrawlTask.id.in_(requested_ids))
            else:
                statement = statement.where(CrawlTask.last_error["errorCode"].as_string() == str(error_code).upper())
            if job_id:
                statement = statement.where(CrawlTask.job_id == job_id)
            selected = list(session.scalars(statement.order_by(CrawlTask.id).limit(101)))
            if not requested_ids and len(selected) > 100:
                raise ValueError("Filter matches more than 100 tasks; narrow the DLQ action scope.")
            if len(selected) != expected_count or not selected:
                raise ValueError("DLQ scope changed; refresh the preview and confirm the exact task count.")
            if requested_ids and len(selected) != len(requested_ids):
                raise ValueError("One or more selected tasks are not currently in the dead-letter queue.")
            changed_ids: list[str] = []
            for task in selected:
                if action == "requeue":
                    task.status = "queued"
                    task.failure_count = 0
                    task.next_retry_at = None
                    task.requeue_count += 1
                    task.completed_at = None
                    previous_error = task.last_error or {}
                    task.last_error = {**previous_error, "retryAfter": None,
                                       "manualRequeueAt": utc_iso(), "manualRequeueBy": actor}
                    job = session.get(CrawlJob, task.job_id)
                    if job is not None:
                        job.status = "queued"
                        job.completed_at = None
                elif action == "delete":
                    task.status = "dead_letter_deleted"
                else:
                    raise ValueError("Unknown DLQ action.")
                changed_ids.append(task.id)
                self._refresh_job(session, task.job_id)
            outcome = {"action": action, "changed": len(changed_ids), "taskIds": changed_ids,
                       "jobId": job_id, "errorCode": error_code.upper() if error_code else None}
            session.add(CrawlerDlqAction(
                request_id=normalized_id, actor=actor, action=action, reason=normalized_reason,
                scope=scope_value,
                outcome=outcome,
            ))
            for task in selected:
                self._event(session, task.job_id, f"dlq_{action}", {
                    "taskId": task.id, "actor": actor, "reason": normalized_reason, "requestId": normalized_id,
                })
            return outcome

    def requeue_dead_letter_tasks(
        self, task_ids: list[str] | None = None, *, job_id: str | None = None, error_code: str | None = None,
        expected_count: int, request_id: str, actor: str, reason: str,
    ) -> dict[str, Any]:
        return self._apply_dlq_action(action="requeue", task_ids=task_ids, job_id=job_id,
            error_code=error_code, expected_count=expected_count, request_id=request_id, actor=actor, reason=reason)

    def delete_dead_letter_task(
        self, task_id: str, *, actor: str, reason: str, request_id: str | None = None,
    ) -> bool:
        outcome = self.delete_dead_letter_tasks([task_id], expected_count=1,
            request_id=request_id or _id(), actor=actor, reason=reason)
        return int(outcome.get("changed") or 0) == 1

    def delete_dead_letter_tasks(
        self, task_ids: list[str], *, expected_count: int, request_id: str, actor: str, reason: str,
    ) -> dict[str, Any]:
        return self._apply_dlq_action(action="delete", task_ids=task_ids, expected_count=expected_count,
            request_id=request_id or _id(), actor=actor, reason=reason, job_id=None, error_code=None)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is not None and job.status == "review_pending":
                self._refresh_job(session, job.id)
            return self._job_snapshot(session, job) if job else None

    def pause_job(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.scalar(select(CrawlJob).where(CrawlJob.id == job_id).with_for_update())
            if job is None:
                return None
            if job.status not in {"queued", "running"}:
                raise ValueError("Only a queued or running job can be paused.")
            control = session.scalar(select(CrawlJobControl).where(
                CrawlJobControl.job_id == job_id,
            ).with_for_update())
            if control is None:
                control = CrawlJobControl(job_id=job_id, state="active")
                session.add(control)
                session.flush()
            if control.state == "active":
                control.state = "pausing"
                control.updated_at = utc_now()
                self._event(session, job_id, "job_pause_requested", {})
            elif control.state not in {"pausing", "paused"}:
                raise ValueError("A job being cancelled cannot be paused.")
            self._refresh_job(session, job_id)
            return self._job_snapshot(session, job)

    def resume_job(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.scalar(select(CrawlJob).where(CrawlJob.id == job_id).with_for_update())
            if job is None:
                return None
            if job.status not in {"queued", "running"}:
                raise ValueError("Only a queued or running job can be resumed.")
            control = session.scalar(select(CrawlJobControl).where(
                CrawlJobControl.job_id == job_id,
            ).with_for_update())
            if control is None or control.state == "active":
                return self._job_snapshot(session, job)
            if control.state not in {"pausing", "paused"}:
                raise ValueError("A job being cancelled cannot be resumed.")
            control.state = "active"
            control.updated_at = utc_now()
            self._event(session, job_id, "job_resumed", {})
            self._refresh_job(session, job_id)
            return self._job_snapshot(session, job)

    def job_summary(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions.begin() as session:
            job = session.get(CrawlJob, job_id)
            if job is not None and job.status == "review_pending":
                self._refresh_job(session, job.id)
            return self._job_summary(session, job) if job else None

    def job_metadata(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            job = session.get(CrawlJob, job_id)
            if job is None:
                return None
            return {"id": job.id, "settings": job.settings}

    @staticmethod
    def _job_summary(session, job: CrawlJob) -> dict[str, Any]:
        task_counts = dict(session.execute(
            select(CrawlTask.status, func.count(CrawlTask.id))
            .where(CrawlTask.job_id == job.id).group_by(CrawlTask.status)
        ).all())
        product_counts = dict(session.execute(
            select(CrawlProductItem.status, func.count(CrawlProductItem.id))
            .where(
                CrawlProductItem.job_id == job.id,
                func.coalesce(CrawlProductItem.shopify_result["skippedExistingShopify"].as_boolean(), False) == False,
            ).group_by(CrawlProductItem.status)
        ).all())
        handoff = CoordinatorStore._seo_queue_handoff_summary(session, job.id)
        completed = sum(int(task_counts.get(status, 0)) for status in TERMINAL_TASK_STATUSES)
        event_payload = session.scalar(
            select(JobEvent.payload).where(JobEvent.job_id == job.id, JobEvent.event_type == "task_progress")
            .order_by(JobEvent.id.desc()).limit(1)
        )
        latest = event_payload.get("progress", {}) if isinstance(event_payload, dict) else {}
        latest = latest if isinstance(latest, dict) else {}
        current_asin = None
        active = session.execute(
            select(CrawlTask.id, CrawlTask.asin).where(
                CrawlTask.job_id == job.id, CrawlTask.status.in_(["leased", "running"]),
            ).order_by(CrawlTask.ordinal).limit(1)
        ).first()
        if active:
            current_asin = active.asin
            if isinstance(event_payload, dict) and event_payload.get("taskId") == active.id:
                items = latest.get("items")
                if isinstance(items, list) and items and isinstance(items[0], dict):
                    current_asin = str(items[0].get("currentAsin") or active.asin)
        retry_error = None
        if product_counts.get("retry_wait"):
            retry_error = session.scalar(
                select(CrawlProductItem.last_error).where(
                    CrawlProductItem.job_id == job.id, CrawlProductItem.status == "retry_wait",
                ).limit(1)
            )
        retry_phase = str(retry_error.get("phase") or "shopify") if isinstance(retry_error, dict) else None
        phase = str(latest.get("phase") or "product")
        if job.status in {"completed", "partial", "cancelled", "review_pending"}:
            phase = "export" if job.status != "review_pending" else "seo"
        elif product_counts.get("syncing") or product_counts.get("shopify_writing") or retry_phase == "shopify":
            phase = "shopify"
        elif retry_phase == "image_processing":
            phase = "image_processing"
        elif retry_phase == "seo":
            phase = "seo"
        elif product_counts.get("seo"):
            phase = "seo"
        elif product_counts.get("image_processing"):
            phase = "image_processing"
        elif product_counts.get("normalizing") or product_counts.get("received"):
            phase = "normalization"
        errors = (int(job.rejected_inputs) + int(task_counts.get("failed", 0))
                  + int(task_counts.get("dead_letter", 0)) + int(task_counts.get("dead_letter_deleted", 0))
                  + int(product_counts.get("failed", 0)))
        if job.status in {"cancelling", "cancelled"}:
            errors += int(session.scalar(select(func.count(CrawlTask.id)).where(
                CrawlTask.job_id == job.id, CrawlTask.status != "failed", CrawlTask.last_error["stage"].as_string() == "job",
            )) or 0)
        message = str(latest.get("message") or f"Đã xử lý {completed}/{job.accepted_inputs} link.")
        if job.status == "review_pending":
            message = f"Đã bàn giao {handoff['handedOver']}/{handoff['totalProducts']} sản phẩm sang SEO Queue."
        elif phase in {"seo", "image_processing", "shopify"}:
            message = f"Đang xử lý {phase}: {completed}/{job.accepted_inputs} link đã crawl."
        elif job.status in {"completed", "partial", "cancelled", "review_pending"}:
            message = f"Đã xử lý {completed}/{job.accepted_inputs} link."
        return {
            "id": job.id, "status": job.status,
            "executionState": CoordinatorStore._job_execution_state(session, job.id),
            "completed": completed, "total": job.accepted_inputs,
            "currentAsin": current_asin, "errors": errors,
            "progress": {
                "phase": phase, "completed": completed, "total": job.accepted_inputs,
                "message": message[:240],
            },
            "taskCounts": task_counts, "productCounts": product_counts,
            "seoQueueHandoff": handoff,
            "createdAt": utc_iso(job.created_at),
            "startedAt": utc_iso(job.started_at) if job.started_at else None,
            "completedAt": utc_iso(job.completed_at) if job.completed_at else None,
        }

    def list_jobs(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.sessions.begin() as session:
            jobs = session.scalars(select(CrawlJob).where(
                CrawlJob.archived_at.is_(None),
            ).order_by(CrawlJob.created_at.desc()).limit(max(1, min(limit, 500)))).all()
            snapshots = []
            for job in jobs:
                if job.status in {"running", "review_pending"}:
                    self._refresh_job(session, job.id)
                if job.status == "cancelling":
                    snapshots.append(self._job_snapshot(session, job, include_task_details=False))
                    continue
                snapshot = self._job_summary(session, job)
                snapshot["settings"] = job.settings
                snapshot["inputs"] = session.scalars(
                    select(CrawlTask.source).where(CrawlTask.job_id == job.id).order_by(CrawlTask.ordinal)
                ).all()
                snapshots.append(snapshot)
            return snapshots

    def list_clients(self) -> list[dict[str, Any]]:
        with self.sessions() as session:
            clients = session.scalars(select(ClientRecord).order_by(ClientRecord.display_name)).all()
            active_counts = dict(session.execute(
                select(CrawlTask.assigned_client_id, func.count(CrawlTask.id))
                .where(CrawlTask.status.in_(["leased", "running", "cancelling"]))
                .group_by(CrawlTask.assigned_client_id)
            ).all())
            return [self._client_snapshot(client, active_tasks=int(active_counts.get(client.id, 0))) for client in clients]

    def applied_agent_runtime_config(self, client_id: str) -> dict[str, Any]:
        with self.sessions() as session:
            client = session.get(ClientRecord, client_id)
            if client is None:
                return AgentRuntimeConfig().to_payload()
            return AgentRuntimeConfig.from_payload(client.applied_agent_config or {}).to_payload()

    def agent_runtime_config_versions(self, client_id: str) -> dict[str, int]:
        with self.sessions() as session:
            client = session.get(ClientRecord, client_id)
            if client is None:
                return {"desiredConfigVersion": 0, "appliedConfigVersion": 0}
            return {"desiredConfigVersion": client.desired_config_version,
                    "appliedConfigVersion": client.applied_config_version}

    def forget_client(self, client_id: str) -> str:
        """Remove an offline Agent registration while preserving historical task records."""
        with self.sessions() as session:
            client = session.get(ClientRecord, client_id)
            if client is None:
                return "not_found"
            active_task_count = session.scalar(
                select(func.count(CrawlTask.id)).where(
                    CrawlTask.assigned_client_id == client_id,
                    CrawlTask.status.not_in(TERMINAL_TASK_STATUSES),
                )
            ) or 0
            if active_task_count > 0:
                return "active_tasks"
            session.execute(
                update(CrawlTask)
                .where(CrawlTask.assigned_client_id == client_id)
                .values(assigned_client_id=None)
            )
            session.delete(client)
            session.commit()
            return "forgotten"

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

    def job_products(self, job_id: str, *, cursor: str | None = None, limit: int = 50) -> dict[str, Any] | None:
        with self.sessions() as session:
            if session.get(CrawlJob, job_id) is None:
                return None
            page_size = max(1, min(limit, 100))
            query = select(
                CrawlProductItem.id, CrawlProductItem.product_id,
                CrawlProductItem.source_key, CrawlProductItem.status,
            ).where(
                CrawlProductItem.job_id == job_id,
                func.coalesce(CrawlProductItem.shopify_result["skippedExistingShopify"].as_boolean(), False) == False,
            )
            if cursor:
                query = query.where(CrawlProductItem.id > cursor)
            rows = session.execute(query.order_by(CrawlProductItem.id).limit(page_size + 1)).all()
            return {
                "jobId": job_id,
                "products": [
                    {"id": row.id, "productId": row.product_id, "sourceKey": row.source_key, "status": row.status}
                    for row in rows[:page_size]
                ],
                "nextCursor": rows[page_size - 1].id if len(rows) > page_size else None,
            }

    def job_product(self, job_id: str, item_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            item = session.scalar(select(CrawlProductItem).where(
                CrawlProductItem.job_id == job_id, CrawlProductItem.id == item_id,
            ))
            if item is None:
                return None
            product = self._product_pipeline_snapshot(item)
            variants = product.pop("variants", [])
            product["variantCount"] = len(variants) if isinstance(variants, list) else 0
            return product

    def job_product_variants(
        self, job_id: str, item_id: str, *, cursor: int = 0, limit: int = 50,
    ) -> dict[str, Any] | None:
        with self.sessions() as session:
            item = session.scalar(select(CrawlProductItem).where(
                CrawlProductItem.job_id == job_id, CrawlProductItem.id == item_id,
            ))
            if item is None:
                return None
            payload = item.normalized_payload or item.raw_payload
            variants = payload.get("variants", [])
            variants = variants if isinstance(variants, list) else []
            page_size = max(1, min(limit, 100))
            offset = max(0, cursor)
            next_cursor = offset + page_size if offset + page_size < len(variants) else None
            return {"variants": variants[offset:offset + page_size], "nextCursor": next_cursor}

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
            asin_lists: dict[str, list[str]] = {
                "completedAsins": [], "failedAsins": [],
                "retryableAsins": [], "nonRetryableAsins": [],
            }

            def collect_asins(payload: dict[str, Any]) -> None:
                for key, values in asin_lists.items():
                    candidates = payload.get(key)
                    if isinstance(candidates, list):
                        values.extend(asin for asin in candidates if isinstance(asin, str))

            errors: list[dict[str, Any]] = [
                {
                    "source": entry.source, "code": "INVALID_INPUT", "status": "invalid_asin",
                    "reason": "invalid_format", "message": entry.message, "retryable": False,
                }
                for entry in invalid
            ]
            pipeline_items = session.scalars(
                select(CrawlProductItem)
                .where(CrawlProductItem.job_id == job_id)
                .order_by(CrawlProductItem.created_at)
            ).all()
            if pipeline_items:
                for item in pipeline_items:
                    if (item.shopify_result or {}).get("skippedExistingShopify"):
                        continue
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
                    collect_asins(result)
                    if not pipeline_items:
                        for product in result.get("products", []):
                            if isinstance(product, dict) and product.get("id"):
                                products[str(product["id"])] = product
                    errors.extend(error for error in result.get("errors", []) if isinstance(error, dict))
                    warnings.extend(str(warning) for warning in result.get("warnings", []) if isinstance(warning, str))
                if (task.status in {"failed", "dead_letter", "dead_letter_deleted"} and not task.result) or (task.last_error or {}).get("stage") == "job":
                    last_error = task.last_error or {}
                    collect_asins(last_error)
                    errors.append({
                        "source": task.source,
                        "code": str(last_error.get("errorCode") or last_error.get("code") or "CRAWL_FAILED"),
                        "message": str(last_error.get("message") or "Crawler failed."),
                        "retryable": bool(last_error.get("retryable", True)),
                        "attempts": task.failure_count,
                        "maxRetry": task.max_retry,
                        **{key: last_error[key] for key in (
                            "status", "reason", "retryAfter", "completedAsins", "failedAsins",
                            "retryableAsins", "nonRetryableAsins",
                            *TIMEOUT_FIELDS, *RETRY_FIELDS,
                        ) if key in last_error},
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
                **{key: sorted(set(values)) for key, values in asin_lists.items()},
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
            "agentGroup": client.agent_group,
            "agentVersion": client.agent_version, "protocolVersion": client.protocol_version,
            "maxConcurrentInputs": client.max_concurrent_inputs, "capabilities": client.capabilities,
            "desiredExecutionState": client.desired_execution_state,
            "appliedExecutionState": client.applied_execution_state,
            "commandSequence": client.command_sequence,
            "lastProcessedCommandSequence": client.last_processed_command_sequence,
            "desiredConfigVersion": client.desired_config_version,
            "appliedConfigVersion": client.applied_config_version,
            "desiredAgentConfig": dict(client.desired_agent_config or {}),
            "appliedAgentConfig": dict(client.applied_agent_config or {}),
            "globalAdmissionGateRevision": client.global_admission_gate_revision,
            "globalAdmissionGateState": client.global_admission_gate_state,
            "activeTasks": active_tasks,
            "limits": client.limits, "connectedAt": utc_iso(client.connected_at) if client.connected_at else None,
            "lastSeenAt": utc_iso(client.last_seen_at),
            "observability": client.capabilities.get("observability"),
        }

    @staticmethod
    def _job_snapshot(session, job: CrawlJob, *, include_task_details: bool = True) -> dict[str, Any]:
        counts = dict(session.execute(
            select(CrawlTask.status, func.count(CrawlTask.id)).where(CrawlTask.job_id == job.id).group_by(CrawlTask.status)
        ).all())
        completed = int(counts.get("completed", 0))
        failed = int(counts.get("failed", 0)) + int(counts.get("dead_letter", 0)) + int(counts.get("dead_letter_deleted", 0))
        cancelled = int(counts.get("cancelled", 0))
        tasks = session.scalars(
            select(CrawlTask)
            .options(selectinload(CrawlTask.result))
            .where(CrawlTask.job_id == job.id)
            .order_by(CrawlTask.ordinal)
        ).all() if include_task_details else []
        progress_events = session.scalars(
            select(JobEvent)
            .where(JobEvent.job_id == job.id, JobEvent.event_type == "task_progress")
            .order_by(JobEvent.id)
        ).all() if include_task_details else []
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
                "taskId": task.id,
                "source": task.source,
                "asin": task.asin,
                "status": public_status,
                "phase": str(item.get("phase") or task_progress.get("phase") or ("queued" if public_status == "queued" else "product")),
                "message": str(item.get("message") or task_progress.get("message") or ("Đang chờ client xử lý." if public_status == "queued" else "Đang xử lý trên client.")),
                "variantCompleted": int(item.get("variantCompleted") or 0),
                "variantTotal": int(item.get("variantTotal") or 0),
                "errorCode": str((task.last_error or {}).get("errorCode") or "") or None,
                "retryCount": task.failure_count,
                "maxRetry": task.max_retry,
                "nextRetryAt": utc_iso(task.next_retry_at) if task.next_retry_at else None,
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
            .where(
                CrawlProductItem.job_id == job.id,
                func.coalesce(CrawlProductItem.shopify_result["skippedExistingShopify"].as_boolean(), False) == False,
            )
            .group_by(CrawlProductItem.status)
        ).all())
        handoff = CoordinatorStore._seo_queue_handoff_summary(session, job.id)
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
            phase = "seo"
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
            progress_message = f"Đã bàn giao {handoff['handedOver']}/{handoff['totalProducts']} sản phẩm sang SEO Queue."
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
            "seoQueueHandoff": handoff,
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
        for item in session.execute(select(
            CrawlProductItem.id, CrawlProductItem.source_key,
            CrawlProductItem.claimed_by, CrawlProductItem.shopify_result,
        ).where(
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
        snapshot = {
            "id": job.id, "externalRequestId": job.external_request_id, "status": job.status,
            "executionState": CoordinatorStore._job_execution_state(session, job.id, control),
            "settings": job.settings, "settingsFingerprint": settings_fingerprint(job.settings),
            "inputs": [task.source for task in tasks],
            "requestedInputs": job.requested_inputs, "acceptedInputs": job.accepted_inputs,
            "rejectedInputs": job.rejected_inputs, "taskCounts": counts,
            "productCounts": product_counts,
            "seoQueueHandoff": handoff,
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
        if not include_task_details:
            summary = CoordinatorStore._job_summary(session, job)
            snapshot.update({key: summary[key] for key in ("completed", "total", "currentAsin", "errors", "progress")})
            snapshot["inputs"] = session.scalars(
                select(CrawlTask.source).where(CrawlTask.job_id == job.id).order_by(CrawlTask.ordinal)
            ).all()
        if (job.settings or {}).get("channel") == "pinterest":
            candidates: list[Any] = []
            rejected_candidates: list[Any] = []
            deliverables: dict[str, Any] = {}
            summary_metrics: dict[str, Any] = {}
            logs: list[str] = []
            task_error = next((
                str(task.last_error.get("message") or "").strip()
                for task in tasks
                if task.status in {"failed", "dead_letter", "dead_letter_deleted"} and isinstance(task.last_error, dict)
                and str(task.last_error.get("message") or "").strip()
            ), "")
            for task in tasks:
                if task.result and isinstance(task.result.payload, dict):
                    res_cands = task.result.payload.get("candidates")
                    if isinstance(res_cands, list) and not candidates:
                        candidates = res_cands
                    res_rejected = task.result.payload.get("rejected_candidates")
                    if isinstance(res_rejected, list) and not rejected_candidates:
                        rejected_candidates = res_rejected
                    res_deliv = task.result.payload.get("deliverables")
                    if isinstance(res_deliv, dict) and not deliverables:
                        deliverables = res_deliv
                    res_metrics = task.result.payload.get("summaryMetrics") or task.result.payload.get("summary_metrics")
                    if isinstance(res_metrics, dict) and not summary_metrics:
                        summary_metrics = res_metrics
                    res_logs = task.result.payload.get("logs")
                    if isinstance(res_logs, list):
                        logs.extend(res_logs)
            events = session.scalars(
                select(JobEvent).where(JobEvent.job_id == job.id).order_by(JobEvent.id)
            ).all()
            for ev in events:
                if isinstance(ev.payload, dict):
                    msg = ev.payload.get("message")
                    if not msg and isinstance(ev.payload.get("progress"), dict):
                        msg = ev.payload["progress"].get("message")
                    if msg:
                        logs.append(str(msg))
            snapshot.update({
                "ok": True,
                "jobId": job.id,
                "job_id": job.id,
                "niche": (job.settings or {}).get("niche"),
                "product": (job.settings or {}).get("product"),
                "candidates": candidates,
                "rejected_candidates": rejected_candidates,
                "total_candidates": len(candidates),
                "deliverables": deliverables,
                "summaryMetrics": summary_metrics,
                "summary_metrics": summary_metrics,
                "logs": logs,
                "error": task_error or None,
            })
            if job.status == "queued":
                snapshot["stepper"] = {"current_step": 1, "percent": 10, "current_message": "Đang xếp hàng chờ Agent kết nối..."}
            elif job.status == "running":
                latest_msg = logs[-1] if logs else "Agent đang thực thi..."
                snapshot["stepper"] = {"current_step": 2, "percent": 50, "current_message": latest_msg}
            elif job.status == "ready_for_review":
                snapshot["stepper"] = {"current_step": 2, "percent": 100, "current_message": "Đã quét xong ứng viên! Sẵn sàng duyệt mẫu."}
            elif job.status == "completed":
                snapshot["stepper"] = {"current_step": 4, "percent": 100, "current_message": "Hoàn thành! Đã tạo đầy đủ mockup AI & file in CMYK xưởng."}
            elif job.status == "failed":
                snapshot["stepper"] = {
                    "current_step": 1,
                    "percent": 0,
                    "current_message": task_error or "Tác vụ thất bại.",
                }
        return snapshot
