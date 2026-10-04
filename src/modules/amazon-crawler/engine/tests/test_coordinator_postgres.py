"""Opt-in PostgreSQL importer tests in a newly created, isolated test schema.

Never point CRAWLER_TEST_DATABASE_URL at a production database.
An existing schema causes setup to fail; it is never replaced or deleted.
"""
import os
import unittest

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from engine.distributed.coordinator_migrations import migrate_coordinator
from engine.tests import test_coordinator_import


@unittest.skipUnless(os.environ.get("CRAWLER_TEST_DATABASE_URL"), "Requires isolated staging PostgreSQL")
class CoordinatorPostgresImportTests(test_coordinator_import.CoordinatorImportTests):
    def setUp(self):
        super().setUp()
        self.target.dispose()
        url = make_url(os.environ["CRAWLER_TEST_DATABASE_URL"])
        if url.get_backend_name() != "postgresql":
            self.fail("CRAWLER_TEST_DATABASE_URL must be PostgreSQL")
        admin = create_engine(url)
        with admin.begin() as connection:
            connection.execute(text("CREATE SCHEMA crawler_import_acceptance"))
        # Register cleanup only after this test successfully created the schema.
        def cleanup():
            try:
                with admin.begin() as connection:
                    connection.execute(text("DROP SCHEMA crawler_import_acceptance CASCADE"))
            finally:
                admin.dispose()
        self.addCleanup(cleanup)
        self.target = create_engine(url.update_query_dict({"options": "-csearch_path=crawler_import_acceptance"}))
        self.addCleanup(self.target.dispose)
        migrate_coordinator(self.target)
