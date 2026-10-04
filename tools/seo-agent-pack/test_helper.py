import json
import pathlib
import tempfile
import time
import tomllib
import unittest
from unittest.mock import patch

import ffp_worker as worker


class HelperTests(unittest.TestCase):
    def test_https_and_redirect_guard(self):
        for url in ["http://example.com/mcp/seo-worker", "https://user:secret@example.com/mcp/seo-worker", "https://example.com/mcp/seo-worker?token=x"]:
            with self.assertRaises(ValueError):
                worker.endpoint(url)
        with self.assertRaises(RuntimeError):
            worker.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example")

    def test_setup_preserves_config_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / ".codex").mkdir()
            config = root / ".codex" / "config.toml"
            original = '[mcp_servers.other]\ncommand = "existing"\n'
            config.write_text(original, encoding="utf-8")
            worker.setup(root, "https://example.com/mcp/seo-worker", "test")
            parsed = tomllib.loads(config.read_text(encoding="utf-8"))
            self.assertEqual(parsed["mcp_servers"]["other"]["command"], "existing")
            self.assertNotIn("token", config.read_text(encoding="utf-8"))
            self.assertTrue((root / ".agents" / "skills" / "ffp-seo" / "SKILL.md").exists())
            with self.assertRaises(RuntimeError):
                worker.setup(root, "https://example.com/mcp/seo-worker", "test")
            self.assertEqual(config.with_name("config.toml.ffp-backup").read_text(encoding="utf-8"), original)

    def test_idle_heartbeat_stops_without_sending(self):
        class Remote:
            def send(self, message):
                raise AssertionError("No heartbeat allowed after idle timeout")
        heartbeat = worker.Heartbeat(Remote())
        heartbeat.lease = {"jobId": "demo"}
        heartbeat.progress_at = time.monotonic() - 1801
        heartbeat.tick()
        self.assertIsNone(heartbeat.lease)

    def test_plaintext_keyring_is_rejected(self):
        import types
        fake = types.SimpleNamespace(get_keyring=lambda: object())
        with patch.dict("sys.modules", {"keyring": fake}):
            with self.assertRaisesRegex(RuntimeError, "plaintext"):
                worker.secret_store()

    def test_errors_are_not_progress(self):
        heartbeat = worker.Heartbeat(None)
        heartbeat.observe({"params": {"name": "queue_claim_next"}}, {"result": {"isError": True}})
        self.assertIsNone(heartbeat.lease)
        message = {"params": {"name": "queue_claim_next"}}
        heartbeat.observe(message, {"result": {"content": [{"type": "text", "text": json.dumps({"lease": {"jobId": "1"}})}]}})
        self.assertEqual(heartbeat.lease["jobId"], "1")


if __name__ == "__main__":
    unittest.main()
