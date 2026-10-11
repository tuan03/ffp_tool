from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from engine.distributed.client_setup import build_setup_payload, disconnect_block_reason, read_setup_payload, save_setup_payload


class AgentSetupTests(unittest.TestCase):
    def test_validates_origin_name_and_concurrency_without_silent_clamping(self):
        payload = build_setup_payload({}, server_url="https://CRAWLER.test/", display_name="Desk", concurrency="2", auto_connect=False)
        self.assertEqual(payload["serverUrl"], "https://crawler.test")
        self.assertEqual(payload["maxConcurrentInputs"], 2)
        for url in ("", "ftp://crawler.test", "https://user:secret@crawler.test", "https://crawler.test/path", "http://crawler.test?token=secret"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                build_setup_payload({}, server_url=url, display_name="Desk", concurrency="1", auto_connect=False)
        for count in ("0", "17", "1.5", "bad"):
            with self.subTest(count=count), self.assertRaises(ValueError):
                build_setup_payload({}, server_url="http://localhost:3011", display_name="Desk", concurrency=count, auto_connect=False)

    def test_retains_existing_storage_and_advanced_settings_on_same_server(self):
        original = {"serverUrl": "https://crawler.test", "dataDirectory": "custom-data", "limits": {"headless": True}, "outbox": {"maxRecords": 50}}
        payload = build_setup_payload(original, server_url="https://CRAWLER.test:443/", display_name="Desk", concurrency="1", auto_connect=True)
        self.assertEqual(payload["dataDirectory"], "custom-data")
        self.assertEqual(payload["limits"], original["limits"])
        self.assertEqual(payload["outbox"], original["outbox"])
        self.assertNotIn("autoConnect", original)

    def test_server_switch_uses_separate_storage_and_does_not_copy_credentials(self):
        original = {"serverUrl": "https://crawler.test", "dataDirectory": "custom-data", "authMode": "key"}
        payload = build_setup_payload(original, server_url="http://localhost:3011", display_name="Desk", concurrency="1", auto_connect=False, auth_mode="legacy")
        self.assertNotIn("dataDirectory", payload)
        self.assertEqual(payload["authMode"], "legacy")

    def test_atomic_save_preserves_unicode_and_no_secret_field(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings" / "agent.json"
            payload = build_setup_payload({}, server_url="https://crawler.test", display_name="Khánh", concurrency="1", auto_connect=False)
            save_setup_payload(path, payload)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), payload)
            self.assertEqual(list(path.parent.glob("*.tmp")), [])

    def test_disconnect_requires_pause_and_clean_active_spool_not_empty_quarantine(self):
        self.assertIsNone(disconnect_block_reason({"isPaused": True, "quarantinedUploads": 277}))
        for field in ("activeTasks", "pendingUploads", "pendingProducts", "pendingResults", "releasingTasks", "pendingCancellations"):
            with self.subTest(field=field):
                self.assertIsNotNone(disconnect_block_reason({"isPaused": True, field: 1}))
        self.assertIsNotNone(disconnect_block_reason({"isPaused": False}))
        self.assertIsNotNone(disconnect_block_reason({"isPaused": True, "storage": {"blocked": True}}))

    def test_invalid_previous_origin_can_be_corrected_without_reusing_its_directory(self):
        payload = build_setup_payload({"serverUrl": "bad", "dataDirectory": "old"}, server_url="http://localhost:3011", display_name="Desk", concurrency="1", auto_connect=False)
        self.assertNotIn("dataDirectory", payload)

    def test_import_resolves_relative_paths_without_modifying_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "agent.json"
            original = {"serverUrl": "https://crawler.test", "dataDirectory": "data", "proxyConfigPath": "proxy.json"}
            path.write_text(json.dumps(original), encoding="utf-8")
            imported = read_setup_payload(path)
            self.assertEqual(imported["dataDirectory"], str(Path("data").resolve()))
            self.assertEqual(imported["proxyConfigPath"], str((root / "proxy.json").resolve()))
            self.assertEqual(json.loads(path.read_text()), original)

    @unittest.skipUnless(os.name == "nt", "Windows desktop lifecycle")
    def test_desktop_setup_saves_preferences_and_starts_only_after_submit(self):
        from engine.distributed.client_main import _run_desktop, build_parser
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "portable" / "agent.json"
            source.parent.mkdir()
            original = {"serverUrl": "https://crawler.test", "displayName": "Old", "dataDirectory": str(root / "data")}
            source.write_text(json.dumps(original))
            target = root / "user" / "connection.json"
            submitted = build_setup_payload(original, server_url="https://crawler.test", display_name="New", concurrency="2", auto_connect=False)
            def window_factory(_original, connect, **_kwargs):
                def run():
                    connect(submitted, "")
                    return submitted
                return Mock(run=run)
            tray = Mock(wants_reconfigure=False)
            with patch("engine.distributed.client_setup.setup_config_path", return_value=target), \
                 patch("engine.distributed.client_connection_window.AgentConnectionWindow", side_effect=window_factory), \
                 patch("engine.distributed.client_agent.DistributedCrawlerAgent") as create_agent, \
                 patch("engine.distributed.client_tray.TrayApplication", return_value=tray), \
                 patch.dict(os.environ, {"AMAZON_COORDINATOR_URL": ""}):
                self.assertEqual(_run_desktop(build_parser().parse_args(["--config", str(source)])), 0)
                self.assertEqual(create_agent.call_args.kwargs["config"].display_name, "New")
                self.assertEqual(create_agent.call_args.kwargs["config"].max_concurrent_inputs, 2)
                profile_path = create_agent.call_args.kwargs["config"].config_file_path
                self.assertEqual(profile_path.parent, target.parent / "connections")
                self.assertEqual(json.loads(profile_path.read_text()), submitted)
                tray.run.assert_called_once()
            self.assertEqual(json.loads(target.read_text()), submitted)
            self.assertEqual(json.loads(source.read_text()), original)

    @unittest.skipUnless(os.name == "nt", "Windows desktop lifecycle")
    def test_desktop_cancel_never_starts_worker(self):
        from engine.distributed.client_main import _run_desktop, build_parser
        with tempfile.TemporaryDirectory() as directory:
            with patch("engine.distributed.client_setup.setup_config_path", return_value=Path(directory) / "settings.json"), \
                 patch("engine.distributed.client_connection_window.AgentConnectionWindow", return_value=Mock(run=lambda: None)), \
                 patch("engine.distributed.client_agent.DistributedCrawlerAgent") as create_agent:
                self.assertEqual(_run_desktop(build_parser().parse_args(["--config", str(Path(directory) / "missing.json")])), 0)
                create_agent.assert_not_called()

    def test_reconfigure_pauses_before_checking_and_does_not_stop_dirty_agent(self):
        from engine.distributed.client_tray import TrayApplication
        with tempfile.TemporaryDirectory() as directory:
            agent = Mock()
            agent.status_snapshot.return_value = {"isPaused": True, "pendingUploads": 1}
            application = TrayApplication(agent, Path(directory))
            application._request_reconfigure()
            agent.set_paused.assert_called_once_with(True)
            agent.stop.assert_not_called()
            self.assertFalse(application.wants_reconfigure)
            agent.status_snapshot.return_value = {"isPaused": True}
            application._request_reconfigure()
            agent.stop.assert_called_once()
            self.assertTrue(application.wants_reconfigure)
            self.assertEqual(application._actions.get_nowait(), "exit")


@unittest.skipUnless(os.name == "nt" and os.environ.get("FFP_TEST_NATIVE_WINDOW") == "1", "Native Tk runs in an isolated process")
class AgentConnectionWindowTests(unittest.TestCase):
    def test_form_controls_fit_at_125_and_150_percent_scaling(self):
        import tkinter as tk
        from engine.distributed.client_connection_window import AgentConnectionWindow
        create_root = tk.Tk
        for scale in (120 / 72, 144 / 72):
            def scaled_root():
                root = create_root()
                root.tk.call("tk", "scaling", scale)
                return root
            with patch("engine.distributed.client_connection_window.tk.Tk", side_effect=scaled_root):
                window = AgentConnectionWindow({}, Mock())
            try:
                window.root.update()
                self.assertLessEqual(window.connect_button.winfo_rooty() + window.connect_button.winfo_height(), window.root.winfo_rooty() + window.root.winfo_height())
            finally:
                window.destroy()

    def test_missing_fields_leave_form_open_and_valid_fields_save_without_key_in_payload(self):
        from engine.distributed.client_connection_window import AgentConnectionWindow
        prepare = Mock()
        window = AgentConnectionWindow({}, prepare)
        try:
            window.root.withdraw()
            window.submit()
            self.assertFalse(window._busy)
            prepare.assert_not_called()
            window.server.set("http://localhost:3011")
            window.name.set("Khánh")
            window.key.set("must-not-persist")
            window.submit()
            payload, error = window._results.get(timeout=3)
            self.assertEqual(error, "")
            self.assertEqual(payload["displayName"], "Khánh")
            self.assertEqual(prepare.call_args.args[1], "")
            self.assertNotIn("key", payload)
            self.assertEqual(window.key.get(), "")
        finally:
            window.destroy()

    def test_validation_failure_is_safe_and_can_be_retried(self):
        from engine.distributed.client_connection_window import AgentConnectionWindow
        prepare = Mock(side_effect=RuntimeError("secret-value"))
        window = AgentConnectionWindow({"serverUrl": "https://crawler.test", "displayName": "Desk"}, prepare)
        try:
            window.root.withdraw()
            window.submit()
            _payload, error = window._results.get(timeout=3)
            self.assertNotIn("secret-value", error)
        finally:
            window.destroy()
