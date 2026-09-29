from __future__ import annotations

import os
import sys
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from pinterest_pod_bridge import generate_pinterest_oauth_url, validate_pinterest_oauth_state


class PinterestOauthStateTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
