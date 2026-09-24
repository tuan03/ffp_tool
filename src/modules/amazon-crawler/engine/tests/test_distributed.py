from __future__ import annotations

import gzip
import json
import tempfile
import threading
import unittest
import asyncio
import base64
import os
import urllib.error
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import websockets
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from engine.crawler_core import CrawlSettings
from engine.cache import RawFamilyCache
from engine.distributed.client_store import ClientStore
from engine.distributed.client_agent import DistributedCrawlerAgent, progress_for_assignment, progress_targets
from engine.distributed.client_config import AgentConfig
from engine.distributed.client_main import _configure_packaged_browser, _resolve_config_path
from engine.distributed.client_tray import format_status, should_notify_captcha
from engine.distributed.coordinator_models import (
    Base,
    CrawlJob,
    CrawlProductItem,
    CrawlTask,
    JobEvent,
    ShopifyOperationIdempotency,
    ShopifyProductLink,
    TaskResult,
    create_database_engine,
    create_session_factory,
)
from engine.distributed.coordinator_server import ConnectionManager, create_coordinator_app, decompress_gzip_limited, read_request_body_limited
from engine.distributed.coordinator_store import ActiveJobExistsError, CoordinatorStore
from engine.distributed.protocol import AgentLimits, hello_message, payload_checksum, settings_fingerprint, utc_iso, utc_now
from engine.proxy_profiles import resolve_proxy_assignments


def client_hello(client_id: str = "client-a", slots: int = 2) -> dict[str, object]:
    return {
        "type": "hello",
        "protocolVersion": "5",
        "agentVersion": "5.0.0",
        "clientId": client_id,
        "displayName": client_id,
        "availableSlots": slots,
        "capabilities": {"amazon": True, "offlineSpool": True, "mediaGalleryV2": True},
        "limits": {
            "productThreads": 4,
            "variantThreads": 8,
            "urllibThreads": 12,
            "browserProfiles": 4,
            "browserTabs": 2,
            "headless": False,
        },
    }


class AgentLimitsTests(unittest.TestCase):
    def test_utc_iso_marks_timezone_less_database_values_as_utc(self) -> None:
        self.assertEqual(utc_iso(datetime(2026, 9, 24, 8, 3, 10)), "2026-09-24T08:03:10Z")

    def test_server_settings_are_capped_by_local_machine_limits(self) -> None:
        limits = AgentLimits(
            product_threads=3,
            variant_threads=6,
            urllib_threads=10,
            browser_profiles=2,
            browser_tabs=2,
            headless=False,
        )

        effective = limits.apply({
            "productThreads": 20,
            "variantThreads": 20,
            "urllibThreads": 30,
            "browserProfiles": 8,
            "browserTabs": 6,
            "headless": True,
            "amazonZip": "10001",
        })

        self.assertEqual(effective["productThreads"], 3)
        self.assertEqual(effective["variantThreads"], 6)
        self.assertEqual(effective["urllibThreads"], 10)
        self.assertEqual(effective["browserProfiles"], 2)
        self.assertEqual(effective["browserTabs"], 2)
        self.assertFalse(effective["headless"])
        self.assertEqual(effective["amazonZip"], "10001")

    def test_hello_advertises_total_capacity_separately_from_free_slots(self) -> None:
        hello = hello_message(
            client_id="client-a",
            display_name="Crawler A",
            available_slots=2,
            max_concurrent_inputs=4,
            limits=AgentLimits(),
        )

        self.assertEqual(hello["availableSlots"], 2)
        self.assertEqual(hello["maxConcurrentInputs"], 4)


class ClientTrayTests(unittest.TestCase):
    def test_status_text_includes_connection_work_and_pending_uploads(self) -> None:
        status = format_status({
            "connection": "online",
            "activeTasks": 2,
            "pendingUploads": 1,
            "waitingCaptcha": False,
        })

        self.assertEqual(status, "Online — 2 active — 1 pending upload")

    def test_captcha_notification_only_fires_on_transition(self) -> None:
        self.assertTrue(should_notify_captcha(False, {"waitingCaptcha": True}))
        self.assertFalse(should_notify_captcha(True, {"waitingCaptcha": True}))
        self.assertFalse(should_notify_captcha(False, {"waitingCaptcha": False}))


class PackagedClientTests(unittest.TestCase):
    def test_playwright_browser_path_uses_pyinstaller_bundle_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle_root = Path(directory)
            browser_root = bundle_root / "ms-playwright"
            browser_root.mkdir()
            with patch("sys._MEIPASS", str(bundle_root), create=True), patch.dict(os.environ, {}, clear=True):
                _configure_packaged_browser()
                self.assertEqual(os.environ["PLAYWRIGHT_BROWSERS_PATH"], str(browser_root))

    def test_double_clicked_packaged_agent_uses_config_beside_executable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory).resolve() / "FFPAmazonCrawlerAgent.exe"
            portable_config = executable.parent / "agent.json"
            portable_config.write_text("{}", encoding="utf-8")

            with patch("sys.frozen", True, create=True), patch("sys.executable", str(executable)):
                self.assertEqual(_resolve_config_path(None), portable_config.resolve())

    def test_explicit_config_overrides_packaged_default(self) -> None:
        explicit = Path("custom-agent.json")
        with patch("sys.frozen", True, create=True):
            self.assertEqual(_resolve_config_path(explicit), explicit)

    def test_portable_agent_discovers_proxy_config_beside_agent_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            portable_root = Path(directory).resolve()
            config_path = portable_root / "agent.json"
            proxy_path = portable_root / "amazon-crawler-profiles.json"
            config_path.write_text(json.dumps({"serverUrl": "http://127.0.0.1:8766"}), encoding="utf-8")
            proxy_path.write_text(json.dumps({
                "rotateProfiles": True,
                "profiles": [
                    {"name": "fallback-1", "enabled": True, "proxy": {"server": "http://proxy.test:8080"}},
                ],
            }), encoding="utf-8")

            config = AgentConfig.load(config_path)
            assignments, warnings = resolve_proxy_assignments(
                portable_root / "agent-data",
                1,
                config_path=config.proxy_config_path,
            )

            self.assertEqual(config.proxy_config_path, proxy_path.resolve())
            self.assertEqual([assignment.name for assignment in assignments], ["direct", "fallback-1"])
            self.assertEqual(warnings, [])

    def test_relative_agent_config_discovers_proxy_config_in_same_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            config_directory = root / "config"
            config_directory.mkdir()
            config_path = config_directory / "agent.json"
            proxy_path = config_directory / "amazon-crawler-profiles.json"
            proxy_path.write_text('{"profiles": []}', encoding="utf-8")
            config_path.write_text(json.dumps({"serverUrl": "http://127.0.0.1:8766"}), encoding="utf-8")

            previous_directory = Path.cwd()
            try:
                os.chdir(root)
                config = AgentConfig.load(Path("config/agent.json"))
            finally:
                os.chdir(previous_directory)

            self.assertEqual(config.proxy_config_path, proxy_path.resolve())


class DistributedCacheControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_connection_manager_reports_live_tasks_separately_from_database_leases(self) -> None:
        manager = ConnectionManager()

        class FakeSocket:
            async def close(self, **_kwargs):
                return None

        socket = FakeSocket()
        await manager.add("client-a", socket)
        await manager.update_runtime("client-a", active_tasks=2, available_slots=2)
        await manager.reserve_tasks("client-a", 1)

        self.assertEqual(await manager.runtime_snapshot(), {
            "client-a": {"activeTasks": 3, "availableSlots": 1},
        })
        await manager.update_available_slots("client-a", 2)
        self.assertEqual((await manager.runtime_snapshot())["client-a"]["activeTasks"], 2)
        await manager.remove("client-a", socket)
        self.assertEqual(await manager.runtime_snapshot(), {})

    async def test_coordinator_collects_cache_clear_responses_from_connected_clients(self) -> None:
        manager = ConnectionManager()

        class FakeSocket:
            async def send_json(self, payload):
                await manager.record_cache_response("client-a", {
                    "type": "cache_cleared", "requestId": payload["requestId"],
                    "removedFiles": 2, "removedBytes": 1024,
                })

            async def close(self, **_kwargs):
                return None

        await manager.add("client-a", FakeSocket())
        result = await manager.clear_client_caches(timeout_seconds=0.1)

        self.assertEqual(result["requestedClients"], 1)
        self.assertEqual(result["respondedClients"], 1)
        self.assertEqual(result["removedFiles"], 2)
        self.assertEqual(result["removedBytes"], 1024)

    async def test_agent_clears_only_its_amazon_family_cache_and_returns_ack(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            cache.save("B012345678", {"variantMatrix": {"complete": True}})
            config = AgentConfig(
                server_url="http://127.0.0.1:8766", display_name="test", max_concurrent_inputs=1,
                limits=AgentLimits(), data_directory=root / "agent-data",
            )
            agent = DistributedCrawlerAgent(project_root=root, config=config)

            response = await agent.clear_local_cache("request-1")

            self.assertEqual(response["type"], "cache_cleared")
            self.assertEqual(response["requestId"], "request-1")
            self.assertEqual(response["removedFiles"], 1)
            self.assertIsNone(cache.load("B012345678"))


class ClientStoreTests(unittest.TestCase):
    def test_cache_generation_survives_agent_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.sqlite3"
            store = ClientStore(path)

            self.assertEqual(store.cache_generation(), 0)
            store.set_cache_generation(7)

            self.assertEqual(ClientStore(path).cache_generation(), 7)

    def test_pause_and_cancel_intents_survive_agent_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.sqlite3"
            store = ClientStore(path)
            store.set_paused(True)
            store.add_cancel_intent("job-1")

            restarted = ClientStore(path)

            self.assertTrue(restarted.is_paused())
            self.assertEqual(restarted.cancel_intents(), ["job-1"])
            restarted.acknowledge_cancel_intents(["job-1"])
            self.assertEqual(restarted.cancel_intents(), [])

    def test_identity_and_pending_result_survive_agent_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.sqlite3"
            first = ClientStore(path)
            client_id = first.client_id()
            first.save_assignment({
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "settingsFingerprint": "settings-1",
            })
            first.spool_result(
                task_id="task-1",
                lease_id="lease-1",
                checksum="abc",
                payload={"taskId": "task-1", "products": []},
            )

            restarted = ClientStore(path)

            self.assertEqual(restarted.client_id(), client_id)
            self.assertEqual(restarted.recover_assignments(), [])
            self.assertEqual(restarted.pending_results()[0]["payload"]["taskId"], "task-1")

    def test_cancelled_job_is_not_recovered_for_execution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.sqlite3")
            store.save_assignment({
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "settingsFingerprint": "settings-1",
            })

            store.cancel_job("job-1")

            self.assertEqual(store.recover_assignments(), [])
            self.assertTrue(store.is_task_cancelled("task-1"))

    def test_pending_product_survives_restart_and_is_idempotently_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.sqlite3"
            first = ClientStore(path)
            first.spool_product(
                task_id="task-1",
                product_key="amazon:B012345678:design:ocean",
                lease_id="lease-1",
                checksum="first-checksum",
                payload={"product": {"id": "ocean", "title": "First"}},
            )
            first.spool_product(
                task_id="task-1",
                product_key="amazon:B012345678:design:ocean",
                lease_id="lease-1",
                checksum="second-checksum",
                payload={"product": {"id": "ocean", "title": "Updated"}},
            )

            restarted = ClientStore(path)
            pending = restarted.pending_products()

            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]["checksum"], "second-checksum")
            self.assertEqual(pending[0]["payload"]["product"]["title"], "Updated")
            self.assertTrue(restarted.has_pending_products("task-1"))

            restarted.acknowledge_product("task-1", "amazon:B012345678:design:ocean")
            self.assertFalse(restarted.has_pending_products("task-1"))


class ClientAgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_product_upload_not_found_is_acknowledged_as_cancelled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            product = {
                "taskId": "missing-task",
                "productKey": "amazon:B012345678:none:none",
                "leaseId": "expired-lease",
                "checksum": "checksum",
                "payload": {"product": {"id": "product-1"}},
            }
            agent.store.spool_product(
                task_id=product["taskId"],
                product_key=product["productKey"],
                lease_id=product["leaseId"],
                checksum=product["checksum"],
                payload=product["payload"],
            )
            not_found = urllib.error.HTTPError(
                "http://127.0.0.1:9999/product",
                404,
                "Not Found",
                {},
                None,
            )

            with patch("urllib.request.urlopen", side_effect=not_found):
                response = agent._upload_product(product)

            self.assertEqual(response, {"status": "cancelled"})

    async def test_transient_product_upload_failure_does_not_stop_upload_loop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            agent.store.spool_product(
                task_id="task-1",
                product_key="amazon:B012345678:none:none",
                lease_id="lease-1",
                checksum="checksum",
                payload={"product": {"id": "product-1"}},
            )

            with (
                patch.object(agent, "_upload_product", side_effect=OSError("temporary network failure")),
                patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError),
            ):
                with self.assertRaises(asyncio.CancelledError):
                    await agent._upload_loop()

            pending = agent.store.pending_products()
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]["attempts"], 1)

    async def test_missing_server_task_discards_all_local_task_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            assignment = {
                "taskId": "missing-task",
                "jobId": "old-job",
                "leaseId": "expired-lease",
                "settingsFingerprint": "settings-1",
            }
            agent.store.save_assignment(assignment)
            for product_key in ("amazon:B012345678:color:red", "amazon:B012345678:color:blue"):
                agent.store.spool_product(
                    task_id="missing-task",
                    product_key=product_key,
                    lease_id="expired-lease",
                    checksum=product_key,
                    payload={"product": {"id": product_key}},
                )
            agent.active["missing-task"] = assignment

            with (
                patch.object(agent, "_upload_product", return_value={"status": "cancelled"}) as upload,
                patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError),
            ):
                with self.assertRaises(asyncio.CancelledError):
                    await agent._upload_loop()

            self.assertEqual(upload.call_count, 1)
            self.assertEqual(agent.store.pending_products(), [])
            self.assertEqual(agent.store.recover_assignments(), [])
            self.assertNotIn("missing-task", agent.active)

    def test_job_cancellation_sets_every_registered_batch_event(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=2,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            first_event = threading.Event()
            second_event = threading.Event()

            agent._register_cancel_event("job-1", first_event)
            agent._register_cancel_event("job-1", second_event)
            agent._cancel_job("job-1")

            self.assertTrue(first_event.is_set())
            self.assertTrue(second_event.is_set())

    def test_job_cancellation_closes_running_browser_pool(self) -> None:
        browser_closed = threading.Event()

        class BrowserPool:
            def close(self) -> None:
                browser_closed.set()

        class RunningCrawler:
            browser_pool = BrowserPool()

        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            with agent._running_crawlers_lock:
                agent._running_crawlers["job-1"] = RunningCrawler()

            agent._cancel_job("job-1")

            self.assertTrue(browser_closed.wait(timeout=1))
            debug_events = [
                json.loads(line)
                for line in (Path(directory) / "agent-debug.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(debug_events[-1]["event"], "stop_signal_applied")
            self.assertTrue(debug_events[-1]["hasRunningCrawler"])

    async def test_cancel_message_immediately_acknowledges_receipt_for_active_task(self) -> None:
        class FakeWebSocket:
            def __init__(self) -> None:
                self.messages = iter([json.dumps({"type": "cancel", "jobId": "job-1"})])

            def __aiter__(self):
                return self

            async def __anext__(self) -> str:
                try:
                    return next(self.messages)
                except StopIteration as error:
                    raise StopAsyncIteration from error

        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            agent.active["task-1"] = {
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
            }

            await agent._receiver(FakeWebSocket())

            self.assertEqual(await agent.outbound_queue.get(), {
                "type": "cancel_received",
                "taskId": "task-1",
                "leaseId": "lease-1",
            })

    async def test_cancelled_batch_discards_late_products_and_results(self) -> None:
        class FakeBrowserPool:
            def close(self) -> None:
                pass

        class LateCallbackCrawler:
            def __init__(self, **_kwargs: object) -> None:
                self.browser_pool = FakeBrowserPool()

            def run(self, **kwargs: object) -> dict[str, object]:
                kwargs["on_product_complete"]({
                    "source": "B0FR4MSS2H",
                    "asin": "B0FR4MSS2H",
                    "product": {"id": "late-product", "sourceKey": "amazon:late"},
                })
                kwargs["on_input_complete"]({
                    "source": "B0FR4MSS2H",
                    "asin": "B0FR4MSS2H",
                    "status": "completed",
                    "products": [{"id": "late-product"}],
                    "errors": [],
                    "warnings": [],
                    "completedAt": "2026-09-23T00:00:00Z",
                    "durationMs": 1,
                })
                return {"status": "completed"}

        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(
                project_root=Path(directory),
                config=config,
                crawler_factory=LateCallbackCrawler,
            )
            assignment = {
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "source": "B0FR4MSS2H",
                "asin": "B0FR4MSS2H",
                "url": "https://www.amazon.com/dp/B0FR4MSS2H",
                "settings": {},
                "settingsFingerprint": "settings-1",
            }
            cancel_event = threading.Event()
            cancel_event.set()

            await asyncio.to_thread(agent._run_batch, [assignment], cancel_event, asyncio.get_running_loop())
            completion = await asyncio.wait_for(agent.completion_queue.get(), timeout=1)

            self.assertEqual(completion["type"], "cancelled")
            self.assertEqual(agent.store.pending_products(), [])
            self.assertEqual(agent.store.pending_results(), [])

    async def test_crawler_receives_agent_proxy_config_path(self) -> None:
        captured: dict[str, object] = {}

        class FakeBrowserPool:
            def close(self) -> None:
                pass

        class CompletedCrawler:
            def __init__(self, **kwargs: object) -> None:
                captured.update(kwargs)
                self.browser_pool = FakeBrowserPool()

            def run(self, **kwargs: object) -> dict[str, object]:
                callback = kwargs["on_input_complete"]
                callback({
                    "source": "https://www.amazon.com/dp/B0FR4MSS2H",
                    "asin": "B0FR4MSS2H",
                    "status": "completed",
                    "products": [],
                    "errors": [],
                    "warnings": [],
                    "completedAt": "2026-09-22T00:00:00Z",
                    "durationMs": 25,
                })
                return {"status": "completed"}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proxy_path = root / "amazon-crawler-profiles.json"
            proxy_path.write_text('{"profiles": []}', encoding="utf-8")
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=root,
                proxy_config_path=proxy_path,
            )
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=config,
                crawler_factory=CompletedCrawler,
            )
            assignment = {
                "type": "assignment",
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "source": "B0FR4MSS2H",
                "asin": "B0FR4MSS2H",
                "url": "https://www.amazon.com/dp/B0FR4MSS2H",
                "settings": {},
                "settingsFingerprint": "settings-1",
            }

            await asyncio.to_thread(agent._run_batch, [assignment], asyncio.Event(), asyncio.get_running_loop())

            self.assertEqual(captured["proxy_config_path"], proxy_path)

    async def test_completed_product_is_spooled_before_the_task_result(self) -> None:
        class FakeBrowserPool:
            def close(self) -> None:
                pass

        class StreamingCrawler:
            def __init__(self, **_kwargs: object) -> None:
                self.browser_pool = FakeBrowserPool()

            def run(self, **kwargs: object) -> dict[str, object]:
                product_callback = kwargs["on_product_complete"]
                input_callback = kwargs["on_input_complete"]
                product = {
                    "id": "ocean-product",
                    "sourceKey": "amazon:B0FR4MSS2H:design:ocean",
                    "parentAsin": "B0FR4MSS2H",
                    "title": "Ocean",
                }
                product_callback({
                    "source": "B0FR4MSS2H",
                    "asin": "B0FR4MSS2H",
                    "product": product,
                    "completedAt": "2026-09-22T00:00:00Z",
                })
                input_callback({
                    "source": "B0FR4MSS2H",
                    "asin": "B0FR4MSS2H",
                    "status": "completed",
                    "products": [product],
                    "errors": [],
                    "warnings": [],
                    "completedAt": "2026-09-22T00:00:01Z",
                    "durationMs": 1000,
                })
                return {"status": "completed"}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=root,
            )
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=config,
                crawler_factory=StreamingCrawler,
            )
            assignment = {
                "type": "assignment",
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "source": "B0FR4MSS2H",
                "asin": "B0FR4MSS2H",
                "url": "https://www.amazon.com/dp/B0FR4MSS2H",
                "settings": {},
                "settingsFingerprint": "settings-1",
            }

            await asyncio.to_thread(
                agent._run_batch,
                [assignment],
                asyncio.Event(),
                asyncio.get_running_loop(),
            )

            pending_products = agent.store.pending_products()
            pending_results = agent.store.pending_results()
            self.assertEqual(len(pending_products), 1)
            self.assertEqual(pending_products[0]["productKey"], "amazon:B0FR4MSS2H:design:ocean")
            self.assertEqual(pending_products[0]["payload"]["jobId"], "job-1")
            self.assertEqual(len(pending_results), 1)

    def test_paused_agent_advertises_no_available_slots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=4,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)

            agent.set_paused(True)

            self.assertEqual(agent.status_snapshot()["connection"], "paused")
            self.assertEqual(agent.status_snapshot()["availableSlots"], 0)

    def test_source_progress_is_sent_only_to_matching_assignment(self) -> None:
        assignments = [
            {"taskId": "task-a", "source": "B0FR4MSS2H", "asin": "B0FR4MSS2H", "url": "https://www.amazon.com/dp/B0FR4MSS2H"},
            {"taskId": "task-b", "source": "B0HG4NRG98", "asin": "B0HG4NRG98", "url": "https://www.amazon.com/dp/B0HG4NRG98"},
        ]

        targeted = progress_targets(assignments, {"source": "https://www.amazon.com/dp/B0HG4NRG98"})
        global_targets = progress_targets(assignments, {"phase": "product"})

        self.assertEqual([assignment["taskId"] for assignment in targeted], ["task-b"])
        self.assertEqual([assignment["taskId"] for assignment in global_targets], ["task-a", "task-b"])

    def test_batch_progress_is_reduced_to_the_matching_product_for_each_assignment(self) -> None:
        assignment = {
            "taskId": "task-b", "source": "B0HG4NRG98", "asin": "B0HG4NRG98",
            "url": "https://www.amazon.com/dp/B0HG4NRG98",
        }
        progress = {
            "phase": "variant_matrix", "completed": 0, "total": 2, "message": "Batch đang chạy",
            "items": [
                {"source": "B0FR4MSS2H", "asin": "B0FR4MSS2H", "message": "Variant 1/8"},
                {
                    "source": "B0HG4NRG98", "asin": "B0HG4NRG98", "message": "Variant 3/14",
                    "variantCompleted": 3, "variantTotal": 14, "currentAsin": "B0CHILD002",
                    "currentOptions": {"Size": "Large"},
                },
            ],
        }

        task_progress = progress_for_assignment(progress, assignment)

        self.assertEqual(len(task_progress["items"]), 1)
        self.assertEqual(task_progress["items"][0]["asin"], "B0HG4NRG98")
        self.assertEqual(task_progress["items"][0]["variantCompleted"], 3)

    async def test_stop_disconnects_an_online_agent_promptly(self) -> None:
        async def coordinator(websocket: object) -> None:
            raw = await websocket.recv()
            hello = json.loads(raw)
            self.assertEqual(hello["type"], "hello")
            await websocket.send(json.dumps({
                "type": "hello_ack",
                "protocolVersion": "5",
                "heartbeatIntervalSeconds": 10,
                "leaseSeconds": 60,
            }))
            await websocket.wait_closed()

        server = await websockets.serve(coordinator, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            with tempfile.TemporaryDirectory() as directory:
                config = AgentConfig(
                    server_url=f"http://127.0.0.1:{port}",
                    display_name="test-agent",
                    max_concurrent_inputs=1,
                    limits=AgentLimits(),
                    data_directory=Path(directory),
                )
                agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
                run_task = asyncio.create_task(agent.run())
                for _ in range(50):
                    if agent.connection_status == "online":
                        break
                    await asyncio.sleep(0.02)
                self.assertEqual(agent.connection_status, "online")

                agent.stop()

                await asyncio.wait_for(run_task, timeout=1)
        finally:
            server.close()
            await server.wait_closed()

    async def test_batch_start_failure_reports_every_assignment_and_keeps_executor_alive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            assignment = {
                "type": "assignment",
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "source": "B0FR4MSS2H",
                "asin": "B0FR4MSS2H",
                "url": "https://www.amazon.com/dp/B0FR4MSS2H",
                "settings": {},
                "settingsFingerprint": "settings-1",
            }
            agent.store.save_assignment(assignment)
            agent.active["task-1"] = assignment
            await agent.assignment_queue.put(assignment)

            def fail_batch(*_args: object) -> None:
                raise RuntimeError("Chromium could not start")

            agent._run_batch = fail_batch  # type: ignore[method-assign]
            executor = asyncio.create_task(agent._execution_loop())
            try:
                completion = await asyncio.wait_for(agent.completion_queue.get(), timeout=2)
                self.assertEqual(completion["type"], "failed")
                self.assertEqual(completion["taskId"], "task-1")
                self.assertIn("Chromium could not start", completion["error"]["message"])
                self.assertFalse(executor.done())
            finally:
                executor.cancel()
                await asyncio.gather(executor, return_exceptions=True)

    async def test_cancelled_crawler_result_releases_local_assignment(self) -> None:
        class FakeBrowserPool:
            def close(self) -> None:
                pass

        class CancelledCrawler:
            def __init__(self, **_kwargs: object) -> None:
                self.browser_pool = FakeBrowserPool()

            def run(self, **kwargs: object) -> dict[str, object]:
                callback = kwargs["on_input_complete"]
                callback({
                    "source": "https://www.amazon.com/dp/B0FR4MSS2H",
                    "asin": "B0FR4MSS2H",
                    "status": "cancelled",
                    "products": [],
                    "errors": [],
                    "warnings": [],
                    "completedAt": "2026-09-22T00:00:00Z",
                    "durationMs": 25,
                })
                return {"status": "cancelled"}

        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=AgentLimits(),
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(
                project_root=Path(directory),
                config=config,
                crawler_factory=CancelledCrawler,
            )
            assignment = {
                "type": "assignment",
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "source": "B0FR4MSS2H",
                "asin": "B0FR4MSS2H",
                "url": "https://www.amazon.com/dp/B0FR4MSS2H",
                "settings": {},
                "settingsFingerprint": "settings-1",
            }
            loop = asyncio.get_running_loop()

            await asyncio.to_thread(agent._run_batch, [assignment], asyncio.Event(), loop)
            completion = await asyncio.wait_for(agent.completion_queue.get(), timeout=1)

            self.assertEqual(completion["type"], "cancelled")
            self.assertEqual(completion["taskId"], "task-1")

    async def test_result_envelope_records_effective_capped_settings(self) -> None:
        class FakeBrowserPool:
            def close(self) -> None:
                pass

        class CompletedCrawler:
            def __init__(self, **_kwargs: object) -> None:
                self.browser_pool = FakeBrowserPool()

            def run(self, **kwargs: object) -> dict[str, object]:
                callback = kwargs["on_input_complete"]
                callback({
                    "source": "https://www.amazon.com/dp/B0FR4MSS2H",
                    "asin": "B0FR4MSS2H",
                    "status": "completed",
                    "products": [{"id": "product-1"}],
                    "errors": [],
                    "warnings": [],
                    "completedAt": "2026-09-22T00:00:00Z",
                    "durationMs": 25,
                })
                return {"status": "completed"}

        with tempfile.TemporaryDirectory() as directory:
            limits = AgentLimits(product_threads=2, browser_profiles=2)
            config = AgentConfig(
                server_url="http://127.0.0.1:9999",
                display_name="test-agent",
                max_concurrent_inputs=1,
                limits=limits,
                data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(
                project_root=Path(directory),
                config=config,
                crawler_factory=CompletedCrawler,
            )
            requested_settings = {"productThreads": 8, "browserProfiles": 4, "amazonZip": "10001"}
            assignment = {
                "type": "assignment",
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "source": "B0FR4MSS2H",
                "asin": "B0FR4MSS2H",
                "url": "https://www.amazon.com/dp/B0FR4MSS2H",
                "settings": requested_settings,
                "settingsFingerprint": "requested-fingerprint",
            }
            agent.store.save_assignment(assignment)

            await asyncio.to_thread(agent._run_batch, [assignment], asyncio.Event(), asyncio.get_running_loop())
            pending = agent.store.pending_results()[0]["payload"]
            effective_settings = CrawlSettings.from_api(limits.apply(requested_settings)).api_dict()

            self.assertEqual(pending["requestedSettingsFingerprint"], "requested-fingerprint")
            self.assertEqual(pending["settings"], effective_settings)
            self.assertEqual(pending["settingsFingerprint"], settings_fingerprint(effective_settings))


class CoordinatorStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "coordinator.sqlite3"
        self.engine = create_database_engine(f"sqlite:///{database_path.as_posix()}")
        Base.metadata.create_all(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temporary_directory.cleanup()

    def _create_four_task_job(self) -> dict[str, object]:
        return self.store.create_job({
            "urls": ["B0FR4MSS2H", "B0HG4NRG98", "B0GVDXGVVB", "B0GQ33XWW7"],
            "productThreads": 4,
        })

    def test_repeated_ready_messages_cannot_exceed_client_capacity(self) -> None:
        self._create_four_task_job()
        self.store.register_client(client_hello(slots=2))

        first = self.store.lease_tasks("client-a", 2)
        second = self.store.lease_tasks("client-a", 2)

        self.assertEqual(len(first), 2)
        self.assertEqual(second, [])

    def test_heartbeat_reissues_cancel_for_a_cancelled_running_job(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.cancel_job(str(job["id"]))

        cancelled_job_ids = self.store.heartbeat("client-a", [{
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        }], "busy")

        self.assertEqual(cancelled_job_ids, [job["id"]])

    def test_cancel_waits_for_agent_ack_and_rejects_late_result(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]

        cancelling = self.store.cancel_job(str(job["id"]))

        self.assertEqual(cancelling["status"], "cancelling")
        self.assertEqual(cancelling["taskCounts"], {"cancelling": 1})
        self.assertFalse(cancelling["cancellation"]["pendingAgents"][0]["hasReceived"])
        received = self.store.acknowledge_task_cancel_received("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        })
        self.assertEqual(received["status"], "received")
        received_snapshot = self.store.get_job(str(job["id"]))
        self.assertEqual(received_snapshot["status"], "cancelling")
        self.assertTrue(received_snapshot["cancellation"]["pendingAgents"][0]["hasReceived"])
        rejected = self.store.accept_result(
            lease["taskId"],
            "client-a",
            lease["leaseId"],
            "late-checksum",
            {"jobId": job["id"], "products": []},
        )
        self.assertEqual(rejected["status"], "cancelled")

        acknowledged = self.store.acknowledge_task_cancel("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        })

        self.assertEqual(acknowledged["status"], "cancelled")
        snapshot = self.store.get_job(str(job["id"]))
        self.assertEqual(snapshot["status"], "cancelled")
        self.assertTrue(snapshot["cancellation"]["isExecutionConfirmed"])

    def test_terminal_stop_waits_for_online_agent_cleanup_then_purges_job(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]

        stopping = self.store.cancel_job(str(job["id"]), {"client-a"})

        self.assertEqual(stopping["status"], "cancelling")
        self.assertEqual(len(stopping["cancellation"]["pendingCleanupAgents"]), 1)
        generation = self.store.current_cache_generation()
        self.store.acknowledge_task_cancel("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        })
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "cancelling")

        self.assertTrue(self.store.acknowledge_stop_cleanup(
            "client-a",
            job_id=str(job["id"]),
            cache_generation=generation,
        ))
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "cancelled")
        self.assertEqual(self.store.purge_stopped_jobs(), 1)
        self.assertIsNone(self.store.get_job(str(job["id"])))
        self.assertEqual(self.store.reconcile_tasks("client-a", [{
            "taskId": lease["taskId"],
            "jobId": job["id"],
            "leaseId": lease["leaseId"],
        }])["discardTaskIds"], [lease["taskId"]])

    def test_cache_generation_ack_recovers_stop_cleanup_after_agent_reconnect(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.cancel_job(str(job["id"]), {"client-a"})
        generation = self.store.current_cache_generation()
        self.store.acknowledge_task_cancel("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        })

        recovered_jobs = self.store.acknowledge_client_cache_generation("client-a", generation)

        self.assertEqual(recovered_jobs, [str(job["id"])])
        snapshot = self.store.get_job(str(job["id"]))
        self.assertEqual(snapshot["status"], "cancelled")
        self.assertEqual(snapshot["cancellation"]["pendingCleanupAgents"], [])

    def test_terminal_stop_does_not_wait_for_offline_agent(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        self.store.lease_tasks("client-a", 1)

        stopped = self.store.cancel_job(str(job["id"]), set())

        self.assertEqual(stopped["status"], "cancelled")
        self.assertEqual(stopped["cancellation"]["pendingCleanupAgents"], [])
        self.assertEqual(self.store.purge_stopped_jobs(), 1)
        self.assertIsNone(self.store.get_job(str(job["id"])))

    def test_stop_drains_started_shopify_write_and_preserves_mapping(self) -> None:
        source_key = "amazon:B0FR4MSS2H:design:drain"
        product = {"id": "product-drain", "sourceKey": source_key, "title": "Drain"}
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-drain",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-drain"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.assertTrue(self.store.mark_product_syncing(
            claim["id"],
            worker_id="worker-1",
            normalized_payload=product,
            proxy_profile="proxy-1",
        ))
        self.assertTrue(self.store.mark_shopify_write_started(claim["id"], worker_id="worker-1"))

        stopping = self.store.cancel_job(str(job["id"]), set())

        self.assertEqual(stopping["status"], "cancelling")
        self.assertEqual(self.store.product_cancellation_state(claim["id"], worker_id="worker-1"), "draining")
        self.assertIs(self.store.checkpoint_shopify_product(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            normalized_checksum="normalized-drain",
            shopify_result={
                "productId": "gid://shopify/Product/999",
                "productHandle": "drain",
                "managedResources": {},
            },
        ), True)
        self.assertTrue(self.store.acknowledge_product_cancel(claim["id"], worker_id="worker-1"))
        self.assertEqual(self.store.purge_stopped_jobs(), 1)
        with self.sessions() as session:
            link = session.scalar(select(ShopifyProductLink).where(
                ShopifyProductLink.store_id == "store-1",
                ShopifyProductLink.source_key == source_key,
            ))
            self.assertIsNotNone(link)
            self.assertEqual(link.shopify_product_id, "gid://shopify/Product/999")

    def test_reconciliation_resumes_valid_lease_and_discards_cancelled_lease(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        local_task = {
            "taskId": lease["taskId"],
            "jobId": job["id"],
            "leaseId": lease["leaseId"],
            "status": "running",
        }

        active = self.store.reconcile_tasks("client-a", [local_task])
        self.assertEqual(active["resumeTaskIds"], [lease["taskId"]])

        self.store.cancel_job(str(job["id"]))
        cancelled = self.store.reconcile_tasks("client-a", [local_task])
        self.assertEqual(cancelled["discardTaskIds"], [lease["taskId"]])
        self.assertEqual(cancelled["cancelledJobIds"], [job["id"]])
        snapshot = self.store.get_job(str(job["id"]))
        self.assertEqual(snapshot["status"], "cancelled")
        self.assertTrue(snapshot["cancellation"]["isExecutionConfirmed"])

    def test_expired_cancel_does_not_wait_for_an_offline_agent(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.cancel_job(str(job["id"]))
        self.store.acknowledge_task_cancel_received("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        })
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, lease["taskId"])
            task.lease_expires_at = utc_now() - timedelta(seconds=1)

        self.store.reap_expired()

        pending = self.store.get_job(str(job["id"]))
        self.assertEqual(pending["status"], "cancelled")
        self.assertTrue(pending["cancellation"]["isExecutionConfirmed"])

        self.store.heartbeat("client-a", [{
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        }], "busy")
        still_pending = self.store.get_job(str(job["id"]))
        self.assertEqual(still_pending["status"], "cancelled")

        self.store.heartbeat("client-a", [], "online")
        confirmed = self.store.get_job(str(job["id"]))
        self.assertEqual(confirmed["status"], "cancelled")
        self.assertTrue(confirmed["cancellation"]["isExecutionConfirmed"])

    def test_late_cancel_ack_confirms_an_expired_cancel_lease(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.cancel_job(str(job["id"]))
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, lease["taskId"])
            task.lease_expires_at = utc_now() - timedelta(seconds=1)

        self.store.reap_expired()
        acknowledged = self.store.acknowledge_task_cancel("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        })

        self.assertEqual(acknowledged["status"], "duplicate")
        confirmed = self.store.get_job(str(job["id"]))
        self.assertEqual(confirmed["status"], "cancelled")
        self.assertTrue(confirmed["cancellation"]["isExecutionConfirmed"])

    def test_expired_pipeline_claim_remains_cancelling_until_worker_acknowledges(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-cancel",
            "sourceKey": "amazon:B0FR4MSS2H:design:cancel",
            "parentAsin": "B0FR4MSS2H",
            "title": "Cancel pipeline product",
        }
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.store.cancel_job(str(job["id"]))
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, claim["id"])
            item.claim_expires_at = utc_now() - timedelta(seconds=1)

        self.store.reap_expired()

        pending = self.store.get_job(str(job["id"]))
        self.assertEqual(pending["status"], "cancelling")
        self.assertEqual(pending["cancellation"]["pendingPipelineItems"], 1)
        self.assertEqual(pending["cancellation"]["pendingPipeline"][0]["phase"], "normalizing")
        self.assertIsNone(pending["cancellation"]["pendingPipeline"][0]["receivedAt"])
        self.assertEqual(
            self.store.product_cancellation_state(claim["id"], worker_id="worker-1"),
            "cancelled",
        )
        received = self.store.get_job(str(job["id"]))
        self.assertIsNotNone(received["cancellation"]["pendingPipeline"][0]["receivedAt"])
        self.assertTrue(self.store.acknowledge_product_cancel(claim["id"], worker_id="worker-1"))
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "cancelled")

    def test_delete_job_is_idempotent_and_leaves_discard_tombstone(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})

        self.assertTrue(self.store.delete_job(str(job["id"])))
        self.assertIsNone(self.store.get_job(str(job["id"])))
        self.assertTrue(self.store.delete_job(str(job["id"])))
        reconciliation = self.store.reconcile_tasks("client-a", [{
            "taskId": "old-task",
            "jobId": job["id"],
            "leaseId": "old-lease",
        }])
        self.assertEqual(reconciliation["discardTaskIds"], ["old-task"])

    def test_second_job_is_rejected_while_an_existing_job_is_active(self) -> None:
        older = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        with self.assertRaises(ActiveJobExistsError) as caught:
            self.store.create_job({
                "urls": ["B0HG4NRG98"],
                "replacementOfJobId": older["id"],
                "schedulerPriority": 100,
            })
        self.assertEqual(caught.exception.job_id, older["id"])

    def test_job_snapshot_exposes_latest_detailed_progress_for_each_task(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.update_progress("client-a", {
            "taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "progress": {
                "phase": "variant_matrix", "message": "Đang cào variant 3/14",
                "items": [{
                    "source": "B0FR4MSS2H", "asin": "B0FR4MSS2H", "status": "running",
                    "phase": "variant_matrix", "message": "Đang cào variant 3/14",
                    "variantCompleted": 3, "variantTotal": 14, "currentAsin": "B0CHILD003",
                    "currentOptions": {"Size": "Large"},
                }],
            },
        })

        snapshot = self.store.get_job(str(job["id"]))
        progress_item = snapshot["progress"]["items"][0]

        self.assertEqual(snapshot["progress"]["phase"], "variant_matrix")
        self.assertEqual(progress_item["variantCompleted"], 3)
        self.assertEqual(progress_item["variantTotal"], 14)
        self.assertEqual(progress_item["currentOptions"], {"Size": "Large"})

    def test_completed_task_progress_uses_durable_result_counts_instead_of_stale_events(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.update_progress("client-a", {
            "taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "progress": {
                "phase": "customization", "message": "Đang tải Customize",
                "items": [{
                    "source": "B0FR4MSS2H", "asin": "B0FR4MSS2H", "status": "running",
                    "phase": "customization", "message": "Đang tải Customize",
                    "variantCompleted": 1, "variantTotal": 2,
                    "activeVariants": [{"asin": "B0CHILD002"}],
                }],
            },
        })
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "checksum",
            {
                "jobId": job["id"],
                "products": [{
                    "id": "product-1",
                    "sourceVariants": [{"asin": "B0CHILD001"}, {"asin": "B0CHILD002"}],
                    "variants": [{"id": "variant-1"}],
                }],
                "errors": [], "warnings": [],
            },
        )

        snapshot = self.store.get_job(str(job["id"]))
        progress_item = snapshot["progress"]["items"][0]

        self.assertEqual(progress_item["status"], "completed")
        self.assertEqual(progress_item["phase"], "product")
        self.assertEqual(progress_item["message"], "Đã hoàn tất sản phẩm.")
        self.assertEqual(progress_item["variantCompleted"], 2)
        self.assertEqual(progress_item["variantTotal"], 2)
        self.assertEqual(progress_item["activeVariants"], [])

    def test_late_progress_cannot_reopen_a_completed_task(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        accepted = self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "checksum",
            {"jobId": job["id"], "products": [], "errors": [], "warnings": []},
        )
        self.assertEqual(accepted["status"], "accepted")

        self.store.update_progress("client-a", {
            "taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "progress": {"phase": "product", "message": "Delayed progress"},
        })

        snapshot = self.store.get_job(str(job["id"]))
        self.assertEqual(snapshot["status"], "completed")
        self.assertEqual(snapshot["taskCounts"], {"completed": 1})

    def test_reaper_repairs_a_completed_result_instead_of_requeueing_it(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "checksum",
            {"jobId": job["id"], "products": [], "errors": [], "warnings": []},
        )
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, lease["taskId"])
            task.status = "running"
            task.lease_expires_at = task.started_at

        reaped = self.store.reap_expired()

        self.assertEqual(reaped["requeuedTasks"], 0)
        self.assertEqual(self.store.get_job(str(job["id"]))["taskCounts"], {"completed": 1})

    def test_third_crawl_failure_makes_task_terminal(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))

        statuses: list[str] = []
        for _ in range(3):
            lease = self.store.lease_tasks("client-a", 1)[0]
            response = self.store.fail_task("client-a", {
                "taskId": lease["taskId"],
                "leaseId": lease["leaseId"],
                "error": {"message": "Amazon blocked the request.", "retryable": True},
            })
            statuses.append(str(response["status"]))

        self.assertEqual(statuses, ["queued", "queued", "failed"])
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "partial")

    def test_expired_lease_requeues_without_counting_as_crawl_failure(self) -> None:
        self._create_four_task_job()
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, lease["taskId"])
            task.lease_expires_at = task.started_at

        reaped = self.store.reap_expired()

        self.assertEqual(reaped["requeuedTasks"], 1)
        with self.sessions() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.id == lease["taskId"]))
            self.assertEqual(task.status, "queued")
            self.assertEqual(task.failure_count, 0)

    def test_equal_clients_dynamically_share_one_hundred_tasks(self) -> None:
        urls = [f"B{index:09d}" for index in range(100)]
        self.store.create_job({"urls": urls})
        client_ids = ["client-a", "client-b", "client-c"]
        for client_id in client_ids:
            self.store.register_client(client_hello(client_id, slots=1))
        assignments = {client_id: 0 for client_id in client_ids}

        while sum(assignments.values()) < 100:
            for client_id in client_ids:
                leases = self.store.lease_tasks(client_id, 1)
                if not leases:
                    continue
                lease = leases[0]
                response = self.store.accept_result(
                    lease["taskId"],
                    client_id,
                    lease["leaseId"],
                    f"checksum-{lease['taskId']}",
                    {"jobId": lease["jobId"], "products": [], "errors": [], "warnings": []},
                )
                self.assertEqual(response["status"], "accepted")
                assignments[client_id] += 1

        self.assertEqual(sorted(assignments.values()), [33, 33, 34])

    def test_first_valid_result_wins_after_expired_task_is_reassigned(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-a", slots=1))
        self.store.register_client(client_hello("client-b", slots=1))
        first = self.store.lease_tasks("client-a", 1)[0]
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, first["taskId"])
            task.lease_expires_at = task.started_at
        self.store.reap_expired()
        second = self.store.lease_tasks("client-b", 1)[0]

        accepted = self.store.accept_result(
            first["taskId"], "client-a", first["leaseId"], "first", {"jobId": first["jobId"], "products": [{"id": "first"}]},
        )
        duplicate = self.store.accept_result(
            second["taskId"], "client-b", second["leaseId"], "second", {"jobId": second["jobId"], "products": [{"id": "second"}]},
        )

        self.assertEqual(accepted["status"], "accepted")
        self.assertEqual(duplicate["status"], "duplicate")

    def test_result_is_rejected_when_lease_was_never_issued_for_task(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-a", slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]

        response = self.store.accept_result(
            lease["taskId"],
            "forged-client",
            "forged-lease",
            "checksum",
            {"products": []},
        )

        self.assertEqual(response["status"], "stale")
        with self.sessions() as session:
            task = session.get(CrawlTask, lease["taskId"])
            self.assertEqual(task.status, "leased")

    def test_job_survives_coordinator_store_restart(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        database_url = str(self.engine.url)
        self.engine.dispose()
        restarted_engine = create_database_engine(database_url)
        restarted_store = CoordinatorStore(create_session_factory(restarted_engine))
        try:
            snapshot = restarted_store.get_job(str(job["id"]))
            self.assertIsNotNone(snapshot)
            self.assertEqual(snapshot["acceptedInputs"], 1)
            self.assertEqual(snapshot["status"], "queued")
        finally:
            restarted_engine.dispose()

    def test_duplicate_product_upload_creates_one_pipeline_item(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-ocean",
            "sourceKey": "amazon:B0FR4MSS2H:design:ocean",
            "parentAsin": "B0FR4MSS2H",
            "title": "Ocean",
        }
        payload = {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"}

        accepted = self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-1", payload,
        )
        duplicate = self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-1", payload,
        )

        self.assertEqual(accepted["status"], "accepted")
        self.assertEqual(duplicate["status"], "duplicate")
        with self.sessions() as session:
            items = session.scalars(select(CrawlProductItem)).all()
            self.assertEqual(len(items), 1)

    def test_same_source_key_reuses_shopify_mapping_across_sequential_jobs(self) -> None:
        source_key = "amazon:B0FR4MSS2H:design:ocean"
        product = {
            "id": "product-ocean",
            "sourceKey": source_key,
            "parentAsin": "B0FR4MSS2H",
            "title": "Ocean",
        }
        first_job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-1", slots=1))
        first_lease = self.store.lease_tasks("client-1", 1)[0]
        self.store.accept_product(
            first_lease["taskId"], "client-1", first_lease["leaseId"], source_key, "checksum-1",
            {"jobId": first_job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        first_claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        completed = self.store.complete_product_item(
            first_claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            normalized_checksum="normalized-1",
            normalized_payload={**product, "normalized": True},
            shopify_result={
                "productId": "gid://shopify/Product/123",
                "productHandle": "ocean",
                "managedResources": {"tags": [source_key]},
            },
        )
        self.assertTrue(completed)
        self.store.delete_job(str(first_job["id"]))

        second_job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-2", slots=1))
        second_lease = self.store.lease_tasks("client-2", 1)[0]
        self.store.accept_product(
            second_lease["taskId"], "client-2", second_lease["leaseId"], source_key, "checksum-2",
            {"jobId": second_job["id"], "product": product, "productChecksum": "checksum-2"},
        )
        second_claim = self.store.claim_product_items(worker_id="worker-2", store_id="store-1", limit=1)[0]

        self.assertEqual(second_claim["existingShopify"]["productId"], "gid://shopify/Product/123")

    def test_shopify_checkpoint_prevents_duplicate_create_when_corpus_commit_retries(self) -> None:
        source_key = "amazon:B0FR4MSS2H:design:ocean"
        product = {"id": "product-ocean", "sourceKey": source_key, "title": "Ocean"}
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.assertTrue(self.store.mark_product_seo(
            claim["id"],
            worker_id="worker-1",
            normalized_payload=product,
            seo_summary={"status": "running"},
        ))
        self.assertTrue(self.store.mark_product_syncing(
            claim["id"],
            worker_id="worker-1",
            normalized_payload={**product, "title": "Ocean SEO"},
            proxy_profile="proxy-1",
            seo_summary={"status": "completed", "engine": "heuristic"},
        ))

        self.assertTrue(self.store.mark_shopify_write_started(claim["id"], worker_id="worker-1"))
        self.assertIs(self.store.checkpoint_shopify_product(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            normalized_checksum="seo-checksum-1",
            shopify_result={
                "productId": "gid://shopify/Product/123",
                "productHandle": "ocean-seo",
                "managedResources": {"tags": [source_key]},
            },
        ), False)
        self.assertEqual(self.store.fail_product_item(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            error={"message": "Corpus revision changed.", "phase": "seo"},
            retryable=True,
            reconciliation_required=False,
        ), "retry_wait")
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, claim["id"])
            item.next_attempt_at = utc_now() - timedelta(seconds=1)

        retry_claim = self.store.claim_product_items(worker_id="worker-2", store_id="store-1", limit=1)[0]
        self.assertEqual(retry_claim["existingShopify"]["productId"], "gid://shopify/Product/123")
        self.assertEqual(retry_claim["existingShopify"]["normalizedChecksum"], "seo-checksum-1")

    def test_completed_product_discards_raw_payload_but_keeps_temporary_normalized_result(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        source_key = "amazon:B0FR4MSS2H:design:ocean"
        product = {
            "id": "product-ocean",
            "sourceKey": source_key,
            "parentAsin": "B0FR4MSS2H",
            "title": "Ocean raw",
        }
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        normalized = {**product, "title": "Ocean normalized"}

        completed = self.store.complete_product_item(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            normalized_checksum="normalized-1",
            normalized_payload=normalized,
            shopify_result={
                "productId": "gid://shopify/Product/123",
                "productHandle": "ocean",
                "managedResources": {"tags": [source_key]},
            },
        )

        self.assertTrue(completed)
        with self.sessions() as session:
            item = session.get(CrawlProductItem, claim["id"])
            task_result = session.get(TaskResult, lease["taskId"])
            self.assertEqual(item.raw_payload, {})
            self.assertEqual(item.normalized_payload, normalized)
            self.assertEqual(task_result.payload["products"], [])
        public_result = self.store.job_results(str(job["id"]))
        self.assertEqual(public_result["products"][0]["title"], "Ocean normalized")

    def test_late_task_result_does_not_restore_raw_product_after_streaming_sync(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        source_key = "amazon:B0FR4MSS2H:design:ocean"
        product = {"id": "product-ocean", "sourceKey": source_key, "title": "Ocean raw"}
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.store.complete_product_item(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            normalized_checksum="normalized-1",
            normalized_payload={**product, "title": "Ocean normalized"},
            shopify_result={"productId": "gid://shopify/Product/123"},
        )

        accepted = self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )

        self.assertEqual(accepted["status"], "accepted")
        with self.sessions() as session:
            task_result = session.get(TaskResult, lease["taskId"])
            item = session.get(CrawlProductItem, claim["id"])
            self.assertEqual(task_result.payload["products"], [])
            self.assertEqual(item.raw_payload, {})

    def test_cleanup_history_removes_expired_job_data_but_keeps_shopify_mapping(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        source_key = "amazon:B0FR4MSS2H:design:ocean"
        product = {"id": "product-ocean", "sourceKey": source_key, "title": "Ocean"}
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.store.complete_product_item(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            normalized_checksum="normalized-1",
            normalized_payload=product,
            shopify_result={"productId": "gid://shopify/Product/123", "productHandle": "ocean"},
        )
        now = utc_now()
        with self.sessions.begin() as session:
            stored_job = session.get(CrawlJob, job["id"])
            stored_job.completed_at = now - timedelta(minutes=61)
            operation = session.scalar(select(ShopifyOperationIdempotency))
            operation.updated_at = now - timedelta(minutes=61)

        cleaned = self.store.cleanup_history(retention_minutes=60, now=now)

        self.assertEqual(cleaned["jobs"], 1)
        self.assertEqual(cleaned["idempotencyOperations"], 1)
        with self.sessions() as session:
            self.assertIsNone(session.get(CrawlJob, job["id"]))
            self.assertEqual(session.scalars(select(CrawlTask)).all(), [])
            self.assertEqual(session.scalars(select(TaskResult)).all(), [])
            self.assertEqual(session.scalars(select(CrawlProductItem)).all(), [])
            self.assertEqual(session.scalars(select(JobEvent)).all(), [])
            links = session.scalars(select(ShopifyProductLink)).all()
            self.assertEqual(len(links), 1)
            self.assertEqual(links[0].source_key, source_key)

    def test_job_becomes_partial_only_after_product_pipeline_failure(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-ocean",
            "sourceKey": "amazon:B0FR4MSS2H:design:ocean",
            "parentAsin": "B0FR4MSS2H",
            "title": "Ocean",
        }
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )

        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "running")
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        status = self.store.fail_product_item(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            error={"message": "Shopify rejected the product."},
            retryable=False,
            reconciliation_required=False,
        )

        self.assertEqual(status, "failed")
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "partial")
        retried = self.store.retry_failed_syncs(str(job["id"]))
        self.assertEqual(retried["retried"], 1)
        self.assertEqual(retried["status"], "running")

        reconciliation_claim = self.store.claim_product_items(
            worker_id="worker-2", store_id="store-1", limit=1,
        )[0]
        reconciliation_status = self.store.fail_product_item(
            reconciliation_claim["id"],
            worker_id="worker-2",
            store_id="store-1",
            error={"message": "Shopify write state must be reconciled."},
            retryable=False,
            reconciliation_required=True,
        )
        reconciliation_retry = self.store.retry_failed_syncs(str(job["id"]))

        self.assertEqual(reconciliation_status, "reconciliation_required")
        self.assertEqual(reconciliation_retry["retried"], 1)
        self.assertEqual(reconciliation_retry["status"], "running")

    def test_seo_failure_is_public_and_does_not_advance_to_shopify(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-ocean",
            "sourceKey": "amazon:B0FR4MSS2H:design:ocean",
            "title": "Ocean",
        }
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.assertTrue(self.store.mark_product_seo(
            claim["id"],
            worker_id="worker-1",
            normalized_payload=product,
            seo_summary={"status": "running"},
        ))

        status = self.store.fail_product_item(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            error={"message": "SEO output validation failed.", "phase": "seo"},
            retryable=True,
            reconciliation_required=False,
        )
        public_product = self.store.job_products(str(job["id"]))["products"][0]

        self.assertEqual(status, "retry_wait")
        self.assertEqual(public_product["pipeline"]["status"], "retry_wait")
        self.assertEqual(public_product["pipeline"]["seo"]["status"], "failed")
        self.assertEqual(public_product["pipeline"]["seo"]["error"], "SEO output validation failed.")
        self.assertIsNone(public_product["pipeline"]["shopify"].get("productId"))
        self.assertEqual(self.store.get_job(str(job["id"]))["progress"]["phase"], "seo")

    def test_pipeline_failure_exposes_phase_timings_for_diagnostics(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-ocean",
            "sourceKey": "amazon:B0FR4MSS2H:design:ocean",
            "title": "Ocean",
        }
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        timings = {"normalizationMs": 2, "seoTotalMs": 1250, "totalMs": 1400}

        self.store.fail_product_item(
            claim["id"],
            worker_id="worker-1",
            store_id="store-1",
            error={"message": "SEO failed.", "phase": "seo", "timings": timings},
            retryable=False,
            reconciliation_required=False,
        )
        public_product = self.store.job_products(str(job["id"]))["products"][0]

        self.assertEqual(public_product["pipeline"]["shopify"]["timings"], {"pipeline": timings})


class CoordinatorDatabaseTests(unittest.TestCase):
    def test_sqlite_database_parent_is_created_for_local_development(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "nested" / "coordinator.sqlite3"
            engine = create_database_engine(f"sqlite:///{database_path.as_posix()}")
            try:
                Base.metadata.create_all(engine)
            finally:
                engine.dispose()

            self.assertTrue(database_path.is_file())


class CoordinatorApiTests(unittest.TestCase):
    def test_image_profile_preview_supports_unsaved_draft_and_job_pins_revision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            image_root = Path(directory) / "images"
            with patch.dict(os.environ, {"IMAGE_PROCESSING_CACHE_DIR": str(image_root)}):
                app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            source = BytesIO()
            Image.new("RGB", (40, 20), "#336699").save(source, format="PNG")
            data_url = "data:image/png;base64," + base64.b64encode(source.getvalue()).decode("ascii")
            draft = {
                "slug": "draft-profile",
                "name": "Draft profile",
                "enabled": True,
                "randomPixels": 0,
                "output": {"width": 64, "height": 64, "fit": "contain", "background": "#ffffff"},
            }

            with TestClient(app) as client:
                preview = client.post(
                    "/api/v1/image-profiles/draft-profile/preview",
                    json={"dataUrl": data_url, "profile": draft},
                )
                client.put("/api/v1/image-profiles/draft-profile", json=draft)
                saved = client.post(
                    "/api/v1/image-profiles/draft-profile/logo",
                    json={"dataUrl": data_url},
                ).json()
                logo = client.get("/api/v1/image-profiles/draft-profile/logo")
                job = client.post(
                    "/api/v1/crawl-jobs",
                    json={"urls": ["B0FR4MSS2H"], "imageProfileSlug": "draft-profile"},
                ).json()

            self.assertEqual(preview.status_code, 200)
            self.assertTrue(preview.json()["dataUrl"].startswith("data:image/jpeg;base64,"))
            self.assertEqual(logo.status_code, 200)
            self.assertEqual(logo.headers["content-type"], "image/png")
            self.assertEqual(logo.content, source.getvalue())
            self.assertEqual(job["settings"]["imageProfileSlug"], "draft-profile")
            self.assertEqual(job["settings"]["imageProfileRevision"], saved["revision"])

    def test_lan_frontend_origin_is_allowed_in_development(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                response = client.options(
                    "/api/v1/clients",
                    headers={
                        "Origin": "http://192.168.1.231:5173",
                        "Access-Control-Request-Method": "GET",
                    },
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["access-control-allow-origin"], "http://192.168.1.231:5173")

    def test_gzip_result_decompression_is_bounded(self) -> None:
        compressed = gzip.compress(b"x" * 1024)

        with self.assertRaises(ValueError):
            decompress_gzip_limited(compressed, maximum_bytes=128)

    def test_job_lifecycle_accepts_worker_result_and_exports_products(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                health = client.get("/api/v1/health").json()
                self.assertEqual(health["status"], "ok")
                self.assertEqual(health["apiVersion"], "v1")
                self.assertEqual(health["workerProtocolVersion"], "5")
                job = client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}).json()
                with client.websocket_connect("/api/v1/worker/connect") as websocket:
                    websocket.send_json(client_hello(slots=1))
                    websocket.receive_json()
                    assignment = websocket.receive_json()
                    envelope = {
                        "version": "distributed-1",
                        "taskId": assignment["taskId"],
                        "jobId": job["id"],
                        "leaseId": assignment["leaseId"],
                        "clientId": "client-a",
                        "status": "completed",
                        "products": [{"id": "product-1", "title": "Amazon title"}],
                        "errors": [],
                        "warnings": [],
                    }
                    response = client.put(
                        f"/api/v1/worker/tasks/{assignment['taskId']}/result",
                        content=gzip.compress(json.dumps(envelope).encode("utf-8")),
                        headers={
                            "Content-Encoding": "gzip",
                            "Content-Type": "application/json",
                            "X-Client-Id": "client-a",
                            "X-Lease-Id": assignment["leaseId"],
                            "X-Result-Checksum": payload_checksum(envelope),
                        },
                    )

                self.assertEqual(response.json()["status"], "accepted")
                self.assertEqual(client.get(f"/api/v1/crawl-jobs/{job['id']}").json()["status"], "running")
                claimed = client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "shopify-worker-1", "storeId": "store-test", "limit": 1},
                ).json()["items"][0]
                self.assertEqual(claimed["sourceKey"], "amazon:UNKNOWN:none:none")
                seo = client.post(
                    f"/api/v1/internal/product-pipeline/{claimed['id']}/seo",
                    json={
                        "workerId": "shopify-worker-1",
                        "normalizedProduct": {"id": "product-1", "title": "Amazon title"},
                        "seo": {"status": "running"},
                    },
                )
                self.assertEqual(seo.status_code, 200)
                self.assertEqual(
                    client.get(f"/api/v1/crawl-jobs/{job['id']}").json()["progress"]["phase"],
                    "seo",
                )
                syncing = client.post(
                    f"/api/v1/internal/product-pipeline/{claimed['id']}/syncing",
                    json={
                        "workerId": "shopify-worker-1",
                        "proxyProfile": "us-proxy-1",
                        "normalizedProduct": {"id": "product-1", "title": "Amazon title"},
                    },
                )
                self.assertEqual(syncing.status_code, 200)
                checkpoint = client.post(
                    f"/api/v1/internal/product-pipeline/{claimed['id']}/shopify-checkpoint",
                    json={
                        "workerId": "shopify-worker-1",
                        "storeId": "store-test",
                        "normalizedChecksum": "normalized-checksum-1",
                        "shopify": {
                            "productId": "gid://shopify/Product/1",
                            "productHandle": "amazon-title",
                            "managedResources": {},
                        },
                    },
                )
                self.assertEqual(checkpoint.status_code, 200)
                completed = client.post(
                    f"/api/v1/internal/product-pipeline/{claimed['id']}/complete",
                    json={
                        "workerId": "shopify-worker-1",
                        "storeId": "store-test",
                        "normalizedChecksum": "normalized-1",
                        "normalizedProduct": {"id": "product-1", "title": "Amazon title"},
                        "shopify": {
                            "productId": "gid://shopify/Product/1",
                            "productHandle": "amazon-title",
                            "seo": {
                                "status": "completed",
                                "engine": "heuristic",
                                "fieldsApplied": ["title", "media.alt"],
                                "fallbackStages": [],
                                "warnings": [],
                                "approvedKeywords": ["internal keyword"],
                                "approvedEmbeddings": {"internal keyword": [0.1, 0.2]},
                                "corpusRevision": 7,
                            },
                            "warnings": [],
                        },
                    },
                )
                self.assertEqual(completed.status_code, 200)
                self.assertEqual(client.get(f"/api/v1/crawl-jobs/{job['id']}").json()["status"], "completed")
                export = client.get(f"/api/v1/crawl-jobs/{job['id']}/export")
                self.assertEqual(export.status_code, 200)
                self.assertEqual(export.json()["products"][0]["id"], "product-1")
                self.assertEqual(export.json()["jobId"], job["id"])
                self.assertEqual(export.json()["statistics"]["products"], 1)
                self.assertEqual(export.json()["products"][0]["pipeline"]["status"], "completed")
                self.assertEqual(export.json()["products"][0]["pipeline"]["seo"]["status"], "completed")
                self.assertEqual(export.json()["products"][0]["pipeline"]["seo"]["engine"], "heuristic")
                self.assertNotIn("approvedKeywords", export.json()["products"][0]["pipeline"]["seo"])
                self.assertNotIn("approvedEmbeddings", export.json()["products"][0]["pipeline"]["seo"])
                self.assertNotIn("corpusRevision", export.json()["products"][0]["pipeline"]["seo"])
                self.assertNotIn("taskResults", export.json())

    def test_cache_clear_also_clears_server_image_cache_without_a_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                response = client.delete("/api/v1/clients/cache")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["requestedClients"], 0)
            self.assertIn("imageProcessing", response.json())

    def test_result_job_identity_must_match_the_leased_task(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]})
                with client.websocket_connect("/api/v1/worker/connect") as websocket:
                    websocket.send_json(client_hello(slots=1))
                    websocket.receive_json()
                    assignment = websocket.receive_json()
                    envelope = {
                        "version": "distributed-1",
                        "taskId": assignment["taskId"],
                        "jobId": "wrong-job",
                        "leaseId": assignment["leaseId"],
                        "clientId": "client-a",
                        "status": "completed",
                        "products": [],
                        "errors": [],
                        "warnings": [],
                    }
                    response = client.put(
                        f"/api/v1/worker/tasks/{assignment['taskId']}/result",
                        content=gzip.compress(json.dumps(envelope).encode("utf-8")),
                        headers={
                            "Content-Encoding": "gzip",
                            "Content-Type": "application/json",
                            "X-Client-Id": "client-a",
                            "X-Lease-Id": assignment["leaseId"],
                            "X-Result-Checksum": payload_checksum(envelope),
                        },
                    )

                self.assertEqual(response.status_code, 400)
                self.assertIn("job", response.json()["detail"].casefold())

    def test_result_envelope_identity_must_match_route_and_headers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                job = client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}).json()
                with client.websocket_connect("/api/v1/worker/connect") as websocket:
                    websocket.send_json(client_hello(slots=1))
                    self.assertEqual(websocket.receive_json()["type"], "hello_ack")
                    assignment = websocket.receive_json()

                    envelope = {
                        "version": "distributed-1",
                        "taskId": "another-task",
                        "jobId": job["id"],
                        "leaseId": assignment["leaseId"],
                        "clientId": "client-a",
                        "status": "completed",
                        "products": [],
                        "errors": [],
                        "warnings": [],
                    }
                    raw = json.dumps(envelope).encode("utf-8")
                    response = client.put(
                        f"/api/v1/worker/tasks/{assignment['taskId']}/result",
                        content=gzip.compress(raw),
                        headers={
                            "Content-Encoding": "gzip",
                            "Content-Type": "application/json",
                            "X-Client-Id": "client-a",
                            "X-Lease-Id": assignment["leaseId"],
                            "X-Result-Checksum": payload_checksum(envelope),
                        },
                    )

                self.assertEqual(response.status_code, 400)
                self.assertIn("identity", response.json()["detail"].casefold())


class CoordinatorUploadLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_compressed_request_body_is_rejected_while_streaming(self) -> None:
        class FakeRequest:
            async def stream(self):
                yield b"1234"
                yield b"5678"

        with self.assertRaises(ValueError):
            await read_request_body_limited(FakeRequest(), maximum_bytes=6)


if __name__ == "__main__":
    unittest.main()
