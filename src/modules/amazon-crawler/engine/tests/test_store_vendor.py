import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.operator_authorization import OperatorCredentials
from engine.distributed.coordinator_models import CrawlJob


class StoreVendorTests(unittest.TestCase):
    def test_configuration_is_durable_and_jobs_snapshot_the_server_value(self):
        with tempfile.TemporaryDirectory() as directory:
            url = f"sqlite:///{(Path(directory) / 'vendor.sqlite3').as_posix()}"
            with TestClient(create_coordinator_app(database_url=url, operator_auth_disabled=True)) as client:
                self.assertIsNone(client.get('/api/v1/store-vendors/store-a').json()['vendor'])
                rejected = client.post('/api/v1/crawl-jobs', json={'urls': ['B0FR4MSS2H'], 'storeId': 'store-a', 'vendor': 'Bypass'})
                self.assertEqual(rejected.status_code, 422)
                self.assertEqual(client.put('/api/v1/store-vendors/store-a', json={'vendor': '  Brand A  '}).status_code, 200)
                job = client.post('/api/v1/crawl-jobs', json={'urls': ['B0FR4MSS2H'], 'storeId': 'store-a', 'vendor': 'Bypass'}).json()
                self.assertEqual(job['settings']['vendor'], 'Brand A')
                self.assertEqual(job['settings']['vendorPolicyVersion'], 1)
                client.put('/api/v1/store-vendors/store-a', json={'vendor': 'New Brand'})
                self.assertEqual(client.get(f"/api/v1/crawl-jobs/{job['id']}").json()['settings']['vendor'], 'Brand A')
                with client.app.state.store.sessions.begin() as session:
                    session.get(CrawlJob, job['id']).status = 'completed'
                replacement = client.post(f"/api/v1/crawl-jobs/{job['id']}/replace", json={'urls': ['B0FR4MSS2H'], 'storeId': 'store-a', 'vendor': 'Old Brand'}).json()['replacementJob']
                self.assertEqual(replacement['settings']['vendor'], 'New Brand')
                self.assertIsNone(client.get('/api/v1/store-vendors/store-b').json()['vendor'])
                for invalid in ('', 'a' * 256, 'Brand\nInjected', 42):
                    self.assertEqual(client.put('/api/v1/store-vendors/store-a', json={'vendor': invalid}).status_code, 422)
            with TestClient(create_coordinator_app(database_url=url, operator_auth_disabled=True)) as client:
                self.assertEqual(client.get('/api/v1/store-vendors/store-a').json()['vendor'], 'New Brand')

    def test_vendor_configuration_requires_operator_and_rejects_cross_origin_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            url = f"sqlite:///{(Path(directory) / 'auth.sqlite3').as_posix()}"
            app = create_coordinator_app(database_url=url, operator_credentials=OperatorCredentials('operator', 'fixture-secret'))
            with TestClient(app) as client:
                path = '/api/v1/store-vendors/store-a'
                self.assertEqual(client.get(path).status_code, 401)
                self.assertEqual(client.put(path, json={'vendor': 'Brand'}).status_code, 401)
                self.assertEqual(client.put(path, json={'vendor': 'Brand'}, auth=('operator', 'fixture-secret'), headers={'Origin': 'https://untrusted.invalid'}).status_code, 403)
                self.assertEqual(client.put(path, json={'vendor': 'Brand'}, auth=('operator', 'fixture-secret')).status_code, 200)
