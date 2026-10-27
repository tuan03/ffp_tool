"""Crawler/SEO deduplication without Shopify writes or a live worker."""

import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from engine.distributed.coordinator_models import AmazonAsinRegistry, CrawlJob, CrawlProductItem, CrawlTask
from engine.tests import test_distributed
from engine.tests.test_distributed import client_hello
from engine.distributed.seo_pipeline_identity import load_active_seo_identities
from engine.distributed.coordinator_server import create_coordinator_app


class ActiveSeoDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_distributed.CoordinatorStoreTests()
        self.fixture.setUp()
        self.store = self.fixture.store
        with self.store.sessions.begin() as session:
            session.execute(text("CREATE TABLE gpt_jobs (id TEXT PRIMARY KEY, store_id TEXT, status TEXT, payload TEXT)"))
            session.execute(text("CREATE TABLE seo_worker_jobs (job_id TEXT PRIMARY KEY, pipeline_active BOOLEAN)"))

    def tearDown(self):
        self.fixture.tearDown()

    def seed_seo(self, *, job_id="seo-existing", store_id="sample", active=True, status="PENDING", owner=None, revision="checksum"):
        product = {"id": "product", "asin": "B0CHILD001", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red", "sourceVariants": [{"asin": "B0CHILD001"}]}
        if owner:
            product["crawlerPipelineItemId"] = owner
        payload = {"source": "amazon", "sourceIdentity": product["sourceKey"],
                   "execution": {"source": "amazon", "sourceIdentity": product["sourceKey"],
                                 "sourceRevision": revision, "originalSnapshot": product}}
        with self.store.sessions.begin() as session:
            session.execute(text("INSERT INTO gpt_jobs(id,store_id,status,payload) VALUES (:id,:store,:status,:payload)"),
                            {"id": job_id, "store": store_id, "status": status, "payload": json.dumps(payload)})
            session.execute(text("INSERT INTO seo_worker_jobs VALUES (:id,:active)"), {"id": job_id, "active": active})
        return product

    def start_crawl(self, input_asin="B0CHILD002"):
        job = self.store.create_job({"urls": [input_asin], "storeId": "sample"})
        self.store.register_client(client_hello(slots=1))
        return job, self.store.lease_tasks("client-a", 1)[0]

    def upload(self, job, lease, product):
        return self.store.accept_product(lease["taskId"], "client-a", lease["leaseId"], product["sourceKey"],
                                         "checksum", {"jobId": job["id"], "product": product, "productChecksum": "checksum"})

    def test_preflight_finds_active_exact_asin_without_crawler_registry(self):
        self.seed_seo()
        families = self.store.resolve_asin_families("sample", ["B0CHILD001", "B0CHILD002", "B0PARENT01"])["families"]
        by_input = {family["inputAsins"][0]: family for family in families}
        self.assertEqual(by_input["B0CHILD001"]["activeSeoAsins"], ["B0CHILD001"])
        self.assertEqual(by_input["B0CHILD002"].get("activeSeoAsins", []), [])
        self.assertEqual(by_input["B0PARENT01"].get("activeSeoAsins", []), [])

    def test_filter_activity_is_exact_store_scoped_and_releases_cleared_queue(self):
        self.seed_seo()
        def states(store="sample"):
            return {row["asin"]: row["status"] for row in self.store.filter_asin_activity(
                store, ["B0CHILD001", "B0CHILD002", "B0PARENT01"])["entries"]}
        self.assertEqual(states(), {"B0CHILD001": "processing", "B0CHILD002": "available", "B0PARENT01": "available"})
        self.assertEqual(set(states("other").values()), {"available"})
        with self.store.sessions.begin() as session:
            session.execute(text("UPDATE gpt_jobs SET status='CANCELLED'"))
        self.assertEqual(set(states().values()), {"available"})

    def test_filter_activity_only_covers_received_children_and_does_not_lock_history(self):
        product = {"id": "one", "asin": "B0CHILD001", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red", "sourceVariants": [{"asin": "B0CHILD001"}]}
        job, lease = self.start_crawl("B0CHILD001")
        self.upload(job, lease, product)
        def states():
            return {row["asin"]: row["status"] for row in self.store.filter_asin_activity(
                "sample", ["B0CHILD001", "B0CHILD002"])["entries"]}
        self.assertEqual(states()["B0CHILD001"], "processing")
        self.assertEqual(states()["B0CHILD002"], "available")
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).status = "completed"
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"]))
            item.status = "failed"
            item.last_error = {"phase": "seo", "message": "GPT SEO job cancelled: Removed from Queue by operator"}
        self.assertEqual(set(states().values()), {"available"})
        for status in ["deleted", "cancelled", "completed"]:
            with self.store.sessions.begin() as session:
                session.scalar(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"])).status = status
            self.assertEqual(set(states().values()), {"available"})

    def test_filter_activity_ignores_cancelled_queue_before_worker_observes_cancellation(self):
        job, lease = self.start_crawl("B0CHILD001")
        product = {"id": "one", "asin": "B0CHILD001", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(job, lease, product)
        self.seed_seo(status="CANCELLED")
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).status = "completed"
            item = session.scalar(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"]))
            item.status = "retry_wait"
            item.shopify_result = {"externalSeo": {"jobId": "seo-existing"}}
        self.assertEqual(self.store.filter_asin_activity("sample", ["B0CHILD001"])["entries"][0]["status"], "available")

    def prepare_cleared_recrawl(self, *, observed=True):
        old, lease = self.start_crawl("B0CHILD001")
        product = {"id": "one", "asin": "B0CHILD001", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red"}
        accepted = self.upload(old, lease, product)
        self.seed_seo(status="CANCELLED", active=False)
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).status = "completed"
            session.get(CrawlJob, old["id"]).status = "completed"
            item = session.get(CrawlProductItem, accepted["productItemId"])
            item.status = "failed" if observed else "retry_wait"
            item.shopify_result = {"externalSeo": {"jobId": "seo-existing"}}
            if observed:
                item.last_error = {"phase": "seo", "message": "GPT SEO job cancelled: Removed from Queue by operator"}
        return product, accepted["productItemId"]

    def test_recrawl_after_queue_clear_accepts_stream_and_final_without_duplicate_handoff(self):
        product, old_id = self.prepare_cleared_recrawl()
        self.assertEqual(self.store.filter_asin_activity("sample", [product["asin"]])["entries"][0]["status"], "available")
        job, lease = self.start_crawl("B0CHILD001")
        self.assertEqual(self.upload(job, lease, product)["status"], "accepted")
        self.assertEqual(self.upload(job, lease, product)["status"], "duplicate", "replayed upload does not create a second item")
        self.store.accept_result(lease["taskId"], "client-a", lease["leaseId"], "final", {
            "jobId": job["id"], "products": [product], "errors": [],
        })
        with self.store.sessions() as session:
            self.assertEqual(len(session.scalars(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"])).all()), 1)
            self.assertEqual(session.get(CrawlProductItem, old_id).status, "failed", "preserve the old cancellation history")
        summary = self.store.get_job(job["id"])["seoQueueHandoff"]
        self.assertEqual(summary["totalProducts"], 1)
        self.assertEqual(summary.get("skippedExistingPipeline", 0), 0)

    def test_final_only_recrawl_accepts_cancelled_seo_before_worker_observes_clear(self):
        product, _ = self.prepare_cleared_recrawl(observed=False)
        job, lease = self.start_crawl("B0CHILD001")
        self.store.accept_result(lease["taskId"], "client-a", lease["leaseId"], "final", {
            "jobId": job["id"], "products": [product], "errors": [],
        })
        self.assertEqual(self.store.get_job(job["id"])["seoQueueHandoff"]["totalProducts"], 1)

    def test_cancelled_seo_does_not_release_a_claimed_crawler_item(self):
        product, old_id = self.prepare_cleared_recrawl()
        with self.store.sessions.begin() as session:
            session.get(CrawlProductItem, old_id).claimed_by = "still-draining-worker"
        self.assertNotEqual(self.store.filter_asin_activity("sample", [product["asin"]])["entries"][0]["status"], "available")
        job, lease = self.start_crawl("B0CHILD001")
        self.assertEqual(self.upload(job, lease, product)["reason"], "existing_pipeline_product")

    def test_queue_clear_does_not_release_retained_review_or_shopify_write(self):
        product, old_id = self.prepare_cleared_recrawl()
        job, lease = self.start_crawl("B0CHILD001")
        for status in ("waiting_review", "sync_queued", "syncing", "shopify_writing", "reconciliation_required"):
            with self.subTest(status=status):
                with self.store.sessions.begin() as session:
                    session.get(CrawlProductItem, old_id).status = status
                candidate = {**product, "sourceKey": product["sourceKey"] + ":" + status}
                self.assertEqual(self.upload(job, lease, candidate)["reason"], "existing_pipeline_product")

    def test_old_cancellation_error_does_not_override_live_seo_job(self):
        product, _ = self.prepare_cleared_recrawl()
        with self.store.sessions.begin() as session:
            session.execute(text("UPDATE gpt_jobs SET status='REVIEW_READY'"))
        job, lease = self.start_crawl("B0CHILD001")
        self.assertEqual(self.upload(job, lease, product)["reason"], "existing_pipeline_product")

    def test_filter_activity_preserves_exact_variant_ownership_after_registry_job_changes(self):
        job, lease = self.start_crawl("B0CHILD001")
        product = {"id": "one", "asin": "B0CHILD001", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red", "sourceVariants": [{"asin": "B0CHILD002"}]}
        self.upload(job, lease, product)
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).status = "completed"
            row = session.scalar(select(AmazonAsinRegistry).where(AmazonAsinRegistry.asin == "B0CHILD002"))
            row.last_job_id = None
        entries = self.store.filter_asin_activity("sample", ["B0CHILD002", "B0PARENT01"])["entries"]
        self.assertEqual([entry["status"] for entry in entries], ["processing", "available"])

    def test_filter_activity_known_family_only_waits_while_crawl_task_is_active(self):
        job, lease = self.start_crawl("B0CHILD001")
        product = {"id": "one", "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(job, lease, product)
        with self.store.sessions.begin() as session:
            self.store._upsert_asin_registry(session, store_id="sample", job_id=job["id"],
                product={**product, "asin": "B0CHILD002"}, status="released")
        entry = self.store.filter_asin_activity("sample", ["B0CHILD002"])["entries"][0]
        self.assertEqual(entry["status"], "crawling")
        self.assertEqual(entry["relatedAsin"], "B0CHILD001")
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).status = "failed"
        self.assertEqual(self.store.filter_asin_activity("sample", ["B0CHILD002"])["entries"][0]["status"], "available")

    def test_filter_activity_reports_errors_and_sync_revision_without_blocking_deleted_shopify_products(self):
        job, lease = self.start_crawl("B0CHILD001")
        product = {"id": "one", "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(job, lease, product)
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).status = "completed"
            session.scalar(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"])).status = "failed"
        self.assertEqual(self.store.filter_asin_activity("sample", ["B0CHILD001"])["entries"][0]["status"], "attention")
        with self.store.sessions.begin() as session:
            session.scalar(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"])).status = "completed"
            self.store._upsert_asin_registry(session, store_id="sample", job_id=job["id"], product=product,
                status="synced", shopify_product_id="gid://shopify/Product/123")
        entry = self.store.filter_asin_activity("sample", ["B0CHILD001"])["entries"][0]
        self.assertEqual(entry["status"], "available", "historical sync is not proof of Shopify existence")
        self.assertTrue(entry["shopifyRevision"].endswith("Z"))

    def test_different_store_inactive_and_cancelled_jobs_do_not_block_recrawl(self):
        self.seed_seo(store_id="other")
        self.seed_seo(job_id="closed", active=False)
        self.seed_seo(job_id="cancelled", status="CANCELLED")
        family = self.store.resolve_asin_families("sample", ["B0CHILD001"])["families"][0]
        self.assertEqual(family.get("activeSeoAsins", []), [])

    def test_upload_and_final_result_skip_active_child_but_accept_new_sibling(self):
        product = self.seed_seo(status="REVIEW_READY")
        job, lease = self.start_crawl()
        duplicate = {**product, "parentAsin": "B0PARENT02", "sourceKey": "amazon:B0PARENT02:color:red"}
        fresh = {**duplicate, "id": "fresh", "asin": "B0CHILD002", "sourceKey": "amazon:B0PARENT02:color:blue",
                 "sourceVariants": [{"asin": "B0CHILD002"}]}
        self.assertEqual(self.upload(job, lease, duplicate)["reason"], "existing_pipeline_product")
        self.assertEqual(self.upload(job, lease, fresh)["status"], "accepted")
        final = self.store.accept_result(lease["taskId"], "client-a", lease["leaseId"], "final", {
            "jobId": job["id"], "products": [duplicate, fresh], "errors": [],
        })
        self.assertEqual(final["status"], "accepted")
        with self.store.sessions() as session:
            rows = session.scalars(select(CrawlProductItem).where(CrawlProductItem.job_id == job["id"])).all()
            self.assertEqual([row.raw_payload["asin"] for row in rows], ["B0CHILD002"])
        summary = self.store.get_job(job["id"])["seoQueueHandoff"]
        self.assertEqual(summary["skippedExistingPipeline"], 1)
        self.assertEqual(summary["totalDetected"], 2)

    def test_enqueue_collision_is_a_skip_without_counting_a_new_handoff(self):
        job, lease = self.start_crawl()
        product = {"id": "product", "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "sourceKey": "amazon:B0PARENT01:color:red"}
        accepted = self.upload(job, lease, product)
        claim = self.store.claim_product_items(worker_id="pipeline", store_id="sample", limit=1)[0]
        self.store.mark_product_seo(claim["id"], worker_id="pipeline", normalized_payload=product, seo_summary={"status": "running"})
        self.seed_seo()
        self.assertTrue(self.store.skip_existing_seo_product(accepted["productItemId"], worker_id="pipeline"))
        self.assertFalse(self.store.skip_existing_seo_product(accepted["productItemId"], worker_id="pipeline"))
        summary = self.store.get_job(job["id"])["seoQueueHandoff"]
        self.assertEqual(summary["handedOver"], 0)
        self.assertEqual(summary["pending"], 0)
        self.assertEqual(summary["skippedExistingPipeline"], 1)
        with self.store.sessions() as session:
            item = session.get(CrawlProductItem, claim["id"])
            self.assertEqual(item.status, "completed")
            self.assertIsNone(item.last_error)

    def test_retry_does_not_skip_its_own_external_job_or_mixed_new_variants(self):
        job, lease = self.start_crawl()
        product = {"id": "product", "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "sourceKey": "amazon:B0PARENT01:color:red"}
        accepted = self.upload(job, lease, product)
        claim = self.store.claim_product_items(worker_id="pipeline", store_id="sample", limit=1)[0]
        self.seed_seo(owner=accepted["productItemId"])
        self.assertFalse(self.store.skip_existing_seo_product(claim["id"], worker_id="pipeline"))
        with self.store.sessions.begin() as session:
            item = session.get(CrawlProductItem, claim["id"])
            item.raw_payload = {**product, "sourceVariants": [{"asin": "B0CHILD001"}, {"asin": "B0CHILD002"}]}
        self.seed_seo(job_id="other-job")
        self.assertFalse(self.store.skip_existing_seo_product(claim["id"], worker_id="pipeline"))

    def test_retained_crawler_child_is_found_after_parent_changes(self):
        old, lease = self.start_crawl()
        product = {"id": "old", "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(old, lease, product)
        with self.store.sessions.begin() as session:
            session.get(CrawlJob, old["id"]).status = "review_pending"
            session.get(CrawlTask, lease["taskId"]).status = "completed"
        new = self.store.create_job({"urls": ["B0CHILD001"], "storeId": "sample"})
        with self.store.sessions() as session:
            match = self.store._retained_pipeline_product(session, session.get(CrawlJob, new["id"]), {
                **product, "parentAsin": "B0PARENT02", "sourceKey": "amazon:B0PARENT02:color:red",
            })
        self.assertIsNotNone(match)

    def test_existing_seo_child_does_not_block_family_discovery(self):
        job, lease = self.start_crawl("B0CHILD001")
        product = {"id": "product", "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(job, lease, product)
        self.seed_seo()
        family = self.store.resolve_asin_families("sample", ["B0PARENT01"])["families"][0]
        self.assertEqual(family["databaseStatus"], "leased")
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, lease["taskId"]).status = "completed"
        family = self.store.resolve_asin_families("sample", ["B0PARENT01"])["families"][0]
        self.assertEqual(family["databaseStatus"], "seo_active")
        self.assertEqual(family.get("activeSeoAsins", []), [])


class IndexedActiveSeoDuplicateTests(ActiveSeoDuplicateTests):
    def setUp(self):
        super().setUp()
        with self.store.sessions.begin() as session:
            session.execute(text("ALTER TABLE gpt_jobs ADD COLUMN provider TEXT DEFAULT 'codex_mcp'"))
            session.execute(text("CREATE TABLE seo_pipeline_identities (job_id TEXT PRIMARY KEY,store_id TEXT,source_key TEXT,source_revision TEXT,owner_item_id TEXT)"))
            session.execute(text("CREATE TABLE seo_pipeline_asins (store_id TEXT,asin TEXT,job_id TEXT,PRIMARY KEY(store_id,asin,job_id))"))

    def seed_seo(self, **options):
        product = super().seed_seo(**options)
        with self.store.sessions.begin() as session:
            session.execute(text("INSERT INTO seo_pipeline_identities VALUES (:id,:store,:source,:revision,:owner)"), {
                "id": options.get("job_id", "seo-existing"), "store": options.get("store_id", "sample"),
                "source": product["sourceKey"], "revision": options.get("revision", "checksum"), "owner": options.get("owner", ""),
            })
            session.execute(text("INSERT INTO seo_pipeline_asins VALUES (:store,'B0CHILD001',:id)"), {
                "id": options.get("job_id", "seo-existing"), "store": options.get("store_id", "sample"),
            })
        return product

    def test_indexed_lookup_never_reads_the_large_payload(self):
        self.seed_seo()
        with self.store.sessions.begin() as session:
            session.execute(text("UPDATE gpt_jobs SET payload='not-json: must not read snapshot'"))
        with self.store.sessions() as session:
            self.assertEqual(load_active_seo_identities(session, "sample", asins={"B0CHILD001"})[0].asins,
                             frozenset({"B0CHILD001"}))
            self.assertEqual(load_active_seo_identities(session, "sample", asins={"B0CHILD002"}), [])

    def test_recovers_only_its_own_revision_and_clears_the_old_timeout(self):
        job, lease = self.start_crawl()
        product = {"id": "product", "asin": "B0CHILD001", "parentAsin": "B0PARENT01", "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(job, lease, product)
        claim = self.store.claim_product_items(worker_id="pipeline", store_id="sample", limit=1)[0]
        self.store.mark_product_seo(claim["id"], worker_id="pipeline", normalized_payload=product, seo_summary={"status": "running"})
        self.seed_seo(owner=claim["id"], revision="old")
        self.assertFalse(self.store.recover_external_seo(claim["id"], worker_id="pipeline"))
        with self.store.sessions.begin() as session:
            session.execute(text("UPDATE seo_pipeline_identities SET source_revision=:revision"), {"revision": claim["seoSourceRevision"]})
            session.get(CrawlProductItem, claim["id"]).last_error = {"phase": "seo", "message": "timeout"}
        self.assertFalse(self.store.recover_external_seo(claim["id"], worker_id="other"))
        self.assertTrue(self.store.recover_external_seo(claim["id"], worker_id="pipeline"))
        with self.store.sessions() as session:
            item = session.get(CrawlProductItem, claim["id"])
            self.assertEqual(item.shopify_result["externalSeo"]["jobId"], "seo-existing")
            self.assertIsNone(item.last_error)
            self.assertIsNone(item.claimed_by)
        self.assertEqual(self.store.get_job(job["id"])["seoQueueHandoff"]["handedOver"], 1)

    def test_recovery_does_not_attach_another_owner_or_a_cancelled_job(self):
        job, lease = self.start_crawl()
        product = {"id": "product", "asin": "B0CHILD001", "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(job, lease, product)
        claim = self.store.claim_product_items(worker_id="pipeline", store_id="sample", limit=1)[0]
        self.seed_seo(owner="another-owner")
        self.assertFalse(self.store.recover_external_seo(claim["id"], worker_id="pipeline"))
        self.seed_seo(job_id="cancelled", owner=claim["id"], status="CANCELLED")
        self.assertFalse(self.store.recover_external_seo(claim["id"], worker_id="pipeline"))

    def test_ready_receipt_wakes_immediately_and_preserves_normalized_assets(self):
        job, lease = self.start_crawl()
        product = {"id": "product", "asin": "B0CHILD001", "sourceKey": "amazon:B0PARENT01:color:red"}
        self.upload(job, lease, product)
        claim = self.store.claim_product_items(worker_id="pipeline", store_id="sample", limit=1)[0]
        self.store.mark_product_seo(claim["id"], worker_id="pipeline", normalized_payload=product,
                                    seo_summary={"status": "running", "assetsNormalized": 7})
        self.seed_seo(owner=claim["id"], status="REVIEW_READY")
        self.assertTrue(self.store.recover_external_seo(claim["id"], worker_id="pipeline"))
        continuation = self.store.claim_product_items(worker_id="next-worker", store_id="sample", limit=1)[0]
        self.assertEqual(continuation["externalSeo"]["jobId"], "seo-existing")
        self.assertEqual(continuation["assetsNormalized"], 7)


class SeoReceiptApiTests(unittest.TestCase):
    def test_activity_endpoint_validates_and_returns_complete_store_scoped_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_coordinator_app(database_url=f"sqlite:///{(Path(directory) / 'activity.sqlite3').as_posix()}")
            with TestClient(app) as client:
                for payload in [{}, {"storeId": "sample", "asins": [123]}, {"storeId": "sample", "asins": ["invalid"]}]:
                    self.assertEqual(client.post("/api/v1/asin-families/activity", json=payload).status_code, 422)
                response = client.post("/api/v1/asin-families/activity", json={"storeId": "sample", "asins": ["B0CHILD001"]})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"storeId": "sample", "entries": [{"asin": "B0CHILD001", "parentAsin": "B0CHILD001", "status": "available"}]})

    def test_recovery_requires_pipeline_credentials_and_passes_only_the_claim_owner(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"SHOPIFY_PIPELINE_TOKEN": "fixture-key"}):
            app = create_coordinator_app(database_url=f"sqlite:///{(Path(directory) / 'receipt.sqlite3').as_posix()}")
            with TestClient(app) as client, patch.object(app.state.store, "recover_external_seo", return_value=True) as recover:
                route = "/api/v1/internal/product-pipeline/item/recover-external-seo"
                self.assertEqual(client.post(route, json={"workerId": "owner"}).status_code, 401)
                recover.assert_not_called()
                response = client.post(route, headers={"X-Pipeline-Key": "fixture-key"}, json={"workerId": "owner"})
                self.assertEqual(response.json(), {"status": "recovered"})
                recover.assert_called_once_with("item", worker_id="owner")


@unittest.skipUnless(os.environ.get("TEST_AMAZON_COORDINATOR_DATABASE_URL"), "PostgreSQL test URL is not configured")
class ActiveSeoPostgresTests(unittest.TestCase):
    def test_projects_compact_aliases_and_owner_from_postgres_queue(self):
        url = os.environ["TEST_AMAZON_COORDINATOR_DATABASE_URL"]
        schema = f"crawler_seo_identity_{uuid.uuid4().hex}"
        admin = create_engine(url)
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(make_url(url).update_query_dict({"options": f"-csearch_path={schema}"}))
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE gpt_jobs (id TEXT PRIMARY KEY,store_id TEXT,status TEXT,payload TEXT)"))
                connection.execute(text("CREATE TABLE seo_worker_jobs (job_id TEXT PRIMARY KEY,pipeline_active BOOLEAN)"))
                snapshot = {"asin": "B0CHILD001", "parentAsin": "B0PARENT01", "crawlerPipelineItemId": "owner",
                            "sourceVariants": [{"asin": "B0CHILD002", "unused": "large snapshot"}, {"asin": "B0PARENT01"}]}
                connection.execute(text("INSERT INTO gpt_jobs VALUES ('job','sample','REVIEW_READY',:payload)"), {
                    "payload": json.dumps({"execution": {"sourceIdentity": "amazon:test", "originalSnapshot": snapshot}}),
                })
                connection.execute(text("INSERT INTO seo_worker_jobs VALUES ('job',true)"))
            with Session(engine) as session:
                identities = load_active_seo_identities(session, "sample")
                self.assertEqual(len(identities), 1)
                self.assertEqual(identities[0].asins, frozenset({"B0CHILD001", "B0CHILD002"}))
                self.assertEqual(identities[0].owner_item_id, "owner")
                self.assertEqual(load_active_seo_identities(session, "other"), [])
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE seo_pipeline_identities(job_id TEXT PRIMARY KEY,store_id TEXT,source_key TEXT,source_revision TEXT,owner_item_id TEXT)"))
                connection.execute(text("CREATE TABLE seo_pipeline_asins(store_id TEXT,asin TEXT,job_id TEXT,PRIMARY KEY(store_id,asin,job_id))"))
                connection.execute(text("INSERT INTO seo_pipeline_identities VALUES ('job','sample','amazon:test','r1','owner')"))
                connection.execute(text("INSERT INTO seo_pipeline_asins VALUES ('sample','B0CHILD001','job'),('sample','B0CHILD002','job')"))
                connection.execute(text("UPDATE gpt_jobs SET payload='invalid-json: indexed path must not read payload'"))
            with Session(engine) as session:
                identities = load_active_seo_identities(session, "sample", asins={"B0CHILD002"})
                self.assertEqual(identities[0].asins, frozenset({"B0CHILD002"}))
                self.assertEqual(identities[0].owner_item_id, "owner")
                self.assertEqual(load_active_seo_identities(session, "other"), [])
        finally:
            engine.dispose()
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()
