"""Credential protection and enrollment must not destroy offline work."""
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from engine.distributed.client_credentials import protect_secret, unprotect_secret, validate_secure_origin


class CredentialTests(unittest.TestCase):
    def test_origin_requires_https_without_embedded_credentials(self):
        self.assertEqual(validate_secure_origin("https://crawler.example/"), "https://crawler.example")
        for url in ("http://crawler.example", "https://user:secret@crawler.example", "https://crawler.example/?key=x", "https://crawler.example/path", "file:///tmp/a"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_secure_origin(url)

    @unittest.skipUnless(sys.platform == "win32", "Windows DPAPI integration")
    def test_windows_roundtrip_and_tamper_rejection(self):
        plaintext = b"fixture-secret-not-a-real-agent-key"
        protected = protect_secret(plaintext)
        self.assertNotIn(plaintext, protected)
        self.assertEqual(unprotect_secret(protected), plaintext)
        with self.assertRaises(ValueError):
            unprotect_secret(protected[:10])

    def test_pending_enrollment_is_durable_and_identity_replacement_fails_closed(self):
        from engine.distributed.client_store import ClientStore
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.db")
            original = store.client_id()
            request_id = store.begin_enrollment("protected-fixture")
            reopened = ClientStore(store.path)
            self.assertEqual(reopened.enrollment_state(), ("protected-fixture", request_id))
            with store._connection() as connection:
                connection.execute("INSERT INTO cancel_intents VALUES ('old-job','now')")
            with self.assertRaisesRegex(ValueError, "REBIND_REQUIRED"):
                reopened.accept_enrollment("a" * 32)
            self.assertEqual(reopened.client_id(), original)
            reopened.accept_enrollment(original)
            self.assertEqual(reopened.client_id(), original)

    def test_empty_store_accepts_server_identity(self):
        from engine.distributed.client_store import ClientStore
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.db")
            store.client_id()
            store.accept_enrollment("b" * 32)
            self.assertEqual(store.client_id(), "b" * 32)

    @unittest.skipUnless(sys.platform == "win32", "Windows DPAPI integration")
    def test_key_is_not_plaintext_in_sqlite_and_cannot_move_to_another_origin(self):
        from engine.distributed.client_credentials import store_credential, load_credential
        from engine.distributed.client_store import ClientStore
        key = "ffp_agent_" + "a" * 32 + "_" + "b" * 43
        with tempfile.TemporaryDirectory() as directory:
            store = ClientStore(Path(directory) / "agent.db")
            request_id = store_credential(store, "https://example.test", key)
            self.assertEqual(load_credential(store, "https://example.test"), (key, request_id))
            self.assertNotIn(key.encode(), store.path.read_bytes())
            with self.assertRaisesRegex(ValueError, "CREDENTIAL_UNAVAILABLE"):
                load_credential(store, "https://different.test")

    def test_non_windows_never_falls_back_to_plaintext(self):
        with patch("engine.distributed.client_credentials.sys.platform", "linux"):
            with self.assertRaisesRegex(ValueError, "WINDOWS_CREDENTIAL_STORE_REQUIRED"):
                protect_secret(b"fixture")
