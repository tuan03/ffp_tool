import unittest

from sqlalchemy import create_engine, inspect, select

from engine.distributed.coordinator_migrations import MIGRATIONS, MIGRATION_VERSION, migrate_coordinator


class CoordinatorMigrationTests(unittest.TestCase):
    def test_schema_upgrade_is_idempotent_and_registers_profile_tables(self):
        engine = create_engine("sqlite:///:memory:")
        try:
            migrate_coordinator(engine)
            migrate_coordinator(engine)
            self.assertIn("crawler_image_profiles", inspect(engine).get_table_names())
            with engine.connect() as connection:
                self.assertEqual(sorted(connection.scalars(select(MIGRATIONS.c.version))), list(range(1, MIGRATION_VERSION + 1)))
            self.assertIn("crawler_upload_receipts", inspect(engine).get_table_names())
        finally:
            engine.dispose()

    def test_newer_schema_is_rejected(self):
        engine = create_engine("sqlite:///:memory:")
        try:
            migrate_coordinator(engine)
            with engine.begin() as connection:
                connection.execute(MIGRATIONS.insert().values(version=MIGRATION_VERSION + 1))
            with self.assertRaisesRegex(RuntimeError, "newer server"):
                migrate_coordinator(engine)
        finally:
            engine.dispose()
