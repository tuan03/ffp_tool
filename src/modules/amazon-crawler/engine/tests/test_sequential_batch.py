"""Sequential Amazon batches: durable exact coverage and fleet-wide admission."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
import os
import json
import uuid
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from engine.distributed.coordinator_models import CrawlJob, CrawlTask, CrawlProductItem, create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.protocol import utc_now
from engine.tests import test_distributed
from engine.tests.test_distributed import client_hello


class SequentialBatchTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_distributed.CoordinatorStoreTests()
        self.fixture.setUp()
        self.store = self.fixture.store
        for client in ("client-a", "client-b"):
            self.store.register_client(client_hello(client, slots=8))

    def tearDown(self):
        self.fixture.tearDown()

    def create(self, **extra):
        return self.store.create_job({"urls": ["B0CHILD001", "B0CHILD002", "B0CHILD003"],
                                      "storeId": "sample", "sequentialBatch": True, **extra})

    def finish(self, lease, children):
        products = [{"id": asin, "asin": asin, "parentAsin": "B0PARENT01",
                     "sourceKey": f"amazon:B0PARENT01:color:{asin}",
                     "sourceVariants": [{"asin": asin}]} for asin in children]
        return self.store.accept_result(lease["taskId"], "client-a", lease["leaseId"], "checksum",
                                       {"jobId": lease["jobId"], "products": products})

    def test_one_task_across_all_agents_until_final_result_is_received(self):
        self.create()
        first = self.store.lease_tasks("client-a", 8)
        self.assertEqual(len(first), 1)
        self.assertEqual(self.store.lease_tasks("client-b", 8), [])
        self.assertEqual(self.store.lease_tasks("client-a", 8), [])
        self.finish(first[0], ["B0CHILD001", "B0CHILD002"])
        next_leases = self.store.lease_tasks("client-b", 8)
        self.assertEqual([lease["asin"] for lease in next_leases], ["B0CHILD003"])

    def test_two_coordinator_instances_cannot_lease_siblings_concurrently(self):
        self.create()
        barrier = Barrier(2)
        def lease(client):
            other = CoordinatorStore(self.store.sessions)
            barrier.wait(timeout=10)
            return other.lease_tasks(client, 8)
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lease, ["client-a", "client-b"]))
        self.assertEqual(sum(len(response) for response in responses), 1)

    def test_partial_coverage_never_skips_unknown_siblings_or_parent(self):
        self.create(urls=["B0CHILD001", "B0CHILD002", "B0PARENT01"])
        first = self.store.lease_tasks("client-a", 8)[0]
        self.finish(first, ["B0CHILD001"])
        self.assertEqual(self.store.lease_tasks("client-b", 8)[0]["asin"], "B0CHILD002")

    def test_completed_shopify_and_pipeline_inputs_are_durable_non_error_skips(self):
        job = self.create(batchSkippedInputs=[{"asin": "B0CHILD001", "reason": "existing_shopify"},
                                              {"asin": "B0CHILD002", "reason": "existing_pipeline"}])
        self.assertEqual(job["progress"]["completed"], 2)
        self.assertEqual(job["progress"]["batch"]["skippedShopify"], 1)
        self.assertEqual(job["progress"]["batch"]["skippedPipeline"], 1)
        self.assertEqual(self.store.lease_tasks("client-a", 8)[0]["asin"], "B0CHILD003")

    def test_all_inputs_skipped_finishes_without_agent_assignment(self):
        job = self.create(urls=["B0CHILD001"], batchSkippedInputs=[{"asin": "B0CHILD001", "reason": "existing_shopify"}])
        self.assertEqual(job["status"], "completed")
        self.assertEqual(self.store.lease_tasks("client-a", 8), [])

    def test_receiving_products_does_not_release_next_link_before_final_receipt(self):
        job = self.create()
        first = self.store.lease_tasks("client-a", 8)[0]
        product = {"id": "received", "asin": "B0CHILD002", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red"}
        self.store.accept_product(first["taskId"], "client-a", first["leaseId"], product["sourceKey"],
                                  "checksum", {"jobId": job["id"], "product": product, "productChecksum": "checksum"})
        self.assertEqual(self.store.lease_tasks("client-b", 8), [])

    def test_retry_delay_holds_the_batch_instead_of_dispatching_next_link(self):
        self.create()
        with self.store.sessions.begin() as session:
            first = session.scalar(select(CrawlTask).order_by(CrawlTask.ordinal))
            first.next_retry_at = utc_now() + timedelta(minutes=5)
        self.assertEqual(self.store.lease_tasks("client-b", 8), [])

    def test_legacy_jobs_keep_parallel_assignment(self):
        self.create(sequentialBatch=False)
        self.assertEqual(len(self.store.lease_tasks("client-a", 8)), 3)

    def test_invalid_skip_metadata_is_rejected(self):
        for skips in ([{"asin": "B0OTHER001", "reason": "existing_shopify"}],
                      [{"asin": "B0CHILD001", "reason": "anything"}]):
            with self.subTest(skips=skips), self.assertRaises(ValueError):
                self.create(batchSkippedInputs=skips)

    def test_restart_keeps_exact_coverage_and_skipped_messages(self):
        job = self.create()
        first = self.store.lease_tasks("client-a", 8)[0]
        self.finish(first, ["B0CHILD001", "B0CHILD002", "B0CHILD003"])
        restarted = CoordinatorStore(self.store.sessions)
        self.assertEqual(restarted.lease_tasks("client-b", 8), [])
        snapshot = restarted.get_job(job["id"])
        self.assertEqual(snapshot["progress"]["completed"], 3)
        self.assertEqual(snapshot["progress"]["batch"]["covered"], 2)
        self.assertEqual(restarted.list_jobs()[0]["progress"]["batch"]["covered"], 2)
        self.assertEqual(restarted.job_summary(job["id"])["progress"]["items"][1]["skipReason"], "received")
        self.assertNotIn("Đã lấy qua ASIN", restarted.job_summary(job["id"])["progress"]["message"])
        self.assertNotIn("items", restarted.list_jobs()[0]["progress"])
        self.assertIn("B0CHILD001", snapshot["progress"]["items"][1]["message"])
        self.assertEqual(snapshot["progress"]["seoQueueHandoff"]["totalProducts"], 3)

    def test_expired_lease_retries_same_input_and_rejects_old_final_result(self):
        self.create()
        first = self.store.lease_tasks("client-a", 8)[0]
        with self.store.sessions.begin() as session:
            session.get(CrawlTask, first["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
        with patch("engine.distributed.coordinator_store.retry_delay", return_value=0):
            self.store.reap_expired()
        next_lease = self.store.lease_tasks("client-b", 8)[0]
        self.assertEqual(next_lease["taskId"], first["taskId"])
        self.assertEqual(self.finish(first, ["B0CHILD001", "B0CHILD002"])["status"], "stale")
        self.assertEqual(self.store.lease_tasks("client-a", 8), [])

    def test_partial_upload_survives_retry_without_prematurely_finishing_input(self):
        job = self.create()
        first = self.store.lease_tasks("client-a", 8)[0]
        product = {"id": "partial", "asin": "B0CHILD001", "parentAsin": "B0PARENT01",
                   "sourceKey": "amazon:B0PARENT01:color:red"}
        self.store.accept_product(first["taskId"], "client-a", first["leaseId"], product["sourceKey"],
                                  "checksum", {"jobId": job["id"], "product": product, "productChecksum": "checksum"})
        with self.store.sessions.begin() as session:
            task = session.get(CrawlTask, first["taskId"])
            task.status = "queued"
            task.lease_id = None
        retried = self.store.lease_tasks("client-a", 8)
        self.assertEqual([lease["taskId"] for lease in retried], [first["taskId"]])

    def test_pause_and_resume_preserve_sequential_gate(self):
        job = self.create()
        first = self.store.lease_tasks("client-a", 8)[0]
        self.store.pause_job(job["id"])
        self.finish(first, ["B0CHILD001", "B0CHILD002"])
        self.assertEqual(self.store.lease_tasks("client-b", 8), [])
        self.store.resume_job(job["id"])
        self.assertEqual([lease["asin"] for lease in self.store.lease_tasks("client-b", 8)], ["B0CHILD003"])

    def test_external_seo_appearing_after_preflight_is_checked_before_assignment(self):
        self.create()
        with self.store.sessions.begin() as session:
            session.execute(text("CREATE TABLE gpt_jobs (id TEXT PRIMARY KEY, store_id TEXT, status TEXT, payload TEXT)"))
            session.execute(text("CREATE TABLE seo_worker_jobs (job_id TEXT PRIMARY KEY, pipeline_active BOOLEAN)"))
            payload = {"execution": {"source": "amazon", "sourceIdentity": "amazon:B0PARENT01:color:red",
                                     "originalSnapshot": {"asin": "B0CHILD001", "parentAsin": "B0PARENT01"}}}
            session.execute(text("INSERT INTO gpt_jobs VALUES ('seo','sample','PENDING',:payload)"), {"payload": json.dumps(payload)})
            session.execute(text("INSERT INTO seo_worker_jobs VALUES ('seo',true)"))
        self.assertEqual(self.store.lease_tasks("client-a", 8)[0]["asin"], "B0CHILD002")

    def test_other_store_receipts_do_not_skip_current_store_inputs(self):
        old = self.create(storeId="other")
        self.finish(self.store.lease_tasks("client-a", 8)[0], ["B0CHILD001", "B0CHILD002", "B0CHILD003"])
        self.store.lease_tasks("client-b", 8)
        with self.store.sessions.begin() as session:
            session.get(CrawlJob, old["id"]).status = "completed"
        self.create()
        self.assertEqual(self.store.lease_tasks("client-a", 8)[0]["asin"], "B0CHILD001")

    def test_cleared_receipts_do_not_permanently_skip_a_new_batch(self):
        old = self.create()
        self.finish(self.store.lease_tasks("client-a", 8)[0], ["B0CHILD001", "B0CHILD002", "B0CHILD003"])
        self.store.lease_tasks("client-b", 8)
        with self.store.sessions.begin() as session:
            session.get(CrawlJob, old["id"]).status = "completed"
            for item in session.scalars(select(CrawlProductItem).where(CrawlProductItem.job_id == old["id"])):
                item.status = "failed"
                item.last_error = {"phase": "seo", "message": "GPT SEO job cancelled: Removed from Queue by operator"}
        self.create()
        self.assertEqual(self.store.lease_tasks("client-a", 8)[0]["asin"], "B0CHILD001")


@unittest.skipUnless(os.environ.get("TEST_AMAZON_COORDINATOR_DATABASE_URL"), "PostgreSQL test URL is not configured")
class SequentialBatchPostgresTests(SequentialBatchTests):
    def setUp(self):
        self.schema = f"test_crawler_batch_{uuid.uuid4().hex}"
        url = os.environ["TEST_AMAZON_COORDINATOR_DATABASE_URL"]
        self.admin = create_engine(url)
        with self.admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(make_url(url).update_query_dict({"options": f"-csearch_path={self.schema}"}))
        test_distributed.create_coordinator_test_schema(self.engine)
        self.store = CoordinatorStore(create_session_factory(self.engine))
        for client in ("client-a", "client-b"):
            self.store.register_client(client_hello(client, slots=8))

    def tearDown(self):
        self.engine.dispose()
        with self.admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        self.admin.dispose()
