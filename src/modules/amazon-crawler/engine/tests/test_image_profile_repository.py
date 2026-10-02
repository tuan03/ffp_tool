import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from engine.distributed.coordinator_models import Base
from engine.distributed.image_profile_repository import ImageProfileRepository
from engine.image_processing import ImageProfileStore


class ImageProfilePersistenceTests(unittest.TestCase):
    def test_profile_and_revision_survive_repository_restart_without_json(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine(f"sqlite:///{directory}/test.sqlite3")
            try:
                Base.metadata.create_all(engine)
                sessions = sessionmaker(engine)
                root = Path(directory) / "images"
                first = ImageProfileStore(root, repository=ImageProfileRepository(sessions))
                saved = first.save({"name": "Saved profile"}, "test")
                first.save({"name": "Changed profile"}, "test")
                restarted = ImageProfileStore(root, repository=ImageProfileRepository(sessions))
                self.assertEqual(restarted.load("test")["name"], "Changed profile")
                self.assertEqual(restarted.load_revision("test", saved["revision"])["name"], "Saved profile")
                self.assertEqual(list(root.rglob("*.json")), [])
                restarted.delete("test")
                with self.assertRaises(KeyError):
                    restarted.load("test")
                self.assertEqual(restarted.load_revision("test", saved["revision"])["name"], "Saved profile")
            finally:
                engine.dispose()
