from __future__ import annotations

import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from engine.observability import emit_event, observe_attempt, redact, register_redactions, trace_scope, write_log
from engine.crawler_core import AmazonCrawler, CrawlSettings
from engine.tests.test_core import FakeBrowser, StaticFetcher, ParentFamilyCrawler, PRODUCT_HTML, cache_family
from engine.crawler_core import normalize_amazon_input
from engine.distributed.coordinator_models import Base, create_database_engine, create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.client_store import ClientStore
from engine.tests.test_distributed import client_hello
from engine.distributed.protocol import utc_now
from engine.distributed.coordinator_models import CrawlTelemetryEvent, JobEvent
from sqlalchemy import event as sql_event, select


class ObservabilityTests(unittest.TestCase):
    def test_trace_context_is_preserved_and_payloads_are_allowlisted(self) -> None:
        events = []
        with trace_scope(on_event=events.append, jobId="job", taskId="task", agentId="agent", requestId="request", asin="B012345678"):
            with observe_attempt("http_attempt", stage="page", route="direct", profile="direct", attempt=2):
                emit_event("checkpoint", stage="child_complete", html="<html>private</html>", cookie="secret")
        self.assertEqual(len(events), 2)
        self.assertTrue(all(event["requestId"] == "request" for event in events))
        self.assertEqual(events[-1]["attempt"], 2)
        self.assertEqual(events[-1]["result"], "success")
        self.assertNotIn("html", events[0])
        self.assertNotIn("cookie", events[0])

    def test_error_redaction_removes_credentials_headers_and_html_before_truncation(self) -> None:
        secret = "http://user:PRIVATE_PASSWORD@proxy.test Authorization: Bearer PRIVATE_TOKEN\nCookie: session=PRIVATE_COOKIE\n<html>PRIVATE_HTML</html>"
        message = redact(secret)
        for marker in ("PRIVATE_PASSWORD", "PRIVATE_TOKEN", "PRIVATE_COOKIE", "PRIVATE_HTML"):
            self.assertNotIn(marker, message)
        self.assertIn("proxy.test", message)
        self.assertLessEqual(len(redact("X" * 10000)), 512)

    def test_logs_rotate_and_never_serialize_raw_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.jsonl"
            for _ in range(10):
                write_log(path, {"event": "failed", "error": "X" * 300, "html": "PRIVATE_HTML", "token": "PRIVATE_TOKEN"}, max_bytes=800, backups=2)
            logs = list(Path(directory).glob("trace.jsonl*"))
            self.assertLessEqual(len(logs), 3)
            self.assertTrue(all(path.stat().st_size <= 800 for path in logs))
            self.assertTrue(all("PRIVATE_" not in path.read_text() for path in logs))

    def test_configured_proxy_secret_is_redacted_even_without_a_header_label(self) -> None:
        register_redactions(["SYNTHETIC_PROXY_PASSWORD"])
        self.assertNotIn("SYNTHETIC_PROXY_PASSWORD", redact("Authentication failed for SYNTHETIC_PROXY_PASSWORD"))

    def test_cache_hit_emits_no_network_events_and_does_not_recount_historical_captcha(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            events = []
            root = Path(directory)
            fetcher = StaticFetcher(PRODUCT_HTML)
            crawler = AmazonCrawler(root=root, settings=CrawlSettings(), fetcher=fetcher, browser_pool=FakeBrowser(PRODUCT_HTML))
            family = cache_family()
            family["sourceVariants"][0]["customizationComplete"] = True
            family["diagnostics"] = {"attempts": 8, "captchaEncountered": True, "fetchMode": "http", "cacheHit": False}
            crawler.cache.save("B012345678:90001:us-v1", family)
            output = crawler.run(job_id="job", sources=["B012345678"], write_export=False,
                                 trace_contexts={"B012345678": {"taskId": "task", "agentId": "agent", "requestId": "request", "leaseId": "lease", "taskAttempt": 2}},
                                 on_telemetry=events.append)
            self.assertEqual(output["status"], "completed")
            self.assertEqual(fetcher.calls, [])
            self.assertEqual([event["result"] for event in events if event["event"] == "family_cache"], ["hit"])
            self.assertFalse(any(event["event"] in {"http_attempt", "browser_attempt"} for event in events))
            completed = [event for event in events if event["event"] == "family_completed"]
            self.assertEqual(len(completed), 1)
            self.assertEqual(completed[0]["taskAttempt"], 2)
            self.assertEqual(output["products"][0]["diagnostics"]["requestId"], "request")

    def test_supervisor_records_cancelled_family_after_stopping_the_worker(self) -> None:
        from engine.process_crawler import ProcessCrawler
        from engine.tests.test_timeouts import HungCheckpointCrawler
        with tempfile.TemporaryDirectory() as directory:
            cancelled = threading.Event()
            events = []
            crawler = ProcessCrawler(root=Path(directory), settings=CrawlSettings(),
                                     cancel_event=cancelled, progress=lambda _: cancelled.set(),
                                     crawler_factory=HungCheckpointCrawler)
            with self.assertRaises(InterruptedError):
                crawler.run(job_id="job", sources=["B012345678"], write_export=False,
                            trace_contexts={"B012345678": {"requestId": "request", "taskId": "task", "leaseId": "lease"}},
                            on_telemetry=events.append)
            self.assertFalse(crawler._process.is_alive())
            self.assertEqual(events[-1]["event"], "family_completed")
            self.assertEqual(events[-1]["result"], "cancelled")
            self.assertEqual(events[-1]["requestId"], "request")

    def test_checkpoint_reuse_replaces_old_job_and_request_ids_without_refetching(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = CrawlSettings(variant_threads=1)
            normalized = normalize_amazon_input("B012345678")
            first = ParentFamilyCrawler(root=root, settings=settings, browser_pool=FakeBrowser(PRODUCT_HTML))
            with trace_scope(jobId="old-job", requestId="old-request", rootAsin=normalized.asin, asin=normalized.asin):
                with patch.object(first.cache, "save", side_effect=KeyboardInterrupt("crash before family save")):
                    with self.assertRaises(KeyboardInterrupt):
                        first._crawl_family(normalized)
            restarted = ParentFamilyCrawler(root=root, settings=settings, browser_pool=FakeBrowser(PRODUCT_HTML))
            with trace_scope(jobId="new-job", requestId="new-request", rootAsin=normalized.asin, asin=normalized.asin), \
                    patch.object(restarted, "_fetch_parsed", side_effect=AssertionError("completed checkpoint was fetched again")):
                family = restarted._crawl_family(normalized)
            self.assertEqual(family["diagnostics"]["jobId"], "new-job")
            self.assertEqual(family["diagnostics"]["requestId"], "new-request")
            self.assertTrue(all(variant["diagnostics"]["jobId"] == "new-job" for variant in family["sourceVariants"]))


class CoordinatorTelemetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
        for target in ("engine.distributed.coordinator_observability.utc_now", "engine.distributed.coordinator_store.utc_now"):
            clock = patch(target, return_value=self.now)
            clock.start()
            self.addCleanup(clock.stop)
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.engine = create_database_engine(f"sqlite:///{(root / 'coordinator.sqlite3').as_posix()}")
        Base.metadata.create_all(self.engine)
        self.store = CoordinatorStore(create_session_factory(self.engine))
        self.job = self.store.create_job({"urls": ["B012345678", "B012345679"]})
        self.store.register_client(client_hello(slots=1))
        self.lease = self.store.lease_tasks("client-a", 1)[0]

    def tearDown(self) -> None:
        self.engine.dispose()
        self.directory.cleanup()

    def event(self, name: str, event_id: str, **fields) -> dict:
        return {"eventId": event_id, "event": name, "taskId": self.lease["taskId"],
                "leaseId": self.lease["leaseId"], "asin": self.lease["asin"], **fields}

    def test_replayed_events_are_counted_once_and_cannot_spoof_task_context(self) -> None:
        events = [self.event("family_cache", "cache", result="hit"),
                  self.event("http_attempt", "http", result="success", attempt=1, captchaEncountered=False),
                  self.event("browser_attempt", "browser", result="captcha", attempt=2, captchaEncountered=True),
                  self.event("page_fetch", "page", result="playwright"),
                  self.event("family_completed", "family", result="partial", durationMs=1200)]
        events[0].update(jobId="spoof", agentId="spoof", html="PRIVATE_HTML")
        self.store.accept_telemetry("client-a", events)
        self.store.accept_telemetry("client-a", events)
        metrics = self.store.crawler_metrics()
        self.assertEqual(metrics["counts"]["familyCacheHits"], 1)
        self.assertEqual(metrics["counts"]["httpAttempts"], 1)
        self.assertEqual(metrics["counts"]["partialFamilies"], 1)
        self.assertEqual(metrics["rates"]["captcha"], 0.5)
        self.assertEqual(metrics["averageCrawlDurationMs"], 1200)
        self.assertEqual(metrics["queue"]["crawl"], 1)
        trace = self.store.crawl_trace(self.job["id"], self.lease["requestId"], limit=2)
        self.assertEqual(len(trace["events"]), 2)
        self.assertIsNotNone(trace["nextCursor"])
        self.assertTrue(all(event["jobId"] == self.job["id"] and event["agentId"] == "client-a" for event in trace["events"]))
        self.assertNotIn("PRIVATE_HTML", json.dumps(trace))

    def test_wrong_agent_events_are_acknowledged_without_being_persisted(self) -> None:
        self.store.accept_telemetry("wrong-client", [self.event("http_attempt", "wrong", result="success")])
        self.assertEqual(self.store.crawler_metrics()["counts"]["httpAttempts"], 0)

    def test_heartbeat_metrics_are_bounded_and_included_in_client_snapshot(self) -> None:
        self.store.heartbeat(
            "client-a",
            [],
            telemetry={"cache": {"hit": 10, "html": "PRIVATE_HTML"},
                       "resources": {"rssBytes": 1024, "browserContexts": 2, "isComplete": True},
                       "backlog": 3, "dropped": 1},
            capabilities={"pinterestBrowserLoggedIn": True, "privateToken": "ignored"},
        )
        snapshot = self.store.list_clients()[0]
        self.assertEqual(snapshot["observability"]["resources"]["rssBytes"], 1024)
        self.assertNotIn("html", snapshot["observability"]["cache"])
        self.assertTrue(snapshot["capabilities"]["pinterestBrowserLoggedIn"])
        self.assertNotIn("privateToken", snapshot["capabilities"])
        self.assertEqual(self.store.crawler_metrics()["agents"][0]["dropped"], 1)

    def test_telemetry_spool_survives_restart_and_acknowledgement(self) -> None:
        path = Path(self.directory.name) / "agent.sqlite3"
        store = ClientStore(path)
        store.spool_telemetry(self.event("http_attempt", "durable", result="success"))
        reloaded = ClientStore(path)
        self.assertEqual(reloaded.pending_telemetry()[0]["eventId"], "durable")
        reloaded.acknowledge_telemetry(["durable"])
        self.assertEqual(reloaded.pending_telemetry(), [])

    def test_spool_overflow_is_visible_and_keeps_a_bounded_backlog(self) -> None:
        store = ClientStore(Path(self.directory.name) / "bounded-agent.sqlite3")
        for index in range(4):
            store.spool_telemetry(self.event("http_attempt", f"event-{index}", result="success"), maximum=2)
        self.assertEqual(store.telemetry_status(), {"backlog": 2, "dropped": 2})

    def test_metrics_do_not_select_product_payloads_and_partial_clears_after_success(self) -> None:
        self.store.accept_telemetry("client-a", [self.event("family_completed", "partial", result="partial", durationMs=1000)])
        self.store.accept_telemetry("client-a", [self.event("family_completed", "complete", result="completed", durationMs=200)])
        queries = []
        def query(connection, cursor, statement, parameters, context, executemany):
            queries.append(statement.lower())
        sql_event.listen(self.engine, "before_cursor_execute", query)
        try:
            metrics = self.store.crawler_metrics()
        finally:
            sql_event.remove(self.engine, "before_cursor_execute", query)
        self.assertEqual(metrics["counts"]["partialFamilies"], 0)
        self.assertFalse(any("raw_payload" in sql or "normalized_payload" in sql or "task_results" in sql for sql in queries))

    def test_trace_retention_removes_expired_events(self) -> None:
        self.store.accept_telemetry("client-a", [self.event("http_attempt", "expired", result="success")])
        with self.store.sessions.begin() as session:
            row = session.scalar(select(CrawlTelemetryEvent).where(CrawlTelemetryEvent.id == "expired"))
            row.created_at = self.now - timedelta(days=8)
        self.store.cleanup_telemetry()
        with self.store.sessions() as session:
            self.assertIsNone(session.scalar(select(CrawlTelemetryEvent).where(CrawlTelemetryEvent.id == "expired")))

    def test_job_error_logs_keep_classification_and_omit_raw_payloads(self) -> None:
        self.store.fail_task("client-a", {"taskId": self.lease["taskId"], "leaseId": self.lease["leaseId"],
            "error": {"code": "PARSER_ERROR", "status": "parser_error", "retryable": False,
                      "message": "Authorization: Bearer PRIVATE_TOKEN\n<html>PRIVATE_HTML</html>",
                      "html": "PRIVATE_HTML", "customizationRaw": {"cookie": "PRIVATE_COOKIE"}}})
        with self.store.sessions() as session:
            row = session.scalar(select(JobEvent).where(JobEvent.event_type == "task_failed"))
            self.assertEqual(row.payload["error"]["code"], "PARSER_ERROR")
            self.assertEqual(row.payload["error"]["retryable"], False)
            self.assertNotIn("PRIVATE_", json.dumps(row.payload))
            self.assertNotIn("html", row.payload["error"])

    def test_metrics_and_trace_routes_keep_progress_small(self) -> None:
        from fastapi.testclient import TestClient
        from engine.distributed.coordinator_server import create_coordinator_app
        app = create_coordinator_app(database_url=str(self.engine.url), create_schema=False)
        with TestClient(app) as client, client.websocket_connect("/api/v1/worker/connect") as socket:
            socket.send_json(client_hello("client-live", slots=1))
            acknowledgement = socket.receive_json()
            self.assertEqual(acknowledgement["type"], "hello_ack")
            lease = socket.receive_json()
            self.assertEqual(lease["type"], "assignment")
            socket.send_json({"type": "telemetry", "events": [{"eventId": "api-event", "event": "http_attempt", "taskId": lease["taskId"], "leaseId": lease["leaseId"], "result": "success", "asin": lease["asin"], "attempt": 1}]})
            self.assertEqual(socket.receive_json()["type"], "telemetry_ack")
            metrics = client.get("/api/v1/crawler-metrics").json()
            self.assertEqual(metrics["counts"]["httpAttempts"], 1)
            trace = client.get(f"/api/v1/crawl-jobs/{lease['jobId']}/traces/{lease['requestId']}?limit=1").json()
            self.assertEqual(len(trace["events"]), 1)
            summary = client.get(f"/api/v1/crawl-jobs/{lease['jobId']}/summary").json()
            self.assertNotIn("events", summary)
            self.assertNotIn("products", summary)


if __name__ == "__main__":
    unittest.main()
