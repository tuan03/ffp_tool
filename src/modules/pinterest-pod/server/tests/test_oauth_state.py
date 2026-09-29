from __future__ import annotations

import os
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

import pinterest_pod_bridge as bridge
from pinterest_pod_bridge import generate_pinterest_oauth_url, validate_pinterest_oauth_state


class PinterestOauthStateTests(unittest.TestCase):
    def test_auth_status_reports_missing_oauth_configuration_without_failing(self) -> None:
        clean_environment = {
            "PINTEREST_APP_ID": "",
            "PINTEREST_APP_SECRET": "",
            "PINTEREST_OAUTH_STATE_SECRET": "",
            "PINTEREST_ACCESS_TOKEN": "",
        }
        with (
            patch.dict(os.environ, clean_environment, clear=False),
            patch.object(bridge, "check_browser_profile_logged_in", return_value=False),
            patch.object(bridge, "check_oauth_token_valid", return_value=(False, {})),
        ):
            status = bridge.get_pinterest_auth_status()

        self.assertTrue(status["ok"])
        self.assertFalse(status["oauth_configured"])
        self.assertIn("PINTEREST_APP_ID", status["oauth_config_error"])

    def test_generated_state_is_signed_and_valid(self) -> None:
        with patch.dict(os.environ, {"PINTEREST_APP_ID": "test-app", "PINTEREST_APP_SECRET": "test-secret"}, clear=False):
            response = generate_pinterest_oauth_url("https://example.test/api/pinterest-pod/oauth/callback")
            state = urllib.parse.parse_qs(urllib.parse.urlsplit(response["auth_url"]).query)["state"][0]

            self.assertTrue(validate_pinterest_oauth_state(state))

    def test_tampered_state_is_rejected(self) -> None:
        with patch.dict(os.environ, {"PINTEREST_APP_ID": "test-app", "PINTEREST_APP_SECRET": "test-secret"}, clear=False):
            response = generate_pinterest_oauth_url()
            state = urllib.parse.parse_qs(urllib.parse.urlsplit(response["auth_url"]).query)["state"][0]

            self.assertFalse(validate_pinterest_oauth_state(f"{state}tampered"))

    def test_auth_status_reads_token_from_durable_runtime_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            token_file = Path(temporary_directory) / "pinterest_oauth_tokens.json"
            token_file.write_text('{"access_token":"test-token"}', encoding="utf-8")
            environment = {"PINTEREST_APP_ID": "test-app", "PINTEREST_APP_SECRET": "test-secret"}
            with (
                patch.dict(os.environ, environment, clear=False),
                patch.object(bridge, "PRIMARY_TOKEN_FILE", token_file),
                patch.object(bridge, "check_browser_profile_logged_in", return_value=False),
            ):
                status = bridge.get_pinterest_auth_status()

            self.assertTrue(status["oauth_valid"])
            self.assertTrue(status["oauth_file_exists"])
            self.assertNotIn("API OK", status["status_text"])
            self.assertIn("quyền Trends được kiểm tra khi quét", status["status_text"])


if __name__ == "__main__":
    unittest.main()
