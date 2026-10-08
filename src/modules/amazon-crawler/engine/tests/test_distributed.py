from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import threading
import unittest
import asyncio
import base64
import os
import time
import urllib.error
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch

import websockets
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import delete, select

from engine.distributed import AGENT_VERSION
from engine.crawler_core import CrawlSettings
from engine.cache import RawFamilyCache
from engine.distributed.client_store import ClientStore
from engine.distributed.client_agent import (
    DistributedCrawlerAgent,
    progress_for_assignment,
    progress_targets,
    refresh_requested_family_caches,
)
from engine.distributed.client_config import AgentConfig
from engine.distributed.client_main import _configure_packaged_browser, _resolve_config_path
from engine.distributed.instance_lock import AgentAlreadyRunningError, AgentInstanceLock
from engine.distributed.client_tray import TrayApplication, format_status, should_notify_captcha
from engine.distributed.coordinator_models import (
    AmazonAsinRegistry,
    Base,
    ClientRecord,
    CoordinatorState,
    CrawlJob,
    CrawlProductItem,
    CrawlTask,
    JobEvent,
    ShopifyOperationIdempotency,
    ShopifyProductLink,
    TaskAttempt,
    TaskResult,
    create_database_engine,
    create_session_factory,
)
from engine.distributed.coordinator_server import ConnectionManager, create_coordinator_app, decompress_gzip_limited, read_request_body_limited
from engine.distributed.coordinator_store import ActiveJobExistsError, CoordinatorStore, ProductPipelineActiveError
from engine.distributed.protocol import AgentLimits, hello_message, payload_checksum, settings_fingerprint, utc_iso, utc_now
from engine.proxy_profiles import resolve_proxy_assignments
from engine.tests.test_core import cache_family, cache_partial
from engine.tests.coordinator_test_support import create_coordinator_test_schema


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
        self.assertFalse(hello["capabilities"]["pinterestBrowserLoggedIn"])

        logged_in_hello = hello_message(
            client_id="client-b",
            display_name="Crawler B",
            available_slots=1,
            max_concurrent_inputs=1,
            limits=AgentLimits(),
            pinterest_browser_logged_in=True,
        )
        self.assertTrue(logged_in_hello["capabilities"]["pinterestBrowserLoggedIn"])

    def test_agent_reports_safe_live_pinterest_task_activity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = AgentConfig(
                server_url="http://127.0.0.1:8766",
                display_name="Crawler A",
                max_concurrent_inputs=2,
                limits=AgentLimits(),
                data_directory=root / "data",
            )
            agent = DistributedCrawlerAgent(project_root=root, config=config)
            agent.active["task-pin-1"] = {
                "taskId": "task-pin-1",
                "jobId": "job-pin-1",
                "leaseId": "lease-secret",
                "channel": "pinterest",
                "action": "crawl_and_review",
                "source": "leather bag",
                "settings": {
                    "channel": "pinterest",
                    "niche": "leather bag",
                    "product": "bag",
                    "custom_queries": ["vintage floral vector", "western leather pattern"],
                    "access_token": "must-not-be-exposed",
                },
            }
            agent._update_task_activity("task-pin-1", "Downloading image 12/40", 30)

            task = agent._current_tasks_snapshot()[0]

            self.assertEqual(task["jobId"], "job-pin-1")
            self.assertEqual(task["niche"], "leather bag")
            self.assertEqual(task["queryCount"], 2)
            self.assertEqual(task["message"], "Downloading image 12/40")
            self.assertNotIn("access_token", task)


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

    def test_tray_login_reports_success_and_refreshes_agent_status(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "src" / "modules" / "pinterest-pod" / "server" / "pinterest" / "pinterest_browser_login.py"
            script.parent.mkdir(parents=True)
            script.write_text("", encoding="utf-8")

            class FakeAgent:
                project_root = root

                @staticmethod
                def status_snapshot():
                    return {"connection": "online", "activeTasks": 0, "pendingUploads": 0, "capabilities": {"pinterestBrowserLoggedIn": True}}

                @staticmethod
                def pinterest_browser_logged_in():
                    return True

            tray = TrayApplication(FakeAgent(), root)
            notifications: list[str] = []
            tray._notify = lambda message, title="FFP Crawler Agent": notifications.append(message)
            with patch("engine.distributed.client_tray.subprocess.run") as run:
                run.return_value.returncode = 0
                tray._run_pinterest_action("login")

            self.assertTrue(any("thành công" in message for message in notifications))
            run.assert_called_once()

    def test_lifecycle_confirmation_is_deferred_until_native_menu_closes(self) -> None:
        action = Mock()
        timer = Mock()
        with patch("engine.distributed.client_tray.threading.Timer", return_value=timer) as timer_factory:
            TrayApplication._defer_menu_action(action, name="ffp-test-confirm")

        timer_factory.assert_called_once_with(0.2, action)
        self.assertEqual(timer.name, "ffp-test-confirm")
        self.assertTrue(timer.daemon)
        timer.start.assert_called_once_with()
        action.assert_not_called()

    def test_update_does_not_reinstall_when_agent_is_current(self) -> None:
        tray = object.__new__(TrayApplication)
        tray._check_for_update = Mock(return_value=AGENT_VERSION)
        tray._notify = Mock()
        tray._confirm = Mock(return_value=True)
        tray._launch_lifecycle_script = Mock()

        tray._run_update_agent()

        tray._notify.assert_called_once_with(
            f"Agent {AGENT_VERSION} hiện là phiên bản mới nhất. Không cần cập nhật."
        )
        tray._confirm.assert_not_called()
        tray._launch_lifecycle_script.assert_not_called()

    def test_update_refuses_unverified_legacy_source_installer(self) -> None:
        tray = object.__new__(TrayApplication)
        tray.agent = Mock()
        tray.agent.config.server_url = "http://coordinator.test"
        tray.agent.project_root = Path("C:/FFP/CrawlerAgent")
        tray._check_for_update = Mock(return_value="99.0.0")
        tray._lifecycle_action_running = False
        tray._latest_release_payload = None
        tray._loop = None
        tray._lifecycle_is_safe = Mock(return_value=True)
        tray._confirm = Mock(return_value=True)
        tray._launch_lifecycle_script = Mock()
        tray._icon = None
        tray._notify = Mock()

        tray._run_update_agent()

        tray._notify.assert_called_once()
        self.assertIn("chưa hoàn tất", tray._notify.call_args.args[0])
        tray._confirm.assert_called_once()
        tray._launch_lifecycle_script.assert_not_called()


class PackagedClientTests(unittest.TestCase):
    def test_agent_data_directory_allows_only_one_running_instance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = AgentInstanceLock(Path(directory))
            second = AgentInstanceLock(Path(directory))
            with first:
                with self.assertRaises(AgentAlreadyRunningError):
                    with second:
                        pass
            with second:
                self.assertTrue((Path(directory) / "agent.lock").exists())

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

    def test_default_data_directory_is_scoped_by_coordinator_origin(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"PROGRAMDATA": directory}, clear=True,
        ):
            first_path = Path(directory) / "first.json"
            second_path = Path(directory) / "second.json"
            equivalent_path = Path(directory) / "equivalent.json"
            first_path.write_text(json.dumps({"serverUrl": "https://crawler-a.test"}), encoding="utf-8")
            second_path.write_text(json.dumps({"serverUrl": "https://crawler-b.test"}), encoding="utf-8")
            equivalent_path.write_text(json.dumps({"serverUrl": "https://CRAWLER-A.test:443/path"}), encoding="utf-8")

            first = AgentConfig.load(first_path)
            second = AgentConfig.load(second_path)
            equivalent = AgentConfig.load(equivalent_path)

            self.assertNotEqual(first.data_directory, second.data_directory)
            self.assertEqual(first.data_directory, equivalent.data_directory)
            self.assertEqual(first.data_directory.parent.name, "servers")

    def test_explicit_data_directory_is_not_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            configured_data = root / "shared-by-explicit-choice"
            config_path = root / "agent.json"
            config_path.write_text(json.dumps({
                "serverUrl": "https://crawler.test",
                "dataDirectory": str(configured_data),
            }), encoding="utf-8")

            self.assertEqual(AgentConfig.load(config_path).data_directory, configured_data)

    def test_agent_config_keeps_only_valid_out_of_band_signer_pins(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "agent.json"
            pin = "A" * 40
            config_path.write_text(json.dumps({"serverUrl": "https://crawler.example",
                "trustedSignerThumbprints": [pin.lower()]}), encoding="utf-8")
            config = AgentConfig.load(config_path)
            self.assertEqual(config.config_file_path, config_path.resolve())
            self.assertEqual(config.trusted_signer_thumbprints, (pin,))

            config_path.write_text(json.dumps({"serverUrl": "https://crawler.example",
                "trustedSignerThumbprints": ["not-a-certificate"]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid certificate thumbprint"):
                AgentConfig.load(config_path)

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
    async def test_connection_manager_keeps_existing_socket_when_client_id_reconnects(self) -> None:
        manager = ConnectionManager()

        class FakeSocket:
            pass

        first = FakeSocket()
        duplicate = FakeSocket()
        self.assertTrue(await manager.add("client-a", first))
        self.assertFalse(await manager.add("client-a", duplicate))
        self.assertEqual(await manager.connected_client_ids(), {"client-a"})
        self.assertFalse(await manager.remove("client-a", duplicate))
        self.assertTrue(await manager.remove("client-a", first))
        self.assertEqual(await manager.connected_client_ids(), set())

    async def test_connection_manager_reports_live_tasks_separately_from_database_leases(self) -> None:
        manager = ConnectionManager()

        class FakeSocket:
            async def close(self, **_kwargs):
                return None

        socket = FakeSocket()
        await manager.add("client-a", socket)
        await manager.update_runtime(
            "client-a",
            active_tasks=2,
            available_slots=2,
            current_tasks=[{
                "taskId": "task-pin-1",
                "jobId": "job-pin-1",
                "channel": "pinterest",
                "niche": "leather bag",
                "message": "Downloading images",
                "percent": 40,
            }],
            executing_task_ids=["task-pin-1"],
            capabilities={"pinterest": True, "pinterestBrowserLoggedIn": True, "secret": "ignored"},
        )
        await manager.reserve_tasks("client-a", 1)

        self.assertEqual(await manager.runtime_snapshot(), {
            "client-a": {
                "activeTasks": 3,
                "availableSlots": 1,
                "readyForTasks": False,
                "currentTasks": [{
                    "taskId": "task-pin-1",
                    "jobId": "job-pin-1",
                    "channel": "pinterest",
                    "niche": "leather bag",
                    "message": "Downloading images",
                    "percent": 40,
                }],
                "executingTaskIds": ["task-pin-1"],
                "capabilities": {"pinterest": True, "pinterestBrowserLoggedIn": True},
            },
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
            cache.save("B012345678", cache_family())
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

    async def test_reconnect_after_job_cancel_replays_cleanup_ack(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )
            assignment = {
                "taskId": "task-1", "jobId": "job-1", "leaseId": "lease-1",
                "settingsFingerprint": "fixture",
            }
            agent.store.save_assignment(assignment)
            agent.active["task-1"] = assignment

            await agent._apply_reconciliation({
                "cancelledJobIds": ["job-1"],
                "discardTaskIds": ["task-1"],
                "requiredCacheGeneration": 0,
            })

            messages = []
            while True:
                message = await asyncio.wait_for(agent.outbound_queue.get(), timeout=2)
                messages.append(message)
                if message["type"] == "stop_cleanup_ack":
                    break
            await asyncio.sleep(0)

            cleanup_ack = next(message for message in messages if message["type"] == "stop_cleanup_ack")
            self.assertEqual(cleanup_ack["jobId"], "job-1")
            self.assertEqual(cleanup_ack["cacheGeneration"], 0)
            self.assertNotIn("job-1", agent._pending_stop_cleanups)
            self.assertEqual(agent.store.recover_assignments(), [])

    async def test_explicit_clear_removes_cache_even_if_agent_generation_is_ahead(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            cache.save("B012345678", cache_family())
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )
            agent.store.set_cache_generation(5)

            response = await agent.clear_local_cache("request-1", generation=1)

            self.assertEqual(response["removedFiles"], 1)
            self.assertIsNone(cache.load("B012345678"))
            self.assertEqual(agent.store.cache_generation(), 5)

    async def test_stop_cleanup_keeps_successful_and_partial_product_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            cache.save("B012345678", cache_family())
            cache.save_partial("B012345679", cache_partial())
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )
            agent._pending_stop_cleanups["other-job"] = 0

            await agent._complete_stop_cleanup("other-job", 0)

            self.assertIsNotNone(cache.load("B012345678"))
            self.assertIsNotNone(cache.load_partial("B012345679"))
            acknowledgement = await agent.outbound_queue.get()
            self.assertEqual(acknowledgement["type"], "stop_cleanup_ack")
            self.assertEqual(acknowledgement["removedFiles"], 0)

    async def test_product_invalidation_removes_only_selected_asin_and_zip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            selected_key = "B012345678:10001:us-v1"
            other_zip_key = "B012345678:90001:us-v1"
            other_asin_key = "B012345679:10001:us-v1"
            for key in (selected_key, other_zip_key, other_asin_key):
                cache.save(key, cache_family())
            cache.save_failure(selected_key, status="network_error", reason="network_error", retry_after_seconds=30)
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )

            response = await agent.invalidate_product_cache("request-1", "B012345678", "10001", 1)

            self.assertEqual(response["removedFiles"], 2)
            self.assertIsNone(cache.load(selected_key))
            self.assertIsNone(cache.load_partial(selected_key))
            self.assertIsNotNone(cache.load(other_zip_key))
            self.assertIsNotNone(cache.load(other_asin_key))
            self.assertEqual(agent.store.product_invalidation_generation(), 1)

    async def test_reconnecting_agent_applies_saved_product_invalidation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            key = "B012345678:10001:us-v1"
            cache.save(key, cache_family())
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )

            await agent._apply_reconciliation({
                "productInvalidations": [{"asin": "B012345678", "amazonZip": "10001", "generation": 3}],
            })

            self.assertIsNone(cache.load(key))
            self.assertEqual(agent.store.product_invalidation_generation(), 3)

    async def test_failed_product_invalidation_reconnects_before_accepting_later_jobs(self) -> None:
        class FakeWebSocket:
            def __aiter__(self):
                return self

            async def __anext__(self) -> str:
                if getattr(self, "sent", False):
                    raise StopAsyncIteration
                self.sent = True
                return json.dumps({
                    "type": "invalidate_product_cache", "requestId": "request-1",
                    "asin": "B012345678", "amazonZip": "10001", "generation": 1,
                })

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            key = "B012345678:10001:us-v1"
            cache.save(key, cache_family())
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )

            with patch.object(RawFamilyCache, "invalidate", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    await agent._receiver(FakeWebSocket())
            self.assertEqual(agent.store.product_invalidation_generation(), 0)
            self.assertIsNotNone(cache.load(key))

            await agent._apply_reconciliation({
                "productInvalidations": [{"asin": "B012345678", "amazonZip": "10001", "generation": 1}],
            })
            self.assertIsNone(cache.load(key))

    async def test_reconnecting_agent_applies_explicit_clear_all_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            key = "B012345678:10001:us-v1"
            cache.save(key, cache_family())
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )

            await agent._apply_reconciliation({"requiredCacheGeneration": 1})

            self.assertIsNone(cache.load(key))
            self.assertEqual(agent.store.cache_generation(), 1)
            self.assertEqual((await agent.outbound_queue.get())["type"], "cache_generation_ack")

    async def test_temporary_cleanup_preserves_product_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            cache.save("B012345678:10001:us-v1", cache_family())
            temporary_file = cache.directory / ".amazon-cache-abandoned.tmp"
            temporary_file.write_text("partial write", encoding="utf-8")
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )
            agent.store.save_assignment({
                "taskId": "orphan-task", "jobId": "deleted-job", "leaseId": "lease-1",
                "settingsFingerprint": "fingerprint", "source": "B012345678",
            })
            agent.store.save_assignment({
                "taskId": "valid-task", "jobId": "retained-job", "leaseId": "lease-2",
                "settingsFingerprint": "fingerprint", "source": "B012345679",
            })
            agent.store.spool_result(
                task_id="orphan-task", lease_id="lease-1", checksum="checksum-1", payload={"status": "completed"},
            )
            agent.store.spool_result(
                task_id="valid-task", lease_id="lease-2", checksum="checksum-2", payload={"status": "completed"},
            )
            agent.store.spool_result(
                task_id="valid-unleased", lease_id="lease-3", checksum="checksum-3",
                payload={"jobId": "retained-job", "status": "completed"},
            )
            agent.store.spool_result(
                task_id="orphan-unleased", lease_id="lease-4", checksum="checksum-4",
                payload={"jobId": "deleted-spool-job", "status": "completed"},
            )
            agent.store.spool_product(
                task_id="valid-product-unleased", product_key="product-1", lease_id="lease-5",
                checksum="checksum-5", payload={"jobId": "retained-job", "product": {}},
            )

            response = await agent.clear_temporary_data("request-1", {"retained-job"})

            self.assertEqual(response["discardedJobs"], 2)
            self.assertEqual(response["removedFiles"], 0)
            self.assertFalse(temporary_file.exists())
            self.assertGreaterEqual(agent.status_snapshot()["cache"]["temporaryRemoved"], 1)
            self.assertEqual([task["taskId"] for task in agent.store.local_tasks()], ["valid-task"])
            self.assertEqual(
                {row["taskId"] for row in agent.store.pending_results()},
                {"valid-task", "valid-unleased"},
            )
            self.assertEqual(
                {row["taskId"] for row in agent.store.pending_products()},
                {"valid-product-unleased"},
            )
            self.assertIsNotNone(cache.load("B012345678:10001:us-v1"))

    async def test_reconnecting_agent_applies_saved_temporary_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = RawFamilyCache(root / ".runtime" / "cache")
            cache.save("B012345678:10001:us-v1", cache_family())
            temporary_file = cache.directory / ".amazon-cache-abandoned.tmp"
            temporary_file.write_text("partial write", encoding="utf-8")
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:8766", display_name="test",
                    max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / "agent-data",
                ),
            )
            agent.store.save_assignment({
                "taskId": "orphan-task", "jobId": "deleted-job", "leaseId": "lease-1",
                "settingsFingerprint": "fingerprint", "source": "B012345678",
            })

            await agent._apply_reconciliation({
                "requiredTemporaryCleanupGeneration": 2, "validJobIds": [],
            })

            self.assertEqual(agent.store.local_tasks(), [])
            self.assertFalse(temporary_file.exists())
            self.assertIsNotNone(cache.load("B012345678:10001:us-v1"))
            self.assertEqual(agent.store.temporary_cleanup_generation(), 2)


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

    def test_pending_product_survives_restart_and_rejects_changed_content(self) -> None:
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
            with self.assertRaisesRegex(ValueError, "content"):
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
            self.assertEqual(pending[0]["checksum"], "first-checksum")
            self.assertEqual(pending[0]["payload"]["product"]["title"], "First")
            self.assertTrue(restarted.has_pending_products("task-1"))

            restarted.acknowledge_product(pending[0]["resultId"])
            self.assertFalse(restarted.has_pending_products("task-1"))


class ClientAgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_product_upload_not_found_is_not_an_acknowledgement(self) -> None:
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
                with self.assertRaises(urllib.error.HTTPError):
                    agent._upload_product(product)
            self.assertEqual(len(agent.store.pending_products()), 1)

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

    async def test_cancelled_upload_response_preserves_unacknowledged_task_state(self) -> None:
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
            self.assertEqual(len(agent.store.pending_products()), 0)
            self.assertEqual(agent.store.upload_counts()["products"], 2)
            self.assertEqual(len(agent.store.quarantined_uploads()), 2)
            self.assertEqual(len(agent.store.recover_assignments()), 1)
            self.assertIn("missing-task", agent.active)

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

    def test_task_cancellation_sets_only_the_selected_task_event(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="test-agent", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            selected = threading.Event()
            sibling = threading.Event()
            agent.active["task-1"] = {"taskId": "task-1", "jobId": "job-1", "leaseId": "lease-1"}
            agent.active["task-2"] = {"taskId": "task-2", "jobId": "job-1", "leaseId": "lease-2"}
            agent.task_cancel_events.update({"task-1": selected, "task-2": sibling})

            self.assertTrue(agent._cancel_task("task-1", "lease-1"))

            self.assertTrue(selected.is_set())
            self.assertFalse(sibling.is_set())
            self.assertFalse(agent._cancel_task("task-1", "stale-lease"))

    def test_preexisting_task_cancel_does_not_cancel_sibling_event_during_registration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="test-agent", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            for task_id, lease_id in (("task-1", "lease-1"), ("task-2", "lease-2")):
                assignment = {
                    "taskId": task_id, "jobId": "job-1", "leaseId": lease_id,
                    "settingsFingerprint": "settings-1",
                }
                agent.store.save_assignment(assignment)
                agent.active[task_id] = assignment
            agent.store.cancel_task("task-1")
            selected = threading.Event()
            sibling = threading.Event()

            agent._register_cancel_event("job-1", selected, "task-1")
            agent._register_cancel_event("job-1", sibling, "task-2")

            self.assertTrue(selected.is_set())
            self.assertFalse(sibling.is_set())

    def test_default_amazon_batch_uses_one_disposable_worker_per_task(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AgentConfig(
                server_url="http://127.0.0.1:9999", display_name="test-agent", max_concurrent_inputs=2,
                limits=AgentLimits(), data_directory=Path(directory),
            )
            agent = DistributedCrawlerAgent(project_root=Path(directory), config=config)
            events = {"task-1": threading.Event(), "task-2": threading.Event()}
            agent.task_cancel_events.update(events)
            observed: list[tuple[list[str], threading.Event]] = []

            def capture(batch, event, _loop):
                observed.append(([str(value["taskId"]) for value in batch], event))

            assignments = [
                {"taskId": task_id, "jobId": "job-1", "leaseId": f"lease-{index}", "settings": {}}
                for index, task_id in enumerate(events, start=1)
            ]
            loop = asyncio.new_event_loop()
            try:
                with patch.object(agent, "_run_batch_group", side_effect=capture):
                    agent._run_batch(assignments, threading.Event(), loop)
            finally:
                loop.close()

            self.assertEqual({tuple(task_ids) for task_ids, _event in observed}, {("task-1",), ("task-2",)})
            self.assertEqual({id(event) for _task_ids, event in observed}, {id(event) for event in events.values()})

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
            self.assertEqual((await asyncio.wait_for(agent.outbound_queue.get(), 1))["type"], "cancel_ack")
            self.assertEqual((await asyncio.wait_for(agent.outbound_queue.get(), 1))["type"], "stop_cleanup_ack")

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

    async def test_local_pause_interrupts_active_task_and_requests_lease_release(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            agent = DistributedCrawlerAgent(
                project_root=root,
                config=AgentConfig(
                    server_url="http://127.0.0.1:9999",
                    display_name="test-agent",
                    max_concurrent_inputs=1,
                    limits=AgentLimits(),
                    data_directory=root,
                ),
            )
            assignment = {
                "type": "assignment",
                "taskId": "task-pause",
                "jobId": "job-pause",
                "leaseId": "lease-pause",
                "source": "B0FR4MSS2H",
                "asin": "B0FR4MSS2H",
                "url": "https://www.amazon.com/dp/B0FR4MSS2H",
                "settings": {},
                "settingsFingerprint": "settings-pause",
            }
            agent.store.save_assignment(assignment)
            agent.active["task-pause"] = assignment
            cancel_event = threading.Event()
            agent.task_cancel_events["task-pause"] = cancel_event
            agent._is_connected = True

            agent.set_paused(True)

            self.assertTrue(cancel_event.is_set())
            self.assertEqual(agent.status_snapshot()["releasingTasks"], 1)
            release_loop = asyncio.create_task(agent._pause_release_loop())
            try:
                release = await asyncio.wait_for(agent.outbound_queue.get(), timeout=1)
            finally:
                release_loop.cancel()
                await asyncio.gather(release_loop, return_exceptions=True)
            self.assertEqual(release, {
                "type": "release_task",
                "taskId": "task-pause",
                "leaseId": "lease-pause",
                "reason": "AGENT_PAUSED",
            })

            await agent._acknowledge_pause_release({
                "type": "release_task_ack",
                "taskId": "task-pause",
                "leaseId": "lease-pause",
                "status": "released",
            })

            self.assertNotIn("task-pause", agent.active)
            self.assertEqual(agent.store.recover_assignments(), [])
            self.assertEqual(agent.status_snapshot()["availableSlots"], 0)

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
                    "completedAsins": ["B0FR4MSS2H"],
                    "failedAsins": [],
                    "retryableAsins": [],
                    "nonRetryableAsins": [],
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
            self.assertEqual(pending_results[0]["payload"]["completedAsins"], ["B0FR4MSS2H"])

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

    def test_incremental_family_assignment_invalidates_only_its_seed_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            selected_key = "B012345678:90001:us-v1"
            retained_key = "B098765432:90001:us-v1"
            cache.save(selected_key, cache_family())
            cache.save(retained_key, cache_family())

            removed = refresh_requested_family_caches(
                cache,
                [{"asin": "B012345678"}, {"asin": "B000000001"}],
                {"amazonZip": "90001", "refreshFamilyAsins": ["B012345678"]},
            )

            self.assertGreaterEqual(removed["removedFiles"], 1)
            self.assertIsNone(cache.load(selected_key))
            self.assertIsNotNone(cache.load(retained_key))

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
            agent._is_connected = True
            agent._recovery_complete = True
            agent._approved_attempts.add(("task-1", "lease-1"))
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
        create_coordinator_test_schema(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)

    def tearDown(self) -> None:
        self.engine.dispose()
        self.temporary_directory.cleanup()

    def test_degraded_worker_health_is_persisted_as_bounded_agent_telemetry(self) -> None:
        self.store.register_client(client_hello(slots=8))
        self.store.heartbeat("client-a", [], "degraded", telemetry={
            "workerHealth": {
                "state": "degraded", "failuresInWindow": 5, "failureLimit": 5,
                "windowSeconds": 600, "configuredConcurrency": 8, "effectiveConcurrency": 4,
                "lastFailureAt": "2026-10-05T12:00:00+00:00", "secret": "must-not-persist",
            },
        })

        client = self.store.list_clients()[0]
        self.assertEqual(client["status"], "degraded")
        self.assertEqual(client["observability"]["workerHealth"]["state"], "degraded")
        self.assertEqual(client["observability"]["workerHealth"]["effectiveConcurrency"], 4)
        self.assertNotIn("secret", client["observability"]["workerHealth"])

    def _create_four_task_job(self) -> dict[str, object]:
        return self.store.create_job({
            "urls": ["B0FR4MSS2H", "B0HG4NRG98", "B0GVDXGVVB", "B0GQ33XWW7"],
            "productThreads": 4,
        })

    def test_job_stops_tracking_after_every_product_reaches_seo_queue(self) -> None:
        job = self.store.create_job({"urls": ["B0REVIEW01", "B0REVIEW02"]})
        with self.sessions.begin() as session:
            tasks = session.scalars(select(CrawlTask).where(CrawlTask.job_id == job["id"])).all()
            for index, task in enumerate(tasks):
                task.status = "completed"
                session.add(CrawlProductItem(
                    id=f"review-item-{index}", job_id=job["id"], task_id=task.id,
                    source_key=f"source-{index}", product_id=f"product-{index}",
                    client_id="client-a", lease_id="lease-a", checksum=f"checksum-{index}",
                    raw_payload={}, normalized_payload={"media": []},
                    status="waiting_review" if index == 0 else "seo",
                    shopify_result={"review": {"decision": "pending"}} if index == 0 else {},
                ))
            session.flush()
            self.store._refresh_job(session, str(job["id"]))

        in_progress = self.store.get_job(str(job["id"]))
        self.assertEqual(in_progress["status"], "running")
        self.assertEqual(in_progress["seoQueueHandoff"], {
            "totalProducts": 2, "handedOver": 1, "pending": 1, "notHandedOver": 0,
        })
        self.assertEqual([item["id"] for item in self.store.list_product_reviews()], ["review-item-0"])
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, "review-item-1")
            item.status = "waiting_review"
            item.shopify_result = {"review": {"decision": "pending"}}
            session.flush()
            self.store._refresh_job(session, str(job["id"]))
        complete = self.store.get_job(str(job["id"]))
        self.assertEqual(complete["status"], "review_pending")
        self.assertIn("Đã bàn giao 2/2 sản phẩm sang SEO Queue", complete["progress"]["message"])

    def test_external_seo_handoff_finishes_crawler_job_without_stopping_pipeline_claims(self) -> None:
        job = self.store.create_job({"urls": ["B0HANDOFF1", "B0HANDOFF2"]})
        with self.sessions.begin() as session:
            tasks = session.scalars(select(CrawlTask).where(CrawlTask.job_id == job["id"])).all()
            for index, task in enumerate(tasks):
                task.status = "completed"
                session.add(CrawlProductItem(
                    id=f"handoff-item-{index}", job_id=job["id"], task_id=task.id,
                    source_key=f"handoff-source-{index}", product_id=f"handoff-product-{index}",
                    client_id="client-a", lease_id="lease-a", checksum=f"handoff-checksum-{index}",
                    raw_payload={}, normalized_payload={"media": []}, status="retry_wait",
                    shopify_result={"externalSeo": {"jobId": f"seo-job-{index}", "provider": "codex_mcp"}},
                    next_attempt_at=utc_now() - timedelta(seconds=1),
                ))
            session.flush()
            self.store._refresh_job(session, str(job["id"]))

        complete = self.store.get_job(str(job["id"]))
        self.assertEqual(complete["status"], "review_pending")
        self.assertEqual(complete["seoQueueHandoff"], {
            "totalProducts": 2, "handedOver": 2, "pending": 0, "notHandedOver": 0,
        })

        claimed = self.store.claim_product_items(
            worker_id="pipeline-worker", store_id="preaureum_dev", limit=2,
        )

        self.assertEqual(len(claimed), 2)
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "review_pending")

    def test_archiving_handed_off_job_hides_history_without_deleting_pipeline_items(self) -> None:
        job = self.store.create_job({"urls": ["B0ARCHIVE1"], "storeId": "preaureum_dev"})
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job["id"]))
            task.status = "completed"
            session.add(CrawlProductItem(
                id="archive-item", job_id=job["id"], task_id=task.id,
                source_key="archive-source", product_id="archive-product",
                client_id="client-a", lease_id="lease-a", checksum="archive-checksum",
                raw_payload={}, normalized_payload={"media": []}, status="retry_wait",
                shopify_result={"externalSeo": {"jobId": "seo-job", "provider": "codex_mcp"}},
                next_attempt_at=utc_now() - timedelta(seconds=1),
            ))
            session.flush()
            self.store._refresh_job(session, str(job["id"]))

        self.assertTrue(self.store.archive_job(str(job["id"])))
        self.assertEqual(self.store.list_jobs(), [])
        self.assertIsNotNone(self.store.get_job(str(job["id"])))
        claimed = self.store.claim_product_items(
            worker_id="pipeline-worker", store_id="preaureum_dev", limit=1,
        )
        self.assertEqual([item["id"] for item in claimed], ["archive-item"])

    def test_hard_delete_rejects_handed_off_nonterminal_pipeline_item(self) -> None:
        job = self.store.create_job({"urls": ["B0SAFEDEL1"]})
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job["id"]))
            task.status = "completed"
            session.add(CrawlProductItem(
                id="protected-item", job_id=job["id"], task_id=task.id,
                source_key="protected-source", product_id="protected-product",
                client_id="client-a", lease_id="lease-a", checksum="protected-checksum",
                raw_payload={}, normalized_payload={"media": []}, status="retry_wait",
                shopify_result={"externalSeo": {"jobId": "seo-job", "provider": "codex_mcp"}},
                next_attempt_at=utc_now() - timedelta(seconds=1),
            ))

        with self.assertRaises(ProductPipelineActiveError):
            self.store.delete_job(str(job["id"]))
        self.assertIsNotNone(self.store.get_job(str(job["id"])))

    def test_delete_all_reviews_hides_ready_items_but_skips_active_sync(self) -> None:
        job = self.store.create_job({"urls": ["B0REVIEW01", "B0REVIEW02"]})
        with self.sessions.begin() as session:
            tasks = session.scalars(select(CrawlTask).where(CrawlTask.job_id == job["id"])).all()
            for index, task in enumerate(tasks):
                task.status = "completed"
                session.add(CrawlProductItem(
                    id=f"delete-item-{index}", job_id=job["id"], task_id=task.id,
                    source_key=f"delete-source-{index}", product_id=f"product-{index}",
                    client_id="client-a", lease_id="lease-a", checksum=f"checksum-{index}",
                    raw_payload={}, normalized_payload={"media": []},
                    status="waiting_review" if index == 0 else "syncing",
                    shopify_result={"review": {"decision": "approved", "syncStatus": "idle" if index == 0 else "syncing"}},
                ))
            session.flush()
            self.store._refresh_job(session, str(job["id"]))

        outcome = self.store.delete_all_product_reviews()

        self.assertEqual(outcome, {"deleted": 1, "skipped": 1})
        self.assertEqual([item["id"] for item in self.store.list_product_reviews()], ["delete-item-1"])
        self.assertEqual(self.store.queue_product_review_sync("delete-item-0"), {"deleted": True})

    def test_delete_review_hides_only_the_requested_ready_item(self) -> None:
        job = self.store.create_job({"urls": ["B0REVIEW01", "B0REVIEW02"]})
        with self.sessions.begin() as session:
            tasks = session.scalars(select(CrawlTask).where(CrawlTask.job_id == job["id"])).all()
            for index, task in enumerate(tasks):
                task.status = "completed"
                session.add(CrawlProductItem(
                    id=f"single-delete-{index}", job_id=job["id"], task_id=task.id,
                    source_key=f"single-source-{index}", product_id=f"single-product-{index}",
                    client_id="client-a", lease_id="lease-a", checksum=f"single-checksum-{index}",
                    raw_payload={}, normalized_payload={"media": []}, status="waiting_review",
                    shopify_result={"review": {"decision": "pending", "syncStatus": "idle"}},
                ))
            session.flush()
            self.store._refresh_job(session, str(job["id"]))

        self.assertEqual(self.store.delete_product_review("single-delete-0"), {"deleted": True})
        self.assertEqual([item["id"] for item in self.store.list_product_reviews()], ["single-delete-1"])
        self.assertEqual(self.store.delete_product_review("single-delete-0"), {"deleted": False, "reason": "not_found"})

        self.assertEqual(self.store.delete_product_review("single-delete-1"), {"deleted": True})
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "completed")

    def test_listing_jobs_repairs_stale_review_pending_status_after_reviews_are_deleted(self) -> None:
        job = self.store.create_job({"urls": ["B0REVIEW01"]})
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job["id"]))
            task.status = "completed"
            session.add(CrawlProductItem(
                id="stale-review-item", job_id=job["id"], task_id=task.id,
                source_key="stale-review-source", product_id="stale-review-product",
                client_id="client-a", lease_id="lease-a", checksum="stale-review-checksum",
                raw_payload={}, normalized_payload={"media": []}, status="deleted",
                shopify_result={"review": {"decision": "pending", "deletedAt": utc_iso(utc_now())}},
            ))
            persisted_job = session.get(CrawlJob, job["id"])
            persisted_job.status = "review_pending"
            session.flush()

        listed = next(item for item in self.store.list_jobs() if item["id"] == job["id"])

        self.assertEqual(listed["status"], "completed")
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "completed")

    def test_failed_review_stays_visible_and_can_retry_bulk_sync(self) -> None:
        job = self.store.create_job({"urls": ["B0REVIEW01"]})
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job["id"]))
            task.status = "completed"
            session.add(CrawlProductItem(
                id="failed-review-item", job_id=job["id"], task_id=task.id,
                source_key="failed-source", product_id="failed-product",
                client_id="client-a", lease_id="lease-a", checksum="failed-checksum",
                raw_payload={}, normalized_payload={"media": []}, status="failed",
                shopify_result={"review": {"decision": "approved", "syncStatus": "failed"}},
            ))
            session.flush()
            self.store._refresh_job(session, str(job["id"]))

        self.assertEqual([item["id"] for item in self.store.list_product_reviews()], ["failed-review-item"])
        self.assertEqual(self.store.queue_all_approved_reviews(), ["failed-review-item"])
        self.assertEqual(self.store.list_product_reviews()[0]["syncStatus"], "queued")

    def test_repeated_ready_messages_cannot_exceed_client_capacity(self) -> None:
        self._create_four_task_job()
        self.store.register_client(client_hello(slots=2))

        first = self.store.lease_tasks("client-a", 2)
        second = self.store.lease_tasks("client-a", 2)

        self.assertEqual(len(first), 2)
        self.assertEqual(second, [])

    def test_paused_agent_release_requeues_without_consuming_retry_budget(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-a", slots=1))
        self.store.register_client(client_hello("client-b", slots=1))
        first = self.store.lease_tasks("client-a", 1)[0]
        self.store.update_progress("client-a", {
            "taskId": first["taskId"],
            "leaseId": first["leaseId"],
            "progress": {"phase": "variants", "completed": 2, "total": 10},
        })

        released = self.store.release_task("client-a", {
            "taskId": first["taskId"],
            "leaseId": first["leaseId"],
            "reason": "AGENT_PAUSED",
        })
        duplicate = self.store.release_task("client-a", {
            "taskId": first["taskId"],
            "leaseId": first["leaseId"],
            "reason": "AGENT_PAUSED",
        })

        self.assertEqual(released["status"], "released")
        self.assertEqual(released["failureCount"], 0)
        self.assertEqual(released["requeueCount"], 1)
        self.assertEqual(duplicate["status"], "duplicate")
        with self.sessions() as session:
            task = session.get(CrawlTask, first["taskId"])
            attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.lease_id == first["leaseId"]))
            self.assertEqual(task.status, "queued")
            self.assertIsNone(task.assigned_client_id)
            self.assertIsNone(task.lease_id)
            self.assertEqual(task.failure_count, 0)
            self.assertEqual(task.requeue_count, 1)
            self.assertEqual(attempt.status, "released")

        second = self.store.lease_tasks("client-b", 1)[0]
        self.assertEqual(second["taskId"], first["taskId"])
        self.assertNotEqual(second["leaseId"], first["leaseId"])
        stale = self.store.accept_result(
            str(first["taskId"]),
            "client-a",
            str(first["leaseId"]),
            "stale-checksum",
            {"jobId": job["id"], "products": []},
        )
        self.assertEqual(stale["status"], "stale")

    def test_paused_agent_release_keeps_products_already_accepted_by_server(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-a", slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-before-pause",
            "sourceKey": "amazon:B0FR4MSS2H:color:ocean",
            "title": "Accepted before pause",
        }
        envelope = {
            "jobId": job["id"],
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
            "clientId": "client-a",
            "product": product,
        }
        accepted = self.store.accept_product(
            str(lease["taskId"]),
            "client-a",
            str(lease["leaseId"]),
            str(product["sourceKey"]),
            payload_checksum(envelope),
            envelope,
        )

        released = self.store.release_task("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
            "reason": "AGENT_PAUSED",
        })

        self.assertEqual(accepted["status"], "accepted")
        self.assertEqual(released["status"], "released")
        with self.sessions() as session:
            products = list(session.scalars(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"])))
            self.assertEqual([item.source_key for item in products], [product["sourceKey"]])

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

    def test_cancel_task_preserves_sibling_and_rejects_only_its_late_result(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H", "B0FR4MSS3H"]})
        self.store.register_client(client_hello(slots=2))
        leases = self.store.lease_tasks("client-a", 2)
        first, sibling = leases

        cancellation = self.store.cancel_task(first["taskId"], {"client-a"})

        self.assertEqual(cancellation["status"], "cancelling")
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "running")
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlTask, sibling["taskId"]).status, "leased")
        rejected = self.store.accept_result(
            first["taskId"], "client-a", first["leaseId"], "late-cancelled", {"jobId": job["id"], "products": []},
        )
        accepted = self.store.accept_result(
            sibling["taskId"], "client-a", sibling["leaseId"], "valid-sibling", {"jobId": job["id"], "products": []},
        )
        self.assertEqual(rejected["status"], "cancelled")
        self.assertEqual(accepted["status"], "accepted")
        self.assertEqual(self.store.acknowledge_task_cancel("client-a", {
            "taskId": first["taskId"], "leaseId": first["leaseId"],
        })["status"], "cancelled")

    def test_pending_purge_fences_only_owned_leased_tasks_atomically(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H", "B0FR4MSS3H"]})
        self.store.register_client(client_hello(slots=2))
        leases = self.store.lease_tasks("client-a", 2)
        pending, running = leases

        preview = self.store.preview_pending_tasks("client-a", [pending["taskId"], running["taskId"]],
            {running["taskId"]})
        self.assertEqual(preview["pendingCount"], 1)
        self.assertEqual(preview["ineligibleCount"], 1)
        self.assertIsNone(self.store.cancel_pending_tasks("client-a", [pending["taskId"], running["taskId"]],
            {running["taskId"]}))
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlTask, pending["taskId"]).status, "leased")

        cancelled = self.store.cancel_pending_tasks("client-a", [pending["taskId"]])
        self.assertEqual(cancelled, [{"taskId": pending["taskId"], "jobId": pending["jobId"],
            "leaseId": pending["leaseId"], "status": "cancelled"}])
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlTask, pending["taskId"]).status, "cancelled")
            self.assertEqual(session.get(CrawlTask, running["taskId"]).status, "leased")

    def test_purge_all_local_preview_excludes_executing_assignment(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H", "B0FR4MSS3H"]})
        self.store.register_client(client_hello(slots=2))
        leases = self.store.lease_tasks("client-a", 2)
        executing_id = leases[0]["taskId"]
        pending_id = leases[1]["taskId"]

        preview = self.store.preview_all_local_pending_tasks("client-a", {executing_id})

        self.assertEqual(preview["scope"], "all-local")
        self.assertEqual(preview["pendingCount"], 1)
        self.assertEqual(preview["eligibleTaskIds"], [pending_id])
        self.assertEqual(preview["ineligibleCount"], 1)
        self.assertFalse(preview["overflow"])

    def test_heartbeat_renews_queued_lease_without_marking_it_running(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]

        self.store.heartbeat("client-a", [{"taskId": lease["taskId"], "leaseId": lease["leaseId"]}],
            "busy", executing_task_ids=set())

        with self.sessions() as session:
            task = session.get(CrawlTask, lease["taskId"])
            self.assertEqual(task.status, "leased")
            self.assertIsNotNone(task.lease_expires_at)

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

    def test_stopping_one_job_does_not_invalidate_product_cache(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        generation_before = self.store.current_cache_generation()

        stopped = self.store.cancel_job(str(job["id"]), {"client-a"})

        self.assertEqual(stopped["status"], "cancelling")
        self.assertEqual(self.store.current_cache_generation(), generation_before)

    def test_product_invalidation_is_persisted_for_reconnecting_agents(self) -> None:
        generation = self.store.invalidate_product_cache("B012345678", "10001")

        self.assertEqual(self.store.product_invalidations_since(0), [{
            "asin": "B012345678", "amazonZip": "10001", "generation": generation,
        }])
        self.assertEqual(self.store.product_invalidations_since(generation), [])

    def test_stop_cleanup_requires_explicit_agent_acknowledgement(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.cancel_job(str(job["id"]), {"client-a"})
        generation = self.store.current_cache_generation()
        self.store.acknowledge_task_cancel("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
        })

        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "cancelling")
        self.assertTrue(self.store.acknowledge_stop_cleanup(
            "client-a", job_id=str(job["id"]), cache_generation=generation,
        ))
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

    def test_reconciliation_replays_single_task_cancel_without_cancelling_job(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H", "B0FR4MSS3H"]})
        self.store.register_client(client_hello(slots=2))
        leases = self.store.lease_tasks("client-a", 2)
        self.store.cancel_task(leases[0]["taskId"], {"client-a"})

        reconciliation = self.store.reconcile_tasks("client-a", [
            {"taskId": lease["taskId"], "jobId": job["id"], "leaseId": lease["leaseId"]}
            for lease in leases
        ])

        self.assertEqual(reconciliation["cancelTaskIds"], [leases[0]["taskId"]])
        self.assertEqual(reconciliation["cancelledJobIds"], [])
        self.assertEqual(reconciliation["resumeTaskIds"], [leases[1]["taskId"]])

    def test_cancelled_job_stays_terminal_after_coordinator_restart_and_reconnect(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        local_assignment = {
            "taskId": lease["taskId"],
            "jobId": job["id"],
            "leaseId": lease["leaseId"],
            "status": "running",
        }

        self.store.cancel_job(str(job["id"]), {"client-a"})
        restarted_store = CoordinatorStore(self.sessions)

        reconciliation = restarted_store.reconcile_tasks("client-a", [local_assignment])
        late_result = restarted_store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "late-after-restart",
            {"jobId": job["id"], "products": []},
        )

        self.assertEqual(reconciliation["discardTaskIds"], [lease["taskId"]])
        self.assertEqual(reconciliation["resumeTaskIds"], [])
        self.assertEqual(restarted_store.get_job(str(job["id"]))["status"], "cancelling")
        self.assertEqual(late_result["status"], "cancelled")
        self.assertTrue(restarted_store.acknowledge_stop_cleanup(
            "client-a", job_id=str(job["id"]), cache_generation=restarted_store.current_cache_generation(),
        ))
        self.assertEqual(restarted_store.get_job(str(job["id"]))["status"], "cancelled")

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

    def test_expired_pipeline_claim_completes_stop_without_old_worker(self) -> None:
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
        self.assertEqual(claim["inputAsin"], "B0FR4MSS2H")
        self.store.cancel_job(str(job["id"]))
        self.store.reap_expired()
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "cancelling")
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, claim["id"])
            item.claim_expires_at = utc_now() - timedelta(seconds=1)

        self.store.reap_expired()

        stopped = self.store.get_job(str(job["id"]))
        self.assertEqual(stopped["status"], "cancelled")
        self.assertEqual(stopped["cancellation"]["pendingPipelineItems"], 0)
        self.assertIsNone(self.store.product_cancellation_state(claim["id"], worker_id="worker-1"))
        self.assertFalse(self.store.acknowledge_product_cancel(claim["id"], worker_id="worker-1"))

    def test_expired_shopify_write_still_waits_for_worker_checkpoint(self) -> None:
        source_key = "amazon:B0FR4MSS2H:design:write"
        product = {"id": "product-write", "sourceKey": source_key, "title": "Write"}
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-write",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-write"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.store.mark_product_syncing(
            claim["id"], worker_id="worker-1", normalized_payload=product, proxy_profile="direct",
        )
        self.store.mark_shopify_write_started(claim["id"], worker_id="worker-1")
        request_id = f"product-sync:{hashlib.sha256(source_key.encode('utf-8')).hexdigest()}"
        with self.sessions.begin() as session:
            session.add(ShopifyOperationIdempotency(
                id="pending-write", store_id="store-1", request_id=request_id,
                operation="product.sync", payload_hash="checksum-write", state="pending",
                response_payload={"itemId": claim["id"], "sourceKey": source_key},
            ))
        self.store.cancel_job(str(job["id"]))
        with self.sessions.begin() as session:
            item = session.get(CrawlProductItem, claim["id"])
            item.claim_expires_at = utc_now() - timedelta(seconds=1)

        self.store.reap_expired()

        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "cancelling")
        with self.sessions() as session:
            operation = session.scalar(select(ShopifyOperationIdempotency).where(
                ShopifyOperationIdempotency.request_id == request_id,
            ))
            self.assertEqual(operation.state, "pending")
        self.assertEqual(self.store.purge_stopped_jobs(), 0)

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
                "phase": "variant_matrix", "message": "Đang cào variant 3/14", "html": "X" * 100_000,
                "items": [{
                    "source": "B0FR4MSS2H", "asin": "B0FR4MSS2H", "status": "running",
                    "phase": "variant_matrix", "message": "Đang cào variant 3/14",
                    "variantCompleted": 3, "variantTotal": 14, "currentAsin": "B0CHILD003",
                    "currentOptions": {"Size": "Large"}, "customizationRaw": "Y" * 100_000,
                }],
            },
        })

        snapshot = self.store.get_job(str(job["id"]))
        progress_item = snapshot["progress"]["items"][0]

        self.assertEqual(snapshot["progress"]["phase"], "variant_matrix")
        self.assertEqual(progress_item["variantCompleted"], 3)
        self.assertEqual(progress_item["variantTotal"], 14)
        self.assertEqual(progress_item["currentOptions"], {"Size": "Large"})
        self.assertNotIn("customizationRaw", progress_item)
        self.assertNotIn("html", snapshot["progress"])
        self.assertEqual(self.store.job_summary(str(job["id"]))["currentAsin"], "B0CHILD003")

    def test_summary_and_product_pages_keep_large_payloads_out_of_polling(self) -> None:
        from sqlalchemy import event

        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        with self.sessions.begin() as session:
            task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job["id"]))
            for index in range(3):
                session.add(CrawlProductItem(
                    id=f"item-{index}", job_id=job["id"], task_id=task.id,
                    source_key=f"source-{index}", product_id=f"product-{index}",
                    client_id="client-a", lease_id="lease-a", checksum=f"checksum-{index}",
                    raw_payload={
                        "id": f"product-{index}", "title": "Large product",
                        "descriptionHtml": "X" * 100_000,
                        "sourceVariants": [{"asin": "B0FR4MSS2H", "media": [{"url": "image"}]}],
                        "variants": [{"id": f"variant-{number}"} for number in range(3)],
                    },
                    status="received",
                ))
        queries: list[str] = []

        def record_query(connection, cursor, statement, parameters, context, executemany) -> None:
            queries.append(statement.lower())

        event.listen(self.engine, "before_cursor_execute", record_query)
        try:
            summary = self.store.job_summary(str(job["id"]))
            first_page = self.store.job_products(str(job["id"]), limit=2)
        finally:
            event.remove(self.engine, "before_cursor_execute", record_query)
        self.assertFalse(any("task_results" in query or "raw_payload" in query or "normalized_payload" in query for query in queries))
        self.assertEqual(summary["total"], 1)
        self.assertNotIn("products", summary)
        self.assertNotIn("X" * 100, str(summary))
        self.assertEqual([product["id"] for product in first_page["products"]], ["item-0", "item-1"])
        self.assertNotIn("descriptionHtml", str(first_page))
        second_page = self.store.job_products(str(job["id"]), cursor=first_page["nextCursor"], limit=2)
        self.assertEqual([product["id"] for product in second_page["products"]], ["item-2"])
        self.assertIsNone(second_page["nextCursor"])
        detail = self.store.job_product(str(job["id"]), "item-0")
        self.assertEqual(detail["variantCount"], 3)
        self.assertNotIn("variants", detail)
        self.assertEqual(detail["descriptionHtml"], "X" * 100_000)
        variants = self.store.job_product_variants(str(job["id"]), "item-0", limit=2)
        self.assertEqual([variant["id"] for variant in variants["variants"]], ["variant-0", "variant-1"])
        self.assertEqual(variants["nextCursor"], 2)

    def test_cancelling_job_list_does_not_load_result_or_product_payloads(self) -> None:
        from sqlalchemy import event

        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        self.store.lease_tasks("client-a", 1)
        self.store.cancel_job(str(job["id"]))
        queries: list[str] = []

        def record_query(connection, cursor, statement, parameters, context, executemany) -> None:
            queries.append(statement.lower())

        event.listen(self.engine, "before_cursor_execute", record_query)
        try:
            listing = self.store.list_jobs()
        finally:
            event.remove(self.engine, "before_cursor_execute", record_query)
        self.assertEqual(listing[0]["status"], "cancelling")
        self.assertEqual(listing[0]["cancellation"]["pendingAgents"][0]["clientId"], "client-a")
        self.assertFalse(any("task_results" in query or "raw_payload" in query or "normalized_payload" in query for query in queries))

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

    @patch("engine.distributed.coordinator_store.retry_delay", return_value=0)
    def test_third_crawl_failure_makes_task_terminal(self, _retry_delay) -> None:
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

        self.assertEqual(statuses, ["queued", "queued", "dead_letter"])
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "partial")

    def test_retry_after_delays_reassignment_to_any_client(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.fail_task("client-a", {
            "taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "error": {"status": "temporarily_blocked", "reason": "captcha", "retryable": True,
                      "retryAfter": (utc_now() + timedelta(minutes=2)).isoformat()},
        })
        self.assertEqual(self.store.lease_tasks("client-a", 1), [])
        with patch("engine.distributed.coordinator_store.utc_now", return_value=utc_now() + timedelta(minutes=3)):
            self.assertEqual(len(self.store.lease_tasks("client-a", 1)), 1)

    def test_not_found_negative_cache_prevents_new_job_fetch(self) -> None:
        first = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.fail_task("client-a", {
            "taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "error": {"status": "not_found", "reason": "not_found", "retryable": False, "notFoundConfirmed": True,
                      "retryAfter": (utc_now() + timedelta(days=1)).isoformat()},
        })
        self.assertEqual(self.store.get_job(str(first["id"]))["status"], "partial")
        errors = self.store.job_results(str(first["id"]))["errors"]
        self.assertEqual(errors[0]["status"], "not_found")
        self.assertFalse(errors[0]["retryable"])
        second = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.assertEqual(second["taskCounts"], {"dead_letter": 1})
        self.assertEqual(self.store.lease_tasks("client-a", 1), [])
        self.store.clear_negative_cache()
        third = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.assertEqual(third["taskCounts"], {"queued": 1})

    def test_captcha_cooldown_stops_other_asins_from_being_leased(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H", "B012345678"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.fail_task("client-a", {
            "taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "error": {"status": "temporarily_blocked", "reason": "captcha", "retryable": True,
                      "retryAfter": (utc_now() + timedelta(minutes=2)).isoformat()},
        })
        self.assertEqual(self.store.lease_tasks("client-a", 1), [])

    @patch("engine.distributed.coordinator_store.retry_delay", return_value=1)
    def test_partial_retry_prefers_agent_with_saved_variants_and_falls_back_when_offline(self, _retry_delay) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-a", slots=1))
        self.store.register_client(client_hello("client-b", slots=1))
        first = self.store.lease_tasks("client-a", 1)[0]
        partial_error = {
            "status": "partial", "reason": "incomplete", "retryable": True,
            "retryAfter": (utc_now() + timedelta(seconds=1)).isoformat(),
        }
        self.store.fail_task("client-a", {
            "taskId": first["taskId"], "leaseId": first["leaseId"], "error": partial_error,
        })
        with patch("engine.distributed.coordinator_store.utc_now", return_value=utc_now() + timedelta(seconds=2)):
            self.assertEqual(self.store.lease_tasks("client-b", 1), [])
            second = self.store.lease_tasks("client-a", 1)[0]
        self.store.fail_task("client-a", {
            "taskId": second["taskId"], "leaseId": second["leaseId"], "error": partial_error,
        })
        with self.sessions.begin() as session:
            session.get(ClientRecord, "client-a").status = "offline"
        with patch("engine.distributed.coordinator_store.utc_now", return_value=utc_now() + timedelta(seconds=2)):
            self.assertEqual(len(self.store.lease_tasks("client-b", 1)), 1)

    @patch("engine.distributed.coordinator_store.retry_delay", return_value=1)
    def test_mixed_partial_failure_retries_remaining_child_and_preserves_asin_lists(self, _retry_delay) -> None:
        job = self.store.create_job({"urls": ["B012345678"]})
        self.store.register_client(client_hello(slots=1))
        first = self.store.lease_tasks("client-a", 1)[0]
        initial_error = {
            "status": "partial", "reason": "mixed_failures", "code": "PARTIAL_CRAWL",
            "message": "Family has incomplete children.", "retryable": True,
            "retryAfter": (utc_now() + timedelta(seconds=1)).isoformat(),
            "completedAsins": ["B012345678"],
            "failedAsins": ["B012345679", "B012345680"],
            "retryableAsins": ["B012345680"],
            "nonRetryableAsins": ["B012345679"],
        }
        self.assertEqual(self.store.fail_task("client-a", {
            "taskId": first["taskId"], "leaseId": first["leaseId"], "error": initial_error,
        })["status"], "queued")
        with patch("engine.distributed.coordinator_store.utc_now", return_value=utc_now() + timedelta(seconds=2)):
            second = self.store.lease_tasks("client-a", 1)[0]
        final_error = {
            **initial_error,
            "retryable": False,
            "completedAsins": ["B012345678", "B012345680"],
            "failedAsins": ["B012345679"],
            "retryableAsins": [],
        }
        self.store.fail_task("client-a", {
            "taskId": second["taskId"], "leaseId": second["leaseId"], "error": final_error,
        })
        output = self.store.job_results(str(job["id"]))
        self.assertEqual(output["completedAsins"], ["B012345678", "B012345680"])
        self.assertEqual(output["failedAsins"], ["B012345679"])
        self.assertEqual(output["retryableAsins"], [])
        self.assertEqual(output["nonRetryableAsins"], ["B012345679"])
        self.assertEqual(output["errors"][0]["completedAsins"], ["B012345678", "B012345680"])

    @patch("engine.distributed.coordinator_store.retry_delay", return_value=0)
    def test_expired_lease_requeues_with_persistent_separate_failure_reason(self, _retry_delay) -> None:
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
            self.assertEqual(task.failure_count, 1)
            self.assertEqual(task.last_error["errorCode"], "LEASE_EXPIRED")

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

    def test_only_current_lease_can_complete_a_reassigned_task(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello("client-a", slots=1))
        self.store.register_client(client_hello("client-b", slots=1))
        first = self.store.lease_tasks("client-a", 1)[0]
        with self.sessions.begin() as session:
            task = session.get(CrawlTask, first["taskId"])
            task.lease_expires_at = task.started_at
        with patch("engine.distributed.coordinator_store.retry_delay", return_value=0):
            self.store.reap_expired()
        second = self.store.lease_tasks("client-b", 1)[0]

        rejected = self.store.accept_result(
            first["taskId"], "client-a", first["leaseId"], "first", {"jobId": first["jobId"], "products": [{"id": "first"}]},
        )
        self.assertEqual(rejected["status"], "stale")
        with self.sessions() as session:
            task = session.get(CrawlTask, first["taskId"])
            self.assertEqual(task.assigned_client_id, "client-b")
            self.assertEqual(task.lease_id, second["leaseId"])
            self.assertEqual(task.status, "leased")
            self.assertIsNone(task.result)
            self.assertEqual(list(session.scalars(select(CrawlProductItem))), [])
        accepted = self.store.accept_result(
            second["taskId"], "client-b", second["leaseId"], "second", {"jobId": second["jobId"], "products": [{"id": "second"}]},
        )
        self.assertEqual(accepted["status"], "accepted")
        duplicate = self.store.accept_result(
            second["taskId"], "client-b", second["leaseId"], "second", {"jobId": second["jobId"], "products": [{"id": "second"}]},
        )
        self.assertEqual(duplicate["status"], "duplicate")
        late = self.store.accept_result(
            first["taskId"], "client-a", first["leaseId"], "first", {"jobId": first["jobId"], "products": []},
        )
        self.assertEqual(late["status"], "stale")
        with self.sessions() as session:
            self.assertEqual(session.get(TaskResult, first["taskId"]).client_id, "client-b")

    def test_final_result_rejects_expired_lease_before_reaper(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        with self.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
        response = self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "checksum", {"jobId": lease["jobId"], "products": []},
        )
        self.assertEqual(response["status"], "stale")
        with self.sessions() as session:
            self.assertIsNone(session.get(TaskResult, lease["taskId"]))

    def test_final_result_rejects_non_executable_or_unbounded_lease(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        for status, deadline in (("queued", utc_now() + timedelta(seconds=60)), ("failed", utc_now() + timedelta(seconds=60)), ("leased", None)):
            with self.subTest(status=status, deadline=deadline):
                with self.sessions.begin() as session:
                    task = session.get(CrawlTask, lease["taskId"])
                    task.status = status
                    task.lease_expires_at = deadline
                response = self.store.accept_result(
                    lease["taskId"], "client-a", lease["leaseId"], "checksum", {"jobId": lease["jobId"], "products": []},
                )
                self.assertEqual(response["status"], "stale")

    def test_committed_final_result_can_be_retried_without_active_lease(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        payload = {"jobId": lease["jobId"], "products": []}
        self.assertEqual(self.store.accept_result(lease["taskId"], "client-a", lease["leaseId"], "checksum", payload)["status"], "accepted")
        with self.sessions() as session:
            self.assertIsNone(session.get(CrawlTask, lease["taskId"]).lease_expires_at)
        self.assertEqual(self.store.accept_result(lease["taskId"], "client-a", lease["leaseId"], "checksum", payload)["status"], "duplicate")
        self.assertEqual(self.store.accept_result(lease["taskId"], "forged-client", lease["leaseId"], "checksum", payload)["status"], "stale")

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

    def test_product_stream_rejects_expired_and_reassigned_leases(self) -> None:
        job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        for client_id in ("client-a", "client-b"):
            self.store.register_client(client_hello(client_id, slots=1))
        first = self.store.lease_tasks("client-a", 1)[0]
        payload = {"jobId": job["id"], "product": {"id": "fixture-product", "title": "Current"}}
        with self.sessions.begin() as session:
            session.get(CrawlTask, first["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
        def upload(lease, client_id):
            return self.store.accept_product(lease["taskId"], client_id, lease["leaseId"], "fixture-product", "checksum", payload)
        self.assertEqual(upload(first, "client-a")["status"], "stale")
        with patch("engine.distributed.coordinator_store.retry_delay", return_value=0):
            self.store.reap_expired()
        second = self.store.lease_tasks("client-b", 1)[0]
        self.assertEqual(upload(first, "client-a")["status"], "stale")
        with self.sessions() as session:
            self.assertEqual(list(session.scalars(select(CrawlProductItem))), [])
            self.assertEqual(session.get(CrawlTask, first["taskId"]).lease_id, second["leaseId"])
        self.assertEqual(upload(second, "client-b")["status"], "accepted")
        self.assertEqual(upload(second, "client-b")["status"], "duplicate")
        payload["product"]["title"] = "Stale overwrite"
        self.assertEqual(upload(first, "client-a")["status"], "stale")
        with self.sessions() as session:
            items = list(session.scalars(select(CrawlProductItem)))
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0].raw_payload["title"], "Current")
            self.assertEqual(items[0].client_id, "client-b")

    def test_product_stream_rejects_terminal_queued_and_missing_deadline(self) -> None:
        self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        for status, expiry in (("completed", utc_now() + timedelta(seconds=60)), ("failed", utc_now() + timedelta(seconds=60)), ("queued", utc_now() + timedelta(seconds=60)), ("leased", None)):
            with self.subTest(status=status):
                with self.sessions.begin() as session:
                    task = session.get(CrawlTask, lease["taskId"])
                    task.status = status
                    task.lease_expires_at = expiry
                response = self.store.accept_product(lease["taskId"], "client-a", lease["leaseId"], "fixture-product", "checksum", {"jobId": lease["jobId"], "product": {"id": "fixture-product"}})
                self.assertEqual(response["status"], "stale")
        with self.sessions() as session:
            self.assertEqual(list(session.scalars(select(CrawlProductItem))), [])

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

    def test_family_registry_resolves_sibling_asins_per_store_and_tracks_shopify_sync(self) -> None:
        job = self.store.create_job({"urls": ["B0CHILD001"], "storeId": "capozen"})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-ocean",
            "sourceKey": "amazon:B0PARENT01:design:ocean",
            "asin": "B0CHILD001",
            "parentAsin": "B0PARENT01",
            "sourceVariants": [{"asin": "B0CHILD001"}, {"asin": "B0CHILD002"}],
            "title": "Ocean",
        }
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )

        active = self.store.resolve_asin_families("capozen", ["B0CHILD002"])["families"][0]
        self.assertEqual(active["parentAsin"], "B0PARENT01")
        self.assertEqual(active["databaseStatus"], "leased")
        self.assertEqual(active["jobId"], job["id"])
        self.assertEqual(active["memberAsins"], ["B0CHILD001", "B0CHILD002", "B0PARENT01"])
        other_store = self.store.resolve_asin_families("jeminise", ["B0CHILD002"])["families"][0]
        self.assertFalse(other_store["isResolved"])

        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [], "errors": [], "warnings": []},
        )
        crawled = self.store.resolve_asin_families("capozen", ["B0CHILD002"])["families"][0]
        self.assertEqual(crawled["databaseStatus"], "crawled")

        claim = self.store.claim_product_items(worker_id="worker-1", store_id="capozen", limit=1)[0]
        self.assertTrue(self.store.complete_product_item(
            claim["id"], worker_id="worker-1", store_id="capozen", normalized_checksum="normalized-1",
            normalized_payload=product,
            shopify_result={"productId": "gid://shopify/Product/123", "productHandle": "ocean"},
        ))
        synced = self.store.resolve_asin_families("capozen", ["B0CHILD002"])["families"][0]
        self.assertEqual(synced["databaseStatus"], "synced")
        with self.sessions() as session:
            rows = session.scalars(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == "capozen",
            )).all()
            self.assertEqual(len(rows), 3)
            self.assertTrue(all(row.shopify_product_ids == ["gid://shopify/Product/123"] for row in rows))
        with self.sessions.begin() as session:
            session.execute(delete(AmazonAsinRegistry))
        self.assertEqual(self.store.backfill_asin_registry(), {"products": 1, "links": 1})
        rebuilt = self.store.resolve_asin_families("capozen", ["B0CHILD002"])["families"][0]
        self.assertEqual(rebuilt["parentAsin"], "B0PARENT01")
        self.assertEqual(rebuilt["databaseStatus"], "synced")

    def test_family_registry_recovers_a_crawled_alias_when_its_pipeline_job_is_gone(self) -> None:
        with self.sessions.begin() as session:
            session.add(AmazonAsinRegistry(
                id="registry-stale", store_id="capozen", marketplace="amazon-us",
                asin="B0CHILD003", parent_asin="B0PARENT01", status="crawled",
                last_job_id="deleted-job", shopify_product_ids=[],
            ))
            session.add(AmazonAsinRegistry(
                id="registry-existing-sibling", store_id="capozen", marketplace="amazon-us",
                asin="B0CHILD001", parent_asin="B0PARENT01", status="synced",
                last_job_id="older-job", shopify_product_ids=["gid://shopify/Product/123"],
                synced_at=utc_now(),
            ))

        resolved = self.store.resolve_asin_families("capozen", ["B0CHILD003"])["families"][0]

        self.assertIsNone(resolved["databaseStatus"])
        self.assertIsNone(resolved["jobId"])
        self.assertTrue(resolved["recoveredStaleRegistry"])
        self.assertTrue(resolved["hasSyncedFamilyMembers"])

    def test_product_upload_skips_an_exact_asin_already_synced_to_shopify(self) -> None:
        job = self.store.create_job({"urls": ["B0CHILD002"], "storeId": "capozen"})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        with self.sessions.begin() as session:
            session.add(AmazonAsinRegistry(
                id="registry-synced", store_id="capozen", marketplace="amazon-us",
                asin="B0CHILD001", parent_asin="B0PARENT01", status="synced",
                last_job_id="older-job", shopify_product_ids=["gid://shopify/Product/123"],
                synced_at=utc_now(),
            ))
        product = {
            "id": "product-existing", "sourceKey": "amazon:B0PARENT01:design:existing",
            "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "title": "Existing",
        }

        response = self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-existing",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-existing"},
        )

        self.assertEqual(response["status"], "duplicate")
        self.assertEqual(response["reason"], "existing_shopify_product")
        with self.sessions() as session:
            self.assertEqual(list(session.scalars(select(CrawlProductItem))), [])

    def test_product_upload_skips_a_preflight_shopify_discovery_seed(self) -> None:
        job = self.store.create_job({
            "urls": ["B0PARENT01"], "storeId": "capozen",
            "existingShopifyAsins": ["B0PARENT01"],
            "refreshFamilyAsins": ["B0PARENT01"],
        })
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.assertEqual(lease["settings"]["refreshFamilyAsins"], ["B0PARENT01"])
        product = {
            "id": "product-seed", "sourceKey": "amazon:B0PARENT01:design:seed",
            "asin": "B0PARENT01", "parentAsin": "B0PARENT01", "title": "Existing seed",
        }

        response = self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-seed",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-seed"},
        )

        self.assertEqual(response["status"], "duplicate")
        self.assertEqual(response["reason"], "existing_shopify_product")
        with self.sessions() as session:
            self.assertEqual(list(session.scalars(select(CrawlProductItem))), [])

    def test_product_upload_skips_only_the_split_product_containing_an_existing_shopify_asin(self) -> None:
        job = self.store.create_job({
            "urls": ["B0PARENT01"], "storeId": "capozen",
            "existingShopifyAsins": ["B0CHILD002"],
            "refreshFamilyAsins": ["B0PARENT01"],
        })
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        products = [
            {
                "id": "product-existing", "sourceKey": "amazon:B0PARENT01:design:existing",
                "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "title": "Existing",
                "sourceVariants": [{"asin": "B0CHILD001"}, {"asin": "B0CHILD002"}],
            },
            {
                "id": "product-new-a", "sourceKey": "amazon:B0PARENT01:design:new-a",
                "asin": "B0CHILD003", "parentAsin": "B0PARENT01", "title": "New A",
                "sourceVariants": [{"asin": "B0CHILD003"}],
            },
            {
                "id": "product-new-b", "sourceKey": "amazon:B0PARENT01:design:new-b",
                "asin": "B0CHILD004", "parentAsin": "B0PARENT01", "title": "New B",
                "sourceVariants": [{"asin": "B0CHILD004"}],
            },
        ]

        responses = [
            self.store.accept_product(
                lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"],
                f"checksum-{index}",
                {"jobId": job["id"], "product": product, "productChecksum": f"checksum-{index}"},
            )
            for index, product in enumerate(products)
        ]

        self.assertEqual(responses[0]["status"], "duplicate")
        self.assertEqual(responses[0]["reason"], "existing_shopify_product")
        self.assertEqual([response["status"] for response in responses[1:]], ["accepted", "accepted"])
        final_payload = {"jobId": job["id"], "products": products}
        final_response = self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "final-checksum", final_payload,
        )
        self.assertEqual(final_response["status"], "accepted")
        with self.sessions() as session:
            stored_products = list(session.scalars(select(CrawlProductItem).order_by(CrawlProductItem.source_key)))
            self.assertEqual(
                [item.source_key for item in stored_products],
                ["amazon:B0PARENT01:design:new-a", "amazon:B0PARENT01:design:new-b"],
            )
            result = session.get(TaskResult, lease["taskId"])
            self.assertEqual(
                [product["sourceKey"] for product in result.payload["products"]],
                ["amazon:B0PARENT01:design:new-a", "amazon:B0PARENT01:design:new-b"],
            )

    def test_parent_shopify_match_does_not_skip_new_split_products_in_the_family(self) -> None:
        job = self.store.create_job({
            "urls": ["B0PARENT01"], "storeId": "capozen",
            "existingShopifyAsins": ["B0PARENT01"],
            "refreshFamilyAsins": ["B0PARENT01"],
        })
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        product = {
            "id": "product-new", "sourceKey": "amazon:B0PARENT01:design:new",
            "asin": "B0CHILD003", "parentAsin": "B0PARENT01", "title": "New",
            "sourceVariants": [{"asin": "B0CHILD003"}],
        }

        response = self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-new",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-new"},
        )

        self.assertEqual(response["status"], "accepted")

    def test_crawling_an_unsynced_sibling_does_not_downgrade_the_synced_parent(self) -> None:
        job = self.store.create_job({"urls": ["B0CHILD002"], "storeId": "capozen"})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        with self.sessions.begin() as session:
            session.add(AmazonAsinRegistry(
                id="registry-parent", store_id="capozen", marketplace="amazon-us",
                asin="B0PARENT01", parent_asin="B0PARENT01", status="synced",
                last_job_id="older-job", shopify_product_ids=["gid://shopify/Product/123"],
                synced_at=utc_now(),
            ))
        product = {
            "id": "product-new", "sourceKey": "amazon:B0PARENT01:design:new",
            "asin": "B0CHILD002", "parentAsin": "B0PARENT01", "title": "New child",
        }

        response = self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"], "checksum-new",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-new"},
        )

        self.assertEqual(response["status"], "accepted")
        with self.sessions() as session:
            parent = session.scalar(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == "capozen", AmazonAsinRegistry.asin == "B0PARENT01",
            ))
            child = session.scalar(select(AmazonAsinRegistry).where(
                AmazonAsinRegistry.store_id == "capozen", AmazonAsinRegistry.asin == "B0CHILD002",
            ))
            self.assertIsNotNone(parent)
            self.assertEqual(parent.status, "synced")
            self.assertIsNotNone(child)
            self.assertEqual(child.status, "crawled")

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

    def test_review_gate_persists_product_until_explicit_sync(self) -> None:
        source_key = "amazon:B0REVIEW01:none:none"
        product = {
            "id": "product-review",
            "sourceKey": source_key,
            "parentAsin": "B0REVIEW01",
            "title": "Review product",
            "media": [],
            "variants": [],
        }
        job = self.store.create_job({"urls": ["B0REVIEW01"], "storeId": "store-1"})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.assertEqual(claim["stage"], "prepare")
        self.assertTrue(self.store.mark_product_seo(
            claim["id"], worker_id="worker-1", normalized_payload=product,
            seo_summary={"status": "running"},
        ))
        seo_product = {
            **product,
            "title": "Reviewed SEO title",
            "descriptionHtml": "<p>Reviewed description</p>",
            "handle": "reviewed-seo-title",
            "seo": {"title": "SEO title", "description": "SEO description"},
        }
        self.assertTrue(self.store.mark_product_image_processing(
            claim["id"], worker_id="worker-1", normalized_payload=seo_product,
            image_summary={"status": "completed", "profileSlug": "default", "profileRevision": "rev-1", "processedImages": 0},
        ))
        self.assertTrue(self.store.mark_product_review_ready(
            claim["id"], worker_id="worker-1", normalized_payload=seo_product,
            seo_summary={"status": "completed", "engine": "heuristic", "performance": {"stageDurationsMs": {"b1": 1200}, "cacheHits": 2}},
            image_summary={"status": "completed", "profileSlug": "default", "profileRevision": "rev-1", "processedImages": 0},
            review_summary={"storeId": "store-1", "assetsNormalized": 0},
        ))

        reviews = self.store.list_product_reviews()
        self.assertEqual(len(reviews), 1)
        snapshot = self.store.job_product(str(job["id"]), claim["id"])
        self.assertEqual(snapshot["pipeline"]["seo"]["performance"]["cacheHits"], 2)
        self.assertEqual(reviews[0]["decision"], "pending")
        self.assertEqual(reviews[0]["syncStatus"], "idle")
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "review_pending")
        self.assertEqual(
            self.store.claim_product_items(worker_id="worker-2", store_id="store-1", limit=1),
            [],
        )

        # A review-pending job no longer blocks the next crawl job.
        next_job = self.store.create_job({"urls": ["B0REVIEW02"]})
        self.assertNotEqual(next_job["id"], job["id"])

        rejected = self.store.decide_product_review(
            claim["id"], expected_version=1, decision="rejected", reason="Needs revision",
        )
        self.assertEqual(rejected["decision"], "rejected")
        cleanup = self.store.cleanup_history(retention_minutes=60, now=utc_now() + timedelta(hours=2))
        self.assertEqual(cleanup["jobs"], 0)
        reopened = self.store.decide_product_review(
            claim["id"], expected_version=2, decision="pending", reason=None,
        )
        self.assertEqual(reopened["decision"], "pending")
        edited = self.store.update_product_review(
            claim["id"], expected_version=3, patch={"productTitle": "Edited review title"},
        )
        self.assertEqual(edited["decision"], "pending")
        self.assertEqual(edited["product"]["title"], "Edited review title")
        approved = self.store.decide_product_review(
            claim["id"], expected_version=4, decision="approved", reason=None,
        )
        self.assertEqual(approved["decision"], "approved")
        queued = self.store.queue_product_review_sync(claim["id"])
        self.assertEqual(queued["syncStatus"], "queued")
        sync_claim = self.store.claim_product_items(worker_id="worker-3", store_id="store-1", limit=1)[0]
        self.assertEqual(sync_claim["stage"], "sync")
        self.assertEqual(sync_claim["product"]["title"], "Edited review title")
        self.assertEqual(self.store.fail_product_item(
            claim["id"], worker_id="worker-3", store_id="store-1",
            error={"message": "Uncertain Shopify write", "phase": "shopify"},
            retryable=False, reconciliation_required=True,
        ), "reconciliation_required")
        failed_review = self.store.list_product_reviews()[0]
        self.assertEqual(failed_review["syncStatus"], "failed")
        self.assertEqual(self.store.queue_product_review_sync(claim["id"]), {"reconciliationRequired": True})
        reconciliation = self.store.queue_product_review_sync(claim["id"], reconcile=True)
        self.assertEqual(reconciliation["syncStatus"], "queued")
        self.assertEqual(reconciliation["syncGeneration"], 1)
        reconciliation_claim = self.store.claim_product_items(
            worker_id="worker-4", store_id="store-1", limit=1,
        )[0]
        self.assertEqual(reconciliation_claim["stage"], "sync")
        self.assertEqual(reconciliation_claim["review"]["syncGeneration"], 1)

    def test_approved_review_completes_only_after_sync_claim(self) -> None:
        source_key = "amazon:B0REVW0001:none:none"
        product = {
            "id": "review-product", "sourceKey": source_key,
            "parentAsin": "B0REVW0001", "title": "Ready for review",
            "media": [], "variants": [],
        }
        job = self.store.create_job({"urls": ["B0REVW0001"], "storeId": "store-1"})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-1",
            {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.store.mark_product_seo(
            claim["id"], worker_id="worker-1", normalized_payload=product,
            seo_summary={"status": "running"},
        )
        self.store.mark_product_image_processing(
            claim["id"], worker_id="worker-1", normalized_payload=product,
            image_summary={"status": "completed"},
        )
        self.store.mark_product_review_ready(
            claim["id"], worker_id="worker-1", normalized_payload=product,
            seo_summary={"status": "completed"},
            image_summary={"status": "completed"},
            review_summary={"storeId": "store-1"},
        )
        self.store.decide_product_review(
            claim["id"], expected_version=1, decision="approved", reason=None,
        )
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "review_pending")
        self.store.queue_product_review_sync(claim["id"])
        sync_claim = self.store.claim_product_items(worker_id="worker-2", store_id="store-1", limit=1)[0]
        self.assertEqual(sync_claim["stage"], "sync")
        self.store.mark_product_syncing(
            claim["id"], worker_id="worker-2", normalized_payload=product,
            proxy_profile="direct", seo_summary={"status": "completed"},
        )
        self.assertTrue(self.store.complete_product_item(
            claim["id"], worker_id="worker-2", store_id="store-1",
            normalized_checksum="normalized-1", normalized_payload=product,
            shopify_result={"productId": "gid://shopify/Product/123", "storeId": "store-1"},
        ))
        synced_review = self.store.list_product_reviews()[0]
        self.assertEqual(synced_review["syncStatus"], "synced")
        self.assertEqual(synced_review["product"]["pipeline"]["shopify"]["productId"], "gid://shopify/Product/123")
        self.assertEqual(self.store.get_job(str(job["id"]))["status"], "completed")

        # Verify synced review can be edited and re-queued for sync
        edited = self.store.update_product_review(
            claim["id"],
            expected_version=synced_review["version"],
            patch={"productTitle": "Updated title after initial sync"},
        )
        self.assertEqual(edited["decision"], "pending")
        self.assertEqual(edited["syncStatus"], "idle")
        self.assertEqual(edited["product"]["title"], "Updated title after initial sync")

        decided = self.store.decide_product_review(
            claim["id"],
            expected_version=edited["version"],
            decision="approved",
            reason=None,
        )
        self.assertEqual(decided["decision"], "approved")

        requeued = self.store.queue_product_review_sync(claim["id"])
        self.assertEqual(requeued["syncStatus"], "queued")

        # Verify editing is locked while queued
        self.assertEqual(
            self.store.update_product_review(
                claim["id"],
                expected_version=requeued["version"],
                patch={"productTitle": "Should be locked while queued"},
            ),
            {"locked": True},
        )

    def test_mark_product_review_sync_failed_persists_status_and_error(self) -> None:
        job = self.store.create_job({"urls": ["B0TESTFAIL"]})
        self.store.register_client(client_hello(slots=1))
        lease = self.store.lease_tasks("client-a", 1)[0]
        source_key = "amazon:B0TESTFAIL:design:red"
        product = {"id": "prod-fail", "sourceKey": source_key, "parentAsin": "B0TESTFAIL", "title": "Test Fail Item"}
        self.store.accept_product(
            lease["taskId"], "client-a", lease["leaseId"], source_key, "cs-1",
            {"jobId": job["id"], "product": product, "productChecksum": "cs-1"},
        )
        self.store.accept_result(
            lease["taskId"], "client-a", lease["leaseId"], "rcs-1",
            {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
        )
        claim = self.store.claim_product_items(worker_id="worker-1", store_id="store-1", limit=1)[0]
        self.store.mark_product_image_processing(
            claim["id"], worker_id="worker-1", normalized_payload=product,
            image_summary={"status": "completed", "profileSlug": "default", "profileRevision": "rev-1", "processedImages": 0},
        )
        self.store.mark_product_review_ready(
            claim["id"], worker_id="worker-1", normalized_payload=product,
            seo_summary={"status": "completed"},
            image_summary={"status": "completed"},
            review_summary={"storeId": "store-1"},
        )
        self.store.decide_product_review(claim["id"], expected_version=1, decision="approved", reason=None)

        failed_snapshot = self.store.mark_product_review_sync_failed(
            claim["id"],
            error="Shopify API rate limit exceeded (HTTP 429)",
        )
        self.assertIsNotNone(failed_snapshot)
        self.assertEqual(failed_snapshot["syncStatus"], "failed")
        self.assertEqual(failed_snapshot["syncError"], "Shopify API rate limit exceeded (HTTP 429)")

        reviews = self.store.list_product_reviews()
        self.assertEqual(len(reviews), 1)
        self.assertEqual(reviews[0]["syncStatus"], "failed")
        self.assertEqual(reviews[0]["syncError"], "Shopify API rate limit exceeded (HTTP 429)")

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
            self.assertGreaterEqual(len(session.scalars(select(AmazonAsinRegistry)).all()), 1)

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
        public_product = self.store.job_product(str(job["id"]), claim["id"])

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
        public_product = self.store.job_product(str(job["id"]), claim["id"])

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
    def test_archive_route_hides_handed_off_job_while_delete_route_protects_pipeline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "archive.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                job = app.state.store.create_job({"urls": ["B0ARCHIVE2"], "storeId": "preaureum_dev"})
                with app.state.store.sessions.begin() as session:
                    task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job["id"]))
                    task.status = "completed"
                    session.add(CrawlProductItem(
                        id="route-archive-item", job_id=job["id"], task_id=task.id,
                        source_key="route-archive-source", product_id="route-archive-product",
                        client_id="client-a", lease_id="lease-a", checksum="route-archive-checksum",
                        raw_payload={}, normalized_payload={"media": []}, status="retry_wait",
                        shopify_result={"externalSeo": {"jobId": "seo-job", "provider": "codex_mcp"}},
                        next_attempt_at=utc_now() - timedelta(seconds=1),
                    ))
                    session.flush()
                    app.state.store._refresh_job(session, str(job["id"]))

                blocked = client.delete(f"/api/v1/crawl-jobs/{job['id']}")
                self.assertEqual(blocked.status_code, 409)
                self.assertIn("ẩn job", blocked.json()["detail"])
                archived = client.post(f"/api/v1/crawl-jobs/{job['id']}/archive")
                self.assertEqual(archived.status_code, 200)
                self.assertEqual(archived.json(), {"status": "archived"})
                self.assertEqual(client.get("/api/v1/crawl-jobs").json(), [])
                claimed = app.state.store.claim_product_items(
                    worker_id="pipeline-worker", store_id="preaureum_dev", limit=1,
                )
                self.assertEqual([item["id"] for item in claimed], ["route-archive-item"])

    def setUp(self) -> None:
        image_cache = tempfile.TemporaryDirectory()
        self.addCleanup(image_cache.cleanup)
        self.image_cache_root = Path(image_cache.name)
        cache_override = patch.dict(os.environ, {"IMAGE_PROCESSING_CACHE_DIR": image_cache.name})
        cache_override.start()
        self.addCleanup(cache_override.stop)

    def test_final_result_route_rejects_stale_lease_and_preserves_lost_ack_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                store = app.state.store
                job = store.create_job({"urls": ["B0FR4MSS2H"]})
                for client_id in ("client-a", "client-b"):
                    store.register_client(client_hello(client_id, slots=1))
                first = store.lease_tasks("client-a", 1)[0]
                with store.sessions.begin() as session:
                    session.get(CrawlTask, first["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
                with patch("engine.distributed.coordinator_store.retry_delay", return_value=0):
                    store.reap_expired()
                second = store.lease_tasks("client-b", 1)[0]

                def upload(lease, client_id):
                    return client.put(
                        f"/api/v1/worker/tasks/{lease['taskId']}/result",
                        headers={"X-Client-Id": client_id, "X-Lease-Id": lease["leaseId"]},
                        json={"taskId": lease["taskId"], "jobId": job["id"],
                              "clientId": client_id, "leaseId": lease["leaseId"], "products": []},
                    )

                rejected = upload(first, "client-a")
                self.assertEqual(rejected.status_code, 409)
                self.assertIn("stale", rejected.json()["detail"])
                product_url = f"/api/v1/worker/tasks/{first['taskId']}/products/fixture-product"
                for lease, client_id, expected_code, expected_status in (
                    (first, "client-a", 409, None),
                    (second, "client-b", 200, "accepted"),
                    (second, "client-b", 200, "duplicate"),
                    (first, "client-a", 409, None),
                ):
                    streamed = client.put(product_url,
                        headers={"X-Client-Id": client_id, "X-Lease-Id": lease["leaseId"]},
                        json={"taskId": lease["taskId"], "clientId": client_id,
                              "leaseId": lease["leaseId"], "jobId": job["id"],
                              "product": {"id": "fixture-product", "title": "Fixture"}},
                    )
                    self.assertEqual(streamed.status_code, expected_code)
                    if expected_status is not None:
                        self.assertEqual(streamed.json()["status"], expected_status)
                accepted = upload(second, "client-b")
                self.assertEqual(accepted.status_code, 200)
                self.assertEqual(accepted.json()["status"], "accepted")
                retry = upload(second, "client-b")
                self.assertEqual(retry.status_code, 200)
                self.assertEqual(retry.json()["status"], "duplicate")
                self.assertEqual(retry.json()["receiptId"], accepted.json()["receiptId"])
                headers = {"X-Client-Id": "client-b", "X-Lease-Id": second["leaseId"]}
                envelope = {"taskId": second["taskId"], "clientId": "client-b",
                            "leaseId": second["leaseId"], "jobId": job["id"]}
                conflict = client.put(f"/api/v1/worker/tasks/{second['taskId']}/result",
                                      headers=headers, json={**envelope, "products": [], "changed": True})
                self.assertEqual(conflict.status_code, 409)
                self.assertEqual(conflict.json()["detail"]["code"], "UPLOAD_CHECKSUM_CONFLICT")
                product_conflict = client.put(product_url, headers=headers,
                    json={**envelope, "product": {"id": "fixture-product", "title": "Changed"}})
                self.assertEqual(product_conflict.status_code, 409)
                self.assertEqual(product_conflict.json()["detail"]["code"], "UPLOAD_CHECKSUM_CONFLICT")
                self.assertEqual(upload(first, "client-a").status_code, 409)

    def test_result_batch_returns_independent_receipts_and_retries_as_duplicates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_coordinator_app(database_url=f"sqlite:///{(Path(directory) / 'batch.sqlite3').as_posix()}")
            with TestClient(app) as client:
                store = app.state.store
                job = store.create_job({"urls": ["B0FR4MSS2H", "B0FR4MSS3H"]})
                store.register_client(client_hello("batch-agent", slots=2))
                leases = store.lease_tasks("batch-agent", 2)
                items = []
                for lease in leases:
                    payload = {"taskId": lease["taskId"], "leaseId": lease["leaseId"],
                               "clientId": "batch-agent", "jobId": job["id"], "products": []}
                    items.append({"taskId": lease["taskId"], "leaseId": lease["leaseId"],
                                  "checksum": payload_checksum(payload), "payload": payload})
                # A malformed sibling receives its own failure and does not prevent the valid result commit.
                items[1]["payload"]["leaseId"] = "wrong-lease"
                response = client.put("/api/v1/worker/results/batch",
                                      headers={"X-Client-Id": "batch-agent"}, json={"items": items})
                self.assertEqual(response.status_code, 200)
                receipts = response.json()["results"]
                self.assertEqual(receipts[0]["status"], "accepted")
                self.assertEqual(receipts[1]["status"], "invalid")
                items[1]["payload"]["leaseId"] = items[1]["leaseId"]
                retry = client.put("/api/v1/worker/results/batch",
                                   headers={"X-Client-Id": "batch-agent"}, json={"items": items[:1]})
                self.assertEqual(retry.status_code, 200)
                self.assertEqual(retry.json()["results"][0]["status"], "duplicate")
                self.assertEqual(retry.json()["results"][0]["receiptId"], receipts[0]["receiptId"])
                changed_payload = {**items[0]["payload"], "marker": "changed"}
                changed = {**items[0], "payload": changed_payload,
                           "checksum": payload_checksum(changed_payload)}
                conflict = client.put("/api/v1/worker/results/batch",
                                      headers={"X-Client-Id": "batch-agent"}, json={"items": [changed]})
                self.assertEqual(conflict.status_code, 200)
                self.assertEqual(conflict.json()["results"][0]["status"], "conflict")
                self.assertEqual(conflict.json()["results"][0]["receiptId"], receipts[0]["receiptId"])

    def test_client_readiness_is_false_until_agent_finishes_reconciliation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_coordinator_app(database_url=f"sqlite:///{(Path(directory) / 'ready.sqlite3').as_posix()}")
            with TestClient(app) as client:
                with client.websocket_connect("/api/v1/worker/connect") as agent:
                    agent.send_json(client_hello("ready-agent", slots=1))
                    self.assertEqual(agent.receive_json()["type"], "hello_ack")
                    self.assertFalse(client.get("/api/v1/clients").json()[0]["readyForTasks"])
                    agent.send_json({"type": "ready", "availableSlots": 1,
                                     "lastProcessedCommandSequence": 0, "appliedExecutionState": "RUNNING"})
                    self.assertTrue(client.get("/api/v1/clients").json()[0]["readyForTasks"])

    def test_new_job_wakes_ready_agents_without_waiting_for_next_heartbeat(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_coordinator_app(database_url=f"sqlite:///{(Path(directory) / 'work-available.sqlite3').as_posix()}")
            with TestClient(app) as client:
                with client.websocket_connect("/api/v1/worker/connect") as agent:
                    agent.send_json(client_hello("wake-agent", slots=1))
                    self.assertEqual(agent.receive_json()["type"], "hello_ack")
                    agent.send_json({"type": "ready", "availableSlots": 1,
                                     "lastProcessedCommandSequence": 0, "appliedExecutionState": "RUNNING"})
                    self.assertEqual(client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}).status_code, 202)
                    self.assertEqual(agent.receive_json()["type"], "work_available")
                    agent.send_json({"type": "ready", "availableSlots": 1,
                                     "lastProcessedCommandSequence": 0, "appliedExecutionState": "RUNNING"})
                    self.assertEqual(agent.receive_json()["type"], "assignment")

    def test_agent_pause_release_is_acknowledged_and_wakes_another_agent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_coordinator_app(
                database_url=f"sqlite:///{(Path(directory) / 'pause-release.sqlite3').as_posix()}"
            )
            with TestClient(app) as client:
                job = client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}).json()
                with client.websocket_connect("/api/v1/worker/connect") as first_agent:
                    first_agent.send_json(client_hello("pause-agent-a", slots=1))
                    self.assertEqual(first_agent.receive_json()["type"], "hello_ack")
                    first = first_agent.receive_json()
                    first_agent.send_json({
                        "type": "release_task",
                        "taskId": first["taskId"],
                        "leaseId": first["leaseId"],
                        "reason": "AGENT_PAUSED",
                    })
                    acknowledgement = first_agent.receive_json()
                    self.assertEqual(acknowledgement["type"], "release_task_ack")
                    self.assertEqual(acknowledgement["status"], "released")
                    self.assertEqual(first_agent.receive_json()["type"], "work_available")

                    with client.websocket_connect("/api/v1/worker/connect") as second_agent:
                        second_agent.send_json(client_hello("pause-agent-b", slots=1))
                        self.assertEqual(second_agent.receive_json()["type"], "hello_ack")
                        second = second_agent.receive_json()

                self.assertEqual(second["taskId"], first["taskId"])
                self.assertNotEqual(second["leaseId"], first["leaseId"])
                stale = app.state.store.accept_result(
                    str(first["taskId"]),
                    "pause-agent-a",
                    str(first["leaseId"]),
                    "stale-checksum",
                    {"jobId": job["id"], "products": []},
                )
                self.assertEqual(stale["status"], "stale")

    def test_single_task_cancel_route_does_not_cancel_sibling_or_job(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                job = app.state.store.create_job({"urls": ["B0FR4MSS2H", "B0FR4MSS3H"]})
                app.state.store.register_client(client_hello(slots=2))
                leases = app.state.store.lease_tasks("client-a", 2)
                target_id, sibling_id = leases[0]["taskId"], leases[1]["taskId"]

                response = client.post(f"/api/v1/crawl-tasks/{target_id}/cancel")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["status"], "cancelled")
                self.assertEqual(app.state.store.get_job(str(job["id"]))["status"], "running")
                with app.state.store.sessions() as session:
                    self.assertEqual(session.get(CrawlTask, target_id).status, "cancelled")
                    self.assertEqual(session.get(CrawlTask, sibling_id).status, "leased")

    def test_single_task_cancel_route_targets_only_the_owning_agent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                job = app.state.store.create_job({"urls": ["B0FR4MSS2H", "B0FR4MSS3H"]})
                with client.websocket_connect("/api/v1/worker/connect") as agent:
                    agent.send_json(client_hello("client-a", slots=2))
                    self.assertEqual(agent.receive_json()["type"], "hello_ack")
                    assignments = [agent.receive_json(), agent.receive_json()]
                    target = assignments[0]
                    sibling = assignments[1]

                    response = client.post(f"/api/v1/crawl-tasks/{target['taskId']}/cancel")

                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["status"], "cancelling")
                    command = agent.receive_json()
                    self.assertEqual(command, {
                        "type": "cancel_task",
                        "taskId": target["taskId"],
                        "leaseId": target["leaseId"],
                    })
                    with app.state.store.sessions() as session:
                        self.assertEqual(session.get(CrawlTask, sibling["taskId"]).status, "leased")

    def test_summary_and_paged_product_routes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                job = client.post("/api/v1/crawl-jobs", json={"urls": ["B0FR4MSS2H"]}).json()
                store = app.state.store
                with store.sessions.begin() as session:
                    task = session.scalar(select(CrawlTask).where(CrawlTask.job_id == job["id"]))
                    session.add(CrawlProductItem(
                        id="item-1", job_id=job["id"], task_id=task.id,
                        source_key="source-1", product_id="product-1", client_id="client-a",
                        lease_id="lease-a", checksum="checksum-1", status="received",
                        raw_payload={"id": "product-1", "descriptionHtml": "X" * 100_000,
                                     "variants": [{"id": "v1"}, {"id": "v2"}]},
                    ))
                base = f"/api/v1/crawl-jobs/{job['id']}"
                self.assertEqual(client.get(f"{base}/metadata").json()["settings"]["amazonZip"], "90001")
                summary = client.get(f"{base}/summary")
                self.assertEqual(summary.status_code, 200)
                self.assertNotIn("X" * 100, summary.text)
                listing = client.get(f"{base}/products?limit=1")
                self.assertEqual(listing.json()["products"][0]["id"], "item-1")
                self.assertNotIn("descriptionHtml", listing.text)
                detail = client.get(f"{base}/products/item-1")
                self.assertEqual(detail.json()["variantCount"], 2)
                self.assertNotIn("variants", detail.json())
                self.assertEqual(client.get(f"{base}/products/item-1/variants?limit=1").json()["nextCursor"], 1)
                self.assertEqual(client.get(f"{base}/products/item-1/variants?cursor=1").json()["variants"][0]["id"], "v2")
                self.assertEqual(client.get(f"{base}/products?limit=101").status_code, 422)
                self.assertEqual(client.get(f"{base}/products/unknown").status_code, 404)
                self.assertEqual(client.get("/api/v1/crawl-jobs/unknown/summary").status_code, 404)
                self.assertEqual(client.get(f"{base}/products/item-1/variants?cursor=-1").status_code, 422)

    def test_cancel_keeps_negative_and_image_cache_until_explicit_clear(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            store = app.state.store
            image_file = app.state.image_processing_service.cache_root / "cached-image.jpg"
            image_file.write_bytes(b"cached")
            with TestClient(app) as client:
                job = store.create_job({"urls": ["B012345678"]})
                cache_key = store._negative_key("B012345678", "90001")
                with store.sessions.begin() as session:
                    store._store_negative(session, cache_key, {
                        "status": "not_found", "reason": "product not found", "retryable": False, "notFoundConfirmed": True,
                        "retryAfter": utc_iso(utc_now() + timedelta(hours=1)),
                    })
                generation = store.current_cache_generation()

                response = client.post(f"/api/v1/crawl-jobs/{job['id']}/cancel")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(store.current_cache_generation(), generation)
                with store.sessions() as session:
                    self.assertIsNotNone(session.get(CoordinatorState, cache_key))
                self.assertTrue(image_file.exists())

                cleared = client.delete("/api/v1/clients/cache")
                self.assertEqual(cleared.status_code, 200)
                self.assertGreater(store.current_cache_generation(), generation)
                self.assertFalse(image_file.exists())

    def test_selected_invalidation_reaches_agent_after_reconnect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                invalidated = client.delete("/api/v1/clients/cache/products/B012345678?amazonZip=10001")
                self.assertEqual(invalidated.status_code, 200)
                self.assertEqual(invalidated.json()["requestedClients"], 0)
                with client.websocket_connect("/api/v1/worker/connect") as agent:
                    agent.send_json(client_hello())
                    acknowledgement = agent.receive_json()
                    self.assertEqual(acknowledgement["productInvalidations"][0]["asin"], "B012345678")
                    self.assertEqual(acknowledgement["productInvalidations"][0]["amazonZip"], "10001")

    def test_temporary_cleanup_reaches_agent_after_reconnect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                cleared = client.delete("/api/v1/clients/temporary-data")
                self.assertEqual(cleared.status_code, 200)
                with client.websocket_connect("/api/v1/worker/connect") as agent:
                    agent.send_json(client_hello())
                    acknowledgement = agent.receive_json()
                    self.assertEqual(acknowledgement["requiredTemporaryCleanupGeneration"], 1)
                    self.assertEqual(acknowledgement["validJobIds"], [])

    def test_selected_invalidation_rejects_invalid_asin_and_zip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                self.assertEqual(client.delete("/api/v1/clients/cache/products/invalid").status_code, 422)
                self.assertEqual(client.delete(
                    "/api/v1/clients/cache/products/B012345678?amazonZip=wrong"
                ).status_code, 422)
                self.assertEqual(app.state.store.product_invalidations_since(0), [])

    def test_cache_maintenance_rejects_active_job(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                app.state.store.create_job({"urls": ["B012345678"]})
                generation = app.state.store.current_cache_generation()

                self.assertEqual(client.delete("/api/v1/clients/cache").status_code, 409)
                self.assertEqual(client.delete("/api/v1/clients/cache/products/B012345678").status_code, 409)
                self.assertEqual(client.delete("/api/v1/clients/temporary-data").status_code, 409)
                self.assertEqual(app.state.store.current_cache_generation(), generation)

    def test_duplicate_agent_socket_does_not_disconnect_the_active_agent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                with client.websocket_connect("/api/v1/worker/connect") as primary:
                    primary.send_json(client_hello())
                    self.assertEqual(primary.receive_json()["type"], "hello_ack")
                    with client.websocket_connect("/api/v1/worker/connect") as duplicate:
                        duplicate.send_json(client_hello())
                        close = duplicate.receive()
                        self.assertEqual(close["type"], "websocket.close")
                        self.assertEqual(close["code"], 4001)
                    current = next(record for record in client.get("/api/v1/clients").json() if record["id"] == "client-a")
                    self.assertTrue(current["isConnected"])
                    self.assertEqual(current["status"], "online")
                    self.assertEqual(current["agentVersion"], "5.0.0")

    def test_clients_endpoint_reports_live_agent_capability_and_task_activity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                with client.websocket_connect("/api/v1/worker/connect") as websocket:
                    hello = client_hello()
                    hello["capabilities"] = {
                        "amazon": True,
                        "pinterest": True,
                        "pinterestBrowserLoggedIn": False,
                        "offlineSpool": True,
                        "mediaGalleryV2": True,
                    }
                    websocket.send_json(hello)
                    self.assertEqual(websocket.receive_json()["type"], "hello_ack")
                    websocket.send_json({
                        "type": "heartbeat",
                        "status": "busy",
                        "availableSlots": 1,
                        "capabilities": {
                            "amazon": True,
                            "pinterest": True,
                            "pinterestBrowserLoggedIn": True,
                            "offlineSpool": True,
                            "mediaGalleryV2": True,
                        },
                        "running": [{
                            "taskId": "task-pin-1",
                            "jobId": "job-pin-1",
                            "leaseId": "private-lease-id",
                            "channel": "pinterest",
                            "stage": "crawl_and_review",
                            "niche": "leather bag",
                            "message": "Search: vintage floral vector print",
                            "percent": 50,
                        }],
                    })

                    current = {}
                    for _attempt in range(20):
                        current = next(record for record in client.get("/api/v1/clients").json() if record["id"] == "client-a")
                        if current.get("capabilities", {}).get("pinterestBrowserLoggedIn"):
                            break
                        time.sleep(0.01)

                    self.assertTrue(current["capabilities"]["pinterestBrowserLoggedIn"])
                    self.assertEqual(current["currentTasks"][0]["jobId"], "job-pin-1")
                    self.assertEqual(current["currentTasks"][0]["niche"], "leather bag")
                    self.assertNotIn("leaseId", current["currentTasks"][0])

    def test_agent_release_and_forget_offline_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                release = client.get("/api/v1/agent-release")
                self.assertEqual(release.status_code, 503)
                self.assertNotIn("version", release.json())

                app.state.store.register_client(client_hello())
                app.state.store.mark_client_disconnected("client-a")
                forgotten = client.delete("/api/v1/clients/client-a")
                self.assertEqual(forgotten.status_code, 200)
                self.assertTrue(forgotten.json()["ok"])
                self.assertEqual(client.delete("/api/v1/clients/client-a").status_code, 404)

    def test_forget_client_rejects_connected_agent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            with TestClient(app) as client:
                with client.websocket_connect("/api/v1/worker/connect") as agent:
                    agent.send_json(client_hello())
                    self.assertEqual(agent.receive_json()["type"], "hello_ack")
                    self.assertEqual(client.delete("/api/v1/clients/client-a").status_code, 409)

    def test_forget_offline_client_preserves_history_and_rejects_active_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            store = app.state.store
            with TestClient(app) as client:
                store.register_client(client_hello())
                job = store.create_job({"urls": ["B012345678"]})
                leased = store.lease_tasks("client-a", 1)[0]
                store.mark_client_disconnected("client-a")
                self.assertEqual(client.delete("/api/v1/clients/client-a").status_code, 409)

                with store.sessions.begin() as session:
                    task = session.get(CrawlTask, leased["taskId"])
                    task.status = "completed"
                    task.lease_id = None
                    task.lease_expires_at = None

                self.assertEqual(client.delete("/api/v1/clients/client-a").status_code, 200)
                self.assertIsNotNone(store.get_job(str(job["id"])))
                with store.sessions() as session:
                    task = session.get(CrawlTask, leased["taskId"])
                    self.assertIsNone(task.assigned_client_id)

    def test_sync_all_queues_only_approved_reviews_as_each_product_becomes_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            store = app.state.store
            with TestClient(app) as client:
                job = store.create_job({"urls": ["B0REVIEW04", "B0REVIEW05"], "storeId": "store-1"})
                store.register_client(client_hello(slots=2))
                leases = store.lease_tasks("client-a", 2)
                self.assertEqual(len(leases), 2)
                for index, lease in enumerate(leases):
                    source_key = f"amazon:B0REVIEW0{index + 4}:none:none"
                    product = {
                        "id": f"review-product-{index}", "sourceKey": source_key,
                        "title": f"Review product {index}", "media": [], "variants": [],
                    }
                    store.accept_product(
                        lease["taskId"], "client-a", lease["leaseId"], source_key, f"checksum-{index}",
                        {"jobId": job["id"], "product": product, "productChecksum": f"checksum-{index}"},
                    )
                    store.accept_result(
                        lease["taskId"], "client-a", lease["leaseId"], f"result-{index}",
                        {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
                    )
                claims = client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "worker-1", "storeId": "store-1", "limit": 2},
                ).json()["items"]
                self.assertEqual(len(claims), 2)
                for index, claim in enumerate(claims):
                    product = claim["product"]
                    store.mark_product_seo(
                        claim["id"], worker_id="worker-1", normalized_payload=product,
                        seo_summary={"status": "running"},
                    )
                    store.mark_product_image_processing(
                        claim["id"], worker_id="worker-1", normalized_payload=product,
                        image_summary={"status": "completed"},
                    )
                    store.mark_product_review_ready(
                        claim["id"], worker_id="worker-1", normalized_payload=product,
                        seo_summary={"status": "completed"}, image_summary={"status": "completed"},
                        review_summary={"storeId": "store-1"},
                    )
                    self.assertEqual(client.get("/api/v1/product-reviews").json()["total"], index + 1)

                first_id = claims[0]["id"]
                approved = client.post(
                    f"/api/v1/product-reviews/{first_id}/decision",
                    json={"expectedVersion": 1, "decision": "approved"},
                )
                self.assertEqual(approved.status_code, 200)
                queued = client.post("/api/v1/product-reviews/sync-approved")
                self.assertEqual(queued.status_code, 200)
                self.assertEqual(queued.json(), {"queued": 1, "itemIds": [first_id]})
                self.assertEqual(client.post("/api/v1/product-reviews/sync-approved").json()["queued"], 0)
                reviews = client.get("/api/v1/product-reviews").json()["items"]
                self.assertEqual(
                    {review["id"]: review["syncStatus"] for review in reviews},
                    {first_id: "queued", claims[1]["id"]: "idle"},
                )
                deleted = client.delete("/api/v1/product-reviews")
                self.assertEqual(deleted.status_code, 200)
                self.assertEqual(deleted.json(), {"deleted": 1, "skipped": 1})
                self.assertEqual(client.get("/api/v1/product-reviews").json()["total"], 1)
                self.assertEqual(client.post(f"/api/v1/product-reviews/{claims[1]['id']}/sync").status_code, 409)

    def test_review_api_exposes_ready_product_and_requires_explicit_sync(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "coordinator.sqlite3"
            app = create_coordinator_app(database_url=f"sqlite:///{database_path.as_posix()}")
            store = app.state.store
            source_key = "amazon:B0REVIEW03:none:none"
            product = {
                "id": "review-api-product",
                "sourceKey": source_key,
                "parentAsin": "B0REVIEW03",
                "title": "Original product title",
                "media": [],
                "variants": [],
            }
            with TestClient(app) as client:
                job = store.create_job({"urls": ["B0REVIEW03"], "storeId": "store-1"})
                store.register_client(client_hello(slots=1))
                lease = store.lease_tasks("client-a", 1)[0]
                store.accept_product(
                    lease["taskId"], "client-a", lease["leaseId"], source_key, "checksum-1",
                    {"jobId": job["id"], "product": product, "productChecksum": "checksum-1"},
                )
                store.accept_result(
                    lease["taskId"], "client-a", lease["leaseId"], "result-checksum",
                    {"jobId": job["id"], "products": [product], "errors": [], "warnings": []},
                )
                claim = client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "worker-1", "storeId": "store-1", "limit": 1},
                ).json()["items"][0]
                self.assertEqual(claim["stage"], "prepare")
                self.assertEqual(client.get("/api/v1/product-reviews").json()["items"], [])
                self.assertEqual(client.post(
                    f"/api/v1/internal/product-pipeline/{claim['id']}/seo",
                    json={"workerId": "worker-1", "normalizedProduct": product, "seo": {"status": "running"}},
                ).status_code, 200)
                self.assertEqual(client.post(
                    f"/api/v1/internal/product-pipeline/{claim['id']}/image-processing",
                    json={
                        "workerId": "worker-1", "normalizedProduct": product,
                        "imageProcessing": {"status": "completed"},
                    },
                ).status_code, 200)
                ready_product = {**product, "title": "SEO product title", "seo": {"title": "SEO title"}}
                ready = client.post(
                    f"/api/v1/internal/product-pipeline/{claim['id']}/review-ready",
                    json={
                        "workerId": "worker-1", "normalizedProduct": ready_product,
                        "seo": {"status": "completed"},
                        "imageProcessing": {"status": "completed"},
                        "review": {"storeId": "store-1"},
                    },
                )
                self.assertEqual(ready.status_code, 200)
                reviews = client.get("/api/v1/product-reviews").json()
                self.assertEqual(reviews["total"], 1)
                self.assertEqual(reviews["items"][0]["product"]["title"], "SEO product title")
                self.assertEqual(reviews["items"][0]["decision"], "pending")
                self.assertEqual(client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "worker-2", "storeId": "store-1", "limit": 1},
                ).json()["items"], [])
                self.assertEqual(client.post(
                    f"/api/v1/product-reviews/{claim['id']}/sync",
                ).status_code, 409)

                edited = client.patch(
                    f"/api/v1/product-reviews/{claim['id']}",
                    json={"expectedVersion": 1, "patch": {"productTitle": "Approved product title"}},
                )
                self.assertEqual(edited.status_code, 200)
                self.assertEqual(edited.json()["version"], 2)
                self.assertEqual(client.post(
                    f"/api/v1/product-reviews/{claim['id']}/decision",
                    json={"expectedVersion": 1, "decision": "approved"},
                ).status_code, 409)
                approved = client.post(
                    f"/api/v1/product-reviews/{claim['id']}/decision",
                    json={"expectedVersion": 2, "decision": "approved"},
                )
                self.assertEqual(approved.status_code, 200)
                self.assertEqual(approved.json()["syncStatus"], "idle")
                self.assertEqual(client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "worker-2", "storeId": "store-1", "limit": 1},
                ).json()["items"], [])
                queued = client.post(f"/api/v1/product-reviews/{claim['id']}/sync")
                self.assertEqual(queued.status_code, 200)
                self.assertEqual(queued.json()["syncStatus"], "queued")
                sync_claim = client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "worker-2", "storeId": "store-1", "limit": 1},
                ).json()["items"][0]
                self.assertEqual(sync_claim["stage"], "sync")
                self.assertEqual(sync_claim["product"]["title"], "Approved product title")
                synced = store.mark_product_review_synced(
                    claim["id"],
                    product_id="gid://shopify/Product/123",
                    product_handle="approved-product-title",
                )
                self.assertEqual(synced["syncStatus"], "synced")
                with store.sessions() as session:
                    link = session.scalar(select(ShopifyProductLink).where(
                        ShopifyProductLink.store_id == "store-1",
                        ShopifyProductLink.source_key == source_key,
                    ))
                    self.assertIsNotNone(link)
                    self.assertEqual(link.shopify_product_id, "gid://shopify/Product/123")
                    registry = session.scalar(select(AmazonAsinRegistry).where(
                        AmazonAsinRegistry.store_id == "store-1",
                        AmazonAsinRegistry.asin == "B0REVIEW03",
                    ))
                    self.assertIsNotNone(registry)
                    self.assertEqual(registry.status, "synced")
                self.assertEqual(
                    client.post(f"/api/v1/product-reviews/{claim['id']}/sync").status_code,
                    409,
                )
                reconcile = client.post(
                    f"/api/v1/product-reviews/{claim['id']}/sync",
                    json={"reconcile": True},
                )
                self.assertEqual(reconcile.status_code, 200)
                self.assertEqual(reconcile.json()["syncStatus"], "queued")
                self.assertEqual(reconcile.json()["syncGeneration"], 1)
                reconciliation_claim = client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "worker-3", "storeId": "store-1", "limit": 1},
                ).json()["items"][0]
                self.assertEqual(reconciliation_claim["stage"], "sync")
                self.assertEqual(reconciliation_claim["review"]["syncGeneration"], 1)

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
            self.assertEqual(app.state.image_processing_service.root, self.image_cache_root.resolve())
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


class CoordinatorPinterestDistributedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_coordinator.sqlite"
        engine = create_database_engine(f"sqlite:///{self.db_path.as_posix()}")
        create_coordinator_test_schema(engine)
        self.sessions = create_session_factory(engine)
        self.store = CoordinatorStore(self.sessions)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_pinterest_control_plane_enqueues_job_and_accepts_agent_asset(self) -> None:
        runtime_root = Path(self.temp_dir.name) / "pinterest-runtime"
        with patch.dict(os.environ, {"PINTEREST_RUNTIME_ROOT": str(runtime_root)}):
            app = create_coordinator_app(database_url=f"sqlite:///{self.db_path.as_posix()}")
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/pinterest-jobs",
                    json={"niche": "leather bag", "stage": "crawl_and_review"},
                )
                self.assertEqual(response.status_code, 202)
                job = response.json()
                self.assertEqual(job["status"], "queued")
                self.assertEqual(job["settings"]["channel"], "pinterest")

                asset_response = client.post(
                    f"/api/v1/pinterest-assets/{job['id']}/preview.png",
                    content=b"png-data",
                    headers={"Content-Type": "image/png"},
                )
                self.assertEqual(asset_response.status_code, 200)
                self.assertEqual(
                    (runtime_root / "jobs" / job["id"] / "preview.png").read_bytes(),
                    b"png-data",
                )

    def test_amazon_captcha_cooldown_does_not_block_pinterest_tasks(self) -> None:
        amazon = self.store.create_job({"urls": ["B012345678"]})
        self.store.register_client({**client_hello(slots=1), "capabilities": {"amazon": True, "pinterest": True}})
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.assertEqual(lease["jobId"], amazon["id"])
        self.store.fail_task("client-a", {"taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "error": {"status": "temporarily_blocked", "reason": "captcha", "retryable": True}})
        pinterest = self.store.create_pinterest_job({"niche": "fixture", "stage": "crawl"})
        leases = self.store.lease_tasks("client-a", 1)
        self.assertEqual([task["jobId"] for task in leases], [pinterest["id"]])
        self.assertEqual(leases[0]["channel"], "pinterest")
        self.assertEqual(self.store.lease_tasks("client-a", 1), [])

    def test_amazon_worker_skips_multiple_incompatible_pinterest_tasks(self) -> None:
        amazon = self.store.create_job({"urls": ["B012345678"]})
        for index in range(5):
            self.store.create_pinterest_job({"niche": f"fixture-{index}", "schedulerPriority": 100})
        self.store.register_client(client_hello(slots=1))
        leases = self.store.lease_tasks("client-a", 1)
        self.assertEqual([task["jobId"] for task in leases], [amazon["id"]])
        self.assertEqual(leases[0]["requestId"], leases[0]["taskId"])
        self.assertIn("asinDeadlineAt", leases[0])

    def test_pinterest_captcha_failure_does_not_set_amazon_cooldown(self) -> None:
        amazon = self.store.create_job({"urls": ["B012345678"]})
        pinterest = self.store.create_pinterest_job({"niche": "fixture", "schedulerPriority": 100})
        self.store.register_client({**client_hello(slots=1), "capabilities": {"amazon": True, "pinterest": True}})
        lease = self.store.lease_tasks("client-a", 1)[0]
        self.assertEqual(lease["jobId"], pinterest["id"])
        self.store.fail_task("client-a", {"taskId": lease["taskId"], "leaseId": lease["leaseId"],
            "error": {"status": "temporarily_blocked", "reason": "captcha", "retryable": True}})
        leases = self.store.lease_tasks("client-a", 1)
        self.assertEqual([task["jobId"] for task in leases], [amazon["id"]])

    def test_failed_pinterest_job_exposes_agent_error_message(self) -> None:
        job = self.store.create_pinterest_job({"niche": "fixture", "stage": "crawl_and_review"})
        self.store.register_client({**client_hello(slots=1), "capabilities": {"amazon": True, "pinterest": True}})
        lease = self.store.lease_tasks("client-a", 1)[0]

        self.store.fail_task("client-a", {
            "taskId": lease["taskId"],
            "leaseId": lease["leaseId"],
            "error": {"message": "Không thể lưu manifest trên Crawler Agent.", "retryable": False},
        })

        snapshot = self.store.get_job(str(job["id"]))
        self.assertEqual(snapshot["status"], "failed")
        self.assertEqual(snapshot["error"], "Không thể lưu manifest trên Crawler Agent.")
        self.assertEqual(snapshot["stepper"]["current_message"], "Không thể lưu manifest trên Crawler Agent.")

    def test_pinterest_job_creation_and_capability_filtering(self) -> None:
        # 1. Create a Pinterest crawl job
        job = self.store.create_pinterest_job({
            "niche": "Gothic skull rugs",
            "product": "rug",
            "workflow_stage": "crawl_and_review",
            "candidatePoolSize": 20,
        })
        self.assertEqual(job["status"], "queued")
        self.assertEqual(job["settings"]["channel"], "pinterest")
        self.assertEqual(job["settings"]["stage"], "crawl_and_review")

        # 2. Register Client-Amazon (can_pinterest = False)
        self.store.register_client({
            **client_hello("client-amazon"),
            "capabilities": {"amazon": True, "pinterest": False},
        })

        # Amazon worker should NOT receive the Pinterest task
        leases_amazon = self.store.lease_tasks("client-amazon", 2)
        self.assertEqual(len(leases_amazon), 0)

        # 3. Register Client-Pinterest (can_pinterest = True)
        self.store.register_client({
            **client_hello("client-pinterest"),
            "capabilities": {"amazon": True, "pinterest": True},
        })

        # Pinterest worker SHOULD receive the Pinterest task
        leases_pin = self.store.lease_tasks("client-pinterest", 2)
        self.assertEqual(len(leases_pin), 1)
        lease = leases_pin[0]
        self.assertEqual(lease["channel"], "pinterest")
        self.assertEqual(lease["action"], "crawl_and_review")
        self.assertEqual(lease["settings"]["channel"], "pinterest")

        # 4. Spool & complete the result
        candidates = [
            {"image_id": "pin_1", "title": "Skull Rug 1", "image_url": "https://i.pinimg.com/1.jpg"},
            {"image_id": "pin_2", "title": "Skull Rug 2", "image_url": "https://i.pinimg.com/2.jpg"},
        ]
        envelope = {
            "version": "distributed-pinterest-1",
            "taskId": lease["taskId"],
            "jobId": job["id"],
            "leaseId": lease["leaseId"],
            "status": "completed",
            "candidates": candidates,
            "rejected_candidates": [],
            "total_candidates": 2,
            "logs": ["Cào xong 2 mẫu từ Pinterest."],
        }
        self.store.accept_result(
            task_id=lease["taskId"],
            client_id="client-pinterest",
            lease_id=lease["leaseId"],
            checksum=payload_checksum(envelope),
            payload=envelope,
        )

        # 5. Verify snapshot reflects ready_for_review and candidate data
        snapshot = self.store.get_job(job["id"])
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["status"], "ready_for_review")
        self.assertEqual(len(snapshot["candidates"]), 2)
        self.assertEqual(snapshot["candidates"][0]["image_id"], "pin_1")
        self.assertEqual(snapshot["stepper"]["current_step"], 2)
        self.assertIn("Sẵn sàng duyệt mẫu", snapshot["stepper"]["current_message"])
        self.assertIn("Agent đã gửi thành công 2 candidate về server.", snapshot["logs"])

    def test_pinterest_production_job_completion(self) -> None:
        # Create a production stage job
        prod_job = self.store.create_pinterest_job({
            "stage": "produce",
            "product": "rug",
            "selected_candidates": [{"image_id": "pin_1", "title": "Skull Rug 1"}],
        })
        self.assertEqual(prod_job["status"], "queued")

        self.store.register_client({
            **client_hello("client-pod"),
            "capabilities": {"pinterest": True},
        })

        leases = self.store.lease_tasks("client-pod", 1)
        self.assertEqual(len(leases), 1)

        deliverables = {
            "print_cmyk_images": [{"filename": "design_1_cmyk_300dpi.jpg", "url": "/api/pinterest-pod/assets/job1/cmyk.jpg"}],
            "lifestyle_mockups": [{"filename": "mockup_1.jpg", "url": "/api/pinterest-pod/assets/job1/mockup_1.jpg"}],
        }
        envelope = {
            "version": "distributed-pinterest-1",
            "taskId": leases[0]["taskId"],
            "jobId": prod_job["id"],
            "leaseId": leases[0]["leaseId"],
            "status": "completed",
            "deliverables": deliverables,
            "summaryMetrics": {"cmyk_count": 1, "mockups_count": 1},
        }
        self.store.accept_result(
            task_id=leases[0]["taskId"],
            client_id="client-pod",
            lease_id=leases[0]["leaseId"],
            checksum=payload_checksum(envelope),
            payload=envelope,
        )

        snapshot = self.store.get_job(prod_job["id"])
        self.assertEqual(snapshot["status"], "completed")
        self.assertEqual(len(snapshot["deliverables"]["print_cmyk_images"]), 1)
        self.assertEqual(snapshot["stepper"]["current_step"], 4)


if __name__ == "__main__":
    unittest.main()

