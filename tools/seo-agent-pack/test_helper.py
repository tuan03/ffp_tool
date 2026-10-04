import json
import io
import pathlib
import tempfile
import time
import tomllib
import unittest
from unittest.mock import Mock, patch

import ffp_worker as worker


class HelperTests(unittest.TestCase):
    def test_transport_identifies_application_and_redacts_http_errors(self):
        remote = worker.Remote("https://example.com/mcp/seo-worker", "secret-test-token")
        remote.opener = Mock()
        remote.opener.open.return_value = io.BytesIO(b'{"result":{}}')
        remote.send({"method": "tools/list"})
        request = remote.opener.open.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), "FFP-SEO-Worker/1.0")
        for status in [401, 403, 500]:
            remote.opener.open.side_effect = worker.urllib.error.HTTPError(remote.url, status, "secret-test-token", {}, io.BytesIO(b'secret-test-token'))
            with self.assertRaises(worker.SafeTransportError) as caught:
                remote.send({"method": "tools/list"})
            self.assertIn(str(status), str(caught.exception))
            self.assertNotIn("secret-test-token", str(caught.exception))

    def test_transport_retries_same_payload_and_respects_retry_after(self):
        remote = worker.Remote("https://example.com/mcp/seo-worker", "synthetic-test-token")
        error = worker.urllib.error.HTTPError(remote.url, 429, "limited", {"Retry-After": "2"}, None)
        remote.opener = Mock()
        remote.opener.open.side_effect = [error, io.BytesIO(b'{"result":{}}')]
        message = {"method": "tools/call", "params": {"name": "job_submit_draft", "arguments": {"requestId": "same"}}}
        with patch.object(worker.time, "sleep") as sleep:
            self.assertEqual(remote.send(message), {"result": {}})
            sleep.assert_called_once_with(2)
        calls = remote.opener.open.call_args_list
        self.assertEqual(calls[0].args[0].data, calls[1].args[0].data)

    def test_transport_stops_on_auth_or_after_three_network_failures(self):
        remote = worker.Remote("https://example.com/mcp/seo-worker", "synthetic-test-token")
        remote.opener = Mock()
        remote.opener.open.side_effect = worker.urllib.error.HTTPError(remote.url, 401, "denied", {}, None)
        with self.assertRaisesRegex(RuntimeError, "rejected"):
            remote.send({"method": "tools/list"})
        self.assertEqual(remote.opener.open.call_count, 1)
        remote.opener.reset_mock()
        remote.opener.open.side_effect = worker.urllib.error.URLError("offline")
        with patch.object(worker.time, "sleep"), self.assertRaisesRegex(RuntimeError, "resume safely"):
            remote.send({"method": "tools/list"})
        self.assertEqual(remote.opener.open.call_count, 3)

    def test_retry_policy_requires_replayable_mutations(self):
        read = {"method": "tools/call", "params": {"name": "run_status", "arguments": {"runId": "r"}}}
        write = {"method": "tools/call", "params": {"name": "job_submit_draft", "arguments": {"requestId": "same"}}}
        self.assertTrue(worker.can_retry(read))
        self.assertTrue(worker.can_retry(write))
        self.assertFalse(worker.can_retry({"method": "tools/call", "params": {"name": "job_submit_draft", "arguments": {}}}))
        self.assertEqual(worker.retry_delay("120", 0, now=0), 120)
        self.assertIsNone(worker.retry_delay("99999", 0, now=0))

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
