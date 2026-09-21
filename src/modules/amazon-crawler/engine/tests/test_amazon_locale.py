from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.amazon_locale import force_us_profile_url, html_is_location_blocked, playwright_us_cookies
from engine.crawler_core import HttpFetcher
from engine.proxy_profiles import ProxyAssignment, resolve_proxy_assignments


class AmazonLocaleTests(unittest.TestCase):
    def test_forces_english_and_usd_without_losing_product_query(self) -> None:
        url = force_us_profile_url("https://www.amazon.com/dp/B012345678?th=1")
        self.assertIn("th=1", url)
        self.assertIn("language=en_US", url)
        self.assertIn("currency=USD", url)

    def test_detects_location_block_only_when_offer_price_is_missing(self) -> None:
        blocked = "<div>Deliver to Vietnam</div><div>This item cannot be shipped to your selected delivery location</div>"
        priced = blocked + '<span class="a-offscreen">$19.99</span>'
        self.assertTrue(html_is_location_blocked(blocked))
        self.assertFalse(html_is_location_blocked(priced))

    def test_playwright_cookies_force_us_language_and_currency(self) -> None:
        cookies = {cookie["name"]: cookie["value"] for cookie in playwright_us_cookies("session-id=abc; sp-cdn=L5Z9:VN; lc-main=vi_VN")}
        self.assertEqual(cookies["session-id"], "abc")
        self.assertEqual(cookies["lc-main"], "en_US")
        self.assertEqual(cookies["i18n-prefs"], "USD")
        self.assertNotIn("sp-cdn", cookies)

    def test_proxy_profiles_rotate_only_when_configured(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config"
            config.mkdir()
            (config / "amazon-crawler-profiles.json").write_text(json.dumps({
                "rotateProfiles": True,
                "profiles": [{"name": "us-one", "proxy": {"server": "http://proxy.test:8080", "username": "user", "password": "secret"}}],
            }), encoding="utf-8")
            with patch.dict(os.environ, {"AMAZON_CRAWLER_PROXIES": ""}, clear=False):
                assignments, warnings = resolve_proxy_assignments(root, 2)
        self.assertEqual(warnings, [])
        self.assertEqual([assignment.name for assignment in assignments], ["us-one", "us-one"])
        self.assertEqual(assignments[0].playwright_proxy(), {"server": "http://proxy.test:8080", "username": "user", "password": "secret"})
        self.assertIn("user:secret@proxy.test:8080", assignments[0].urllib_url())

    def test_http_fetch_refuses_unconfirmed_us_session(self) -> None:
        fetcher = HttpFetcher(zip_code="10001", assignments=[ProxyAssignment(index=0, name="direct")])
        fetcher._bootstrap_us_cookie = lambda assignment: "lc-main=en_US; i18n-prefs=USD"
        with self.assertRaisesRegex(RuntimeError, "could not confirm Amazon US delivery ZIP"):
            fetcher.fetch("https://www.amazon.com/dp/B012345678")


if __name__ == "__main__":
    unittest.main()
