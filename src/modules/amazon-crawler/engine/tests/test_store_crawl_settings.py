import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.coordinator_models import CrawlJob
from engine.distributed.operator_authorization import OperatorCredentials


class StoreCrawlSettingsTests(unittest.TestCase):
    def test_defaults_are_durable_isolated_and_snapshotted_for_new_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            url = f"sqlite:///{(Path(directory) / 'settings.sqlite3').as_posix()}"
            path = '/api/v1/store-vendors/store-a/crawl-settings'
            with TestClient(create_coordinator_app(database_url=url, operator_auth_disabled=True)) as client:
                client.put('/api/v1/store-vendors/store-a', json={'vendor': 'Existing Brand'})
                initial = client.get(path).json()
                self.assertEqual(initial['vendor'], 'Existing Brand')
                self.assertIsNone(initial['defaults'])
                config = client.put(path, json={
                    'vendor': ' Brand A ', 'profileSlug': 'jeminise',
                    'imageProfileSlug': 'default', 'applyJeminisePreset': True,
                }).json()
                self.assertEqual(config['vendor'], 'Brand A')
                self.assertIsNone(client.get('/api/v1/store-vendors/store-b/crawl-settings').json()['defaults'])
                job = client.post('/api/v1/crawl-jobs', json={
                    'urls': ['B0FR4MSS2H'], 'storeId': 'store-a', 'profileSlug': 'default',
                    'storeCrawlSettingsUpdatedAt': config['updatedAt'], 'priceAddition': 6.95,
                }).json()
                self.assertEqual(job['settings']['profileSlug'], 'jeminise')
                self.assertTrue(job['settings']['applyJeminisePreset'])
                self.assertEqual(job['settings']['vendor'], 'Brand A')
                self.assertEqual(job['settings']['priceAddition'], 6.95)
                client.put('/api/v1/store-vendors/store-a', json={'vendor': 'Changed Brand'})
                self.assertEqual(client.get(path).json()['defaults'], config['defaults'])
                stale = client.post('/api/v1/crawl-jobs', json={
                    'urls': ['B0FR4MSS2H'], 'storeId': 'store-a',
                    'storeCrawlSettingsUpdatedAt': config['updatedAt'],
                })
                self.assertEqual(stale.status_code, 422)
                with self.assertRaisesRegex(ValueError, 'STORE_CRAWL_SETTINGS_CHANGED'):
                    client.app.state.store.create_job({
                        'urls': ['B0FR4MSS2H'], 'storeId': 'store-a',
                        'storeCrawlSettingsUpdatedAt': config['updatedAt'],
                    }, require_store_vendor=True)
                with client.app.state.store.sessions.begin() as session:
                    session.get(CrawlJob, job['id']).status = 'completed'
                replacement = client.post(f"/api/v1/crawl-jobs/{job['id']}/replace", json={
                    'urls': ['B0FR4MSS2H'], 'storeId': 'store-a', 'profileSlug': 'default',
                }).json()['replacementJob']
                self.assertEqual(replacement['settings']['profileSlug'], 'jeminise')
                self.assertEqual(replacement['settings']['vendor'], 'Changed Brand')
                self.assertEqual(client.get(f"/api/v1/crawl-jobs/{job['id']}").json()['settings']['vendor'], 'Brand A')
            with TestClient(create_coordinator_app(database_url=url, operator_auth_disabled=True)) as client:
                self.assertEqual(client.get(path).json()['defaults'], config['defaults'])

    def test_invalid_or_missing_profiles_cannot_be_saved_and_auth_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            url = f"sqlite:///{(Path(directory) / 'settings.sqlite3').as_posix()}"
            app = create_coordinator_app(database_url=url, operator_credentials=OperatorCredentials('operator', 'fixture-secret'))
            with TestClient(app) as client:
                path = '/api/v1/store-vendors/store-a/crawl-settings'
                valid = {'vendor': 'Brand', 'profileSlug': 'default', 'imageProfileSlug': 'default', 'applyJeminisePreset': False}
                auth = ('operator', 'fixture-secret')
                self.assertEqual(client.get(path).status_code, 401)
                self.assertEqual(client.put(path, json=valid).status_code, 401)
                self.assertEqual(client.put(path, json=valid, auth=auth, headers={'Origin': 'https://untrusted.invalid'}).status_code, 403)
                for patch in ({'vendor': ''}, {'profileSlug': 'unknown'}, {'imageProfileSlug': 'missing-profile'},
                              {'applyJeminisePreset': 'false'}, {'applyJeminisePreset': True}):
                    self.assertEqual(client.put(path, json={**valid, **patch}, auth=auth).status_code, 422)
                self.assertIsNone(client.get(path, auth=auth).json()['defaults'])
                self.assertEqual(client.put(path, json=valid, auth=auth).status_code, 200)

    def test_deleted_image_profile_blocks_new_jobs_without_falling_back(self):
        with tempfile.TemporaryDirectory() as directory:
            url = f"sqlite:///{(Path(directory) / 'settings.sqlite3').as_posix()}"
            with TestClient(create_coordinator_app(database_url=url, operator_auth_disabled=True)) as client:
                image_path = '/api/v1/image-profiles/store-settings-test-logo'
                self.assertEqual(client.put(image_path, json={'name': 'Test Logo', 'enabled': False}).status_code, 200)
                path = '/api/v1/store-vendors/store-a/crawl-settings'
                config = client.put(path, json={'vendor': 'Brand', 'profileSlug': 'default',
                    'imageProfileSlug': 'store-settings-test-logo', 'applyJeminisePreset': False}).json()
                self.assertEqual(client.delete(image_path).status_code, 200)
                rejected = client.post('/api/v1/crawl-jobs', json={'urls': ['B0FR4MSS2H'], 'storeId': 'store-a',
                    'imageProfileSlug': 'default', 'storeCrawlSettingsUpdatedAt': config['updatedAt']})
                self.assertEqual(rejected.status_code, 422)
                self.assertIn('Unknown image profile', rejected.json()['detail'])
