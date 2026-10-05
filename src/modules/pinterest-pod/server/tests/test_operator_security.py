"""Operator boundary regression tests; no external service or real credentials."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import operator_security as security


class OperatorSecurityTests(unittest.TestCase):
    def test_coordinator_credentials_are_destination_bound(self):
        with patch.dict('os.environ', {
            'PINTEREST_COORDINATOR_OPERATOR_USERNAME': 'fixture', 'PINTEREST_COORDINATOR_OPERATOR_PASSWORD': 'secret',
            'PINTEREST_COORDINATOR_URL': 'https://coordinator.invalid',
        }):
            self.assertIn('Authorization', security.coordinator_headers('https://coordinator.invalid/api/v1/clients'))
            self.assertEqual(security.coordinator_headers('https://external.invalid/api/v1/clients'), {})
            self.assertEqual(security.coordinator_headers('https://coordinator.invalid/unrelated'), {})

    def test_coordinator_credentials_do_not_enable_pinterest_ui_authentication(self):
        with patch.dict('os.environ', {
            'PINTEREST_COORDINATOR_OPERATOR_USERNAME': 'fixture',
            'PINTEREST_COORDINATOR_OPERATOR_PASSWORD': 'secret',
            'PINTEREST_OPERATOR_USERNAME': '',
            'PINTEREST_OPERATOR_PASSWORD': '',
            'PINTEREST_COORDINATOR_URL': 'http://127.0.0.1:8766',
        }):
            self.assertIsNone(security.operator_credentials())
            self.assertEqual(security.coordinator_headers('http://127.0.0.1:8766/api/v1/clients')['Authorization'],
                'Basic Zml4dHVyZTpzZWNyZXQ=')

    def test_partial_coordinator_credentials_fail_closed(self):
        with patch.dict('os.environ', {
            'PINTEREST_COORDINATOR_OPERATOR_USERNAME': 'fixture',
            'PINTEREST_COORDINATOR_OPERATOR_PASSWORD': '',
        }):
            with self.assertRaisesRegex(ValueError, 'Incomplete Pinterest Coordinator'):
                security.coordinator_operator_credentials()

    def test_sessions_expire_and_revoke_without_storing_password(self):
        sessions = security.OperatorSessions()
        token = sessions.create('fingerprint', now=100)
        self.assertTrue(sessions.accepts(token, 'fingerprint', now=101))
        self.assertFalse(sessions.accepts(token, 'changed', now=101))
        self.assertFalse(sessions.accepts(token, 'fingerprint', now=4000))
        sessions.revoke(token)
        self.assertFalse(sessions.accepts(token, 'fingerprint', now=101))

    def test_partial_configuration_fails_closed(self):
        with patch.dict('os.environ', {'PINTEREST_OPERATOR_USERNAME': 'fixture', 'PINTEREST_OPERATOR_PASSWORD': ''}):
            with self.assertRaises(ValueError):
                security.operator_credentials()

    def test_credential_transport_rejects_remote_http_and_redirects(self):
        with patch.dict('os.environ', {
            'PINTEREST_COORDINATOR_OPERATOR_USERNAME': 'fixture', 'PINTEREST_COORDINATOR_OPERATOR_PASSWORD': 'secret',
            'PINTEREST_COORDINATOR_URL': 'http://remote.invalid',
        }):
            with self.assertRaises(ValueError):
                security.coordinator_headers('http://remote.invalid/api/v1/clients')
        self.assertIsNone(security.NoCredentialRedirect().redirect_request(None, None, 302, '', {}, 'https://other.invalid'))

    def test_readiness_checks_authorized_clients_not_public_health(self):
        import pinterest_pod_bridge as bridge
        import urllib.error
        with patch.object(bridge, 'http_get_json', side_effect=urllib.error.HTTPError('https://fixture.invalid', 401, '', {}, None)) as get:
            self.assertFalse(bridge.check_pinterest_coordinator_ready())
            self.assertTrue(get.call_args.args[0].endswith('/api/v1/clients'))

    def test_job_listing_does_not_hide_auth_failure(self):
        import pinterest_pod_bridge as bridge
        import urllib.error
        with patch.object(bridge, 'http_get_json', side_effect=urllib.error.HTTPError('https://fixture.invalid', 401, '', {}, None)):
            with self.assertRaisesRegex(RuntimeError, 'PINTEREST_COORDINATOR_AUTH_FAILED'):
                bridge.list_recent_jobs_and_runs()


if __name__ == '__main__':
    unittest.main()
