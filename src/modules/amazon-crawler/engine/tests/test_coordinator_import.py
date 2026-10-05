import unittest
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, select

from engine.distributed.coordinator_migrations import migrate_coordinator
from engine.distributed.image_profile_repository import ImageProfileRecord
from engine.distributed.global_admission_gate import GlobalAdmissionGate, GLOBAL_ADMISSION_GATE_ID
from engine.distributed.migrate_local import import_profile_files, import_relational_rows
from engine.image_processing import ImageProfileStore


class CoordinatorImportTests(unittest.TestCase):
    def setUp(self):
        self.source = create_engine("sqlite:///:memory:")
        self.target = create_engine("sqlite:///:memory:")
        for engine in (self.source, self.target):
            migrate_coordinator(engine)
            self.addCleanup(engine.dispose)
        self.table = ImageProfileRecord.__table__
        with self.source.begin() as connection:
            connection.execute(self.table.insert(), [
                {"slug": "first", "payload": {"name": "First"}},
                {"slug": "second", "payload": {"name": "Second"}},
            ])

    def test_repeated_import_is_idempotent(self):
        for _ in range(2):
            with self.source.connect() as reader, self.target.begin() as writer:
                counts = import_relational_rows(reader, writer)
                self.assertEqual(counts["crawler_image_profiles"], 2)
        with self.target.connect() as connection:
            self.assertEqual(len(connection.execute(select(self.table)).all()), 2)

    def test_conflict_rolls_back_preceding_insertions(self):
        with self.target.begin() as connection:
            connection.execute(self.table.insert().values(slug="second", payload={"name": "Keep existing"}))
        with self.assertRaisesRegex(ValueError, "Conflicting target row"):
            with self.source.connect() as reader, self.target.begin() as writer:
                import_relational_rows(reader, writer)
        with self.target.connect() as connection:
            rows = connection.execute(select(self.table)).mappings().all()
            self.assertEqual([dict(row) for row in rows], [{"slug": "second", "payload": {"name": "Keep existing"}}])

    def test_dry_run_can_roll_back_all_imported_rows(self):
        with self.source.connect() as reader, self.target.connect() as writer:
            transaction = writer.begin()
            import_relational_rows(reader, writer)
            transaction.rollback()
        with self.target.connect() as connection:
            self.assertEqual(connection.execute(select(self.table)).all(), [])

    def test_import_replaces_only_the_pristine_open_gate_seed_and_preserves_stopped_state(self):
        with self.source.begin() as connection:
            connection.execute(GlobalAdmissionGate.__table__.update()
                .where(GlobalAdmissionGate.id == GLOBAL_ADMISSION_GATE_ID)
                .values(state="STOPPED", revision=1, actor="operator", reason="maintenance", request_id="a" * 32))
        for _ in range(2):
            with self.source.connect() as reader, self.target.begin() as writer:
                import_relational_rows(reader, writer)
        with self.target.connect() as connection:
            gate = connection.execute(select(GlobalAdmissionGate)).mappings().one()
            self.assertEqual(gate["state"], "STOPPED")
            self.assertEqual(gate["actor"], "operator")
            self.assertEqual(gate["reason"], "maintenance")

        with self.target.begin() as connection:
            connection.execute(GlobalAdmissionGate.__table__.update()
                .where(GlobalAdmissionGate.id == GLOBAL_ADMISSION_GATE_ID)
                .values(state="OPEN", revision=2, actor="operator", reason="opened", request_id="b" * 32))
        with self.assertRaisesRegex(ValueError, "crawler_global_admission_gate"):
            with self.source.connect() as reader, self.target.begin() as writer:
                import_relational_rows(reader, writer)

    def test_profile_files_import_without_modifying_source_and_can_repeat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ImageProfileStore(root)
            saved = store.save({"name": "Migrated"}, "migrated")
            original = {path: path.read_bytes() for path in root.rglob("*.json")}
            for _ in range(2):
                with self.target.begin() as writer:
                    self.assertEqual(import_profile_files(root, writer), 2)
            self.assertEqual({path: path.read_bytes() for path in root.rglob("*.json")}, original)
            from sqlalchemy.orm import sessionmaker
            from engine.distributed.image_profile_repository import ImageProfileRepository
            migrated = ImageProfileStore(root, repository=ImageProfileRepository(sessionmaker(self.target)))
            self.assertEqual(migrated.load_revision("migrated", saved["revision"]), saved)
