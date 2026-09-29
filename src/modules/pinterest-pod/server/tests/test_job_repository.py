from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from job_repository import PinterestJobRepository


class PinterestJobRepositoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "jobs.sqlite3"
        self.repository = PinterestJobRepository(f"sqlite:///{database_path.as_posix()}")

    def tearDown(self) -> None:
        self.repository.engine.dispose()
        self.temporary_directory.cleanup()

    def test_persists_job_snapshot_across_repository_instances(self) -> None:
        snapshot = {"status": "completed", "created_at": 123.0, "logs": ["done"]}
        self.repository.save("job_123", snapshot)

        second_repository = PinterestJobRepository(str(self.repository.engine.url))
        try:
            self.assertEqual(second_repository.load("job_123"), snapshot)
        finally:
            second_repository.engine.dispose()

    def test_creates_missing_sqlite_parent_directory(self) -> None:
        database_path = Path(self.temporary_directory.name) / "missing" / "nested" / "jobs.sqlite3"

        repository = PinterestJobRepository(f"sqlite:///{database_path.as_posix()}")
        try:
            repository.save("job_nested", {"status": "completed"})
            self.assertTrue(database_path.is_file())
        finally:
            repository.engine.dispose()

    def test_marks_interrupted_jobs_failed_after_restart(self) -> None:
        self.repository.save("job_running", {"status": "running", "logs": []})

        self.assertEqual(self.repository.recover_interrupted(), 1)
        recovered = self.repository.load("job_running")

        self.assertIsNotNone(recovered)
        self.assertEqual(recovered["status"], "failed")
        self.assertIn("khởi động lại", recovered["error"])

    def test_delete_removes_metadata(self) -> None:
        self.repository.save("job_delete", {"status": "cancelled"})

        self.assertTrue(self.repository.delete("job_delete"))
        self.assertIsNone(self.repository.load("job_delete"))


if __name__ == "__main__":
    unittest.main()
