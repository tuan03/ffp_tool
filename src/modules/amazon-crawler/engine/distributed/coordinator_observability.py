"""Deduplicated crawl events, bounded trace pages and SQL-only metric summaries."""
from __future__ import annotations

import re
import json
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from ..observability import safe_fields
from .coordinator_models import ClientRecord, CrawlJob, CrawlProductItem, CrawlTask, CrawlTelemetryEvent, TaskAttempt
from .protocol import CLIENT_OFFLINE_SECONDS, utc_iso, utc_now

EVENT_TYPES = {"family_started", "family_completed", "family_cache", "http_attempt", "browser_attempt",
               "page_fetch", "page_fetch_started", "playwright_fallback", "stage_completed", "checkpoint", "cache_read", "cache_write", "child_failed", "parser_failure"}
RESULTS = {"running", "completed", "partial", "success", "error", "failed", "timeout", "cancelled", "captcha",
           "parser_error", "network_error", "temporarily_blocked", "not_found", "hit", "miss", "saved", "rejected",
           "http", "playwright", "cache", "location"}
CACHE_COUNTERS = ("hit", "miss", "corrupt", "evicted", "writeRejected", "temporaryRemoved", "bytes", "files", "maxBytes", "maxFiles")
RESOURCE_FIELDS = ("rssBytes", "browserProcesses", "processCount", "browserContexts", "browserPages")
TELEMETRY_RETENTION_DAYS = 7
MAX_TELEMETRY_ROWS = 100000


def bounded_agent_telemetry(payload: Any) -> dict[str, Any]:
    payload = payload if isinstance(payload, dict) else {}
    snapshot = {}
    for section, keys in (("cache", CACHE_COUNTERS), ("resources", RESOURCE_FIELDS)):
        values = payload.get(section)
        values = values if isinstance(values, dict) else {}
        snapshot[section] = {key: max(0, min(2**53 - 1, value)) for key in keys
                             if isinstance((value := values.get(key)), int) and not isinstance(value, bool)}
        if section == "resources":
            snapshot[section]["isComplete"] = values.get("isComplete") is True
    for key in ("backlog", "dropped"):
        value = payload.get(key)
        snapshot[key] = max(0, min(2**53 - 1, value)) if isinstance(value, int) else 0
    snapshot["sampledAt"] = utc_iso()
    return snapshot


class CoordinatorObservability:
    def accept_telemetry(self, client_id: str, events: Any) -> list[str]:
        if not isinstance(events, list) or len(events) > 64:
            raise ValueError("Telemetry must contain at most 64 events.")
        acknowledged = []
        attempts = {}
        now = utc_now()
        with self.sessions.begin() as session:
            insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
            for raw in events:
                if not isinstance(raw, dict):
                    continue
                event_id = raw.get("eventId")
                if not isinstance(event_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", event_id):
                    continue
                acknowledged.append(event_id)  # Invalid/stale events must not clog the offline spool.
                payload = safe_fields(raw)
                name = payload.get("event")
                outcome = payload.get("result", "success")
                if name not in EVENT_TYPES or outcome not in RESULTS:
                    continue
                key = (str(raw.get("taskId") or "")[:40], str(raw.get("leaseId") or "")[:40])
                if key not in attempts:
                    row = session.execute(select(TaskAttempt, CrawlTask).join(CrawlTask, TaskAttempt.task_id == CrawlTask.id).where(
                        TaskAttempt.task_id == key[0], TaskAttempt.lease_id == key[1], TaskAttempt.client_id == client_id,
                    )).first()
                    ordinal = session.scalar(select(func.count(TaskAttempt.id)).where(
                        TaskAttempt.task_id == key[0], TaskAttempt.leased_at <= row[0].leased_at,
                    )) if row else 0
                    attempts[key] = (row, ordinal)
                row, ordinal = attempts[key]
                if row is None:
                    continue
                attempt, task = row
                asin = str(payload.get("asin") or task.asin)
                if not re.fullmatch(r"[A-Z0-9]{10}", asin):
                    continue
                request_id = task.id if asin == task.asin else uuid.uuid5(uuid.NAMESPACE_URL, f"{task.id}:{asin}").hex
                duration = payload.get("durationMs", 0)
                duration = max(0, min(86400000, duration)) if isinstance(duration, int) else 0
                physical_attempt = payload.get("attempt", 1)
                physical_attempt = max(1, min(1000, physical_attempt)) if isinstance(physical_attempt, int) else 1
                payload.update(jobId=task.job_id, taskId=task.id, leaseId=attempt.lease_id, agentId=client_id,
                               requestId=request_id, familyRequestId=task.id, rootAsin=task.asin, asin=asin,
                               attempt=physical_attempt, taskAttempt=ordinal, durationMs=duration, result=outcome)
                try:
                    occurred = datetime.fromisoformat(str(payload.get("timestamp", utc_iso(now))).replace("Z", "+00:00"))
                    if occurred.tzinfo is None or occurred > now + timedelta(minutes=5):
                        occurred = now
                    if occurred < now - timedelta(days=TELEMETRY_RETENTION_DAYS):
                        continue
                except (ValueError, TypeError):
                    occurred = now
                payload["timestamp"] = utc_iso(occurred)
                if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > 4096:
                    continue
                session.execute(insert(CrawlTelemetryEvent).values(
                    id=event_id, job_id=task.job_id, task_id=task.id, client_id=client_id, lease_id=attempt.lease_id,
                    request_id=request_id, family_request_id=task.id, event_type=name, result=outcome,
                    duration_ms=duration, captcha_encountered=payload.get("captchaEncountered") is True,
                    payload=payload, created_at=occurred,
                ).on_conflict_do_nothing(index_elements=["id"]))
        return acknowledged

    @staticmethod
    def record_task_trace(session, task: CrawlTask, attempt: TaskAttempt, name: str, *, ordinal: int) -> None:
        event_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{attempt.lease_id}:{name}").hex
        payload = {"eventId": event_id, "event": name, "timestamp": utc_iso(), "jobId": task.job_id,
                   "taskId": task.id, "leaseId": attempt.lease_id, "agentId": attempt.client_id,
                   "requestId": task.id, "familyRequestId": task.id, "rootAsin": task.asin, "asin": task.asin,
                   "stage": "queue", "taskAttempt": ordinal, "attempt": 1, "result": "leased"}
        session.add(CrawlTelemetryEvent(id=event_id, job_id=task.job_id, task_id=task.id,
            client_id=attempt.client_id, lease_id=attempt.lease_id, request_id=task.id, family_request_id=task.id,
            event_type=name, result="leased", duration_ms=0, captcha_encountered=False, payload=payload))

    def crawl_trace(self, job_id: str, request_id: str, *, cursor: str | None = None, limit: int = 50) -> dict[str, Any] | None:
        if len(request_id) > 64:
            raise ValueError("Trace request ID is invalid.")
        limit = max(1, min(limit, 100))
        with self.sessions() as session:
            if session.get(CrawlJob, job_id) is None:
                return None
            filters = [CrawlTelemetryEvent.job_id == job_id,
                       or_(CrawlTelemetryEvent.request_id == request_id, CrawlTelemetryEvent.family_request_id == request_id)]
            if cursor:
                previous = session.execute(select(CrawlTelemetryEvent.created_at, CrawlTelemetryEvent.sequence).where(
                    *filters, CrawlTelemetryEvent.id == cursor[:64],
                )).first()
                if previous is None:
                    raise ValueError("Trace cursor is invalid or expired.")
                filters.append(or_(CrawlTelemetryEvent.created_at > previous.created_at,
                                   and_(CrawlTelemetryEvent.created_at == previous.created_at, CrawlTelemetryEvent.sequence > previous.sequence)))
            rows = session.scalars(select(CrawlTelemetryEvent).where(*filters).order_by(CrawlTelemetryEvent.created_at, CrawlTelemetryEvent.sequence).limit(limit + 1)).all()
            return {"events": [row.payload for row in rows[:limit]], "nextCursor": rows[limit - 1].id if len(rows) > limit else None}

    def crawler_metrics(self, *, job_id: str | None = None) -> dict[str, Any]:
        now = utc_now()
        start = now - timedelta(hours=24)
        filters = [CrawlTelemetryEvent.created_at >= start]
        if job_id:
            filters.append(CrawlTelemetryEvent.job_id == job_id)
        with self.sessions() as session:
            grouped = session.execute(select(CrawlTelemetryEvent.event_type, CrawlTelemetryEvent.result,
                func.count(), func.sum(CrawlTelemetryEvent.duration_ms)).where(*filters).group_by(CrawlTelemetryEvent.event_type, CrawlTelemetryEvent.result)).all()
            totals = {(name, outcome): int(count) for name, outcome, count, _ in grouped}
            count = lambda name: sum(value for (kind, _), value in totals.items() if kind == name)
            hits, misses = totals.get(("family_cache", "hit"), 0), totals.get(("family_cache", "miss"), 0)
            http_attempts, browser_attempts = count("http_attempt"), count("browser_attempt")
            captcha = int(session.scalar(select(func.count()).select_from(CrawlTelemetryEvent).where(
                *filters, CrawlTelemetryEvent.event_type.in_(["http_attempt", "browser_attempt"]), CrawlTelemetryEvent.captcha_encountered.is_(True),
            )) or 0)
            network_retries = int(session.scalar(select(func.count()).select_from(CrawlTelemetryEvent).where(
                *filters, CrawlTelemetryEvent.event_type.in_(["http_attempt", "browser_attempt"]), CrawlTelemetryEvent.payload["attempt"].as_integer() > 1,
            )) or 0)
            latest = select(CrawlTelemetryEvent.result, func.row_number().over(partition_by=CrawlTelemetryEvent.task_id,
                            order_by=(CrawlTelemetryEvent.created_at.desc(), CrawlTelemetryEvent.sequence.desc())).label("rank")).where(
                *filters, CrawlTelemetryEvent.event_type == "family_completed",
            ).subquery()
            partial = int(session.scalar(select(func.count()).select_from(latest).where(latest.c.rank == 1, latest.c.result == "partial")) or 0)
            crawl_query = select(CrawlTask.status, func.count()).group_by(CrawlTask.status)
            pipeline_query = select(CrawlProductItem.status, func.count()).group_by(CrawlProductItem.status)
            if job_id:
                crawl_query = crawl_query.where(CrawlTask.job_id == job_id)
                pipeline_query = pipeline_query.where(CrawlProductItem.job_id == job_id)
            crawl_counts = dict(session.execute(crawl_query).all())
            pipeline_counts = dict(session.execute(pipeline_query).all())
            clients = session.scalars(select(ClientRecord).where(ClientRecord.status != "offline", ClientRecord.last_seen_at >= now - timedelta(seconds=CLIENT_OFFLINE_SECONDS)).limit(100)).all()
            agents = [{"agentId": client.id, "displayName": client.display_name, **dict(client.capabilities.get("observability") or {})} for client in clients]
            durations = sum(int(duration or 0) for name, _, _, duration in grouped if name == "family_completed")
            family_attempts = count("family_completed")
            ratio = lambda numerator, denominator: numerator / denominator if denominator else None
            retained = session.scalar(select(func.min(CrawlTelemetryEvent.created_at)).where(*filters))
            return {
                "windowStartedAt": utc_iso(start), "retainedSince": utc_iso(retained) if retained else None,
                "sampledAt": utc_iso(now), "jobId": job_id,
                "counts": {"familyCacheHits": hits, "familyCacheMisses": misses, "httpAttempts": http_attempts,
                           "httpSuccesses": totals.get(("http_attempt", "success"), 0), "browserAttempts": browser_attempts,
                           "pageFetches": count("page_fetch_started"), "playwrightFallbacks": count("playwright_fallback"),
                           "captchaAttempts": captcha, "familyAttempts": family_attempts, "partialFamilies": partial,
                           "parserFailures": count("parser_failure"), "networkRetries": network_retries,
                           "taskRetries": count("task_retry"), "retryCount": network_retries + count("task_retry")},
                "rates": {"cacheHit": ratio(hits, hits + misses), "httpSuccess": ratio(totals.get(("http_attempt", "success"), 0), http_attempts),
                          "playwrightFallback": ratio(count("playwright_fallback"), count("page_fetch_started")),
                          "captcha": ratio(captcha, http_attempts + browser_attempts)},
                "averageCrawlDurationMs": durations / family_attempts if family_attempts else None,
                "queue": {"crawl": int(crawl_counts.get("queued", 0)), "crawlActive": sum(int(crawl_counts.get(status, 0)) for status in ("leased", "running")),
                          "pipeline": sum(int(value) for status, value in pipeline_counts.items() if status in {"received", "normalizing", "seo", "image_processing", "retry_wait", "sync_queued"})},
                "agents": agents,
            }

    def cleanup_telemetry(self) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(CrawlTelemetryEvent).where(CrawlTelemetryEvent.created_at < utc_now() - timedelta(days=TELEMETRY_RETENTION_DAYS)))
            count = int(session.scalar(select(func.count()).select_from(CrawlTelemetryEvent)) or 0)
            if count > MAX_TELEMETRY_ROWS:
                oldest = select(CrawlTelemetryEvent.id).order_by(CrawlTelemetryEvent.created_at).limit(count - MAX_TELEMETRY_ROWS)
                session.execute(delete(CrawlTelemetryEvent).where(CrawlTelemetryEvent.id.in_(oldest)))
