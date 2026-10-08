"""Mixed-family recovery must never duplicate live downstream products."""
from __future__ import annotations

import tempfile
import json
import hashlib
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import Mock, patch

from sqlalchemy import select
from fastapi.testclient import TestClient

from engine.distributed.coordinator_models import (
    AmazonAsinRegistry, CoordinatorState, CrawlJob, CrawlProductItem, CrawlTask, ShopifyProductLink, ShopifyOperationIdempotency,
    create_database_engine, create_session_factory,
)
from engine.distributed.coordinator_store import CoordinatorStore
from engine.tests.coordinator_test_support import create_coordinator_test_schema
from engine.distributed.shopify_family_verification import verify_shopify_family
from engine.distributed.protocol import utc_now
from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.shopify_family_verification import gateway_read


class MixedFamilyRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_database_engine(f"sqlite:///{Path(self.directory.name) / 'test.sqlite3'}")
        create_coordinator_test_schema(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)
        with self.sessions.begin() as session:
            session.add(CrawlJob(id="old-job", status="review_pending", settings={"storeId": "store-a"}, requested_inputs=1))
            session.flush()
            session.add(CrawlTask(id="old-task", job_id="old-job", ordinal=0, source="B0CHILD003",
                                  asin="B0CHILD003", canonical_url="https://www.amazon.com/dp/B0CHILD003", status="completed"))
            session.flush()
            for suffix, status in [("001", "completed"), ("002", "waiting_review"), ("003", "failed")]:
                asin = f"B0CHILD{suffix}"
                source = f"amazon:B0PARENT01:color:{suffix}"
                product = {"id": suffix, "sourceKey": source, "asin": asin, "parentAsin": "B0PARENT01"}
                session.add(CrawlProductItem(
                    id=suffix, job_id="old-job", task_id="old-task", source_key=source, checksum="checksum",
                    product_id=suffix, client_id="test", lease_id="test-lease",
                    raw_payload=product, status=status,
                    last_error={"phase": "seo", "message": "GPT SEO job cancelled: Removed from Queue by operator"} if status == "failed" else None,
                    shopify_result={"productId": "gid://shopify/Product/123", "review": {"syncStatus": "synced"}} if status == "completed" else {},
                ))
                session.add(AmazonAsinRegistry(
                    id=suffix, store_id="store-a", asin=asin, parent_asin="B0PARENT01",
                    status="synced" if status == "completed" else "crawled", last_job_id="old-job",
                    shopify_product_ids=["gid://shopify/Product/123"] if status == "completed" else [],
                ))
            session.add(AmazonAsinRegistry(
                id="parent", store_id="store-a", asin="B0PARENT01", parent_asin="B0PARENT01",
                status="synced", last_job_id="old-job", shopify_product_ids=["gid://shopify/Product/123"],
            ))
            session.add(ShopifyProductLink(
                id="link", store_id="store-a", source_key="amazon:B0PARENT01:color:001",
                shopify_product_id="gid://shopify/Product/123", normalized_checksum="old-checksum",
            ))

    def tearDown(self) -> None:
        self.engine.dispose()
        self.directory.cleanup()

    def recover(self, action="recrawl", missing=(), existing=("B0CHILD001",)):
        return self.store.recover_cleared_family(
            "store-a", "B0PARENT01", action, actor="test", reason="Recover selected eligible products",
            verify_shopify=Mock(return_value={"missingProductIds": set(missing), "existingAsins": set(existing)}),
        )

    def test_mixed_family_exposes_recovery_even_with_synced_and_review_siblings(self):
        family = self.store.resolve_asin_families("store-a", ["B0CHILD003"])["families"][0]
        self.assertEqual(family["databaseStatus"], "queue_cleared")

    def test_recrawl_only_releases_cancelled_members_and_preserves_review_and_links(self):
        self.assertEqual(self.recover()["releasedAsins"], 1)
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlProductItem, "003").status, "deleted")
            self.assertEqual(session.get(CrawlProductItem, "002").status, "waiting_review")
            self.assertEqual(session.get(CrawlProductItem, "001").status, "completed")
            self.assertIsNotNone(session.get(ShopifyProductLink, "link"))
        family = self.store.resolve_asin_families("store-a", ["B0CHILD003"])["families"][0]
        self.assertEqual(family["databaseStatus"], "released")
        with self.assertRaises(ValueError):
            self.recover()

    def test_confirmed_deleted_shopify_product_releases_only_its_mapping_and_aliases(self):
        recovered = self.recover(missing=("gid://shopify/Product/123",), existing=())
        self.assertEqual(recovered["releasedAsins"], 3)
        with self.sessions() as session:
            self.assertIsNone(session.get(ShopifyProductLink, "link"))
            self.assertEqual(session.get(CrawlProductItem, "001").status, "deleted")
            rows = session.scalars(select(AmazonAsinRegistry)).all()
            self.assertTrue(all(not row.shopify_product_ids for row in rows))
            self.assertEqual(session.get(CrawlProductItem, "002").status, "waiting_review")

    def test_live_exact_match_preserves_cancelled_member_without_rehandover(self):
        with self.assertRaises(ValueError):
            self.recover(existing=("B0CHILD001", "B0CHILD003"))
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlProductItem, "003").status, "failed")

    def test_verification_failure_is_atomic_and_does_not_release_anything(self):
        with self.assertRaises(ValueError):
            self.store.recover_cleared_family(
                "store-a", "B0PARENT01", "recrawl", actor="test", reason="Check connection failure",
                verify_shopify=Mock(side_effect=ValueError("Shopify verification unavailable")),
            )
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlProductItem, "003").status, "failed")
            self.assertIsNotNone(session.get(ShopifyProductLink, "link"))

    def test_retry_preserves_waiting_review_and_starts_new_seo_only_for_cancelled(self):
        self.assertEqual(self.recover(action="retry")["recovered"], 1)
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlProductItem, "003").status, "received")
            self.assertEqual(session.get(CrawlProductItem, "002").status, "waiting_review")

    def test_other_store_cannot_recover_this_family(self):
        with self.assertRaises(ValueError):
            self.store.recover_cleared_family("store-b", "B0PARENT01", "recrawl", actor="test", reason="Store isolation check")

    def test_backfill_does_not_resurrect_obsolete_shopify_mapping_after_recrawl_release(self):
        self.recover(missing=("gid://shopify/Product/123",), existing=())
        self.store.backfill_asin_registry()
        with self.sessions() as session:
            self.assertEqual(session.get(AmazonAsinRegistry, "001").status, "released")
            self.assertEqual(session.get(AmazonAsinRegistry, "001").shopify_product_ids, [])

    def test_deleted_review_history_can_recover_after_shopify_deletion(self):
        with self.sessions.begin() as session:
            session.get(CrawlProductItem, "001").status = "deleted"
        self.assertEqual(self.recover(missing=("gid://shopify/Product/123",), existing=())["releasedAsins"], 3)

    def test_synced_history_without_raw_payload_and_with_legacy_owner_can_recrawl(self):
        with self.sessions.begin() as session:
            candidate = session.get(CrawlProductItem, "001")
            candidate.normalized_payload = candidate.raw_payload
            candidate.raw_payload = {}
            candidate.status = "deleted"
            candidate.claimed_by = "previous-sync-worker"
            candidate.claim_expires_at = None
        self.assertEqual(self.recover(missing=("gid://shopify/Product/123",), existing=())["releasedAsins"], 3)
        with self.sessions() as session:
            self.assertEqual(session.get(AmazonAsinRegistry, "001").status, "released")
            self.assertIsNone(session.get(CrawlProductItem, "001").claimed_by)

    def test_completed_sync_clears_worker_owner_and_expiry(self):
        with self.sessions.begin() as session:
            candidate = session.get(CrawlProductItem, "003")
            candidate.status = "shopify_writing"
            candidate.claimed_by = "sync-worker"
            candidate.claim_expires_at = utc_now()
        self.assertTrue(self.store.complete_product_item(
            "003", worker_id="sync-worker", store_id="store-a", normalized_checksum="checksum",
            normalized_payload={"asin": "B0CHILD003", "parentAsin": "B0PARENT01"},
            shopify_result={"productId": "gid://shopify/Product/456"},
        ))
        with self.sessions() as session:
            self.assertIsNone(session.get(CrawlProductItem, "003").claimed_by)
            self.assertIsNone(session.get(CrawlProductItem, "003").claim_expires_at)

    def test_synced_terminal_record_with_lease_still_blocks_recovery(self):
        with self.sessions.begin() as session:
            candidate = session.get(CrawlProductItem, "001")
            candidate.claimed_by = "sync-worker"
            candidate.claim_expires_at = utc_now()
        with self.assertRaisesRegex(ValueError, "pipeline claim"):
            self.recover(missing=("gid://shopify/Product/123",), existing=())

    def test_unsynced_failed_record_with_owner_but_no_expiry_is_not_ignored(self):
        with self.sessions.begin() as session:
            session.get(CrawlProductItem, "003").claimed_by = "unknown-owner"
        with self.assertRaisesRegex(ValueError, "pipeline claim"):
            self.recover()

    def test_active_crawl_task_blocks_recovery(self):
        with self.sessions.begin() as session:
            session.get(CrawlTask, "old-task").status = "running"
        with self.assertRaises(ValueError):
            self.recover()

    def test_active_claim_on_candidate_blocks_recovery(self):
        with self.sessions.begin() as session:
            candidate = session.get(CrawlProductItem, "003")
            candidate.claimed_by = "busy-worker"
            candidate.claim_expires_at = utc_now()
        with self.assertRaises(ValueError):
            self.recover()

    def test_new_family_uploads_skip_review_siblings_but_accept_released_asin(self):
        self.recover()
        job = self.store.create_job({"urls": ["B0CHILD003"], "storeId": "store-a"})
        hello = {"clientId": "agent", "displayName": "test", "availableSlots": 1, "capabilities": {"amazon": True}}
        self.store.register_client(hello)
        lease = self.store.lease_tasks("agent", 1)[0]
        products = []
        for suffix in ["002", "003"]:
            product = {"id": suffix, "sourceKey": f"amazon:B0PARENT01:color:{suffix}",
                       "asin": f"B0CHILD{suffix}", "parentAsin": "B0PARENT01"}
            products.append(product)
            reply = self.store.accept_product(lease["taskId"], "agent", lease["leaseId"], product["sourceKey"], suffix,
                                              {"jobId": job["id"], "product": product})
            self.assertEqual(reply["status"], "duplicate" if suffix == "002" else "accepted")
        self.store.accept_result(lease["taskId"], "agent", lease["leaseId"], "final",
                                 {"jobId": job["id"], "products": products, "errors": []})
        with self.sessions() as session:
            new_items = session.scalars(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"])).all()
            self.assertEqual([item.source_key for item in new_items], ["amazon:B0PARENT01:color:003"])
        self.assertEqual(self.store.get_job(job["id"])["seoQueueHandoff"]["skippedExistingPipeline"], 1)

    def test_retry_uses_new_stable_seo_revision_instead_of_old_result(self):
        self.recover(action="retry")
        claim = self.store.claim_product_items(worker_id="worker", store_id="store-a", limit=1)[0]
        self.assertNotEqual(claim["seoSourceRevision"], claim["checksum"])
        self.assertIn(":recovery:003:1", claim["seoSourceRevision"])

    def test_missing_shopify_product_can_recrawl_even_after_its_old_pipeline_record_was_removed(self):
        with self.sessions.begin() as session:
            session.delete(session.get(CrawlProductItem, "001"))
        self.assertEqual(self.recover(missing=("gid://shopify/Product/123",), existing=())["releasedAsins"], 3)
        with self.sessions() as session:
            self.assertIsNone(session.get(ShopifyProductLink, "link"))
            audit = session.scalar(select(CoordinatorState).where(CoordinatorState.key.like("family_recovery_audit:%")))
            evidence = json.loads(audit.value)
            self.assertEqual(evidence["storeId"], "store-a")
            self.assertIn("B0CHILD001", evidence["releasedAsins"])

    def test_orphaned_synced_registry_can_recrawl_when_all_old_history_is_gone(self):
        with self.sessions.begin() as session:
            for candidate in session.scalars(select(CrawlProductItem)).all():
                session.delete(candidate)
            session.delete(session.get(CrawlTask, "old-task"))
            session.delete(session.get(CrawlJob, "old-job"))
        self.assertEqual(self.recover(missing=("gid://shopify/Product/123",), existing=())["releasedAsins"], 2)
        with self.sessions() as session:
            self.assertEqual(session.get(AmazonAsinRegistry, "001").status, "released")
            self.assertIsNone(session.get(ShopifyProductLink, "link"))

    def test_audit_survives_history_cleanup(self):
        self.recover()
        with self.sessions.begin() as session:
            for candidate in session.scalars(select(CrawlProductItem)).all():
                session.delete(candidate)
            session.delete(session.get(CrawlTask, "old-task"))
            session.delete(session.get(CrawlJob, "old-job"))
        with self.sessions() as session:
            self.assertIsNotNone(session.scalar(select(CoordinatorState).where(CoordinatorState.key.like("family_recovery_audit:%"))))

    def test_single_asin_family_can_recover_orphaned_parent_mapping(self):
        with self.sessions.begin() as session:
            for candidate in session.scalars(select(CrawlProductItem)).all():
                session.delete(candidate)
            for row in session.scalars(select(AmazonAsinRegistry)).all():
                if row.asin != "B0PARENT01":
                    session.delete(row)
            session.delete(session.get(CrawlTask, "old-task"))
            session.delete(session.get(CrawlJob, "old-job"))
        self.assertEqual(self.recover(missing=("gid://shopify/Product/123",), existing=())["releasedAsins"], 1)

    def test_orphan_mapping_with_an_unresolved_write_is_not_released(self):
        with self.sessions.begin() as session:
            session.delete(session.get(CrawlProductItem, "001"))
            source_key = "amazon:B0PARENT01:color:001"
            session.add(ShopifyOperationIdempotency(
                id="uncertain-write", store_id="store-a",
                request_id="product-sync:" + hashlib.sha256(source_key.encode()).hexdigest(),
                operation="product.sync", payload_hash="test-hash", state="reconciliation_required",
            ))
        with self.assertRaises(ValueError):
            self.recover(missing=("gid://shopify/Product/123",), existing=())
        with self.sessions() as session:
            self.assertIsNotNone(session.get(ShopifyProductLink, "link"))
            self.assertEqual(session.get(CrawlProductItem, "003").status, "failed")

    def test_browser_cannot_supply_its_own_shopify_deletion_proof(self):
        app = create_coordinator_app(database_url=self.engine.url.render_as_string(hide_password=False), create_schema=False, operator_auth_disabled=True)
        app.state.store.recover_cleared_family = self.store.recover_cleared_family
        with patch("engine.distributed.coordinator_server.verify_shopify_family", side_effect=ValueError("Verification unavailable")):
            response = TestClient(app).post("/api/v1/asin-families/recover", json={
                "storeId": "store-a", "parentAsin": "B0PARENT01", "action": "recrawl",
                "reason": "Forged browser proof must be ignored", "missingProductIds": ["gid://shopify/Product/123"],
            })
        self.assertEqual(response.status_code, 409)
        with self.sessions() as session:
            self.assertIsNotNone(session.get(ShopifyProductLink, "link"))


class ShopifyFamilyVerificationTests(unittest.TestCase):
    def test_http_404_auth_and_rate_limit_never_mean_product_deleted(self):
        for status in [401, 403, 404, 429, 500]:
            with self.subTest(status=status), patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError(
                "http://test/api/shopify", status, "unavailable", {}, None,
            )):
                with self.assertRaises(ValueError):
                    gateway_read("store-a", "products.get", {"id": "gid://shopify/Product/123"})

    def test_only_explicit_null_product_proves_deletion(self):
        with patch("engine.distributed.shopify_family_verification.gateway_read", side_effect=[
            {"product": None}, {"ready": True, "matches": []},
        ]) as read:
            result = verify_shopify_family("store-a", "B0PARENT01", {"B0CHILD001"}, {"gid://shopify/Product/123"})
            self.assertEqual(result["missingProductIds"], {"gid://shopify/Product/123"})
            self.assertTrue(all(call.args[0] == "store-a" for call in read.call_args_list))

    def test_missing_product_field_does_not_prove_deletion(self):
        with patch("engine.distributed.shopify_family_verification.gateway_read", return_value={}):
            with self.assertRaises(ValueError):
                verify_shopify_family("store-a", "B0PARENT01", set(), {"gid://shopify/Product/123"})

    def test_search_failure_does_not_release_confirmed_missing_id(self):
        with patch("engine.distributed.shopify_family_verification.gateway_read", side_effect=[
            {"product": None}, {"ready": False, "matches": []},
        ]):
            with self.assertRaises(ValueError):
                verify_shopify_family("store-a", "B0PARENT01", {"B0CHILD001"}, {"gid://shopify/Product/123"})

    def test_existing_replacement_asin_protects_against_duplicates(self):
        with patch("engine.distributed.shopify_family_verification.gateway_read", side_effect=[
            {"product": None}, {"ready": True, "matches": [{"asin": "B0CHILD001"}]},
        ]):
            result = verify_shopify_family("store-a", "B0PARENT01", {"B0CHILD001"}, {"gid://shopify/Product/123"})
            self.assertEqual(result["existingAsins"], {"B0CHILD001"})
