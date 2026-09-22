from __future__ import annotations

import os
import unittest
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from engine.distributed.coordinator_models import Base, create_database_engine, create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore


POSTGRES_TEST_URL = os.environ.get("TEST_AMAZON_COORDINATOR_DATABASE_URL", "").strip()


@unittest.skipUnless(POSTGRES_TEST_URL, "TEST_AMAZON_COORDINATOR_DATABASE_URL is not configured")
class PostgreSqlCoordinatorIntegrationTests(unittest.TestCase):
    def test_job_and_lease_persist_in_isolated_postgres_schema(self) -> None:
        schema = f"crawler_test_{uuid.uuid4().hex}"
        admin_engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

        test_url = make_url(POSTGRES_TEST_URL).update_query_dict({"options": f"-csearch_path={schema}"})
        engine = create_database_engine(test_url.render_as_string(hide_password=False))
        try:
            Base.metadata.create_all(engine)
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


if __name__ == "__main__":
    unittest.main()
