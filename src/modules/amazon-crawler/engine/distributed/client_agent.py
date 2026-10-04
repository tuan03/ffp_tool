"""Long-running distributed crawler agent with offline result spooling."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import gzip
import json
import random
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from pathlib import Path
from typing import Any, Callable

import websockets

from ..crawler_core import AmazonCrawler, CrawlSettings
from ..cache import RawFamilyCache
from ..process_crawler import ProcessCrawler
from ..review_engine import crawl_reviews_with_agent
from ..observability import redact, safe_fields, write_log
from ..runtime_resources import sample_resources
from . import AGENT_VERSION
from .client_config import AgentConfig
from .client_dashboard_state import DashboardState
from .client_store import ClientStore
from .client_storage_pressure import storage_pressure
from .worker_health import WorkerHealth
from .protocol import HEARTBEAT_INTERVAL_SECONDS, hello_message, payload_checksum, product_source_key, settings_fingerprint, utc_iso


StatusCallback = Callable[[dict[str, Any]], None]


def progress_targets(assignments: list[dict[str, Any]], progress_payload: dict[str, Any]) -> list[dict[str, Any]]:
    source = str(progress_payload.get("source") or "").strip()
    if not source:
        return assignments
    matched = [
        assignment
        for assignment in assignments
        if source in {
            str(assignment.get("source") or ""),
            str(assignment.get("asin") or ""),
            str(assignment.get("url") or ""),
        }
    ]
    return matched or assignments


def progress_for_assignment(progress_payload: dict[str, Any], assignment: dict[str, Any]) -> dict[str, Any]:
    task_progress = dict(progress_payload)
    items = progress_payload.get("items")
    if not isinstance(items, list):
        return task_progress
    identities = {
        str(assignment.get("source") or ""),
        str(assignment.get("asin") or ""),
        str(assignment.get("url") or ""),
    }
    matched_items = [
        dict(item) for item in items
        if isinstance(item, dict) and (
            str(item.get("source") or "") in identities
            or str(item.get("asin") or "") in identities
        )
    ]
    task_progress["items"] = matched_items
    return task_progress


class DistributedCrawlerAgent:
    def __init__(
        self,
        *,
        project_root: Path,
        config: AgentConfig,
        on_status: StatusCallback | None = None,
        crawler_factory: Callable[..., Any] = AmazonCrawler,
    ) -> None:
        self.project_root = project_root
        self.cache = RawFamilyCache(project_root / ".runtime" / "cache")
        self.config = config
        self.on_status = on_status or (lambda _status: None)
        self.crawler_factory = crawler_factory
        self.store = ClientStore(config.data_directory / "agent.sqlite3")
        self.client_id = self.store.client_id()
        self._agent_key: str | None = None
        self._is_connected = False
        self._recovery_complete = False
        self._uploads_checked = asyncio.Event()
        self._approved_attempts: set[tuple[str, str]] = set()
        self._started_at = utc_iso()
        self._dashboard_unavailable = False
        try:
            self.dashboard: DashboardState | None = DashboardState(self.store)
        except (OSError, sqlite3.Error):
            self.dashboard = None
            self._dashboard_unavailable = True
        self.assignment_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.outbound_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.completion_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.active: dict[str, dict[str, Any]] = {}
        self.cancel_events: dict[str, set[threading.Event]] = {}
        self.task_cancel_events: dict[str, threading.Event] = {}
        self._cancel_events_lock = threading.Lock()
        self.executing_task_ids: set[str] = set()
        self.stop_event = asyncio.Event()
        self.connection_status = "offline"
        self._locally_paused = self.store.is_paused()
        self._remote_execution_state = self.store.remote_execution_state()
        self._global_admission_gate = self.store.global_admission_gate()
        self._global_admission_stopped = self._global_admission_gate["state"] == "STOPPED"
        self._paused = self._locally_paused or self._remote_execution_state == "PAUSED" or self._global_admission_stopped
        self._command_recovery_complete = False
        self._command_recovery_event = asyncio.Event()
        self._captcha_waiting = False
        self._pending_stop_cleanups: dict[str, int] = {}
        self._cache_cleanup_lock = asyncio.Lock()
        self._running_crawlers: dict[str, Any] = {}
        self._running_crawlers_lock = threading.Lock()
        self._debug_log_lock = threading.Lock()
        self._debug_log_path = config.data_directory / "agent-debug.jsonl"
        self._resources: dict[str, Any] = {}
        self.worker_health = WorkerHealth()
        self._telemetry_losses = 0
        self._task_activity: dict[str, dict[str, Any]] = {}
        self._task_activity_lock = threading.Lock()

    def _debug_event(self, event: str, **details: Any) -> None:
        payload = {"timestamp": utc_iso(), "event": event, "clientId": self.client_id, **details}
        write_log(self._debug_log_path, payload)

    def _record_telemetry(self, event: dict[str, Any]) -> None:
        try:
            self.store.spool_telemetry(event)
        except (OSError, sqlite3.Error):
            self._telemetry_losses += 1

    def _telemetry_snapshot(self) -> dict[str, Any]:
        try:
            status = self.store.telemetry_status()
        except (OSError, sqlite3.Error):
            status = {"backlog": 0, "dropped": 0}
        return {"cache": self.cache.metrics_snapshot(), "resources": self._resources,
                "workerHealth": self._worker_health_snapshot(),
                **status, "dropped": status["dropped"] + self._telemetry_losses}

    def _worker_health_snapshot(self) -> dict[str, Any]:
        return self.worker_health.snapshot(self.config.max_concurrent_inputs)

    def _record_worker_failure(self, event: dict[str, Any]) -> None:
        reason = str(event.get("reason") or "worker_failure")
        self.worker_health.record_failure(reason)
        self._debug_event("crawler_worker_failure", reason=reason,
                          workerHealth=self._worker_health_snapshot())

    def _sample_resources(self) -> dict[str, Any]:
        resources = sample_resources()
        with self._running_crawlers_lock:
            pools = [dict(getattr(crawler, "browser_pool_state", getattr(crawler, "_browser_pool_state", {}))) for crawler in self._running_crawlers.values()]
        resources.update({key: sum(int(pool.get(key, 0)) for pool in pools) for key in ("browserContexts", "browserPages")})
        return resources

    def status_snapshot(self) -> dict[str, Any]:
        try:
            uploads = self.store.upload_counts()
            pending_cancellations = len(self.store.cancel_intents())
        except (OSError, sqlite3.Error):
            uploads = {"results": 0, "products": 0}
            pending_cancellations = 0
        try:
            dashboard = self.dashboard.snapshot() if self.dashboard is not None else {"tasks": [], "history": [], "events": []}
        except (OSError, sqlite3.Error):
            dashboard = {"tasks": [], "history": [], "events": []}
            self._dashboard_unavailable = True
        try:
            last_processed_command_sequence = self.store.last_processed_command_sequence()
        except (OSError, sqlite3.Error):
            last_processed_command_sequence = 0
        return {
            "clientId": self.client_id,
            "displayName": self.config.display_name,
            "connection": self.connection_status,
            "activeTasks": len(self.active),
            "availableSlots": self._available_slots(),
            "workerHealth": self._worker_health_snapshot(),
            "waitingCaptcha": self._captcha_waiting,
            "pendingUploads": uploads["results"] + uploads["products"],
            "pendingProducts": uploads["products"],
            "pendingResults": uploads["results"],
            "storage": self._storage_pressure(),
            "isConnected": self._is_connected,
            "agentVersion": AGENT_VERSION,
            "serverUrl": redact(self.config.server_url),
            "startedAt": self._started_at,
            "maxConcurrentInputs": self.config.max_concurrent_inputs,
            "runningTasks": len(self.executing_task_ids & self.active.keys()),
            "queuedTasks": len(self.active.keys() - self.executing_task_ids),
            "pendingCancellations": pending_cancellations,
            "limits": self.config.limits.apply({}),
            "dashboard": dashboard,
            "captchaDetected": bool(dashboard.get("hasUnattributedCaptcha")),
            "dashboardUnavailable": self._dashboard_unavailable,
            "isPaused": self._paused,
            "desiredExecutionState": self._remote_execution_state,
            "appliedExecutionState": self._remote_execution_state,
            "lastProcessedCommandSequence": last_processed_command_sequence,
            "globalAdmissionGate": dict(self._global_admission_gate),
            "capabilities": self._agent_capabilities(),
            "currentTasks": self._current_tasks_snapshot(),
            "cache": self.cache.metrics_snapshot(),
            "observability": self._telemetry_snapshot(),
        }

    def _publish_status(self) -> None:
        self.on_status(self.status_snapshot())

    def _dashboard_update(self, method: str, *arguments: object) -> None:
        # History failures must not turn a successful crawl into a failed task.
        try:
            if self.dashboard is None:
                return
            getattr(self.dashboard, method)(*arguments)
        except (OSError, sqlite3.Error):
            self._dashboard_unavailable = True
        finally:
            if self.dashboard is not None:
                self._captcha_waiting = self.dashboard.waiting_captcha

    def _dashboard_progress(self, assignments: list[dict[str, Any]], progress: dict[str, Any]) -> None:
        if self.dashboard is None:
            self._captcha_waiting = progress.get("phase") == "captcha"
        self._dashboard_update("progress", assignments, progress)
        self._publish_status()

    async def run(self) -> None:
        if self.config.auth_mode == "key":
            from .client_credentials import enroll_agent, load_credential
            self.client_id = await asyncio.to_thread(enroll_agent, self.store, self.config.server_url, self.config.display_name)
            self._agent_key, _request_id = load_credential(self.store, self.config.server_url)
        for assignment in self.store.recover_assignments():
            task_id = str(assignment["taskId"])
            self.active[task_id] = assignment
            self._dashboard_update("receive", assignment)
        executor = asyncio.create_task(self._execution_loop())
        completions = asyncio.create_task(self._completion_loop())
        try:
            await self._connection_supervisor()
        finally:
            self.stop_event.set()
            executor.cancel()
            completions.cancel()
            await asyncio.gather(executor, completions, return_exceptions=True)

    def stop(self) -> None:
        self.stop_event.set()
        with self._cancel_events_lock:
            events = [event for job_events in self.cancel_events.values() for event in job_events]
        for event in events:
            event.set()

    def _register_cancel_event(self, job_id: str, event: threading.Event, task_id: str | None = None) -> None:
        with self._cancel_events_lock:
            self.cancel_events.setdefault(job_id, set()).add(event)
        if task_id is not None and self.store.is_task_cancelled(task_id):
            event.set()

    def _unregister_cancel_event(self, job_id: str, event: threading.Event) -> None:
        with self._cancel_events_lock:
            events = self.cancel_events.get(job_id)
            if events is None:
                return
            events.discard(event)
            if not events:
                self.cancel_events.pop(job_id, None)

    def _cancel_job(self, job_id: str) -> None:
        if not job_id:
            return
        self.store.cancel_job(job_id)
        with self._cancel_events_lock:
            events = list(self.cancel_events.get(job_id, set()))
        for event in events:
            event.set()
        with self._running_crawlers_lock:
            crawlers = [
                self._running_crawlers.get(task_id)
                for task_id, assignment in self.active.items()
                if str(assignment.get("jobId") or "") == job_id
            ]
            if not crawlers and self._running_crawlers.get(job_id) is not None:
                crawlers.append(self._running_crawlers[job_id])
        self._debug_event(
            "stop_signal_applied",
            jobId=job_id,
            cancelEventCount=len(events),
            hasRunningCrawler=any(crawler is not None for crawler in crawlers),
        )
        for crawler in crawlers:
            if crawler is not None:
                threading.Thread(target=crawler.browser_pool.close, name=f"stop-task-{job_id[:8]}", daemon=True).start()

    def _cancel_task(self, task_id: str, lease_id: str) -> bool:
        assignment = self.active.get(task_id)
        if assignment is None or str(assignment.get("leaseId") or "") != lease_id:
            return False
        with self._cancel_events_lock:
            event = self.task_cancel_events.get(task_id)
            if event is not None:
                event.set()
        self.store.cancel_task(task_id)
        with self._running_crawlers_lock:
            crawler = self._running_crawlers.get(task_id)
        if crawler is not None and not isinstance(crawler, ProcessCrawler):
            threading.Thread(target=crawler.browser_pool.close, name=f"cancel-task-{task_id[:8]}", daemon=True).start()
        return True

    def set_paused(self, is_paused: bool) -> None:
        self._locally_paused = is_paused
        self.store.set_paused(is_paused)
        self._refresh_pause_state()

    def _refresh_pause_state(self) -> None:
        was_paused = self._paused
        self._paused = (self._locally_paused or self._remote_execution_state == "PAUSED"
                        or self._global_admission_stopped)
        if self._paused:
            self.connection_status = "paused"
        elif self.connection_status == "paused":
            self.connection_status = "online"
        if was_paused != self._paused:
            self._dashboard_update("activity", "paused" if self._paused else "resumed")
            self._publish_status()

    async def _apply_global_admission_gate(self, revision: int, state: str) -> None:
        self._global_admission_gate = await asyncio.to_thread(
            self.store.apply_global_admission_gate, revision, state,
        )
        self._global_admission_stopped = self._global_admission_gate["state"] == "STOPPED"
        self._refresh_pause_state()
        await self.outbound_queue.put({
            "type": "global_gate_ack",
            **self._global_admission_gate,
            "availableSlots": self._available_slots(),
        })

    def stop_and_discard_local_work(self) -> int:
        if self.config.auth_mode == "key":
            # Local stop cannot request job-wide cancellation or discard durable uploads.
            self.set_paused(True)
            with self._cancel_events_lock:
                for events in self.cancel_events.values():
                    for event in events:
                        event.set()
            return len(self.active)
        assignments = {str(entry["assignment"]["taskId"]): entry["assignment"]
                       for entry in self.store.dashboard_local_tasks()}
        assignments.update(self.active)
        assignments = list(assignments.values())
        job_ids = {
            str(assignment.get("jobId") or "")
            for assignment in assignments
            if str(assignment.get("jobId") or "")
        }
        for job_id in job_ids:
            self.store.add_cancel_intent(job_id)
            self._cancel_job(job_id)
            self.store.discard_job(job_id)
        for assignment in assignments:
            self._dashboard_update("finish", assignment, "cancelled")
            self._dashboard_update("delivery", str(assignment["taskId"]), str(assignment["leaseId"]), "cancelled")
        for task_id in list(self.active):
            if task_id not in self.executing_task_ids:
                self.active.pop(task_id, None)
        self._publish_status()
        return len(assignments)

    async def _apply_reconciliation(self, acknowledgement: dict[str, Any]) -> None:
        self._recovery_complete = False
        self._command_recovery_complete = False
        self._command_recovery_event.clear()
        gate = acknowledgement.get("globalAdmissionGate")
        if isinstance(gate, dict):
            try:
                revision = max(0, int(gate.get("revision") or 0))
            except (TypeError, ValueError):
                revision = -1
            state = str(gate.get("state") or "")
            if revision >= 0 and state in {"OPEN", "STOPPED"}:
                await self._apply_global_admission_gate(revision, state)
        command_batch = acknowledgement.get("commands")
        if isinstance(command_batch, list):
            await self._process_command_batch({
                "commands": command_batch,
                "latestCommandSequence": acknowledgement.get("latestCommandSequence", 0),
                "desiredExecutionState": acknowledgement.get("desiredExecutionState", "RUNNING"),
            })
        else:
            # A legacy Coordinator has no command contract; retain its existing
            # recovery behavior without pretending a new command was acknowledged.
            self._command_recovery_complete = True
            self._command_recovery_event.set()
        self._approved_attempts.clear()
        while not self.assignment_queue.empty():
            self.assignment_queue.get_nowait()
        resume_ids = {str(value) for value in acknowledgement.get("resumeTaskIds") or []}
        executable_ids = {
            str(assignment.get("taskId") or "")
            for assignment in self.store.recover_assignments()
        }
        discard_ids = {str(value) for value in acknowledgement.get("discardTaskIds") or []}
        cancel_task_ids = {str(value) for value in acknowledgement.get("cancelTaskIds") or []}
        cancelled_job_ids = {str(value) for value in acknowledgement.get("cancelledJobIds") or []}
        for job_id in cancelled_job_ids:
            self._cancel_job(job_id)
            cleanup_generation = max(0, int(acknowledgement.get("requiredCacheGeneration") or 0))
            current_generation = self._pending_stop_cleanups.get(job_id, -1)
            if cleanup_generation > current_generation:
                self._pending_stop_cleanups[job_id] = cleanup_generation
                asyncio.create_task(self._complete_stop_cleanup(job_id, cleanup_generation))
        for task_id in cancel_task_ids:
            assignment = self.active.get(task_id) or self.store.assignment(task_id)
            if assignment is None:
                continue
            lease_id = str(assignment["leaseId"])
            self._cancel_task(task_id, lease_id)
            await self.outbound_queue.put({"type": "cancel_received", "taskId": task_id, "leaseId": lease_id})
            if task_id not in self.executing_task_ids:
                self.store.discard_task(task_id)
                self.active.pop(task_id, None)
                await self.outbound_queue.put({"type": "cancel_ack", "taskId": task_id, "leaseId": lease_id})
        for task_id in discard_ids:
            assignment = self.active.get(task_id) or self.store.assignment(task_id)
            if assignment is not None:
                self.store.quarantine_attempt(task_id, str(assignment["leaseId"]), "reconcile_discarded")
                self._dashboard_update("finish", assignment, "cancelled")
                self._dashboard_update("delivery", task_id, str(assignment["leaseId"]), "cancelled")
                if task_id in self.executing_task_ids:
                    self._cancel_task(task_id, str(assignment["leaseId"]))
            if task_id not in self.executing_task_ids:
                self.active.pop(task_id, None)
                self.store.discard_task(task_id)
        for task_id in {str(value) for value in acknowledgement.get("uploadTaskIds") or []} - discard_ids:
            assignment = self.active.get(task_id) or self.store.assignment(task_id)
            if assignment is not None and str(assignment.get("jobId")) not in cancelled_job_ids and task_id not in self.executing_task_ids:
                # Replay the receipt without starting another crawl.
                self.store.complete_lease(task_id)
                self.active.pop(task_id, None)
        acknowledged = [str(value) for value in acknowledgement.get("acknowledgedCancelIntents") or []]
        self.store.acknowledge_cancel_intents(acknowledged)
        required_generation = max(0, int(acknowledgement.get("requiredCacheGeneration") or 0))
        if required_generation > self.store.cache_generation():
            await self._ensure_cache_generation(required_generation)
            await self.outbound_queue.put({
                "type": "cache_generation_ack",
                "cacheGeneration": required_generation,
                "availableSlots": self._available_slots(),
            })
        for invalidation in acknowledgement.get("productInvalidations") or []:
            await self._invalidate_product_cache(
                str(invalidation["asin"]), str(invalidation["amazonZip"]),
                int(invalidation["generation"]),
            )
        temporary_generation = max(0, int(acknowledgement.get("requiredTemporaryCleanupGeneration") or 0))
        if temporary_generation > self.store.temporary_cleanup_generation():
            cleanup = await self.clear_temporary_data(
                "reconnect", {str(value) for value in acknowledgement.get("validJobIds") or []},
                generation=temporary_generation,
            )
            if cleanup.get("error"):
                raise RuntimeError(f"Could not clear temporary crawler data: {cleanup['error']}")
        await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
        self._publish_status()

        for task_id in resume_ids - discard_ids:
            assignment = self.active.get(task_id) or self.store.assignment(task_id)
            if assignment is not None and str(assignment.get("jobId")) not in cancelled_job_ids and task_id in executable_ids and task_id not in self.executing_task_ids:
                self.active[task_id] = assignment
                self._approved_attempts.add((task_id, str(assignment["leaseId"])))
                await self.assignment_queue.put(assignment)

    async def _process_command_batch(self, message: dict[str, Any]) -> None:
        commands = message.get("commands")
        if not isinstance(commands, list):
            raise ValueError("Coordinator command batch is malformed.")
        for command in commands:
            if not isinstance(command, dict):
                raise ValueError("Coordinator command is malformed.")
            receipt = await asyncio.to_thread(self.store.begin_server_command, command)
            command_id = str(command.get("commandId") or "")
            sequence = int(command.get("sequence") or 0)
            if receipt["decision"] == "gap":
                await self.outbound_queue.put({"type": "command_sync", "afterSequence": int(receipt["expectedSequence"]) - 1})
                return
            status = str(receipt.get("status") or "ACKED")
            if receipt["decision"] == "duplicate":
                update = {"type": "command_update", "commandId": command_id,
                    "sequence": sequence, "status": status}
                if status == "SUCCESS":
                    update["appliedExecutionState"] = self._remote_execution_state
                await self.outbound_queue.put(update)
                continue
            if receipt["decision"] == "expired":
                await self.outbound_queue.put({"type": "command_update", "commandId": command_id,
                    "sequence": sequence, "status": "EXPIRED"})
                continue
            if receipt["decision"] == "process":
                await self.outbound_queue.put({"type": "command_update", "commandId": command_id,
                    "sequence": sequence, "status": "ACKED"})
            payload = command.get("payload")
            desired_state = "PAUSED" if command.get("type") == "PAUSE" else "RUNNING"
            if not isinstance(payload, dict) or payload.get("desiredExecutionState") != desired_state:
                error = "Command payload does not match its type."
                await asyncio.to_thread(self.store.complete_server_command, command_id, sequence, "FAILED", None, error)
                await self.outbound_queue.put({"type": "command_update", "commandId": command_id,
                    "sequence": sequence, "status": "FAILED", "error": error})
                continue
            await asyncio.to_thread(self.store.set_server_command_running, command_id)
            await self.outbound_queue.put({"type": "command_update", "commandId": command_id,
                "sequence": sequence, "status": "RUNNING"})
            await asyncio.to_thread(self.store.complete_server_command, command_id, sequence, "SUCCESS", desired_state)
            self._remote_execution_state = desired_state
            self._refresh_pause_state()
            await self.outbound_queue.put({"type": "command_update", "commandId": command_id,
                "sequence": sequence, "status": "SUCCESS", "appliedExecutionState": desired_state})
        last_sequence = self.store.last_processed_command_sequence()
        latest_sequence = int(message.get("latestCommandSequence") or last_sequence)
        desired_state = str(message.get("desiredExecutionState") or self._remote_execution_state)
        applied_state = str(message.get("appliedExecutionState") or self._remote_execution_state)
        server_sequence = int(message.get("serverLastProcessedCommandSequence") or 0)
        if last_sequence < latest_sequence:
            await self.outbound_queue.put({"type": "command_sync", "afterSequence": last_sequence})
            return
        if desired_state in {"RUNNING", "PAUSED"} and self._remote_execution_state != desired_state:
            await self.outbound_queue.put({"type": "command_sync", "afterSequence": max(0, last_sequence - 1)})
            return
        if (applied_state in {"RUNNING", "PAUSED"} and desired_state == applied_state
                and server_sequence >= latest_sequence and self._remote_execution_state != applied_state):
            await asyncio.to_thread(self.store.reconcile_remote_execution_state, applied_state)
            self._remote_execution_state = applied_state
            self._refresh_pause_state()
        self._command_recovery_complete = True
        self._command_recovery_event.set()
        await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots(),
            "lastProcessedCommandSequence": last_sequence, "appliedExecutionState": self._remote_execution_state})

    async def _recovery_gate_loop(self) -> None:
        # One bounded upload pass, not an unbounded drain of the entire spool.
        await self._uploads_checked.wait()
        await self._command_recovery_event.wait()
        self._recovery_complete = True
        await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots(),
            "lastProcessedCommandSequence": self.store.last_processed_command_sequence(),
            "appliedExecutionState": self._remote_execution_state})
        self._publish_status()
        await self.stop_event.wait()

    async def _connection_supervisor(self) -> None:
        delay = 1.0
        while not self.stop_event.is_set():
            self._is_connected = False
            self._recovery_complete = False
            self._command_recovery_complete = False
            self._command_recovery_event.clear()
            self._uploads_checked.clear()
            try:
                async with websockets.connect(
                    self.config.websocket_url,
                    **({"additional_headers": {"Authorization": "Bearer " + self._agent_key}} if self._agent_key else {}),
                    open_timeout=15,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=4 * 1024 * 1024,
                ) as websocket:
                    self.connection_status = "paused" if self._paused else "online"
                    self._publish_status()
                    await websocket.send(json.dumps({**hello_message(
                        client_id=self.client_id,
                        display_name=self.config.display_name,
                        available_slots=self._available_slots(),
                        max_concurrent_inputs=self.config.max_concurrent_inputs,
                        limits=self.config.limits,
                        local_tasks=self.store.local_tasks(),
                        cancel_intents=[] if self._agent_key else self.store.cancel_intents(),
                        cache_generation=self.store.cache_generation(),
                        product_invalidation_generation=self.store.product_invalidation_generation(),
                        temporary_cleanup_generation=self.store.temporary_cleanup_generation(),
                        pinterest_browser_logged_in=self.pinterest_browser_logged_in(),
                        last_processed_command_sequence=self.store.last_processed_command_sequence(),
                        desired_execution_state=self.store.remote_execution_state(),
                    ), **({"authProtocol": 1} if self._agent_key else {})}))
                    acknowledgement = json.loads(await asyncio.wait_for(websocket.recv(), timeout=15))
                    if acknowledgement.get("type") != "hello_ack":
                        raise RuntimeError("Coordinator did not acknowledge the worker protocol.")
                    await self._apply_reconciliation(acknowledgement)
                    self._is_connected = True
                    self._dashboard_update("activity", "connected")
                    self._publish_status()
                    delay = 1.0
                    connection_tasks = [
                        asyncio.create_task(self._sender(websocket)),
                        asyncio.create_task(self._receiver(websocket)),
                        asyncio.create_task(self._heartbeat_loop()),
                        asyncio.create_task(self._upload_loop()),
                        asyncio.create_task(self._telemetry_loop()),
                    ]
                    connection_tasks.append(asyncio.create_task(self._recovery_gate_loop()))
                    stop_waiter = asyncio.create_task(self.stop_event.wait())
                    tasks = [*connection_tasks, stop_waiter]
                    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    self._recovery_complete = False
                    self._is_connected = False
                    for task in pending:
                        task.cancel()
                    await asyncio.gather(*pending, return_exceptions=True)
                    if stop_waiter in done:
                        return
                    for task in done:
                        if task.cancelled():
                            continue
                        error = task.exception()
                        if error:
                            raise error
                    raise ConnectionError("Coordinator connection ended; reconciliation required.")
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._is_connected = False
                self._recovery_complete = False
                close_frame = getattr(error, "rcvd", None)
                if self._agent_key and getattr(close_frame, "code", None) == 4004:
                    self.connection_status = "NEED_REAUTH"
                    self._publish_status()
                    # Keep leases/outbox intact; require operator action before reconnect.
                    return
                self.connection_status = "offline"
                self._dashboard_update("activity", "offline")
                self._publish_status()
                self.on_status({**self.status_snapshot(), "lastError": redact(error)})
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=delay + random.random())
                except (TimeoutError, asyncio.TimeoutError):
                    pass
                delay = min(30.0, delay * 2)

    async def _sender(self, websocket) -> None:
        while True:
            payload = await self.outbound_queue.get()
            if "availableSlots" in payload:
                payload = {**payload, "availableSlots": self._available_slots()}
            await websocket.send(json.dumps(payload, ensure_ascii=False))

    async def _receiver(self, websocket) -> None:
        async for raw in websocket:
            payload = json.loads(raw)
            message_type = payload.get("type")
            if message_type == "assignment":
                if (not self._is_connected or not self._recovery_complete or not self._command_recovery_complete
                        or self._paused or self._storage_pressure()["blocked"]):
                    # A lease sent before the last capacity update is not
                    # accepted locally. The coordinator can expire/reassign it.
                    await self.outbound_queue.put({"type": "ready", "availableSlots": 0})
                    self._publish_status()
                    continue
                task_id = str(payload["taskId"])
                if task_id not in self.active:
                    self.store.save_assignment(payload)
                    self.active[task_id] = payload
                    self._approved_attempts.add((task_id, str(payload["leaseId"])))
                    self._dashboard_update("receive", payload)
                    await self.assignment_queue.put(payload)
                    self._publish_status()
            elif message_type == "telemetry_ack":
                event_ids = payload.get("eventIds")
                if isinstance(event_ids, list):
                    await asyncio.to_thread(self.store.acknowledge_telemetry, [event_id for event_id in event_ids[:64] if isinstance(event_id, str)])
            elif message_type == "command_batch":
                await self._process_command_batch(payload)
            elif message_type == "command_sync":
                await self.outbound_queue.put({
                    "type": "command_sync",
                    "afterSequence": self.store.last_processed_command_sequence(),
                })
            elif message_type == "global_admission_gate":
                try:
                    revision = max(0, int(payload.get("revision") or 0))
                except (TypeError, ValueError):
                    continue
                state = str(payload.get("state") or "")
                if state not in {"OPEN", "STOPPED"}:
                    continue
                await self._apply_global_admission_gate(revision, state)
            elif message_type == "cancel":
                job_id = str(payload.get("jobId") or "")
                generation = max(0, int(payload.get("cacheGeneration") or 0))
                self._debug_event(
                    "stop_received",
                    jobId=job_id,
                    cacheGeneration=generation,
                    activeTaskIds=sorted(
                        task_id
                        for task_id, assignment in self.active.items()
                        if str(assignment.get("jobId") or "") == job_id
                    ),
                    executingTaskIds=sorted(self.executing_task_ids),
                )
                self._cancel_job(job_id)
                for assignment in list(self.active.values()):
                    if str(assignment.get("jobId") or "") != job_id:
                        continue
                    await self.outbound_queue.put({
                        "type": "cancel_received",
                        "taskId": assignment["taskId"],
                        "leaseId": assignment["leaseId"],
                    })
                current_generation = self._pending_stop_cleanups.get(job_id, 0)
                if job_id and (job_id not in self._pending_stop_cleanups or generation > current_generation):
                    self._pending_stop_cleanups[job_id] = generation
                    asyncio.create_task(self._complete_stop_cleanup(job_id, generation))
            elif message_type == "cancel_task":
                task_id = str(payload.get("taskId") or "")
                lease_id = str(payload.get("leaseId") or "")
                assignment = self.active.get(task_id)
                if assignment is None or str(assignment.get("leaseId") or "") != lease_id:
                    continue
                self._cancel_task(task_id, lease_id)
                await self.outbound_queue.put({
                    "type": "cancel_received",
                    "taskId": task_id,
                    "leaseId": lease_id,
                })
            elif message_type == "pause":
                self.set_paused(bool(payload.get("paused", True)))
            elif message_type == "clear_cache":
                response = await self.clear_local_cache(
                    str(payload.get("requestId") or ""),
                    generation=max(0, int(payload.get("cacheGeneration") or 0)),
                )
                await self.outbound_queue.put(response)
                if response.get("error"):
                    raise OSError(str(response["error"]))
            elif message_type == "invalidate_product_cache":
                response = await self.invalidate_product_cache(
                    str(payload.get("requestId") or ""),
                    str(payload.get("asin") or ""),
                    str(payload.get("amazonZip") or ""),
                    max(0, int(payload.get("generation") or 0)),
                )
                await self.outbound_queue.put(response)
                if response.get("error"):
                    raise OSError(str(response["error"]))
            elif message_type == "clear_temporary_data":
                response = await self.clear_temporary_data(
                    str(payload.get("requestId") or ""),
                    {str(value) for value in payload.get("validJobIds") or []},
                    generation=max(0, int(payload.get("generation") or 0)),
                )
                await self.outbound_queue.put(response)
                if response.get("error"):
                    raise OSError(str(response["error"]))

    async def clear_local_cache(self, request_id: str, *, generation: int = 0) -> dict[str, Any]:
        try:
            if generation:
                async with self._cache_cleanup_lock:
                    result = await asyncio.to_thread(self.cache.clear)
                    self.store.set_cache_generation(max(self.store.cache_generation(), generation))
            else:
                result = await asyncio.to_thread(self.cache.clear)
            return {"type": "cache_cleared", "requestId": request_id, **result, "error": None}
        except OSError as error:
            return {
                "type": "cache_cleared", "requestId": request_id,
                "removedFiles": 0, "removedBytes": 0, "error": redact(error),
            }

    async def _invalidate_product_cache(self, asin: str, amazon_zip: str, generation: int) -> dict[str, int]:
        cache_key = f"{asin}:{amazon_zip}:us-v1"
        result = await asyncio.to_thread(
            self.cache.invalidate, cache_key,
        )
        self.store.set_product_invalidation_generation(generation)
        return result

    async def invalidate_product_cache(
        self, request_id: str, asin: str, amazon_zip: str, generation: int,
    ) -> dict[str, Any]:
        try:
            result = await self._invalidate_product_cache(asin, amazon_zip, generation)
            return {"type": "product_cache_invalidated", "requestId": request_id, **result, "error": None}
        except OSError as error:
            return {"type": "product_cache_invalidated", "requestId": request_id,
                    "removedFiles": 0, "removedBytes": 0, "error": redact(error)}

    async def clear_temporary_data(
        self, request_id: str, valid_job_ids: set[str], *, generation: int = 0,
    ) -> dict[str, Any]:
        try:
            discarded_jobs = await asyncio.to_thread(self.store.clear_orphaned_jobs, valid_job_ids)
            result = await asyncio.to_thread(
                self.cache.clear_temporary_files,
            )
            if generation:
                self.store.set_temporary_cleanup_generation(generation)
            return {"type": "temporary_data_cleared", "requestId": request_id,
                    "discardedJobs": discarded_jobs, **result, "error": None}
        except OSError as error:
            return {"type": "temporary_data_cleared", "requestId": request_id,
                    "discardedJobs": 0, "removedFiles": 0, "removedBytes": 0, "error": redact(error)}

    async def _ensure_cache_generation(self, generation: int) -> dict[str, Any]:
        async with self._cache_cleanup_lock:
            if self.store.cache_generation() >= generation:
                return {"removedFiles": 0, "removedBytes": 0}
            result = await asyncio.to_thread(self.cache.clear)
            self.store.set_cache_generation(generation)
            return result

    async def _complete_stop_cleanup(self, job_id: str, generation: int) -> None:
        started_at = time.monotonic()
        local_tasks = {
            str(task.get("taskId") or ""): task
            for task in self.store.local_tasks()
            if str(task.get("jobId") or "") == job_id
        }
        job_task_ids = {
            task_id
            for task_id, assignment in self.active.items()
            if str(assignment.get("jobId") or "") == job_id
        } | set(local_tasks)
        acknowledged_task_ids: set[str] = set()
        for task_id, assignment in list(self.active.items()):
            if str(assignment.get("jobId") or "") != job_id or task_id in self.executing_task_ids:
                continue
            self.active.pop(task_id, None)
            self._dashboard_update("finish", assignment, "cancelled")
            self._dashboard_update("delivery", task_id, str(assignment["leaseId"]), "cancelled")
            self.store.discard_task(task_id)
            await self.outbound_queue.put({
                "type": "cancel_ack",
                "taskId": task_id,
                "leaseId": assignment["leaseId"],
            })
            acknowledged_task_ids.add(task_id)
        for task_id, local_task in local_tasks.items():
            if task_id in acknowledged_task_ids or task_id in self.active or task_id in self.executing_task_ids:
                continue
            await self.outbound_queue.put({
                "type": "cancel_ack",
                "taskId": task_id,
                "leaseId": local_task["leaseId"],
            })
        while (
            any(
                str(assignment.get("jobId") or "") == job_id
                for assignment in self.active.values()
            )
            or bool(job_task_ids & self.executing_task_ids)
        ):
            await asyncio.sleep(0.1)
        self._debug_event(
            "stop_execution_drained",
            jobId=job_id,
            cacheGeneration=generation,
            durationMs=round((time.monotonic() - started_at) * 1000),
        )
        self.store.discard_job(job_id)
        while self._pending_stop_cleanups.get(job_id) == generation:
            try:
                cache_result = {"removedFiles": 0, "removedBytes": 0}
                self._debug_event(
                    "stop_cleanup_completed",
                    jobId=job_id,
                    cacheGeneration=generation,
                    durationMs=round((time.monotonic() - started_at) * 1000),
                    **cache_result,
                )
                await self.outbound_queue.put({
                    "type": "stop_cleanup_ack",
                    "jobId": job_id,
                    "cacheGeneration": generation,
                    **cache_result,
                    "error": None,
                })
                self._pending_stop_cleanups.pop(job_id, None)
                await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
                self._publish_status()
                return
            except Exception as error:
                self._debug_event(
                    "stop_cleanup_failed",
                    jobId=job_id,
                    cacheGeneration=generation,
                    error=redact(error),
                )
                await self.outbound_queue.put({
                    "type": "stop_cleanup_ack",
                    "jobId": job_id,
                    "cacheGeneration": generation,
                    "error": redact(error),
                })
                await asyncio.sleep(1)

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.to_thread(self.cache.maintain)
            self._resources = await asyncio.to_thread(self._sample_resources)
            self._publish_status()
            running = self._current_tasks_snapshot()
            await self.outbound_queue.put({
                "type": "heartbeat",
                "status": "paused" if self._paused else (
                    "waiting_captcha" if self._captcha_waiting else (
                        "degraded" if self._worker_health_snapshot()["state"] == "degraded"
                        else ("busy" if running else "online")
                    )
                ),
                "availableSlots": self._available_slots(),
                "lastProcessedCommandSequence": self.store.last_processed_command_sequence(),
                "appliedExecutionState": self._remote_execution_state,
                "running": running,
                "capabilities": self._agent_capabilities(),
                "observability": self._telemetry_snapshot(),
            })
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)

    async def _telemetry_loop(self) -> None:
        while True:
            events = await asyncio.to_thread(self.store.pending_telemetry)
            if events:
                await self.outbound_queue.put({"type": "telemetry", "events": events})
            await asyncio.sleep(1)

    def _storage_pressure(self) -> dict[str, Any]:
        return storage_pressure(self.store, self.config.outbox, self.project_root)

    def _available_slots(self) -> int:
        if (not self._is_connected or not self._recovery_complete or not self._command_recovery_complete
                or self._paused or self._pending_stop_cleanups or self._storage_pressure()["blocked"]):
            return 0
        effective_concurrency = int(self._worker_health_snapshot()["effectiveConcurrency"])
        return max(0, effective_concurrency - len(self.active))

    async def _execution_loop(self) -> None:
        backlog: deque[dict[str, Any]] = deque()
        loop = asyncio.get_running_loop()
        while not self.stop_event.is_set():
            if not self._is_connected or not self._recovery_complete or self._paused or self._storage_pressure()["blocked"]:
                await asyncio.sleep(1)
                continue
            try:
                first = backlog.popleft() if backlog else await self.assignment_queue.get()
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(0.1)
                continue

            batch = [first]
            batch_key = (first["jobId"], first["settingsFingerprint"])
            deadline = loop.time() + 0.4
            effective_concurrency = int(self._worker_health_snapshot()["effectiveConcurrency"])
            while len(batch) < effective_concurrency:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    candidate = await asyncio.wait_for(self.assignment_queue.get(), timeout=remaining)
                except (TimeoutError, asyncio.TimeoutError):
                    break
                candidate_key = (candidate["jobId"], candidate["settingsFingerprint"])
                if candidate_key == batch_key:
                    batch.append(candidate)
                else:
                    backlog.append(candidate)
            if not self._is_connected or not self._recovery_complete or self._paused or self._storage_pressure()["blocked"]:
                backlog.extendleft(reversed(batch))
                await asyncio.sleep(1)
                continue
            runnable: list[dict[str, Any]] = []
            executable_attempts = {
                (str(local["taskId"]), str(local["leaseId"]))
                for local in self.store.recover_assignments()
            }
            for assignment in batch:
                task_id = str(assignment["taskId"])
                attempt = (task_id, str(assignment["leaseId"]))
                if attempt not in self._approved_attempts or task_id in self.executing_task_ids:
                    continue
                self._approved_attempts.discard(attempt)
                if self.store.is_task_cancelled(task_id):
                    self._dashboard_update("finish", assignment, "cancelled")
                    self.active.pop(task_id, None)
                    self.store.discard_task(task_id)
                    await self.outbound_queue.put({
                        "type": "cancel_ack",
                        "taskId": task_id,
                        "leaseId": assignment["leaseId"],
                    })
                elif attempt in executable_attempts:
                    runnable.append(assignment)
            batch = runnable
            if not batch:
                await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
                self._publish_status()
                continue
            task_ids = [str(assignment["taskId"]) for assignment in batch]
            self.executing_task_ids.update(task_ids)
            self.store.mark_running(task_ids)
            for assignment in batch:
                self._dashboard_update("start", assignment)
            self._publish_status()
            job_id = str(first["jobId"])
            task_events = {task_id: threading.Event() for task_id in task_ids}
            with self._cancel_events_lock:
                self.task_cancel_events.update(task_events)
            for task_id, task_event in task_events.items():
                self._register_cancel_event(job_id, task_event, task_id)
            cancel_event = threading.Event()
            channel = str(first.get("channel", "amazon")).lower()
            try:
                if channel == "pinterest":
                    await asyncio.to_thread(self._run_pinterest_batch, batch, cancel_event, loop)
                elif channel == "amazon_reviews":
                    await asyncio.to_thread(self._run_review_batch, batch, cancel_event, loop)
                else:
                    await asyncio.to_thread(self._run_batch, batch, cancel_event, loop)
            except Exception as error:
                for assignment in batch:
                    await self.completion_queue.put({
                        "type": "failed",
                        "taskId": assignment["taskId"],
                        "leaseId": assignment["leaseId"],
                        "error": {
                            "message": f"Crawler batch could not start or complete: {redact(error)}",
                            "retryable": True,
                        },
                    })
            finally:
                for task_event in task_events.values():
                    self._unregister_cancel_event(job_id, task_event)
                with self._cancel_events_lock:
                    for task_id in task_ids:
                        self.task_cancel_events.pop(task_id, None)
                self.executing_task_ids.difference_update(task_ids)

    def _run_review_batch(self, batch: list[dict[str, Any]], cancel_event: threading.Event, loop: asyncio.AbstractEventLoop) -> None:
        for assignment in batch:
            task_id = str(assignment["taskId"])
            task_cancel_event = self.task_cancel_events.get(task_id, cancel_event)
            if task_cancel_event.is_set():
                asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                    "type": "cancelled", "taskId": assignment["taskId"], "leaseId": assignment["leaseId"],
                }), loop)
                continue

            def progress(update: dict[str, Any]) -> None:
                if task_cancel_event.is_set():
                    return
                self._captcha_waiting = update.get("phase") == "captcha"
                asyncio.run_coroutine_threadsafe(self.outbound_queue.put({
                    "type": "progress", "taskId": assignment["taskId"],
                    "leaseId": assignment["leaseId"], "progress": update,
                }), loop)
                loop.call_soon_threadsafe(self._publish_status)

            try:
                review_data = crawl_reviews_with_agent(
                    str(assignment["source"]), root=self.project_root,
                    settings=self.config.limits.apply(dict(assignment.get("settings") or {})),
                    proxy_config_path=self.config.proxy_config_path,
                    progress=progress, cancel_event=task_cancel_event,
                )
                if task_cancel_event.is_set():
                    asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                        "type": "cancelled", "taskId": assignment["taskId"], "leaseId": assignment["leaseId"],
                    }), loop)
                    continue
                core_result = {"status": "completed", "products": [], "errors": [], "warnings": review_data["warnings"],
                               "durationMs": 0, "reviewData": review_data}
                envelope = {
                    "version": "distributed-reviews-1", "agentVersion": AGENT_VERSION,
                    "taskId": assignment["taskId"], "jobId": assignment["jobId"],
                    "leaseId": assignment["leaseId"], "clientId": self.client_id,
                    "source": assignment["source"], "asin": assignment["asin"],
                    "completedAt": utc_iso(), "resultChecksum": payload_checksum(core_result), **core_result,
                }
                self.store.spool_result(task_id=str(assignment["taskId"]), lease_id=str(assignment["leaseId"]),
                                        checksum=payload_checksum(envelope), payload=envelope)
                asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                    "type": "completed", "taskId": assignment["taskId"],
                }), loop)
            finally:
                self._captcha_waiting = False

    def _run_batch(self, batch: list[dict[str, Any]], cancel_event: threading.Event, loop: asyncio.AbstractEventLoop) -> None:
        if self.crawler_factory is not AmazonCrawler or len(batch) == 1:
            assignment = batch[0]
            task_event = self.task_cancel_events.get(str(assignment["taskId"]), cancel_event)
            self._run_batch_group(batch, task_event, loop)
            return

        # A disposable process must own one task only; otherwise terminating one
        # hung task would also terminate its siblings in the same process tree.
        with ThreadPoolExecutor(max_workers=len(batch), thread_name_prefix="crawler-task") as executor:
            futures = {
                executor.submit(
                    self._run_batch_group,
                    [assignment],
                    self.task_cancel_events.get(str(assignment["taskId"]), cancel_event),
                    loop,
                ): assignment
                for assignment in batch
            }
            for future, assignment in futures.items():
                try:
                    future.result()
                except Exception as error:
                    asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                        "type": "failed",
                        "taskId": assignment["taskId"],
                        "leaseId": assignment["leaseId"],
                        "error": {"message": f"Crawler task could not start or complete: {redact(error)}", "retryable": True},
                    }), loop)

    def _run_batch_group(self, batch: list[dict[str, Any]], cancel_event: threading.Event, loop: asyncio.AbstractEventLoop) -> None:
        first = batch[0]
        effective_settings = self.config.limits.apply(dict(first.get("settings") or {}))
        settings = CrawlSettings.from_api(effective_settings)
        actual_settings = settings.api_dict()
        assignments_by_source = {str(assignment["url"]): assignment for assignment in batch}
        completed_task_ids: set[str] = set()
        completion_lock = threading.Lock()

        def enqueue_completion(completion: dict[str, Any]) -> None:
            task_id = str(completion["taskId"])
            with completion_lock:
                if task_id in completed_task_ids:
                    return
                completed_task_ids.add(task_id)
            asyncio.run_coroutine_threadsafe(self.completion_queue.put(completion), loop)

        def enqueue_cancelled(assignment: dict[str, Any]) -> None:
            enqueue_completion({
                "type": "cancelled",
                "taskId": assignment["taskId"],
                "leaseId": assignment["leaseId"],
            })

        def progress(progress_payload: dict[str, Any]) -> None:
            if cancel_event.is_set():
                return
            for assignment in progress_targets(batch, progress_payload):
                asyncio.run_coroutine_threadsafe(self.outbound_queue.put({
                    "type": "progress", "taskId": assignment["taskId"], "leaseId": assignment["leaseId"],
                    "progress": progress_for_assignment(progress_payload, assignment),
                }), loop)
            loop.call_soon_threadsafe(self._dashboard_progress, batch, progress_payload)

        def completed(input_result: dict[str, Any]) -> None:
            assignment = assignments_by_source.get(str(input_result.get("source") or ""))
            if assignment is None:
                assignment = next((item for item in batch if item.get("asin") == input_result.get("asin")), None)
            if assignment is None:
                return
            if cancel_event.is_set():
                enqueue_cancelled(assignment)
                return
            core_result = {
                "status": input_result["status"], "products": input_result["products"],
                "errors": input_result["errors"], "warnings": input_result["warnings"],
                "durationMs": input_result["durationMs"],
                **{key: input_result.get(key, []) for key in (
                    "completedAsins", "failedAsins", "retryableAsins", "nonRetryableAsins",
                )},
            }
            envelope = {
                "version": "distributed-1", "agentVersion": AGENT_VERSION,
                "taskId": assignment["taskId"], "jobId": assignment["jobId"],
                "requestId": assignment.get("requestId", assignment["taskId"]),
                "leaseId": assignment["leaseId"], "clientId": self.client_id,
                "source": assignment["source"], "asin": assignment["asin"],
                "requestedSettingsFingerprint": assignment["settingsFingerprint"],
                "settingsFingerprint": settings_fingerprint(actual_settings),
                "settings": actual_settings,
                "completedAt": input_result["completedAt"], "resultChecksum": payload_checksum(core_result),
                **core_result,
            }
            if input_result["status"] == "completed":
                checksum = payload_checksum(envelope)
                self.store.spool_result(
                    task_id=assignment["taskId"], lease_id=assignment["leaseId"],
                    checksum=checksum, payload=envelope,
                )
                enqueue_completion({
                    "type": "completed", "taskId": assignment["taskId"],
                })
            elif input_result["status"] == "failed":
                error = input_result["errors"][0] if input_result["errors"] else {"message": "Crawler failed.", "retryable": True}
                enqueue_completion({
                    "type": "failed", "taskId": assignment["taskId"], "leaseId": assignment["leaseId"], "error": error,
                })
            elif input_result["status"] == "cancelled":
                enqueue_cancelled(assignment)

        def product_completed(product_result: dict[str, Any]) -> None:
            assignment = assignments_by_source.get(str(product_result.get("source") or ""))
            if assignment is None:
                assignment = next(
                    (item for item in batch if item.get("asin") == product_result.get("asin")),
                    None,
                )
            product = product_result.get("product")
            if assignment is None or not isinstance(product, dict):
                return
            if cancel_event.is_set():
                return
            product_key = str(product.get("sourceKey") or product.get("id") or "").strip()
            if not product_key:
                return
            core_payload = {
                "sourceKey": product_key,
                "productId": str(product.get("id") or product_key),
                "product": product,
            }
            envelope = {
                "version": "distributed-2",
                "agentVersion": AGENT_VERSION,
                "taskId": assignment["taskId"],
                "jobId": assignment["jobId"],
                "leaseId": assignment["leaseId"],
                "clientId": self.client_id,
                "source": assignment["source"],
                "asin": assignment["asin"],
                "completedAt": product_result.get("completedAt") or utc_iso(),
                "productChecksum": payload_checksum(product),
                **core_payload,
            }
            self.store.spool_product(
                task_id=str(assignment["taskId"]),
                product_key=product_key,
                lease_id=str(assignment["leaseId"]),
                checksum=payload_checksum(envelope),
                payload=envelope,
            )
            loop.call_soon_threadsafe(self._publish_status)

        factory = ProcessCrawler if self.crawler_factory is AmazonCrawler else self.crawler_factory
        deadline_arguments = {
            "job_deadline_at": min((str(assignment["jobDeadlineAt"]) for assignment in batch if assignment.get("jobDeadlineAt")), default=None),
            "asin_deadline_at": min((str(assignment["asinDeadlineAt"]) for assignment in batch if assignment.get("asinDeadlineAt")), default=None),
        } if factory is ProcessCrawler else {}
        worker_health_arguments = {"on_worker_failure": self._record_worker_failure} if factory is ProcessCrawler else {}
        crawler = factory(
            root=self.project_root,
            settings=settings,
            progress=progress,
            cancel_event=cancel_event,
            proxy_config_path=self.config.proxy_config_path,
            **deadline_arguments,
            **worker_health_arguments,
        )
        with self._running_crawlers_lock:
            self._running_crawlers[str(first["taskId"])] = crawler
        try:
            trace_arguments = {
                "trace_contexts": {str(assignment["asin"]): {
                    "taskId": assignment["taskId"], "leaseId": assignment["leaseId"], "agentId": self.client_id,
                    "requestId": assignment.get("requestId", assignment["taskId"]), "taskAttempt": assignment.get("taskAttempt", 1),
                } for assignment in batch},
                "on_telemetry": self._record_telemetry,
            } if isinstance(crawler, (AmazonCrawler, ProcessCrawler)) else {}
            crawler.run(
                job_id=str(first["jobId"]),
                sources=[str(assignment["url"]) for assignment in batch],
                on_input_complete=completed,
                on_product_complete=product_completed,
                write_export=False,
                **trace_arguments,
            )
        finally:
            if cancel_event.is_set():
                for assignment in batch:
                    enqueue_cancelled(assignment)
            crawler.browser_pool.close()
            with self._running_crawlers_lock:
                if self._running_crawlers.get(str(first["taskId"])) is crawler:
                    self._running_crawlers.pop(str(first["taskId"]), None)
            if self.dashboard is None:
                self._captcha_waiting = False
            loop.call_soon_threadsafe(self._publish_status)

    def _open_agent_request(self, request):
        if self.config.auth_mode == "key":
            from .client_credentials import credential_request
            if self._agent_key is None:
                raise ValueError("AGENT_NEED_REAUTH")
            if not request.full_url.startswith(self.config.server_url.rstrip("/") + "/"):
                raise ValueError("AGENT_ORIGIN_MISMATCH")
            request.add_header("Authorization", "Bearer " + self._agent_key)
            return credential_request(request)
        return urllib.request.urlopen(request, timeout=60)

    def _upload_asset(self, job_id: str, filename: str, data: bytes, assignment=None) -> None:
        safe_job_id = "".join(c for c in job_id if c.isalnum() or c in ("-", "_"))
        safe_filename = Path(filename).name
        request = urllib.request.Request(
            f"{self.config.server_url}/api/v1/pinterest-assets/{safe_job_id}/{safe_filename}",
            data=data,
            method="POST",
            headers={"Content-Type": "application/octet-stream"},
        )
        if self._agent_key and assignment:
            request.add_header("X-Task-Id", str(assignment["taskId"]))
            request.add_header("X-Lease-Id", str(assignment["leaseId"]))
        try:
            with self._open_agent_request(request):
                pass
        except Exception:
            if self.config.auth_mode == "key":
                raise
            pass

    def pinterest_browser_logged_in(self) -> bool:
        pod_server_dir = self.project_root / "src" / "modules" / "pinterest-pod" / "server"
        if pod_server_dir.is_dir() and str(pod_server_dir) not in sys.path:
            sys.path.insert(0, str(pod_server_dir))
        try:
            import pinterest_pod_bridge as pod_bridge

            profile_dir = pod_server_dir / "pinterest" / ".pinterest_browser_profile"
            return bool(pod_bridge.check_browser_profile_logged_in(profile_dir))
        except Exception:
            return False

    def _agent_capabilities(self) -> dict[str, Any]:
        return {
            "amazon": True,
            "pinterest": True,
            "pinterestBrowserLoggedIn": self.pinterest_browser_logged_in(),
        }

    def _current_tasks_snapshot(self) -> list[dict[str, Any]]:
        active_task_ids = set(self.active)
        with self._task_activity_lock:
            for stale_task_id in set(self._task_activity) - active_task_ids:
                self._task_activity.pop(stale_task_id, None)
            activities = {task_id: dict(activity) for task_id, activity in self._task_activity.items()}
        snapshots: list[dict[str, Any]] = []
        for task_id, assignment in list(self.active.items()):
            settings = assignment.get("settings") if isinstance(assignment.get("settings"), dict) else {}
            activity = activities.get(task_id, {})
            queries = settings.get("custom_queries") if isinstance(settings.get("custom_queries"), list) else []
            snapshots.append({
                "taskId": task_id,
                "jobId": str(assignment.get("jobId") or ""),
                "leaseId": str(assignment.get("leaseId") or ""),
                "channel": str(assignment.get("channel") or settings.get("channel") or "amazon"),
                "stage": str(assignment.get("action") or settings.get("stage") or "crawl"),
                "source": str(assignment.get("source") or ""),
                "niche": str(settings.get("niche") or assignment.get("source") or ""),
                "product": str(settings.get("product") or ""),
                "queryCount": len(queries),
                "message": str(activity.get("message") or "Đang chuẩn bị tác vụ trên Agent."),
                "percent": max(0, min(100, int(activity.get("percent") or 0))),
                "updatedAt": activity.get("updatedAt"),
            })
        return snapshots

    def _update_task_activity(self, task_id: str, message: str, percent: int) -> None:
        with self._task_activity_lock:
            self._task_activity[task_id] = {
                "message": message[:500],
                "percent": max(0, min(100, int(percent))),
                "updatedAt": utc_iso(),
            }

    def _run_pinterest_batch(self, batch: list[dict[str, Any]], cancel_event: threading.Event, loop: asyncio.AbstractEventLoop) -> None:
        pod_server_dir = self.project_root / "src" / "modules" / "pinterest-pod" / "server"
        if pod_server_dir.is_dir() and str(pod_server_dir) not in sys.path:
            sys.path.insert(0, str(pod_server_dir))
        import pinterest_pod_bridge as pod_bridge

        first = batch[0]
        settings = dict(first.get("settings") or {})
        job_id = str(first.get("jobId") or "")
        task_id = str(first.get("taskId") or "")
        lease_id = str(first.get("leaseId") or "")
        cancel_event = self.task_cancel_events.get(task_id, cancel_event)

        def enqueue_cancelled() -> None:
            asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                "type": "cancelled",
                "taskId": task_id,
                "leaseId": lease_id,
            }), loop)

        def enqueue_progress(msg: str, percent: int = 50) -> None:
            if cancel_event.is_set():
                return
            self._update_task_activity(task_id, msg, percent)
            progress_payload = {
                "phase": "pinterest",
                "message": msg,
                "percent": percent,
            }
            asyncio.run_coroutine_threadsafe(self.outbound_queue.put({
                "type": "progress",
                "taskId": task_id,
                "leaseId": lease_id,
                "progress": progress_payload,
            }), loop)
            loop.call_soon_threadsafe(self._dashboard_progress, batch, progress_payload)

        def enqueue_completed(payload: dict[str, Any]) -> None:
            if cancel_event.is_set():
                enqueue_cancelled()
                return
            core_result = {
                "status": "completed",
                "products": [],
                "errors": [],
                "warnings": [],
                "durationMs": 0,
                **payload,
            }
            envelope = {
                "version": "distributed-pinterest-1",
                "agentVersion": AGENT_VERSION,
                "taskId": task_id,
                "jobId": job_id,
                "leaseId": lease_id,
                "clientId": self.client_id,
                "source": first.get("source", ""),
                "asin": first.get("asin", ""),
                "completedAt": utc_iso(),
                "resultChecksum": payload_checksum(core_result),
                **core_result,
            }
            checksum = payload_checksum(envelope)
            self.store.spool_result(
                task_id=task_id,
                lease_id=lease_id,
                checksum=checksum,
                payload=envelope,
            )
            asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                "type": "completed",
                "taskId": task_id,
            }), loop)

        def enqueue_failed(error_msg: str) -> None:
            asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                "type": "failed",
                "taskId": task_id,
                "leaseId": lease_id,
                "error": {"message": error_msg, "retryable": False},
            }), loop)

        if cancel_event.is_set():
            enqueue_cancelled()
            return

        enqueue_progress("Khởi tạo Pinterest POD pipeline cục bộ...", 10)
        req_body = dict(settings)
        if "source_run_id" not in req_body:
            resolved_source = req_body.get("jobId") or req_body.get("job_id") or first.get("source")
            if resolved_source:
                req_body["source_run_id"] = str(resolved_source)
        if "workflow_stage" not in req_body:
            req_body["workflow_stage"] = req_body.get("stage") or req_body.get("action") or "crawl_and_review"

        def on_pod_progress(msg: str) -> None:
            enqueue_progress(msg, 50)

        try:
            pod_bridge._run_local_pipeline_worker(
                job_id, req_body, self.config.server_url, cancel_event, progress_callback=on_pod_progress
            )
        except Exception as exc:
            stage_check = str(settings.get("stage") or settings.get("action") or "crawl").lower()
            if stage_check == "production":
                job_data = pod_bridge.ACTIVE_JOBS.get(job_id) or pod_bridge.load_job_manifest(job_id) or {}
                run_id = job_data.get("run_id") or job_data.get("runId") or req_body.get("source_run_id") or job_id
                recovered = pod_bridge.load_standalone_run(str(run_id), self.config.server_url) if run_id else None
                if recovered and (recovered.get("deliverables") or {}).get("lifestyle_mockups"):
                    pod_bridge.ACTIVE_JOBS[job_id] = recovered
                elif cancel_event.is_set():
                    enqueue_cancelled()
                    return
                else:
                    enqueue_failed(f"Pinterest POD execution error: {exc}")
                    return
            elif cancel_event.is_set():
                enqueue_cancelled()
                return
            else:
                enqueue_failed(f"Pinterest POD execution error: {exc}")
                return

        if cancel_event.is_set():
            stage_check = str(settings.get("stage") or settings.get("action") or "crawl").lower()
            if stage_check == "production":
                job_data = pod_bridge.ACTIVE_JOBS.get(job_id) or pod_bridge.load_job_manifest(job_id) or {}
                run_id = job_data.get("run_id") or job_data.get("runId") or req_body.get("source_run_id") or job_id
                recovered = pod_bridge.load_standalone_run(str(run_id), self.config.server_url) if run_id else None
                if recovered and (recovered.get("deliverables") or {}).get("lifestyle_mockups"):
                    pod_bridge.ACTIVE_JOBS[job_id] = recovered
                else:
                    enqueue_cancelled()
                    return
            else:
                enqueue_cancelled()
                return

        job_data = pod_bridge.ACTIVE_JOBS.get(job_id) or pod_bridge.load_job_manifest(job_id) or {}
        if str(job_data.get("status") or "").lower() == "failed":
            err_msg = job_data.get("error") or job_data.get("message") or "Pinterest POD local pipeline execution failed."
            enqueue_failed(str(err_msg))
            return

        stage = str(settings.get("stage") or settings.get("action") or "crawl").lower()

        if stage in {"crawl", "crawl_and_review"}:
            raw_cands = job_data.get("candidates") or []
            candidates = []
            for c in raw_cands:
                item = c.to_dict() if hasattr(c, "to_dict") else dict(c)
                candidates.append(item)
            rejected = job_data.get("rejected_candidates") or []
            logs = job_data.get("logs") or []
            enqueue_completed({
                "candidates": candidates,
                "rejected_candidates": rejected,
                "total_candidates": len(candidates),
                "logs": logs,
            })
        else:
            deliverables = job_data.get("deliverables") or {}
            metrics = job_data.get("summaryMetrics") or job_data.get("summary_metrics") or {}
            logs = job_data.get("logs") or []

            has_mockups = bool(
                deliverables.get("lifestyle_mockups")
                or deliverables.get("print_cmyk_images")
                or deliverables.get("final_png_images")
            )
            if str(job_data.get("status") or "").lower() != "completed" and not has_mockups:
                err_msg = job_data.get("error") or "Không tạo được ảnh thành phẩm cho tác vụ này (deliverables trống)."
                enqueue_failed(str(err_msg))
                return

            run_id = job_data.get("run_id") or job_data.get("runId") or req_body.get("source_run_id") or job_id
            run_dir = pod_bridge.resolve_run_dir(run_id)
            if run_dir and run_dir.is_dir():
                for subfolder in (
                    "lifestyle_mockups",
                    "product_cutouts_white",
                    "rendered_products",
                    "product_cutouts",
                    "final_png_images",
                    "final_print",
                ):
                    sub_dir = run_dir / subfolder
                    if sub_dir.is_dir():
                        for img_file in sub_dir.glob("*.*"):
                            if img_file.is_file() and img_file.stat().st_size <= 10 * 1024 * 1024:
                                file_bytes = img_file.read_bytes()
                                if run_id:
                                    try:
                                        self._upload_asset(str(run_id), img_file.name, file_bytes, first)
                                    except Exception:
                                        if self.config.auth_mode == "key":
                                            enqueue_failed("Authenticated asset upload failed; local files retained.")
                                            return
                                        pass
                                if job_id and str(job_id) != str(run_id):
                                    try:
                                        self._upload_asset(str(job_id), img_file.name, file_bytes, first)
                                    except Exception:
                                        if self.config.auth_mode == "key":
                                            enqueue_failed("Authenticated asset upload failed; local files retained.")
                                            return
                                        pass

            enqueue_completed({
                "deliverables": deliverables,
                "summaryMetrics": metrics,
                "summary_metrics": metrics,
                "logs": logs,
            })

    async def _completion_loop(self) -> None:
        while True:
            completion = await self.completion_queue.get()
            task_id = str(completion["taskId"])
            assignment = self.active.pop(task_id, None)
            if assignment is not None:
                self._dashboard_update("finish", assignment, str(completion["type"]), completion.get("error"))
            if completion["type"] == "failed" and assignment is not None:
                await self.outbound_queue.put({
                    "type": "task_failed", "taskId": task_id,
                    "leaseId": completion["leaseId"], "error": completion["error"],
                })
                self.store.complete_lease(task_id)
            elif completion["type"] == "cancelled":
                self.store.discard_task(task_id)
                await self.outbound_queue.put({
                    "type": "cancel_ack",
                    "taskId": task_id,
                    "leaseId": completion["leaseId"],
                })
            await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
            self._publish_status()

    async def _upload_loop(self) -> None:
        while True:
            upload_failed = False
            retry_delay = 1
            pending_products = self.store.pending_products()
            for product in pending_products:
                task_id = str(product["taskId"])
                if not self.store.is_upload_pending(product["resultId"]):
                    continue
                try:
                    response = await asyncio.to_thread(self._upload_product, product)
                    self._validate_upload_receipt(product, response)
                    self.store.acknowledge_product(product["resultId"])
                except Exception as error:
                    self._quarantine_rejected_upload(product, error)
                    self._dashboard_update("delivery", task_id, str(product["leaseId"]), "retry")
                    self.store.product_failed(product["resultId"], redact(error))
                    upload_failed = True
                    retry_delay = max(retry_delay, min(30, 2 ** min(int(product.get("attempts", 0)), 5)))
            pending = self.store.pending_results()
            if not pending:
                self._uploads_checked.set()
                self._publish_status()
                await asyncio.sleep(retry_delay if upload_failed else 1)
                continue
            for result in pending:
                if not self.store.is_upload_pending(result["resultId"]):
                    continue
                if self.store.has_pending_products(result["taskId"], result["leaseId"]):
                    continue
                try:
                    self._dashboard_update("delivery", str(result["taskId"]), str(result["leaseId"]), "uploading")
                    response = await asyncio.to_thread(self._upload_result, result)
                    self._validate_upload_receipt(result, response)
                    self._dashboard_update("delivery", str(result["taskId"]), str(result["leaseId"]), "sent")
                    self.store.acknowledge_result(result["resultId"])
                    if self.active.get(result["taskId"], {}).get("leaseId") == result["leaseId"]:
                        self.active.pop(result["taskId"], None)
                    await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
                except Exception as error:
                    self._quarantine_rejected_upload(result, error)
                    self._dashboard_update("delivery", str(result["taskId"]), str(result["leaseId"]), "retry")
                    self.store.result_failed(result["resultId"], redact(error))
                    upload_failed = True
                    retry_delay = max(retry_delay, min(30, 2 ** min(int(result.get("attempts", 0)), 5)))
            self._publish_status()
            self._uploads_checked.set()
            await asyncio.sleep(retry_delay if upload_failed else 1)

    def _quarantine_rejected_upload(self, upload: dict[str, Any], error: Exception) -> None:
        if isinstance(error, urllib.error.HTTPError) and error.code in {404, 409}:
            # These are not successful receipts. Keep data for an operator;
            # never repeatedly publish it or infer deletion permission.
            self.store.quarantine_attempt(upload["taskId"], upload["leaseId"], f"upload_http_{error.code}")

    def _validate_upload_receipt(self, upload: dict[str, Any], response: dict[str, Any]) -> None:
        if response.get("status") in {"cancelled", "stale", "conflict"}:
            self.store.quarantine_attempt(upload["taskId"], upload["leaseId"], f"upload_{response['status']}")
        # Local resultId selects the exact immutable row. Task 05's server
        # adapter identifies that upload by attempt and canonical product key.
        is_product = "productKey" in upload
        source_key = product_source_key(upload["payload"]["product"]) if is_product else ""
        expected = payload_checksum(["product" if is_product else "final", upload["taskId"],
                                     self.client_id, upload["leaseId"], source_key])
        if (response.get("status") not in {"accepted", "duplicate"}
                or response.get("receiptId") != expected
                or response.get("checksum") != payload_checksum(upload["payload"])):
            raise ValueError("Upload response lacks a matching durable receipt")

    def _upload_product(self, product: dict[str, Any]) -> dict[str, Any]:
        body = gzip.compress(json.dumps(product["payload"], ensure_ascii=False).encode("utf-8"))
        product_key = urllib.parse.quote(str(product["productKey"]), safe="")
        request = urllib.request.Request(
            f"{self.config.server_url}/api/v1/worker/tasks/{product['taskId']}/products/{product_key}",
            data=body,
            method="PUT",
            headers={
                "Content-Type": "application/json",
                "Content-Encoding": "gzip",
                "X-Client-Id": self.client_id,
                "X-Lease-Id": product["leaseId"],
                "X-Result-Checksum": product["checksum"],
            },
        )
        with self._open_agent_request(request) as response:
            return json.loads(response.read().decode("utf-8"))

    def _upload_result(self, result: dict[str, Any]) -> dict[str, Any]:
        raw = json.dumps(result["payload"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.config.server_url}/api/v1/worker/tasks/{result['taskId']}/result",
            data=gzip.compress(raw),
            method="PUT",
            headers={
                "Content-Type": "application/json", "Content-Encoding": "gzip",
                "X-Client-Id": self.client_id, "X-Lease-Id": result["leaseId"],
                "X-Result-Checksum": result["checksum"],
            },
        )
        with self._open_agent_request(request) as response:
            return json.loads(response.read())
