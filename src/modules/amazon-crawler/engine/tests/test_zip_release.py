import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from engine.distributed.zip_release import (
    EXECUTABLE,
    build_release_catalog_request,
    require_compatible,
    validate_zip,
    verify_release,
)
from engine.distributed.zip_updater import install_runtime, launch_prepared_update


class ZipReleaseTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.keys = {"test": base64.b64encode(self.key.public_key().public_bytes_raw()).decode()}
        self.manifest = {"schemaVersion": 2, "platform": "windows-x64", "version": "5.2.4",
                         "minimumServerVersion": "5.2.3", "protocolVersion": "5", "size": 1,
                         "sha256": "a" * 64, "url": "https://github.com/example/release.zip"}

    def envelope(self, manifest=None):
        payload = json.dumps(manifest or self.manifest).encode()
        return {"keyId": "test", "payload": base64.b64encode(payload).decode(),
                "signature": base64.b64encode(self.key.sign(payload)).decode()}

    def test_signature_is_required_even_when_checksum_is_replaced(self):
        envelope = self.envelope()
        self.assertEqual(verify_release(envelope, keys=self.keys), self.manifest)
        forged = {**self.manifest, "sha256": "b" * 64}
        envelope["payload"] = base64.b64encode(json.dumps(forged).encode()).decode()
        with self.assertRaises(ValueError):
            verify_release(envelope, keys=self.keys)
        with self.assertRaises(ValueError):
            verify_release(self.envelope(), keys={})

    def test_release_catalog_request_identifies_agent_to_edge_security(self):
        request = build_release_catalog_request("https://coordinator.example/api/v1/agent-release", "5.3.4")
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(request.get_header("User-agent"), "FFP-Amazon-Crawler-Agent/5.3.4")

    def test_compatibility_and_downgrade_are_rejected(self):
        require_compatible(self.manifest, "5.2.3", "5.2.3", "5")
        for installed, server, protocol in [("5.2.4", "5.2.3", "5"), ("5.2.3", "5.2.2", "5"), ("5.2.3", "5.2.3", "4")]:
            with self.assertRaises(ValueError):
                require_compatible(self.manifest, installed, server, protocol)

    def test_zip_requires_exact_signed_bytes_and_safe_managed_paths(self):
        for unsafe in [None, "../escape", "_internal/../../escape", "_internal/CON.txt", "credentials.json",
                       "_internal/file:stream", "_internal/trailing.", "_internal/UPPER", "_internal/a/b"]:
            with self.subTest(unsafe=unsafe), tempfile.TemporaryDirectory() as temporary:
                archive = Path(temporary) / "release.zip"
                with zipfile.ZipFile(archive, "w") as bundle:
                    bundle.writestr(EXECUTABLE, "exe")
                    bundle.writestr("_internal/a", "runtime")
                    bundle.writestr("_internal/upper", "runtime")
                    if unsafe:
                        bundle.writestr(unsafe, "bad")
                manifest = {**self.manifest, "size": archive.stat().st_size,
                            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
                if unsafe:
                    with self.assertRaises(ValueError):
                        validate_zip(archive, manifest)
                else:
                    self.assertIn(EXECUTABLE, validate_zip(archive, manifest))
                    with self.assertRaises(ValueError):
                        validate_zip(archive, {**manifest, "sha256": "f" * 64})

    def test_runtime_swap_preserves_user_config_and_rolls_back_failed_probe(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                install, staged, recovery = root / "install", root / "stage", root / "recovery"
                for directory, value in ((install, "old"), (staged, "new")):
                    directory.mkdir()
                    (directory / EXECUTABLE).write_text(value)
                    (directory / "_internal").mkdir()
                    (directory / "_internal" / "runtime").write_text(value)
                (install / "agent.json").write_text("private config")
                probe = Mock(side_effect=ValueError("bad boot") if fail else None)
                if fail:
                    with self.assertRaises(ValueError):
                        install_runtime(install, staged, recovery, probe)
                else:
                    install_runtime(install, staged, recovery, probe)
                expected = "old" if fail else "new"
                self.assertEqual((install / EXECUTABLE).read_text(), expected)
                self.assertEqual((install / "_internal" / "runtime").read_text(), expected)
                self.assertEqual((install / "agent.json").read_text(), "private config")

    def test_catalog_never_advertises_server_source_version_when_release_is_unavailable(self):
        from engine.distributed.release_catalog import load_release_catalog
        with patch.dict("os.environ", {"FFP_AGENT_RELEASE_MANIFEST_URL": ""}):
            with self.assertRaises(ValueError):
                load_release_catalog()

    def test_parent_only_exits_after_helper_verified_and_staged_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            (work / "status.json").write_text(json.dumps({"stage": "WAITING_FOR_EXIT"}))
            process = Mock()
            process.poll.return_value = None
            with patch("engine.distributed.zip_updater.subprocess.Popen", return_value=process):
                launch_prepared_update(work)
            process.terminate.assert_not_called()
            process.poll.return_value = 1
            with patch("engine.distributed.zip_updater.subprocess.Popen", return_value=process):
                with self.assertRaises(ValueError):
                    launch_prepared_update(work)

    def test_tray_clears_stale_latest_label_after_failed_check(self):
        from engine.distributed.client_tray import TrayApplication
        tray = object.__new__(TrayApplication)
        tray.agent = Mock()
        tray.agent.config.server_url = "http://127.0.0.1:3011"
        tray._latest_agent_version = "99.0.0"
        tray._latest_release_payload = {"stale": True}
        tray._update_message = ""
        with patch("urllib.request.urlopen", side_effect=OSError("offline")):
            self.assertIsNone(tray._check_for_update(notify=False))
        self.assertIsNone(tray._latest_agent_version)
        self.assertIsNone(tray._latest_release_payload)
        self.assertIn("chưa kiểm tra được", tray._update_status_text(None))

    def test_tray_identifies_agent_when_loading_public_release_catalog(self):
        from engine.distributed import AGENT_VERSION
        from engine.distributed.client_tray import TrayApplication
        tray = object.__new__(TrayApplication)
        tray.agent = Mock()
        tray.agent.config.server_url = "https://coordinator.example"
        tray._latest_agent_version = None
        tray._latest_release_payload = None
        tray._update_message = ""
        tray._icon = None
        response = Mock()
        response.read.return_value = json.dumps({"release": self.envelope()}).encode()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch("urllib.request.urlopen", return_value=response) as open_request, patch(
                "engine.distributed.zip_release.TRUSTED_RELEASE_KEYS", self.keys):
            self.assertEqual(tray._check_for_update(notify=False), self.manifest["version"])
        request = open_request.call_args.args[0]
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(request.get_header("User-agent"), f"FFP-Amazon-Crawler-Agent/{AGENT_VERSION}")


class ZipDrainTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_update_closes_admission_and_waits_for_outbox_without_cancelling_work(self):
        import asyncio
        from engine.distributed.client_agent import DistributedCrawlerAgent
        from engine.distributed.client_config import AgentConfig
        from engine.distributed.protocol import AgentLimits
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            agent = DistributedCrawlerAgent(project_root=root / "install", config=AgentConfig(
                server_url="http://127.0.0.1:3011", display_name="update-test", max_concurrent_inputs=1,
                limits=AgentLimits(), data_directory=root / "data", config_file_path=root / "agent.json"))
            agent._is_connected = True
            agent.active["task"] = {"taskId": "task"}
            agent.executing_task_ids.add("task")
            count = Mock(return_value=1)
            prepare = Mock(return_value=root / "prepared")
            launch = Mock()
            with patch.object(agent.store, "drain_outbox_count", count), patch(
                "engine.distributed.zip_updater.prepare_update", prepare), patch(
                "engine.distributed.zip_updater.launch_prepared_update", launch):
                task = asyncio.create_task(agent.install_zip_release({}, root / "release.zip", Mock()))
                await asyncio.sleep(0.02)
                self.assertTrue(agent._zip_update_draining)
                self.assertEqual(agent._available_slots(), 0)
                self.assertIn("task", agent.active)
                prepare.assert_not_called()
                agent.active.clear()
                agent.executing_task_ids.clear()
                await asyncio.sleep(1.05)
                prepare.assert_not_called()
                count.return_value = 0
                await asyncio.wait_for(task, timeout=3)
                launch.assert_called_once()
                self.assertTrue(agent.store.is_paused())
                self.assertTrue(agent.stop_event.is_set())
