"""Crawler/SEO deduplication without Shopify writes or a live worker."""

import json
import os
import unittest
import uuid

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from engine.distributed.coordinator_models import CrawlJob, CrawlProductItem, CrawlTask
from engine.tests import test_distributed
from engine.tests.test_distributed import client_hello
from engine.distributed.seo_pipeline_identity import load_active_seo_identities


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

    def seed_seo(self, *, job_id="seo-existing", store_id="sample", active=True, status="PENDING", owner=None):
        product = {"id": "product", "asin": "B0CHILD001", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red", "sourceVariants": [{"asin": "B0CHILD001"}]}
        if owner:
            product["crawlerPipelineItemId"] = owner
        payload = {"source": "amazon", "sourceIdentity": product["sourceKey"],
                   "execution": {"source": "amazon", "sourceIdentity": product["sourceKey"], "originalSnapshot": product}}
        with self.store.sessions.begin() as session:
            session.execute(text("INSERT INTO gpt_jobs VALUES (:id,:store,:status,:payload)"),
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
        finally:
            engine.dispose()
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()
