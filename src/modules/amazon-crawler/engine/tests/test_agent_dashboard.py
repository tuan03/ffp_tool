from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from engine.distributed.client_dashboard_state import DashboardState
from engine.distributed.client_store import ClientStore
from engine.distributed.client_agent import DistributedCrawlerAgent
from engine.distributed.client_config import AgentConfig
from engine.distributed.client_main import build_parser
from engine.distributed.client_tray import TrayApplication
from engine.distributed.protocol import AgentLimits
from engine.observability import register_redactions


def assignment(task_id: str = "task-a", lease_id: str = "lease-a", channel: str = "amazon") -> dict[str, object]:
    return {"taskId": task_id, "leaseId": lease_id, "jobId": "job-a", "channel": channel,
            "asin": "B012345678", "source": "Desk lamps" if channel == "pinterest" else "B012345678",
            "url": "https://amazon.com/dp/B012345678", "settingsFingerprint": "settings"}


class DashboardStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "agent.sqlite3"
        self.store = ClientStore(self.path)
        self.now = datetime(2026, 9, 29, 1, 0, tzinfo=timezone.utc)
        self.dashboard = DashboardState(self.store, now=lambda: self.now)

    def test_progress_matches_each_input_and_keeps_captcha_until_that_task_continues(self) -> None:
        first = assignment()
        second = {**assignment("task-b", "lease-b"), "asin": "B098765432", "source": "B098765432"}
        for task in (first, second):
            self.dashboard.receive(task)
            self.dashboard.start(task)
        self.dashboard.progress([first, second], {"phase": "captcha", "source": "B012345678",
            "items": [{"source": "B012345678", "phase": "captcha", "currentAsin": "B011111111"}]})
        self.dashboard.progress([first, second], {"phase": "product", "source": "B098765432",
            "completed": 1, "total": 2, "items": [{"source": "B098765432", "phase": "product",
            "variantCompleted": 2, "variantTotal": 5, "activeVariants": [{"asin": "B022222222"}]}]})
        rows = self.dashboard.snapshot()["tasks"]
        self.assertTrue(self.dashboard.waiting_captcha)
        self.assertEqual(rows[0]["currentAsin"], "B011111111")
        self.assertEqual(rows[1]["variantCompleted"], 2)
        self.assertEqual(rows[1]["activeVariants"], ["B022222222"])
        self.assertNotIn("percent", rows[1])
        self.dashboard.progress([first], {"phase": "product", "source": "B012345678"})
        self.assertFalse(self.dashboard.waiting_captcha)

    def test_unknown_source_does_not_overwrite_other_tasks(self) -> None:
        task = assignment()
        self.dashboard.receive(task)
        self.dashboard.start(task)
        self.dashboard.progress([task], {"source": "unknown", "phase": "captcha", "message": "wrong"})
        self.assertFalse(self.dashboard.waiting_captcha)

    def test_captcha_without_asin_shows_detection_without_marking_all_tasks_blocked(self) -> None:
        first = assignment()
        second = assignment("task-b", "lease-b")
        for task in (first, second):
            self.dashboard.receive(task)
            self.dashboard.start(task)
        self.dashboard.progress([first, second], {"phase": "captcha"})
        self.assertTrue(self.dashboard.has_unattributed_captcha)
        self.assertFalse(self.dashboard.waiting_captcha)
        self.dashboard.finish(first, "completed")
        self.assertTrue(self.dashboard.has_unattributed_captcha)
        self.dashboard.finish(second, "completed")
        self.assertFalse(self.dashboard.has_unattributed_captcha)

    def test_pinterest_has_label_and_no_fake_percentage(self) -> None:
        task = assignment(channel="pinterest")
        self.dashboard.receive(task)
        self.dashboard.start(task)
        self.dashboard.progress([task], {"phase": "pinterest", "message": "Đang render", "percent": 50})
        row = self.dashboard.snapshot()["tasks"][0]
        self.assertEqual(row["label"], "Desk lamps")
        self.assertNotIn("percent", row)

    def test_completion_upload_and_replay_are_separate_and_idempotent(self) -> None:
        task = assignment()
        self.dashboard.receive(task)
        self.dashboard.finish(task, "completed")
        row = self.dashboard.snapshot()["tasks"][0]
        self.assertEqual(row["state"], "completed")
        self.assertEqual(row["delivery"], "pending")
        self.dashboard.delivery("task-a", "lease-a", "sent")
        self.dashboard.delivery("task-a", "lease-a", "sent")
        self.dashboard.receive(task)
        rows = self.dashboard.snapshot()["history"]
        self.assertEqual(len(rows), 1)
        events = self.dashboard.snapshot()["events"]
        self.assertEqual(sum(event["event"] == "sent" for event in events), 1)

    def test_upload_ack_arriving_before_completion_does_not_revert_to_pending(self) -> None:
        task = assignment()
        self.dashboard.receive(task)
        self.dashboard.start(task)
        self.dashboard.delivery("task-a", "lease-a", "sent")
        self.dashboard.finish(task, "completed")
        row = self.dashboard.snapshot()["history"][0]
        self.assertEqual(row["delivery"], "sent")
        self.assertEqual(row["state"], "completed")
        self.assertEqual(self.dashboard.snapshot()["tasks"], [])

    def test_quarantined_delivery_is_not_presented_as_retrying(self) -> None:
        task = assignment()
        self.dashboard.receive(task)
        self.dashboard.start(task)
        self.dashboard.delivery("task-a", "lease-a", "quarantined")
        self.dashboard.finish(task, "failed")

        row = self.dashboard.snapshot()["tasks"][0]

        self.assertEqual(row["state"], "failed")
        self.assertEqual(row["delivery"], "quarantined")

    def test_errors_are_explained_without_raw_internal_exceptions(self) -> None:
        task = assignment()
        self.dashboard.receive(task)
        self.dashboard.finish(task, "failed", {"code": "CRAWL_TIMEOUT", "message": "PRIVATE_STACK_TRACE"})
        message = self.dashboard.snapshot()["history"][0]["message"]
        self.assertIn("thời gian", message)
        self.assertNotIn("PRIVATE_STACK_TRACE", message)

    def test_restart_reconciles_live_spool_and_never_restores_running_from_history(self) -> None:
        task = assignment()
        self.store.save_assignment(task)
        self.dashboard.receive(task)
        self.dashboard.start(task)
        restored = DashboardState(self.store, now=lambda: self.now)
        self.assertEqual(restored.snapshot()["tasks"][0]["state"], "recovering")
        self.store.spool_result(task_id="task-a", lease_id="lease-a", checksum="checksum", payload={})
        restored = DashboardState(self.store, now=lambda: self.now)
        self.assertEqual(restored.snapshot()["tasks"][0]["delivery"], "pending")
        self.store.acknowledge_result(self.store.pending_results()[0]["resultId"])
        restored = DashboardState(self.store, now=lambda: self.now)
        self.assertEqual(restored.snapshot()["tasks"], [])

    def test_retention_preserves_live_work_and_existing_identity(self) -> None:
        client_id = self.store.client_id()
        task = assignment()
        self.store.save_assignment(task)
        self.dashboard.receive(task)
        old = assignment("old", "old-lease")
        self.dashboard.receive(old)
        self.dashboard.finish(old, "failed")
        self.now += timedelta(days=8)
        self.dashboard.prune()
        rows = self.dashboard.snapshot()["history"]
        self.assertEqual([row["taskId"] for row in rows], ["task-a"])
        self.assertEqual(ClientStore(self.path).client_id(), client_id)

    def test_history_limits_and_activity_limits(self) -> None:
        for index in range(1003):
            task = assignment(str(index), str(index))
            self.dashboard.receive(task)
            self.dashboard.finish(task, "failed")
        self.dashboard.prune()
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM dashboard_tasks").fetchone()[0], 1000)
        for index in range(5003):
            self.dashboard.activity("connected" if index % 2 else "offline")
        self.dashboard.prune()
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertLessEqual(connection.execute("SELECT COUNT(*) FROM dashboard_events").fetchone()[0], 5000)

    def test_dashboard_does_not_persist_raw_payloads_or_credentials(self) -> None:
        register_redactions(["sample-secret-credential"])
        task = {**assignment(), "settings": {"password": "sample-secret-credential"}, "products": [{"html": "RAW_HTML"}]}
        self.dashboard.receive(task)
        self.dashboard.start(task)
        self.dashboard.progress([task], {"source": "B012345678", "phase": "product",
            "message": "Authorization: Bearer sample-secret-credential", "html": "RAW_HTML"})
        self.dashboard.finish(task, "failed")
        with closing(sqlite3.connect(self.path)) as connection:
            persisted = json.dumps(connection.execute("SELECT payload_json FROM dashboard_tasks").fetchall())
        self.assertNotIn("sample-secret-credential", persisted)
        self.assertNotIn("RAW_HTML", persisted)
        self.assertNotIn("password", persisted)

    def test_counts_include_backlogs_beyond_upload_batch_sizes(self) -> None:
        for index in range(75):
            self.store.spool_product(task_id="task-a", product_key=str(index), lease_id="lease-a", checksum="sum", payload={})
        for index in range(25):
            self.store.spool_result(task_id=str(index), lease_id="lease-a", checksum="sum", payload={})
        self.assertEqual(self.store.upload_counts(), {"products": 75, "results": 25})

    def test_malformed_history_is_ignored_without_changing_lease_or_identity(self) -> None:
        client_id = self.store.client_id()
        task = assignment()
        self.store.save_assignment(task)
        with self.store._connection() as connection:
            connection.execute("INSERT INTO dashboard_tasks VALUES (?,?,?,?,?)", ("bad", "lease", "job", self.now.isoformat(),
                json.dumps({"state": ["invalid"], "active_variants": 123})))
        restored = DashboardState(self.store, now=lambda: self.now)
        self.assertEqual(len(restored.snapshot()["tasks"]), 1)
        self.assertEqual(self.store.client_id(), client_id)
        self.assertIsNotNone(self.store.assignment("task-a"))


class DashboardAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        config = AgentConfig(server_url="http://127.0.0.1:9999", display_name="Test agent",
                             max_concurrent_inputs=4, limits=AgentLimits(), data_directory=root)
        self.agent = DistributedCrawlerAgent(project_root=root, config=config)

    def test_pausing_offline_never_claims_an_actual_connection(self) -> None:
        self.agent.set_paused(True)
        self.assertFalse(self.agent.status_snapshot()["isConnected"])
        self.assertTrue(self.agent.status_snapshot()["isPaused"])
        self.assertEqual(self.agent.status_snapshot()["availableSlots"], 0)

    def test_local_stop_includes_completed_tasks_waiting_for_upload(self) -> None:
        task = assignment()
        self.agent.store.save_assignment(task)
        self.agent.dashboard.receive(task)
        self.agent.dashboard.finish(task, "completed")
        self.agent.store.spool_result(task_id="task-a", lease_id="lease-a", checksum="sum", payload={})
        self.assertEqual(self.agent.stop_and_discard_local_work(), 1)
        self.assertEqual(self.agent.store.upload_counts()["results"], 1)
        self.assertEqual(self.agent.store.pending_results(), [])
        self.assertEqual(len(self.agent.store.quarantined_uploads()), 1)
        self.assertEqual(self.agent.store.cancel_intents(), ["job-a"])
        snapshot = self.agent.status_snapshot()
        self.assertEqual(snapshot["dashboard"]["history"][0]["delivery"], "cancelled")
        self.assertEqual(snapshot["pendingResults"], 0)
        self.assertEqual(snapshot["pendingProducts"], 0)
        self.assertEqual(snapshot["quarantinedUploads"], 1)

    def test_history_io_failure_does_not_stop_crawler_status(self) -> None:
        with patch.object(self.agent.dashboard, "snapshot", side_effect=sqlite3.OperationalError("disk")):
            status = self.agent.status_snapshot()
        self.assertTrue(status["dashboardUnavailable"])
        self.assertEqual(status["pendingUploads"], 0)

    def test_cli_preserves_console_mode_and_allows_background_start(self) -> None:
        arguments = build_parser().parse_args(["--no-tray", "--start-minimized", "--check-config"])
        self.assertTrue(arguments.no_tray)
        self.assertTrue(arguments.start_minimized)
        self.assertTrue(arguments.check_config)

    def test_lifecycle_launch_closes_dashboard_through_ui_queue(self) -> None:
        tray = TrayApplication(self.agent, Path(self.directory.name))
        tray._window = Mock()
        tray._icon = Mock()
        tray._lifecycle_is_safe = Mock(return_value=True)
        tray._stop_agent = Mock()
        with patch.object(Path, "is_file", return_value=True), patch("engine.distributed.client_tray.subprocess.Popen"):
            tray._launch_lifecycle_script("update-agent.ps1", [])
        tray._window.close.assert_not_called()
        self.assertEqual(tray._actions.get_nowait(), "exit")
        tray._dispatch_action("exit")
        tray._window.close.assert_called_once()
        self.assertTrue(tray._is_exiting)

    def test_tray_clicks_queue_window_work_and_never_call_tk_from_callback(self) -> None:
        tray = TrayApplication(self.agent, Path(self.directory.name))
        window = Mock()
        tray._window = window
        tray._show_window(None, None)
        window.show.assert_not_called()
        tray._dispatch_action(tray._actions.get_nowait())
        window.show.assert_called_once()
        tray._stop_local_work(None, None)
        window.confirm_stop.assert_not_called()
        tray._dispatch_action(tray._actions.get_nowait())
        window.confirm_stop.assert_called_once()


@unittest.skipUnless(os.name == "nt" and os.environ.get("FFP_TEST_NATIVE_WINDOW") == "1", "Native Tk runs in an isolated process")
class DashboardWindowTests(unittest.TestCase):
    def setUp(self) -> None:
        from engine.distributed.client_dashboard_window import AgentDashboardWindow

        self.actions: list[str] = []
        self.task = {"taskId": "a", "leaseId": "lease-a", "jobId": "job-a", "channel": "amazon", "label": "B012345678",
                     "asin": "B012345678", "currentAsin": "B011111111", "state": "captcha", "phase": "captcha",
                     "delivery": "none", "variantCompleted": 2, "variantTotal": 5, "activeVariants": ["B011111111"]}
        self.snapshot = {"displayName": "Test agent", "isConnected": False, "isPaused": True,
                         "dashboard": {"tasks": [self.task], "history": [self.task], "events": []}}
        self.window = AgentDashboardWindow(lambda: self.snapshot, self.actions.append, start_minimized=True)
        self.addCleanup(self.window.close)
        self.window.root.update()

    def test_start_minimized_and_close_to_tray(self) -> None:
        self.assertEqual(self.window.root.state(), "withdrawn")
        self.window.show()
        self.window.root.update()
        close_command = self.window.root.protocol("WM_DELETE_WINDOW")
        self.window.root.tk.call(close_command)
        self.assertEqual(self.window.root.state(), "withdrawn")
        self.assertEqual(self.actions, [])

    def test_selection_displays_assigned_and_current_asin_and_real_variant_counts(self) -> None:
        self.window.work_tree.selection_set("a/lease-a")
        self.window.root.update()
        detail = self.window.details.get("1.0", "end")
        self.assertIn("B012345678", detail)
        self.assertIn("B011111111", detail)
        self.assertIn("2/5", detail)
        self.assertIn("Mất kết nối", self.window.connection.cget("text"))

    def test_channel_filters_history_and_preserves_selection_during_refresh(self) -> None:
        self.window.work_tree.selection_set("a/lease-a")
        self.window.root.update()
        self.window.render(self.snapshot)
        self.assertEqual(self.window.work_tree.selection(), ("a/lease-a",))
        self.window.channel_filter.set("Pinterest")
        self.window.render(self.snapshot)
        self.assertEqual(self.window.history_tree.get_children(), ())

    def test_stop_is_only_dispatched_after_confirmation(self) -> None:
        with patch("engine.distributed.client_dashboard_window.messagebox.askyesno", return_value=False):
            self.window.confirm_stop()
        self.assertEqual(self.actions, [])
        with patch("engine.distributed.client_dashboard_window.messagebox.askyesno", return_value=True) as confirm:
            self.window.confirm_stop()
        self.assertEqual(self.actions, ["stop"])
        self.assertIn("1 công việc thuộc 1 job", confirm.call_args.args[1])

    def test_stop_confirmation_does_not_claim_zero_tasks_when_history_is_unavailable(self) -> None:
        self.snapshot["dashboardUnavailable"] = True
        self.snapshot["dashboard"] = {"tasks": [], "history": [], "events": []}
        with patch("engine.distributed.client_dashboard_window.messagebox.askyesno", return_value=False) as confirm:
            self.window.confirm_stop()
        self.assertNotIn("0 công việc", confirm.call_args.args[1])
        self.assertIn("toàn bộ", confirm.call_args.args[1])

    def test_history_activity_and_agent_copy_button_remain_visible_at_small_sizes(self) -> None:
        self.window.show()
        self.window.root.geometry("860x650")
        self.window.notebook.select(1)
        self.window.root.update()
        self.assertGreater(self.window.history_tree.winfo_height(), 80)
        self.window.history_notebook.select(1)
        self.window.root.update()
        self.assertGreater(self.window.events_tree.winfo_height(), 80)
        self.window.notebook.select(2)
        self.window.root.update()
        self.assertTrue(self.window.copy_agent_button.winfo_viewable())
        self.assertLess(self.window.copy_agent_button.winfo_rooty(), self.window.root.winfo_rooty() + self.window.root.winfo_height())

    def test_layout_at_125_and_150_percent_font_scaling(self) -> None:
        import tkinter as tk
        from engine.distributed.client_dashboard_window import AgentDashboardWindow

        create_root = tk.Tk
        for scale in (120 / 72, 144 / 72):
            def scaled_root() -> tk.Tk:
                root = create_root()
                root.tk.call("tk", "scaling", scale)
                return root

            with patch("engine.distributed.client_dashboard_window.tk.Tk", side_effect=scaled_root):
                scaled = AgentDashboardWindow(lambda: self.snapshot, self.actions.append, start_minimized=True)
            try:
                scaled.show()
                scaled.root.geometry("1100x780")
                scaled.notebook.select(1)
                scaled.root.update()
                self.assertGreater(scaled.history_tree.winfo_height(), 80)
                scaled.notebook.select(2)
                scaled.root.update()
                self.assertTrue(scaled.copy_agent_button.winfo_viewable())
                self.assertLess(scaled.pause_button.winfo_rooty() + scaled.pause_button.winfo_height(),
                                scaled.root.winfo_rooty() + scaled.root.winfo_height())
            finally:
                scaled.close()


@unittest.skipUnless(os.name == "nt", "Native Windows Tk integration")
class DashboardWindowProcessTests(unittest.TestCase):
    def test_native_window_selection_filters_close_and_confirmation(self) -> None:
        # Tk finalizers cannot run in a later crawler test's worker thread during GC.
        environment = {**os.environ, "FFP_TEST_NATIVE_WINDOW": "1"}
        result = subprocess.run([sys.executable, "-m", "unittest", "engine.tests.test_agent_dashboard.DashboardWindowTests", "-v"],
                                cwd=Path(__file__).resolve().parents[2], env=environment,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


@unittest.skipUnless(os.name == "nt", "Windows named event integration")
class DashboardActivationTests(unittest.TestCase):
    def test_signal_reopens_only_the_matching_instance_and_is_consumed_once(self) -> None:
        from engine.distributed.client_activation import ActivationSignal, request_activation

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            signal = ActivationSignal(path)
            try:
                self.assertFalse(signal.requested())
                self.assertFalse(request_activation(path / "other"))
                self.assertTrue(request_activation(path))
                self.assertTrue(signal.requested())
                self.assertFalse(signal.requested())
            finally:
                signal.close()
            self.assertFalse(request_activation(path))


if __name__ == "__main__":
    unittest.main()
