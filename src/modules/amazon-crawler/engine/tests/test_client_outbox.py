"""Task 06: attempt-scoped durable outbox identities and migration."""
import sqlite3
import tempfile
import unittest
import asyncio
import urllib.error
from contextlib import closing
from unittest.mock import patch
from pathlib import Path

from engine.distributed.client_store import ClientStore
from engine.distributed.protocol import payload_checksum


class ClientOutboxTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "agent.sqlite3"

    def tearDown(self):
        self.directory.cleanup()

    def spool(self, store, lease, *, product=False, marker="original"):
        payload = {"jobId": "job", "marker": marker}
        arguments = dict(task_id="task", lease_id=lease, checksum=payload_checksum(payload), payload=payload)
        if product:
            store.spool_product(product_key="product", **arguments)
        else:
            store.spool_result(**arguments)

    def test_attempts_have_distinct_stable_ids_after_reopen(self):
        store = ClientStore(self.path)
        for product in (False, True):
            for lease in ("a", "b"):
                self.spool(store, lease, product=product)
        before = store.pending_results() + store.pending_products()
        self.assertEqual(len(before), 4)
        self.assertEqual(len({row["resultId"] for row in before}), 4)
        reopened = ClientStore(self.path)
        self.assertEqual(reopened.pending_results() + reopened.pending_products(), before)

    def test_same_attempt_retry_keeps_identity_attempts_and_original_content(self):
        store = ClientStore(self.path)
        self.spool(store, "a")
        row = store.pending_results()[0]
        store.result_failed(row["resultId"], "offline")
        self.spool(store, "a")
        self.assertEqual(store.pending_results()[0]["resultId"], row["resultId"])
        self.assertEqual(store.pending_results()[0]["attempts"], 1)
        with self.assertRaisesRegex(ValueError, "content"):
            self.spool(store, "a", marker="changed")
        self.assertEqual(store.pending_results()[0]["payload"], row["payload"])

    def test_ack_of_old_attempt_preserves_new_result_and_assignment(self):
        store = ClientStore(self.path)
        self.spool(store, "a")
        old = store.pending_results()[0]
        store.save_assignment({"taskId": "task", "jobId": "job", "leaseId": "b", "settingsFingerprint": "settings"})
        self.spool(store, "b")
        store.acknowledge_result(old["resultId"])
        self.assertEqual([row["leaseId"] for row in store.pending_results()], ["b"])
        self.assertEqual(store.assignment("task")["leaseId"], "b")

    def test_product_ack_and_failure_are_exact_and_do_not_block_other_attempt(self):
        store = ClientStore(self.path)
        for lease in ("a", "b"):
            self.spool(store, lease, product=True)
        first, second = store.pending_products()
        store.product_failed(first["resultId"], "offline")
        self.assertEqual([row["attempts"] for row in store.pending_products()], [1, 0])
        store.acknowledge_product(second["resultId"])
        self.assertTrue(store.has_pending_products("task", "a"))
        self.assertFalse(store.has_pending_products("task", "b"))

    def test_old_completion_cannot_mark_new_assignment_completed(self):
        store = ClientStore(self.path)
        store.save_assignment({"taskId": "task", "jobId": "job", "leaseId": "b", "settingsFingerprint": "settings"})
        self.spool(store, "a")
        self.assertEqual(store.local_tasks()[0]["status"], "leased")

    def make_legacy(self):
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("CREATE TABLE agent_identity(singleton INTEGER PRIMARY KEY, client_id TEXT)")
            connection.execute("INSERT INTO agent_identity VALUES (1, 'existing-agent')")
            for table, key in (("pending_results", "task_id TEXT PRIMARY KEY,"),
                               ("pending_products", "task_id TEXT, product_key TEXT,")):
                connection.execute(f"CREATE TABLE {table} ({key} lease_id TEXT, checksum TEXT, payload_json TEXT, attempts INTEGER, last_error TEXT, created_at TEXT, updated_at TEXT)")
                values = ["task"] + (["product"] if table == "pending_products" else []) + ["a", "legacy-checksum", '{"jobId":"job"}', 3, "offline", "created", "updated"]
                connection.execute(f"INSERT INTO {table} VALUES ({','.join('?' for _ in values)})", values)

    def test_legacy_migration_backs_up_preserves_all_fields_and_is_repeatable(self):
        self.make_legacy()
        store = ClientStore(self.path)
        self.assertEqual(store.client_id(), "existing-agent")
        snapshots = store.pending_results() + store.pending_products()
        self.assertEqual(len(snapshots), 2)
        self.assertTrue(all(row["resultId"] for row in snapshots))
        self.assertTrue(all(row["attempts"] == 3 for row in snapshots))
        self.assertTrue(all(row["checksum"] == "legacy-checksum" for row in snapshots))
        self.assertEqual(ClientStore(self.path).pending_results() + ClientStore(self.path).pending_products(), snapshots)
        backups = list(self.path.parent.glob("agent.sqlite3.pre-outbox-v1-*.bak"))
        self.assertEqual(len(backups), 1)
        with closing(sqlite3.connect(backups[0])) as connection:
            self.assertEqual(connection.execute("SELECT payload_json, last_error, created_at, updated_at FROM pending_results").fetchone(), ('{"jobId":"job"}', "offline", "created", "updated"))
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 2)

    def test_newer_schema_fails_closed(self):
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("PRAGMA user_version=99")
        with self.assertRaisesRegex(RuntimeError, "newer"):
            ClientStore(self.path)

    def test_migration_failure_rolls_back_both_tables_and_can_retry(self):
        from engine.distributed import client_outbox_migrations as migration
        self.make_legacy()
        create = migration._create_outbox
        def fail_second(connection, table):
            if table == "pending_products":
                raise RuntimeError("injected migration failure")
            create(connection, table)
        with patch.object(migration, "_create_outbox", side_effect=fail_second):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                ClientStore(self.path)
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 0)
            self.assertNotIn("result_id", {row[1] for row in connection.execute("PRAGMA table_info(pending_results)")})
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM pending_products").fetchone()[0], 1)
        self.assertEqual(ClientStore(self.path).upload_counts(), {"products": 1, "results": 1})

    def test_backup_failure_leaves_legacy_data_unchanged(self):
        self.make_legacy()
        with patch("engine.distributed.client_outbox_migrations._backup", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                ClientStore(self.path)
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT attempts FROM pending_results").fetchone()[0], 3)


class AgentOutboxDeliveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from engine.distributed.client_agent import DistributedCrawlerAgent
        from engine.distributed.client_config import AgentConfig
        from engine.distributed.protocol import AgentLimits
        self.directory = tempfile.TemporaryDirectory()
        self.agent = DistributedCrawlerAgent(project_root=Path(self.directory.name), config=AgentConfig(
            server_url="http://127.0.0.1:9999", display_name="test", max_concurrent_inputs=1,
            limits=AgentLimits(), data_directory=Path(self.directory.name)))

    def tearDown(self):
        self.directory.cleanup()

    def spool(self, lease="a", product=False):
        payload = {"jobId": "job", "product": {"sourceKey": "product"}}
        arguments = dict(task_id="task", lease_id=lease, checksum=payload_checksum(payload), payload=payload)
        if product:
            self.agent.store.spool_product(product_key="product", **arguments)
            return self.agent.store.pending_products()[-1]
        self.agent.store.spool_result(**arguments)
        return self.agent.store.pending_results()[-1]

    async def cycle(self):
        with patch("engine.distributed.client_agent.asyncio.sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await self.agent._upload_loop()

    async def test_missing_or_wrong_receipt_never_deletes_outbox(self):
        row = self.spool()
        for response in ({"status": "duplicate"}, {"status": "accepted", "receiptId": "wrong", "checksum": row["checksum"]}):
            with patch.object(self.agent, "_upload_result", return_value=response):
                await self.cycle()
        self.assertEqual(self.agent.store.pending_results()[0]["resultId"], row["resultId"])
        self.assertEqual(self.agent.store.pending_results()[0]["attempts"], 2)

    async def test_matching_receipt_removes_only_uploaded_attempt(self):
        row = self.spool()
        assignment = {"taskId": "task", "jobId": "job", "leaseId": "b", "settingsFingerprint": "settings"}
        self.agent.store.save_assignment(assignment)
        self.agent.active["task"] = assignment
        receipt = {"status": "duplicate", "checksum": row["checksum"],
                   "receiptId": payload_checksum(["final", "task", self.agent.client_id, "a", ""])}
        with patch.object(self.agent, "_upload_result", return_value=receipt):
            await self.cycle()
        self.assertEqual(self.agent.store.pending_results(), [])
        self.assertEqual(self.agent.active["task"]["leaseId"], "b")
        self.assertEqual(self.agent.store.assignment("task")["leaseId"], "b")

    async def test_batch_acknowledges_only_items_with_matching_durable_receipts(self):
        first = self.spool()
        second_payload = {"jobId": "job", "product": {"sourceKey": "product-2"}}
        self.agent.store.spool_result(task_id="task-2", lease_id="b",
                                      checksum=payload_checksum(second_payload), payload=second_payload)
        second = self.agent.store.pending_results()[1]
        first_receipt = {"taskId": first["taskId"], "leaseId": first["leaseId"],
                         "status": "accepted", "checksum": first["checksum"],
                         "receiptId": payload_checksum(["final", first["taskId"], self.agent.client_id,
                                                         first["leaseId"], ""])}
        # An omitted transient receipt cannot acknowledge or discard that outbox row.
        with patch.object(self.agent, "_upload_result_batch", return_value=[first_receipt]):
            await self.cycle()
        remaining = self.agent.store.pending_results()
        self.assertEqual([row["resultId"] for row in remaining], [second["resultId"]])
        self.assertEqual(remaining[0]["attempts"], 1)

    async def test_batch_upload_uses_bounded_gzipped_endpoint_and_per_item_identity(self):
        from urllib.request import Request
        first = self.spool()
        second_payload = {"jobId": "job", "product": {"sourceKey": "product-2"}}
        self.agent.store.spool_result(task_id="task-2", lease_id="b",
                                      checksum=payload_checksum(second_payload), payload=second_payload)
        second = self.agent.store.pending_results()[1]

        class Response:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return b'{"results": []}'

        captured = {}
        def open_request(request):
            self.assertIsInstance(request, Request)
            captured["url"] = request.full_url
            captured["headers"] = request.header_items()
            captured["body"] = request.data
            return Response()
        with patch.object(self.agent, "_open_agent_request", side_effect=open_request):
            self.assertEqual(self.agent._upload_result_batch([first, second]), [])
        self.assertTrue(captured["url"].endswith("/api/v1/worker/results/batch"))
        self.assertTrue(any(key.casefold() == "content-encoding" and value == "gzip"
                            for key, value in captured["headers"]))
        import gzip, json
        envelope = json.loads(gzip.decompress(captured["body"]))
        self.assertEqual([item["taskId"] for item in envelope["items"]], ["task", "task-2"])

    async def test_http_errors_preserve_products_and_results(self):
        final = self.spool()
        product = self.spool(product=True)
        for code in (404, 409, 401, 500):
            for upload, row in ((self.agent._upload_product, product), (self.agent._upload_result, final)):
                with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("test", code, "failed", {}, None)):
                    with self.assertRaises(urllib.error.HTTPError):
                        upload(row)
        self.assertEqual(self.agent.store.upload_counts(), {"products": 1, "results": 1})

    async def test_product_requires_matching_checksum_before_ack(self):
        row = self.spool(product=True)
        receipt = {"status": "accepted", "checksum": "wrong",
                   "receiptId": payload_checksum(["product", "task", self.agent.client_id, "a", "product"])}
        with patch.object(self.agent, "_upload_product", return_value=receipt):
            await self.cycle()
        self.assertEqual(self.agent.store.pending_products()[0]["attempts"], 1)
        receipt["checksum"] = row["checksum"]
        with patch.object(self.agent, "_upload_product", return_value=receipt):
            await self.cycle()
        self.assertEqual(self.agent.store.pending_products(), [])

    async def test_lost_ack_retries_durable_result_without_recrawling(self):
        from sqlalchemy import select
        from engine.distributed.coordinator_models import TaskResult, UploadReceipt, create_database_engine, create_session_factory
        from engine.distributed.coordinator_store import CoordinatorStore
        from engine.tests.coordinator_test_support import create_coordinator_test_schema
        engine = create_database_engine(f"sqlite:///{Path(self.directory.name).as_posix()}/coordinator.sqlite3")
        try:
            create_coordinator_test_schema(engine)
            sessions = create_session_factory(engine)
            coordinator = CoordinatorStore(sessions)
            job = coordinator.create_job({"urls": ["B0FR4MSS2H"]})
            coordinator.register_client({"clientId": self.agent.client_id, "displayName": "test", "availableSlots": 1, "maxConcurrentInputs": 1})
            lease = coordinator.lease_tasks(self.agent.client_id, 1)[0]
            payload = {"jobId": job["id"], "products": []}
            self.agent.store.spool_result(task_id=lease["taskId"], lease_id=lease["leaseId"], checksum=payload_checksum(payload), payload=payload)
            def upload(row):
                return coordinator.accept_result(row["taskId"], self.agent.client_id, row["leaseId"], row["checksum"], row["payload"])
            row = self.agent.store.pending_results()[0]
            first = upload(row)  # Server commits; response is lost before local ACK.
            self.agent.store = ClientStore(self.agent.store.path)
            self.assertEqual(self.agent.store.pending_results()[0]["resultId"], row["resultId"])
            self.assertEqual(upload(row)["receiptId"], first["receiptId"])
            with patch.object(self.agent, "_upload_result", side_effect=upload):
                await self.cycle()
            self.assertEqual(self.agent.store.pending_results(), [])
            with sessions() as session:
                self.assertEqual(len(list(session.scalars(select(TaskResult)))), 1)
                self.assertEqual(len(list(session.scalars(select(UploadReceipt)))), 1)
        finally:
            engine.dispose()
