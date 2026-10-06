from datetime import datetime, timezone
import tempfile
import unittest
from pathlib import Path

from engine.distributed.coordinator_server import create_coordinator_app
from engine.tests.test_distributed import client_hello
from engine.distributed.coordinator_models import CrawlProductItem
from engine.tests.coordinator_test_support import create_coordinator_test_schema


class CustomGptHandoffTests(unittest.TestCase):
    def test_external_seo_releases_worker_and_preserves_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_coordinator_app(database_url=f"sqlite:///{(Path(directory) / 'queue.sqlite3').as_posix()}")
            store = app.state.store
            with store.sessions() as session:
                create_coordinator_test_schema(session.get_bind())
            job = store.create_job({"urls": ["B0REVIEW04"], "storeId": "capozen"})
            store.register_client(client_hello(slots=1))
            lease = store.lease_tasks("client-a", 1)[0]
            product = {"id": "product", "sourceKey": "amazon:test", "title": "Rug", "media": [], "variants": []}
            store.accept_product(lease["taskId"], "client-a", lease["leaseId"], "amazon:test", "checksum", {"jobId": job["id"], "product": product, "productChecksum": "checksum"})
            claim = store.claim_product_items(worker_id="worker", store_id="capozen", limit=1)[0]
            self.assertTrue(store.mark_product_seo(claim["id"], worker_id="worker", normalized_payload=product, seo_summary={"status": "running"}))
            self.assertTrue(store.defer_external_seo(
                claim["id"], worker_id="worker", external_job_id="gpt-job", provider="codex_mcp",
            ))
            self.assertEqual(store.claim_product_items(worker_id="other", store_id="capozen", limit=1), [])
            self.assertFalse(store.defer_external_seo(
                claim["id"], worker_id="worker", external_job_id="different", provider="codex_mcp",
            ))

            # Make the parked poll due, as if its one-minute delay elapsed.
            with store.sessions.begin() as session:
                parked = session.get(CrawlProductItem, claim["id"])
                parked.next_attempt_at = datetime(2000, 1, 1, tzinfo=timezone.utc)
            resumed = store.claim_product_items(worker_id="worker", store_id="capozen", limit=1)[0]
            self.assertEqual(resumed["externalSeo"], {"jobId": "gpt-job", "provider": "codex_mcp"})
            self.assertTrue(store.mark_product_seo(claim["id"], worker_id="worker", normalized_payload=product, seo_summary={"status": "running"}))
            self.assertFalse(store.mark_product_review_ready(
                claim["id"], worker_id="worker", normalized_payload=product,
                seo_summary={"engine": "codex_mcp"}, image_summary={}, review_summary={"storeId": "capozen"},
            ))
            self.assertTrue(store.mark_product_image_processing(
                claim["id"], worker_id="worker", normalized_payload=product, image_summary={"status": "running"},
            ))
            self.assertFalse(store.mark_product_review_ready(
                claim["id"], worker_id="worker", normalized_payload=product,
                seo_summary={"engine": "codex_mcp"}, image_summary={"status": "running"},
                review_summary={"storeId": "capozen"},
            ))
            self.assertTrue(store.mark_product_image_processing(
                claim["id"], worker_id="worker", normalized_payload=product, image_summary={"status": "completed"},
            ))
            self.assertTrue(store.mark_product_review_ready(
                claim["id"], worker_id="worker", normalized_payload=product,
                seo_summary={"engine": "codex_mcp"}, image_summary={"status": "completed"},
                review_summary={"storeId": "capozen"},
            ))
            self.assertFalse(store.queue_product_review_sync(claim["id"]).get("product"))
            store.decide_product_review(claim["id"], expected_version=1, decision="approved", reason=None)
            store.queue_product_review_sync(claim["id"])
            sync = store.claim_product_items(worker_id="publisher", store_id="capozen", limit=1)[0]
            self.assertEqual(sync["stage"], "sync")
            self.assertEqual(sync["externalSeo"], {"jobId": "gpt-job", "provider": "codex_mcp"})
            self.assertEqual(sync["review"]["decision"], "approved")
