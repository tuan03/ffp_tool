import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.distributed.client_main import main


class AgentInstallReportTests(unittest.TestCase):
    def test_check_config_writes_stable_identity_without_connecting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "agent.json"
            report = root / "identity.json"
            config.write_text(json.dumps({
                "serverUrl": "https://crawler.test", "displayName": "Test agent", "dataDirectory": str(root),
            }), encoding="utf-8")
            identities = []
            for _ in range(2):
                with patch.dict(os.environ, {"AMAZON_COORDINATOR_URL": ""}), contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(main(["--check-config", "--config", str(config), "--installation-report", str(report)]), 0)
                identities.append(json.loads(report.read_text(encoding="utf-8")))
            self.assertEqual(identities[0], identities[1])
            self.assertTrue(identities[0]["clientId"])
            self.assertEqual(identities[0]["serverUrl"], "https://crawler.test")
