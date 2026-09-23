"""Long-running distributed crawler agent with offline result spooling."""

from __future__ import annotations

import asyncio
import gzip
import json
import random
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
from . import AGENT_VERSION
from .client_config import AgentConfig
from .client_store import ClientStore
from .protocol import HEARTBEAT_INTERVAL_SECONDS, hello_message, payload_checksum, settings_fingerprint, utc_iso


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
        self.config = config
        self.on_status = on_status or (lambda _status: None)
        self.crawler_factory = crawler_factory
        self.store = ClientStore(config.data_directory / "agent.sqlite3")
        self.client_id = self.store.client_id()
        self.assignment_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.outbound_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.completion_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.active: dict[str, dict[str, Any]] = {}
        self.cancel_events: dict[str, threading.Event] = {}
        self.stop_event = asyncio.Event()
        self.connection_status = "offline"
        self._paused = False
        self._captcha_waiting = False

    def status_snapshot(self) -> dict[str, Any]:
        return {
            "clientId": self.client_id,
            "displayName": self.config.display_name,
            "connection": self.connection_status,
            "activeTasks": len(self.active),
            "availableSlots": self._available_slots(),
            "waitingCaptcha": self._captcha_waiting,
            "pendingUploads": len(self.store.pending_results()) + len(self.store.pending_products()),
        }

    def _publish_status(self) -> None:
        self.on_status(self.status_snapshot())

    async def run(self) -> None:
        for assignment in self.store.recover_assignments():
            task_id = str(assignment["taskId"])
            self.active[task_id] = assignment
            await self.assignment_queue.put(assignment)
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
        for event in self.cancel_events.values():
            event.set()

    def set_paused(self, is_paused: bool) -> None:
        self._paused = is_paused
        if is_paused:
            self.connection_status = "paused"
        elif self.connection_status == "paused":
            self.connection_status = "online"
        self._publish_status()

    async def _connection_supervisor(self) -> None:
        delay = 1.0
        while not self.stop_event.is_set():
            try:
                async with websockets.connect(
                    self.config.websocket_url,
                    open_timeout=15,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=4 * 1024 * 1024,
                ) as websocket:
                    self.connection_status = "paused" if self._paused else "online"
                    self._publish_status()
                    await websocket.send(json.dumps(hello_message(
                        client_id=self.client_id,
                        display_name=self.config.display_name,
                        available_slots=self._available_slots(),
                        max_concurrent_inputs=self.config.max_concurrent_inputs,
                        limits=self.config.limits,
                    )))
                    acknowledgement = json.loads(await asyncio.wait_for(websocket.recv(), timeout=15))
                    if acknowledgement.get("type") != "hello_ack":
                        raise RuntimeError("Coordinator did not acknowledge the worker protocol.")
                    delay = 1.0
                    connection_tasks = [
                        asyncio.create_task(self._sender(websocket)),
                        asyncio.create_task(self._receiver(websocket)),
                        asyncio.create_task(self._heartbeat_loop()),
                        asyncio.create_task(self._upload_loop()),
                    ]
                    stop_waiter = asyncio.create_task(self.stop_event.wait())
                    tasks = [*connection_tasks, stop_waiter]
                    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
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
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.connection_status = "offline"
                self._publish_status()
                self.on_status({**self.status_snapshot(), "lastError": str(error)})
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=delay + random.random())
                except TimeoutError:
                    pass
                delay = min(30.0, delay * 2)

    async def _sender(self, websocket) -> None:
        while True:
            payload = await self.outbound_queue.get()
            await websocket.send(json.dumps(payload, ensure_ascii=False))

    async def _receiver(self, websocket) -> None:
        async for raw in websocket:
            payload = json.loads(raw)
            message_type = payload.get("type")
            if message_type == "assignment":
                task_id = str(payload["taskId"])
                if task_id not in self.active:
                    self.store.save_assignment(payload)
                    self.active[task_id] = payload
                    await self.assignment_queue.put(payload)
                    self._publish_status()
            elif message_type == "cancel":
                job_id = str(payload.get("jobId") or "")
                self.store.cancel_job(job_id)
                event = self.cancel_events.get(job_id)
                if event:
                    event.set()
            elif message_type == "pause":
                self.set_paused(bool(payload.get("paused", True)))
            elif message_type == "clear_cache":
                response = await self.clear_local_cache(str(payload.get("requestId") or ""))
                await self.outbound_queue.put(response)

    async def clear_local_cache(self, request_id: str) -> dict[str, Any]:
        try:
            result = await asyncio.to_thread(RawFamilyCache(self.project_root / ".runtime" / "cache").clear)
            return {"type": "cache_cleared", "requestId": request_id, **result, "error": None}
        except OSError as error:
            return {
                "type": "cache_cleared", "requestId": request_id,
                "removedFiles": 0, "removedBytes": 0, "error": str(error),
            }

    async def _heartbeat_loop(self) -> None:
        while True:
            running = [
                {"taskId": task_id, "leaseId": assignment["leaseId"]}
                for task_id, assignment in self.active.items()
            ]
            await self.outbound_queue.put({
                "type": "heartbeat",
                "status": "paused" if self._paused else (
                    "waiting_captcha" if self._captcha_waiting else ("busy" if running else "online")
                ),
                "availableSlots": self._available_slots(),
                "running": running,
            })
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)

    def _available_slots(self) -> int:
        if self._paused:
            return 0
        return max(0, self.config.max_concurrent_inputs - len(self.active))

    async def _execution_loop(self) -> None:
        backlog: deque[dict[str, Any]] = deque()
        loop = asyncio.get_running_loop()
        while True:
            first = backlog.popleft() if backlog else await self.assignment_queue.get()
            batch = [first]
            batch_key = (first["jobId"], first["settingsFingerprint"])
            deadline = loop.time() + 0.4
            while len(batch) < self.config.max_concurrent_inputs:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    candidate = await asyncio.wait_for(self.assignment_queue.get(), timeout=remaining)
                except TimeoutError:
                    break
                candidate_key = (candidate["jobId"], candidate["settingsFingerprint"])
                if candidate_key == batch_key:
                    batch.append(candidate)
                else:
                    backlog.append(candidate)
            runnable: list[dict[str, Any]] = []
            for assignment in batch:
                task_id = str(assignment["taskId"])
                if self.store.is_task_cancelled(task_id):
                    self.active.pop(task_id, None)
                    self.store.complete_lease(task_id)
                else:
                    runnable.append(assignment)
            batch = runnable
            if not batch:
                await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
                self._publish_status()
                continue
            task_ids = [str(assignment["taskId"]) for assignment in batch]
            self.store.mark_running(task_ids)
            cancel_event = threading.Event()
            job_id = str(first["jobId"])
            self.cancel_events[job_id] = cancel_event
            try:
                await asyncio.to_thread(self._run_batch, batch, cancel_event, loop)
            except Exception as error:
                for assignment in batch:
                    await self.completion_queue.put({
                        "type": "failed",
                        "taskId": assignment["taskId"],
                        "leaseId": assignment["leaseId"],
                        "error": {
                            "message": f"Crawler batch could not start or complete: {error}",
                            "retryable": True,
                        },
                    })
            finally:
                self.cancel_events.pop(job_id, None)

    def _run_batch(self, batch: list[dict[str, Any]], cancel_event: threading.Event, loop: asyncio.AbstractEventLoop) -> None:
        first = batch[0]
        effective_settings = self.config.limits.apply(dict(first.get("settings") or {}))
        settings = CrawlSettings.from_api(effective_settings)
        actual_settings = settings.api_dict()
        assignments_by_source = {str(assignment["url"]): assignment for assignment in batch}

        def progress(progress_payload: dict[str, Any]) -> None:
            phase = str(progress_payload.get("phase") or "product")
            self._captcha_waiting = phase == "captcha"
            for assignment in progress_targets(batch, progress_payload):
                asyncio.run_coroutine_threadsafe(self.outbound_queue.put({
                    "type": "progress", "taskId": assignment["taskId"], "leaseId": assignment["leaseId"],
                    "progress": progress_for_assignment(progress_payload, assignment),
                }), loop)
            loop.call_soon_threadsafe(self._publish_status)

        def completed(input_result: dict[str, Any]) -> None:
            assignment = assignments_by_source.get(str(input_result.get("source") or ""))
            if assignment is None:
                assignment = next((item for item in batch if item.get("asin") == input_result.get("asin")), None)
            if assignment is None:
                return
            core_result = {
                "status": input_result["status"], "products": input_result["products"],
                "errors": input_result["errors"], "warnings": input_result["warnings"],
                "durationMs": input_result["durationMs"],
            }
            envelope = {
                "version": "distributed-1", "agentVersion": AGENT_VERSION,
                "taskId": assignment["taskId"], "jobId": assignment["jobId"],
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
                asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                    "type": "completed", "taskId": assignment["taskId"],
                }), loop)
            elif input_result["status"] == "failed":
                error = input_result["errors"][0] if input_result["errors"] else {"message": "Crawler failed.", "retryable": True}
                asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                    "type": "failed", "taskId": assignment["taskId"], "leaseId": assignment["leaseId"], "error": error,
                }), loop)
            elif input_result["status"] == "cancelled":
                asyncio.run_coroutine_threadsafe(self.completion_queue.put({
                    "type": "cancelled", "taskId": assignment["taskId"], "leaseId": assignment["leaseId"],
                }), loop)

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

        crawler = self.crawler_factory(
            root=self.project_root,
            settings=settings,
            progress=progress,
            cancel_event=cancel_event,
            proxy_config_path=self.config.proxy_config_path,
        )
        try:
            crawler.run(
                job_id=str(first["jobId"]),
                sources=[str(assignment["url"]) for assignment in batch],
                on_input_complete=completed,
                on_product_complete=product_completed,
                write_export=False,
            )
        finally:
            crawler.browser_pool.close()
            self._captcha_waiting = False
            loop.call_soon_threadsafe(self._publish_status)

    async def _completion_loop(self) -> None:
        while True:
            completion = await self.completion_queue.get()
            task_id = str(completion["taskId"])
            assignment = self.active.pop(task_id, None)
            if completion["type"] == "failed" and assignment is not None:
                await self.outbound_queue.put({
                    "type": "task_failed", "taskId": task_id,
                    "leaseId": completion["leaseId"], "error": completion["error"],
                })
                self.store.complete_lease(task_id)
            elif completion["type"] == "cancelled":
                self.store.complete_lease(task_id)
            await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
            self._publish_status()

    async def _upload_loop(self) -> None:
        while True:
            pending_products = self.store.pending_products()
            for product in pending_products:
                try:
                    response = await asyncio.to_thread(self._upload_product, product)
                    if response.get("status") in {"accepted", "duplicate"}:
                        self.store.acknowledge_product(product["taskId"], product["productKey"])
                except Exception as error:
                    self.store.product_failed(product["taskId"], product["productKey"], str(error))
                    raise
            pending = self.store.pending_results()
            if not pending:
                await asyncio.sleep(1)
                continue
            for result in pending:
                if self.store.has_pending_products(result["taskId"]):
                    continue
                try:
                    response = await asyncio.to_thread(self._upload_result, result)
                    if response.get("status") in {"accepted", "duplicate"}:
                        self.store.acknowledge_result(result["taskId"])
                        self.active.pop(result["taskId"], None)
                        await self.outbound_queue.put({"type": "ready", "availableSlots": self._available_slots()})
                except Exception as error:
                    self.store.result_failed(result["taskId"], str(error))
                    raise
            self._publish_status()

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
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 409:
                return {"status": "duplicate"}
            raise

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
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code in {404, 409}:
                self.store.acknowledge_result(result["taskId"])
                return {"status": "cancelled"}
            raise
