import tempfile
import unittest
from pathlib import Path

from engine.distributed.coordinator_server import create_coordinator_app
from engine.tests.coordinator_test_support import create_coordinator_test_schema
from engine.tests.test_distributed import client_hello


class AutoSyncTests(unittest.TestCase):
    def test_automatic_classification_blocks_sync_until_operator_repairs_without_rerunning_seo(self):
        with tempfile.TemporaryDirectory() as directory:
            store, claim, product = self.prepare(directory, True, "automatic")
            store.mark_product_image_processing(claim["id"], worker_id="worker", normalized_payload=product, image_summary={"status": "completed"})
            store.mark_product_review_ready(claim["id"], worker_id="worker", normalized_payload=product,
                seo_summary={"status": "completed", "engine": "codex_mcp"}, image_summary={"status": "completed"},
                review_summary={"storeId": "sample", "classification": {"status": "needs_review", "reason": "No matching collection"}})
            review = store.get_product_review(claim["id"], "sample")
            self.assertEqual(review["syncStatus"], "idle")
            self.assertEqual(review["target"]["classificationStatus"], "needs_review")
            self.assertFalse(review["actions"]["canDecide"])
            self.assertTrue(review["actions"]["canEdit"])
            catalog = store.product_review_catalog("sample")
            self.assertFalse(catalog["items"][0]["actions"]["canDecide"])
            review = store.update_product_review(claim["id"], expected_version=review["version"], patch={
                "productTitle": "Operator SEO edit", "classification": {"collectionId": "", "productType": ""}})
            self.assertEqual(review["target"]["classificationStatus"], "needs_review")
            self.assertEqual(store.queue_product_review_sync(claim["id"]), {"classificationRequired": True})
            store.decide_product_review(claim["id"], expected_version=review["version"], decision="approved", reason=None)
            self.assertEqual(store.queue_all_approved_reviews(), [])
            review = store.get_product_review(claim["id"], "sample")
            repaired = store.update_product_review(claim["id"], expected_version=review["version"], patch={
                "classification": {"collectionId": "gid://shopify/Collection/123", "productType": "  New   Type  "}})
            self.assertEqual(repaired["target"]["productType"], "New Type")
            self.assertEqual(repaired["target"]["collectionIds"], ["gid://shopify/Collection/123"])
            store.decide_product_review(claim["id"], expected_version=repaired["version"], decision="approved", reason=None)
            queued = store.queue_product_review_sync(claim["id"])
            self.assertEqual(queued["syncStatus"], "queued")
            sync_claim = store.claim_product_items(worker_id="sync", store_id="sample", limit=1)[0]
            self.assertEqual(sync_claim["stage"], "sync")
            self.assertEqual(sync_claim["review"]["classification"]["productType"], "New Type")

    def test_valid_classification_queues_automatic_sync_and_preserves_per_product_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            store, claim, product = self.prepare(directory, True, "automatic")
            store.mark_product_image_processing(claim["id"], worker_id="worker", normalized_payload=product, image_summary={"status": "completed"})
            store.mark_product_review_ready(claim["id"], worker_id="worker", normalized_payload=product,
                seo_summary={"status": "completed", "engine": "codex_mcp"}, image_summary={"status": "completed"},
                review_summary={"storeId": "sample", "classification": {"status": "ready", "collectionId": "gid://shopify/Collection/9", "productType": "Handbag", "reason": "Visual identity"}})
            review = store.get_product_review(claim["id"], "sample")
            self.assertEqual(review["syncStatus"], "queued")
            self.assertEqual(review["target"]["collectionIds"], ["gid://shopify/Collection/9"])

    def test_auto_sync_is_opt_in_for_new_jobs_and_requires_completed_codex_and_images(self):
        for enabled, engine, seo_status, expected in [
            (True, "codex_mcp", "completed", "sync_queued"),
            (False, "codex_mcp", "completed", "waiting_review"),
            (None, "codex_mcp", "completed", "waiting_review"),
            (True, "gemini", "completed", "waiting_review"),
            (True, "codex_mcp", "pending", "waiting_review"),
        ]:
            with self.subTest(enabled=enabled, engine=engine, seo_status=seo_status), tempfile.TemporaryDirectory() as directory:
                store, claim, product = self.prepare(directory, enabled)
                self.assertFalse(store.mark_product_review_ready(claim["id"], worker_id="worker", normalized_payload=product,
                    seo_summary={"status": seo_status, "engine": engine}, image_summary={"status": "completed"}, review_summary={"storeId": "sample"}))
                store.mark_product_image_processing(claim["id"], worker_id="worker", normalized_payload=product, image_summary={"status": "completed"})
                self.assertTrue(store.mark_product_review_ready(claim["id"], worker_id="worker", normalized_payload=product,
                    seo_summary={"status": seo_status, "engine": engine}, image_summary={"status": "completed"}, review_summary={"storeId": "sample"}))
                review = store.get_product_review(claim["id"], "sample")
                self.assertEqual(review["syncStatus"], "queued" if expected == "sync_queued" else "idle")
                self.assertEqual(review["decision"], "approved" if expected == "sync_queued" else "pending")
                # A replay cannot queue a second write or replace the current review.
                self.assertFalse(store.mark_product_review_ready(claim["id"], worker_id="worker", normalized_payload=product,
                    seo_summary={"status": seo_status, "engine": engine}, image_summary={"status": "completed"}, review_summary={"storeId": "sample"}))

    def test_partial_publication_retries_only_channels_and_keeps_shopify_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            store, claim, product = self.prepare(directory, True)
            store.mark_product_image_processing(claim["id"], worker_id="worker", normalized_payload=product, image_summary={"status": "completed"})
            store.mark_product_review_ready(claim["id"], worker_id="worker", normalized_payload=product,
                seo_summary={"status": "completed", "engine": "codex_mcp"}, image_summary={"status": "completed"}, review_summary={"storeId": "sample"})
            sync = store.claim_product_items(worker_id="publisher", store_id="sample", limit=1)[0]
            self.assertEqual(sync["stage"], "sync")
            store.complete_product_item(claim["id"], worker_id="publisher", store_id="sample", normalized_checksum="synced-checksum",
                normalized_payload=product, shopify_result={"success": True, "productId": "gid://shopify/Product/1",
                    "publication": {"status": "partial", "channels": []}})
            review = store.get_product_review(claim["id"], "sample")
            self.assertEqual(review["syncStatus"], "failed")
            self.assertTrue(review["actions"]["canRetry"])
            self.assertFalse(review["actions"]["canEdit"])
            self.assertTrue(store.update_product_review(claim["id"], expected_version=1, patch={"title": "Changed"})["locked"])
            catalog = store.product_review_catalog("sample", workspace="work")
            self.assertFalse(catalog["items"][0]["actions"]["canEdit"])
            self.assertEqual(catalog["items"][0]["stage"], "failed")
            store.queue_product_review_sync(claim["id"])
            retry = store.claim_product_items(worker_id="publisher", store_id="sample", limit=1)[0]
            self.assertEqual(retry["stage"], "publish")
            self.assertEqual(retry["existingShopify"]["productId"], "gid://shopify/Product/1")
            self.assertEqual(retry["review"]["publicationAttempt"], 1)
            store.complete_product_item(claim["id"], worker_id="publisher", store_id="sample", normalized_checksum="synced-checksum",
                normalized_payload=product, shopify_result={"success": True, "productId": "gid://shopify/Product/1",
                    "publication": {"status": "completed", "channels": []}})
            self.assertEqual(store.get_product_review(claim["id"], "sample")["syncStatus"], "synced")

    def prepare(self, directory, enabled, classification_mode=None):
        app = create_coordinator_app(database_url=f"sqlite:///{(Path(directory) / 'queue.sqlite3').as_posix()}")
        store = app.state.store
        with store.sessions() as session:
            create_coordinator_test_schema(session.get_bind())
        settings = {"urls": ["B012345678"], "storeId": "sample"}
        if classification_mode:
            settings["classificationMode"] = classification_mode
        if enabled is not None:
            settings["autoSyncAfterSeo"] = enabled
        job = store.create_job(settings)
        store.register_client(client_hello(slots=1))
        lease = store.lease_tasks("client-a", 1)[0]
        product = {"id": "product", "sourceKey": "amazon:test", "title": "Sample", "asin": "B012345678", "media": [], "variants": []}
        store.accept_product(lease["taskId"], "client-a", lease["leaseId"], "amazon:test", "checksum", {"jobId": job["id"], "product": product, "productChecksum": "checksum"})
        claim = store.claim_product_items(worker_id="worker", store_id="sample", limit=1)[0]
        store.mark_product_seo(claim["id"], worker_id="worker", normalized_payload=product, seo_summary={"status": "completed"})
        return store, claim, product
