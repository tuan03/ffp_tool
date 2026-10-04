"""Supervise crawl batches in disposable processes so native hangs cannot retain slots."""

from __future__ import annotations

import multiprocessing
import os
import queue
import signal
import subprocess
import threading
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .cache import RawFamilyCache
from .crawler_core import SCHEMA_VERSION, AmazonCrawler, CrawlSettings, normalize_amazon_input
from .timeouts import CrawlTimeout, observe_deadlines
from .observability import emit_event, redact, trace_scope


def _crawl_process(connection, factory, root: str, settings: dict[str, Any], proxy_config_path: str | None,
                   job_id: str, sources: list[str], write_export: bool, stream_results: bool = False,
                   trace_contexts: dict[str, dict[str, Any]] | None = None) -> None:
    if os.name != "nt":
        os.setsid()
    crawler = None
    send_lock = threading.Lock()
    def send(kind: str, payload: dict[str, Any]) -> None:
        with send_lock:
            connection.send((kind, payload))
    try:
        crawler = factory(root=Path(root), settings=CrawlSettings(**settings),
                          progress=lambda progress: send("progress", progress),
                          cancel_event=threading.Event(),
                          proxy_config_path=Path(proxy_config_path) if proxy_config_path else None)
        with observe_deadlines(lambda deadline: send("deadline", deadline)):
            telemetry_arguments = {"trace_contexts": trace_contexts, "on_telemetry": lambda event: send("telemetry", event)} if isinstance(crawler, AmazonCrawler) else {}
            output = crawler.run(job_id=job_id, sources=sources, write_export=write_export,
                                 on_input_complete=lambda result: send("input", result),
                                 on_product_complete=lambda product: send("product", product), **telemetry_arguments)
        crawler.browser_pool.close()
        send("result", {"status": output["status"]} if stream_results else output)
    except Exception as error:
        send("error", error.as_error("") if isinstance(error, CrawlTimeout) else {
            "code": "CRAWLER_WORKER_FAILED", "message": redact(error), "retryable": True,
        })
    finally:
        connection.close()
        # Keep the root PID alive until the supervisor terminates its tree, including a driver
        # that failed to close. Otherwise an exited root could leave browser descendants behind.
        parent = multiprocessing.parent_process()
        while parent is not None and parent.is_alive():
            time.sleep(0.1)


class ProcessCrawler:
    def __init__(self, *, root: Path, settings: CrawlSettings, progress=None, cancel_event=None,
                 proxy_config_path: Path | None = None, crawler_factory=AmazonCrawler,
                 job_deadline_at: str | None = None, asin_deadline_at: str | None = None,
                 on_worker_failure=None) -> None:
        self.root = root
        self.settings = settings
        self.progress = progress or (lambda _: None)
        self.cancel_event = cancel_event or threading.Event()
        self.proxy_config_path = proxy_config_path
        self.factory = crawler_factory
        self.job_deadline_at = job_deadline_at
        self.asin_deadline_at = asin_deadline_at
        self.on_worker_failure = on_worker_failure
        self.browser_pool = self
        self._process = None
        self._process_lock = threading.Lock()
        self._closed = threading.Event()
        self.browser_pool_state: dict[str, Any] = {}

    def _report_worker_failure(self, reason: str) -> None:
        if self.on_worker_failure is None:
            return
        try:
            self.on_worker_failure({"reason": reason[:80]})
        except Exception:
            # Health reporting must never turn a crawl failure into an agent failure.
            pass

    def close(self) -> None:
        """Terminate only this worker and its browser descendants, before reusing capacity."""
        self._closed.set()
        with self._process_lock:
            process = self._process
            if process is None or not process.is_alive():
                return
            if os.name == "nt":
                try:
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                   capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            else:
                try:
                    if os.getpgid(process.pid) == process.pid:
                        os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.is_alive():
                process.kill()
            process.join(timeout=2)
            if process.is_alive():
                raise RuntimeError("Crawler worker could not be terminated; capacity remains unavailable.")

    @staticmethod
    def _absolute_remaining(timestamp: str | None, default: float) -> float:
        if timestamp is None:
            return default
        deadline = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        return min(default, max(0, (deadline - datetime.now(timezone.utc)).total_seconds()))

    def run(self, *, job_id: str, sources: list[str], on_input_complete=None,
            on_product_complete=None, write_export: bool = True, trace_contexts=None, on_telemetry=None) -> dict[str, Any]:
        context = multiprocessing.get_context("spawn")
        reader, writer = context.Pipe(duplex=False)
        pending: dict[str, str] = {}
        rejected_inputs = 0
        for source in sources:
            try:
                pending.setdefault(normalize_amazon_input(source).asin, source)
            except ValueError:
                rejected_inputs += 1  # The crawler reports invalid inputs without contacting Amazon.
        accepted_inputs = len(pending)
        started_at = datetime.now(timezone.utc).isoformat()
        started = time.monotonic()
        job_expires = started + self._absolute_remaining(self.job_deadline_at, self.settings.job_timeout_seconds)
        asin_remaining = self._absolute_remaining(self.asin_deadline_at, self.settings.asin_timeout_seconds)
        absolute_asin_expires = started + asin_remaining if self.asin_deadline_at is not None else None
        input_started: dict[str, float] = {}
        child_started: dict[tuple[str, str], float] = {}
        stage_deadlines: dict[str, dict[str, Any]] = {}
        traces: dict[str, dict[str, Any]] = {}
        completions: list[dict[str, Any]] = []
        product_results: list[dict[str, Any]] = []
        process = context.Process(target=_crawl_process, args=(writer, self.factory, str(self.root), asdict(self.settings),
            str(self.proxy_config_path) if self.proxy_config_path else None, job_id, sources, write_export, on_input_complete is not None, trace_contexts), daemon=False)
        self._process = process
        if self._closed.is_set() or self.cancel_event.is_set():
            reader.close()
            writer.close()
            raise InterruptedError("Crawler cancelled before worker startup.")
        try:
            process.start()
        except Exception:
            self._report_worker_failure("worker_start_failed")
            reader.close()
            writer.close()
            raise
        writer.close()
        messages: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue(maxsize=16)
        reader_stop = threading.Event()
        def receive() -> None:
            try:
                while not reader_stop.is_set():
                    message = reader.recv()
                    while not reader_stop.is_set():
                        try:
                            messages.put(message, timeout=0.05)
                            break
                        except queue.Full:
                            pass
            except (EOFError, OSError):
                pass
        receiver = threading.Thread(target=receive, name="amazon-worker-results", daemon=True)
        receiver.start()
        worker_error = None
        output = None
        finished_at = None
        try:
            while True:
                if self.cancel_event.is_set() or self._closed.is_set():
                    raise InterruptedError("Crawler worker cancelled.")
                now = time.monotonic()
                stage = "job" if now >= job_expires else None
                # Give cooperative cancellation one second to finish; native hangs are then terminated.
                expired_stage = min((deadline for deadline in stage_deadlines.values() if now >= deadline["expires"] + 1),
                                    key=lambda deadline: deadline["expires"], default=None)
                expired_asin = next((asin for asin, began in input_started.items()
                                     if asin in pending and now - began >= asin_remaining), None)
                if absolute_asin_expires is not None and now >= absolute_asin_expires and pending:
                    expired_asin = expired_asin or next(iter(pending))
                if expired_asin:
                    stage = stage or "asin"
                expired_child = next((key for key, began in child_started.items()
                                      if key[0] in pending and now - began >= self.settings.child_timeout_seconds), None)
                if expired_child:
                    stage = stage or "child"
                    expired_asin = expired_asin or expired_child[0]
                if expired_stage and stage is None:
                    stage = expired_stage["stage"]
                    expired_asin = expired_stage.get("sourceAsin")
                if not input_started and pending and now - started >= 60:
                    stage = stage or "worker_startup"
                if not pending and finished_at is None:
                    finished_at = now
                if finished_at is not None and now - finished_at >= 45:
                    stage = stage or "worker_cleanup"
                if stage:
                    trace = traces.get(expired_asin, {})
                    timeout_started = child_started[expired_child] if stage == "child" and expired_child else input_started.get(expired_asin, started)
                    if expired_stage and stage == expired_stage["stage"]:
                        timeout_started = expired_stage["started"]
                        trace = {"networkRoute": expired_stage.get("route"), "browserProfile": expired_stage.get("profile")}
                    worker_error = CrawlTimeout(stage, started=timeout_started,
                        route=trace.get("networkRoute"), profile=trace.get("browserProfile"),
                        attempt=expired_stage.get("attempt", 1) if expired_stage else 1).as_error("")
                    if expired_child:
                        worker_error["asin"] = expired_child[1]
                    elif expired_stage and expired_stage.get("childAsin"):
                        worker_error["asin"] = expired_stage["childAsin"]
                    self._report_worker_failure("worker_deadline_" + str(stage))
                    self.close()
                    break
                try:
                    kind, payload = messages.get(timeout=0.05)
                except queue.Empty:
                    if not process.is_alive():
                        worker_error = {"code": "CRAWLER_WORKER_EXITED", "message": "Crawler worker exited without completing its inputs.", "retryable": True}
                        self._report_worker_failure("worker_exited")
                        break
                    continue
                if kind == "telemetry":
                    if on_telemetry:
                        on_telemetry(payload)
                elif kind == "deadline":
                    if payload["state"] == "started":
                        stage_deadlines[payload["id"]] = payload
                    else:
                        stage_deadlines.pop(payload["id"], None)
                elif kind == "progress":
                    self.browser_pool_state = dict(payload.get("browserPool") or {})
                    for item in payload.get("items", []):
                        asin = str(item.get("asin") or "")
                        if asin in pending and item.get("status") == "running":
                            input_started.setdefault(asin, time.monotonic())
                            traces[asin] = item
                            active = item.get("activeVariants")
                            if isinstance(active, list):
                                active_asins = {str(child.get("asin") or "") for child in active}
                                for child_asin in active_asins:
                                    child_started.setdefault((asin, child_asin), time.monotonic())
                                for key in list(child_started):
                                    if key[0] == asin and key[1] not in active_asins:
                                        child_started.pop(key)
                    source = payload.get("source")
                    if source:
                        try:
                            asin = normalize_amazon_input(source).asin
                            if asin in pending:
                                input_started.setdefault(asin, time.monotonic())
                                traces[asin] = {**traces.get(asin, {}), **payload}
                        except ValueError:
                            pass
                    self.progress(payload)
                elif kind == "product":
                    product_results.append(payload)
                    if on_product_complete:
                        on_product_complete(payload)
                elif kind == "input":
                    pending.pop(str(payload.get("asin") or ""), None)
                    completions.append({key: value for key, value in payload.items() if key != "products"} if on_input_complete else payload)
                    if on_input_complete:
                        on_input_complete(payload)
                        product_results = [result for result in product_results if result.get("asin") != payload.get("asin")]
                elif kind == "result":
                    output = payload
                    break
                elif kind == "error":
                    worker_error = payload
                    break
            if output is not None:
                return output
            # Finish termination before callbacks remove assignments from the agent's active slots.
            self.close()
            for asin, source in pending.items():
                error = {**(worker_error or {}), "source": source}
                if expired_asin and asin != expired_asin and error.get("stage") != "job":
                    error.update({"code": "WORKER_INTERRUPTED", "reason": "worker_interrupted", "stage": "worker_shutdown",
                                  "asin": asin, "elapsedMs": round((time.monotonic() - input_started.get(asin, started)) * 1000),
                                  "message": "Crawl worker restarted after another input exceeded its deadline."})
                cache = RawFamilyCache(self.root / ".runtime" / "cache")
                cache_key = f"{asin}:{self.settings.amazon_zip}:us-v1"
                checkpoint = cache.load_checkpoint(cache_key) or {}
                partial = cache.load_partial(cache_key) or {}
                completed_asins = sorted({child for child, steps in checkpoint.get("children", {}).items() if steps.get("complete")} | set(partial.get("completedAsins", [])))
                discovered = set((checkpoint.get("matrix") or {}).get("asinOptions", {})) | set(partial.get("failedAsins", [])) | set(completed_asins)
                discovered = discovered or {asin}
                failed_asins = sorted(discovered - set(completed_asins))
                non_retryable = set(partial.get("nonRetryableAsins", []))
                for child in failed_asins:
                    failure = cache.load_failure(f"{child}:{self.settings.amazon_zip}:us-v1")
                    if failure and failure.get("status") in {"not_found", "parser_error"}:
                        non_retryable.add(child)
                retryable_asins = sorted(set(failed_asins) - non_retryable) if error.get("retryable", True) else []
                asin_status = {"completedAsins": completed_asins, "failedAsins": failed_asins,
                    "retryableAsins": retryable_asins,
                    "nonRetryableAsins": sorted(set(failed_asins) - set(retryable_asins))}
                if completed_asins:
                    error["status"] = "partial"
                if failed_asins and not retryable_asins and (checkpoint.get("matrix") or {}).get("complete") is True:
                    error.update({"retryable": False, "isRetryable": False, "retryAfter": None})
                error.update(asin_status)
                if on_telemetry:
                    supplied = (trace_contexts or {}).get(asin, {})
                    with trace_scope(on_event=on_telemetry, jobId=job_id, asin=asin, rootAsin=asin,
                                     cacheKey=cache_key, stage=error.get("stage", "worker"), **supplied):
                        emit_event("family_completed", result="partial" if completed_asins else "timeout" if error.get("stage") else "error",
                                   reason=error.get("reason"), durationMs=round((time.monotonic() - input_started.get(asin, started)) * 1000))
                completion = {"source": source, "asin": asin, "status": "failed",
                    "products": [result["product"] for result in product_results if result.get("asin") == asin],
                    "errors": [error], "warnings": [], "completedAt": datetime.now(timezone.utc).isoformat(),
                    "durationMs": round((time.monotonic() - input_started.get(asin, started)) * 1000), **asin_status}
                completions.append(completion)
                if on_input_complete:
                    on_input_complete(completion)
            products = list({result["product"]["id"]: result["product"] for result in product_results}.values())
            return {"version": SCHEMA_VERSION, "jobId": job_id, "status": "cancelled" if (worker_error or {}).get("stage") == "job" else "partial",
                    "startedAt": started_at, "completedAt": datetime.now(timezone.utc).isoformat(), "settings": self.settings.api_dict(),
                    "products": products, "warnings": sorted({warning for product in products for warning in product.get("warnings", [])}), "exportFilename": None,
                    "statistics": {"requestedInputs": len(sources), "acceptedInputs": accepted_inputs, "rejectedInputs": rejected_inputs,
                                   "products": len(products), "sourceVariants": sum(len(product.get("sourceVariants", [])) for product in products),
                                   "finalVariants": sum(len(product.get("variants", [])) for product in products),
                                   "durationMs": round((time.monotonic() - started) * 1000)},
                    "errors": [error for completion in completions for error in completion.get("errors", [])],
                    **{key: sorted({asin for completion in completions for asin in completion.get(key, [])})
                       for key in ("completedAsins", "failedAsins", "retryableAsins", "nonRetryableAsins")}}
        except InterruptedError:
            self.close()
            if on_telemetry:
                for asin in pending:
                    supplied = (trace_contexts or {}).get(asin, {})
                    with trace_scope(on_event=on_telemetry, jobId=job_id, asin=asin, rootAsin=asin,
                                     cacheKey=f"{asin}:{self.settings.amazon_zip}:us-v1", stage="worker", **supplied):
                        emit_event("family_completed", result="cancelled",
                                   durationMs=round((time.monotonic() - input_started.get(asin, started)) * 1000))
            raise
        finally:
            self.close()
            self.browser_pool_state = {}
            reader_stop.set()
            reader.close()
            receiver.join(timeout=1)
            process.join(timeout=2)
