from __future__ import annotations

import os
import unittest
import uuid
from datetime import timedelta

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from engine.distributed.coordinator_models import ArchivedTaskAttempt, CrawlProductItem, TaskAttempt, create_database_engine, create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.coordinator_migrations import migrate_coordinator
from engine.distributed.protocol import utc_now
from engine.tests.coordinator_test_support import create_coordinator_test_schema


POSTGRES_TEST_URL = os.environ.get("TEST_AMAZON_COORDINATOR_DATABASE_URL", "").strip()


@unittest.skipUnless(POSTGRES_TEST_URL, "TEST_AMAZON_COORDINATOR_DATABASE_URL is not configured")
class PostgreSqlCoordinatorIntegrationTests(unittest.TestCase):
    def test_finished_external_seo_wakes_parked_pipeline_item(self) -> None:
        schema = f"crawler_seo_wake_test_{uuid.uuid4().hex}"
        admin_engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

        test_url = make_url(POSTGRES_TEST_URL).update_query_dict({"options": f"-csearch_path={schema}"})
        engine = create_database_engine(test_url.render_as_string(hide_password=False))
        try:
            migrate_coordinator(engine)
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE gpt_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL)"))
            store = CoordinatorStore(create_session_factory(engine))
            job = store.create_job({"urls": ["B0WAKESEO1"], "storeId": "store-1"})
            store.register_client({"clientId": "seo-wake-agent", "displayName": "SEO wake agent",
                                   "availableSlots": 1, "maxConcurrentInputs": 1})
            lease = store.lease_tasks("seo-wake-agent", 1)[0]
            product = {"id": "product", "sourceKey": "amazon:wake", "title": "Rug", "media": [], "variants": []}
            store.accept_product(lease["taskId"], "seo-wake-agent", lease["leaseId"], "amazon:wake", "checksum", {
                "jobId": job["id"], "product": product, "productChecksum": "checksum",
            })
            claim = store.claim_product_items(worker_id="pipeline-1", store_id="store-1", limit=1)[0]
            self.assertTrue(store.mark_product_seo(
                claim["id"], worker_id="pipeline-1", normalized_payload=product,
                seo_summary={"status": "running", "assetsNormalized": 0},
            ))
            self.assertTrue(store.defer_external_seo(
                claim["id"], worker_id="pipeline-1", external_job_id="gpt-ready", provider="codex_mcp",
            ))
            with engine.begin() as connection:
                connection.execute(text("INSERT INTO gpt_jobs(id,status) VALUES ('gpt-ready','REVIEW_READY')"))

            resumed = store.claim_product_items(worker_id="pipeline-2", store_id="store-1", limit=1)

            self.assertEqual([item["id"] for item in resumed], [claim["id"]])
            self.assertEqual(resumed[0]["product"], product)
            with store.sessions() as session:
                self.assertEqual(session.get(CrawlProductItem, claim["id"]).status, "seo")
        finally:
            engine.dispose()
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()

    def test_job_and_lease_persist_in_isolated_postgres_schema(self) -> None:
        schema = f"crawler_test_{uuid.uuid4().hex}"
        admin_engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

        test_url = make_url(POSTGRES_TEST_URL).update_query_dict({"options": f"-csearch_path={schema}"})
        engine = create_database_engine(test_url.render_as_string(hide_password=False))
        try:
            create_coordinator_test_schema(engine)
            store = CoordinatorStore(create_session_factory(engine))
            job = store.create_job({"urls": ["B0FR4MSS2H"]})
            store.register_client({
                "clientId": "postgres-client",
                "displayName": "Postgres client",
                "availableSlots": 1,
                "maxConcurrentInputs": 1,
            })

            lease = store.lease_tasks("postgres-client", 1)[0]

            self.assertEqual(job["acceptedInputs"], 1)
            self.assertEqual(lease["asin"], "B0FR4MSS2H")
            self.assertEqual(store.get_job(str(job["id"]))["status"], "running")
        finally:
            engine.dispose()
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()

    def test_dlq_attempts_and_idempotent_requeue_persist_in_isolated_postgres_schema(self) -> None:
        schema = f"crawler_dlq_test_{uuid.uuid4().hex}"
        admin_engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        test_url = make_url(POSTGRES_TEST_URL).update_query_dict({"options": f"-csearch_path={schema}"})
        engine = create_database_engine(test_url.render_as_string(hide_password=False))
        try:
            migrate_coordinator(engine)
            sessions = create_session_factory(engine)
            store = CoordinatorStore(sessions)
            job = store.create_job({"urls": ["B0FR4MSS2H"]})
            store.register_client({"clientId": "postgres-dlq-agent", "displayName": "Postgres test agent",
                "availableSlots": 1, "maxConcurrentInputs": 1, "agentVersion": "test-1",
                "crawlerVersion": "crawler-2", "parserVersion": "parser-3"})
            lease = store.lease_tasks("postgres-dlq-agent", 1)[0]
            self.assertEqual(store.fail_task("postgres-dlq-agent", {
                "taskId": lease["taskId"], "leaseId": lease["leaseId"],
                "error": {"reason": "invalid_url", "retryable": False, "message": "invalid fixture"},
            })["status"], "dead_letter")
            self.assertEqual(store.list_dead_letter_tasks(job_id=str(job["id"]))["total"], 1)
            action = {"task_ids": [lease["taskId"]], "expected_count": 1, "request_id": "postgres-dlq-requeue",
                "actor": "operator", "reason": "Reviewed fixture failure and approved retry."}
            first = store.requeue_dead_letter_tasks(**action)
            restarted_store = CoordinatorStore(create_session_factory(engine))
            second = restarted_store.requeue_dead_letter_tasks(**action)
            self.assertEqual(first, second)
            self.assertEqual(len(restarted_store.list_task_attempts(lease["taskId"])), 1)
            self.assertEqual(restarted_store.list_dead_letter_tasks(job_id=str(job["id"]))["total"], 0)
        finally:
            engine.dispose()
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()

    def test_seven_day_attempt_retention_deletes_old_live_and_archived_rows(self) -> None:
        schema = f"crawler_retention_test_{uuid.uuid4().hex}"
        admin_engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        test_url = make_url(POSTGRES_TEST_URL).update_query_dict({"options": f"-csearch_path={schema}"})
        engine = create_database_engine(test_url.render_as_string(hide_password=False))
        try:
            migrate_coordinator(engine)
            sessions = create_session_factory(engine)
            store = CoordinatorStore(sessions)
            store.register_client({"clientId": "retention-agent", "displayName": "Retention test agent",
                "availableSlots": 1, "maxConcurrentInputs": 1})

            live_job = store.create_job({"urls": ["B0FR4MSS2H"]})
            live_lease = store.lease_tasks("retention-agent", 1)[0]
            store.fail_task("retention-agent", {"taskId": live_lease["taskId"], "leaseId": live_lease["leaseId"],
                "error": {"reason": "invalid_url", "retryable": False}})

            archived_job = store.create_job({"urls": ["B0FR4MSS2H"]})
            archived_lease = store.lease_tasks("retention-agent", 1)[0]
            store.fail_task("retention-agent", {"taskId": archived_lease["taskId"], "leaseId": archived_lease["leaseId"],
                "error": {"reason": "invalid_url", "retryable": False}})
            self.assertTrue(store.delete_job(str(archived_job["id"])))

            with sessions.begin() as session:
                old_time = utc_now() - timedelta(days=8)
                live_attempt = session.scalar(select(TaskAttempt).where(TaskAttempt.task_id == live_lease["taskId"]))
                live_attempt.finished_at = old_time
                archived_attempt = session.scalar(select(ArchivedTaskAttempt).where(
                    ArchivedTaskAttempt.task_id == archived_lease["taskId"]))
                archived_attempt.archived_at = old_time

            cleaned = store.cleanup_attempt_history()
            self.assertEqual(cleaned, {"attempts": 1, "archivedAttempts": 1})
            self.assertEqual(store.list_task_attempts(live_lease["taskId"]), [])
            self.assertIsNone(store.list_task_attempts(archived_lease["taskId"]))
            self.assertEqual(store.get_job(str(live_job["id"]))["status"], "partial")
        finally:
            engine.dispose()
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()


if __name__ == "__main__":
    unittest.main()
