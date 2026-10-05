"""Process relaunch contract for durable agent restart commands."""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.distributed.client_restart import launch_replacement_agent
from engine.distributed.client_main import _acquire_agent_lock
from engine.distributed.instance_lock import AgentAlreadyRunningError


class AgentRestartLauncherTests(unittest.TestCase):
    def test_replacement_waits_for_old_instance_lock_to_release(self) -> None:
        class FakeLock:
            attempts = 0

            def __init__(self, _directory: Path) -> None:
                pass

            def __enter__(self):
                type(self).attempts += 1
                if type(self).attempts == 1:
                    raise AgentAlreadyRunningError("old instance has not released its lock")
                return self

            def __exit__(self, *_args):
                return None

        with patch("engine.distributed.client_main.AgentInstanceLock", FakeLock), \
                patch("engine.distributed.client_main.time.sleep"):
            with _acquire_agent_lock(Path("C:/agent"), restart_command_id="restart-123") as lock:
                self.assertEqual(FakeLock.attempts, 2)

    def test_replacement_launch_carries_command_id_and_uses_detached_process(self) -> None:
        with patch.object(sys, "frozen", False, create=True), patch.object(sys, "argv", ["agent.py", "--no-tray"]), \
                patch("engine.distributed.client_restart.subprocess.Popen") as popen:
            self.assertTrue(launch_replacement_agent("restart-123", Path("C:/agent")))

        arguments, options = popen.call_args
        command = arguments[0]
        self.assertEqual(command[0], sys.executable)
        self.assertIn("agent.py", command)
        self.assertIn("--no-tray", command)
        self.assertEqual(command[-2:], ["--restart-command-id", "restart-123"])
        self.assertEqual(options["cwd"], "C:\\agent")
        self.assertTrue(options["close_fds"])
        self.assertTrue(options["creationflags"] & getattr(subprocess, "DETACHED_PROCESS", 0x00000008))

    def test_invalid_command_id_is_not_launched(self) -> None:
        with patch("engine.distributed.client_restart.subprocess.Popen") as popen:
            self.assertFalse(launch_replacement_agent("invalid id", Path("C:/agent")))
        popen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
