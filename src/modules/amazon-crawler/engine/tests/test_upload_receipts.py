"""Durable upload acknowledgements and immutable retry contents."""
import tempfile
import unittest
from unittest.mock import patch
from datetime import timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import select, inspect, delete

from engine.distributed.coordinator_models import Base, CrawlTask, CrawlProductItem, TaskResult, UploadReceipt, create_database_engine, create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.protocol import payload_checksum, utc_now


class UploadReceiptTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_database_engine(f"sqlite:///{Path(self.directory.name).as_posix()}/test.sqlite3")
        self.initialize_fixture()

    def initialize_fixture(self):
        Base.metadata.create_all(self.engine)
        self.sessions = create_session_factory(self.engine)
        self.store = CoordinatorStore(self.sessions)
        self.job = self.store.create_job({"urls": ["B0FR4MSS2H"]})
        self.store.register_client({"clientId": "a", "displayName": "a", "availableSlots": 1, "maxConcurrentInputs": 1})
        self.lease = self.store.lease_tasks("a", 1)[0]

    def tearDown(self):
        self.engine.dispose()
        self.directory.cleanup()

    def final(self, payload):
        return self.store.accept_result(self.lease["taskId"], "a", self.lease["leaseId"], payload_checksum(payload), payload)

    def product(self, payload):
        return self.store.accept_product(self.lease["taskId"], "a", self.lease["leaseId"], "fixture-product", payload_checksum(payload), payload)

    def test_final_retry_returns_same_receipt_after_store_restart(self):
        payload = {"jobId": self.job["id"], "products": []}
        first = self.final(payload)
        self.store = CoordinatorStore(create_session_factory(self.engine))
        retry = self.final(payload)
        self.assertEqual(retry["status"], "duplicate")
        self.assertEqual(retry["receiptId"], first["receiptId"])
        self.assertEqual(retry["checksum"], payload_checksum(payload))

    def test_reconcile_completed_attempt_allows_receipt_retry_not_recrawl(self):
        self.final({"jobId": self.job["id"], "products": []})
        local = [{"taskId": self.lease["taskId"], "leaseId": self.lease["leaseId"], "jobId": self.job["id"]}]
        reply = self.store.reconcile_tasks("a", local)
        self.assertEqual(reply["uploadTaskIds"], [self.lease["taskId"]])
        self.assertEqual(reply["resumeTaskIds"], [])
        self.assertEqual(reply["discardTaskIds"], [])
        self.assertEqual(self.store.reconcile_tasks("other", local)["uploadTaskIds"], [])

    def test_final_changed_content_conflicts_without_overwrite(self):
        payload = {"jobId": self.job["id"], "products": [], "marker": "original"}
        self.final(payload)
        changed = {**payload, "marker": "changed"}
        self.assertEqual(self.final(changed)["status"], "conflict")
        with self.sessions() as session:
            self.assertEqual(session.get(TaskResult, self.lease["taskId"]).payload["marker"], "original")

    def test_product_retry_survives_expiry_and_raw_payload_cleanup(self):
        payload = {"jobId": self.job["id"], "product": {"id": "fixture-product", "title": "original"}}
        first = self.product(payload)
        with self.sessions.begin() as session:
            session.get(CrawlTask, self.lease["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
            session.scalar(select(CrawlProductItem)).raw_payload = {}
        self.store = CoordinatorStore(create_session_factory(self.engine))
        retry = self.product(payload)
        self.assertEqual(retry["status"], "duplicate")
        self.assertEqual(retry["receiptId"], first["receiptId"])
        with self.sessions() as session:
            self.assertEqual(session.scalar(select(CrawlProductItem)).raw_payload, {})

    def test_product_changed_content_conflicts_even_with_same_claimed_checksum(self):
        payload = {"jobId": self.job["id"], "productChecksum": "untrusted", "product": {"id": "fixture-product", "title": "original"}}
        self.product(payload)
        changed = {**payload, "product": {"id": "fixture-product", "title": "changed"}}
        self.assertEqual(self.product(changed)["status"], "conflict")

    def test_stale_writer_without_receipt_cannot_upload(self):
        with self.sessions.begin() as session:
            session.get(CrawlTask, self.lease["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
        payload = {"jobId": self.job["id"], "product": {"id": "fixture-product"}}
        self.assertEqual(self.product(payload)["status"], "stale")

    def test_legacy_final_checksum_backfills_receipt_after_payload_pruning(self):
        payload = {"jobId": self.job["id"], "products": [], "marker": "original"}
        self.final(payload)
        with self.sessions.begin() as session:
            session.execute(delete(UploadReceipt))
            session.get(TaskResult, self.lease["taskId"]).payload = {}
        self.assertEqual(self.final({**payload, "marker": "changed"})["status"], "conflict")
        self.assertEqual(self.final(payload)["status"], "duplicate")
        self.assertEqual(self.final(payload)["checksum"], payload_checksum(payload))

    def test_failed_transaction_does_not_leave_receipt_or_result(self):
        payload = {"jobId": self.job["id"], "products": []}
        original = self.store._save_receipt
        def fail_after_receipt(*args):
            original(*args)
            raise RuntimeError("injected transaction failure")
        with patch.object(self.store, "_save_receipt", side_effect=fail_after_receipt):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                self.final(payload)
        with self.sessions() as session:
            self.assertEqual(list(session.scalars(select(UploadReceipt))), [])
            self.assertEqual(list(session.scalars(select(TaskResult))), [])
            self.assertEqual(session.get(CrawlTask, self.lease["taskId"]).status, "leased")
        self.assertEqual(self.final(payload)["status"], "accepted")

    def test_migration_v1_to_v2_preserves_task_and_is_repeatable(self):
        from engine.distributed.coordinator_migrations import MIGRATIONS, migrate_coordinator
        UploadReceipt.__table__.drop(self.engine)
        with self.engine.begin() as connection:
            MIGRATIONS.create(connection, checkfirst=True)
            connection.execute(MIGRATIONS.insert().values(version=1))
        migrate_coordinator(self.engine)
        migrate_coordinator(self.engine)
        self.assertIn("crawler_upload_receipts", inspect(self.engine).get_table_names())
        with self.sessions() as session:
            self.assertEqual(session.get(CrawlTask, self.lease["taskId"]).lease_id, self.lease["leaseId"])
        with self.engine.connect() as connection:
            self.assertEqual(sorted(connection.scalars(select(MIGRATIONS.c.version))), [1, 2, 3])

    def test_concurrent_final_uploads_share_one_receipt_on_postgres(self):
        if self.engine.dialect.name != "postgresql":
            self.skipTest("Requires PostgreSQL row locking; run audit --receipts")
        barrier = Barrier(2, timeout=10)
        payload = {"jobId": self.job["id"], "products": []}
        def upload():
            barrier.wait()
            return self.final(payload)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(upload) for _ in range(2)]
            responses = [future.result(timeout=20) for future in futures]
        self.assertEqual(sorted(response["status"] for response in responses), ["accepted", "duplicate"])
        self.assertEqual(len({response["receiptId"] for response in responses}), 1)
        with self.sessions() as session:
            self.assertEqual(len(list(session.scalars(select(UploadReceipt)))), 1)
            self.assertEqual(len(list(session.scalars(select(TaskResult)))), 1)
