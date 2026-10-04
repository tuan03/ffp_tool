import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from engine.image_processing import ImageProfileStore
from engine.proxy_profiles import load_proxy_profiles


class SharedProfileTests(unittest.TestCase):
    def test_bundled_profiles_include_logo_bytes_and_survive_repeat_seeding(self):
        seeds = Path(__file__).resolve().parents[5] / "config/image-processing-profiles"
        with tempfile.TemporaryDirectory() as temporary:
            store = ImageProfileStore(Path(temporary))
            store.seed_shared(seeds)
            for source in seeds.glob("*.json"):
                profile = store.load(source.stem)
                self.assertTrue(profile["hasLogo"])
                original = (seeds / "logos" / f"{source.stem}.png").read_bytes()
                self.assertEqual(hashlib.sha256(store.logo_path(source.stem).read_bytes()).digest(), hashlib.sha256(original).digest())
                revision = profile["revision"]
                store.seed_shared(seeds)
                self.assertEqual(store.load(source.stem)["revision"], revision)

    def test_seed_preserves_operator_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            seeds = root / "shared"
            seeds.mkdir()
            (seeds / "team.json").write_text(json.dumps({"slug": "team", "name": "Team", "enabled": True}))
            store = ImageProfileStore(root / "runtime")
            store.seed_shared(seeds)
            self.assertEqual(store.load("team")["name"], "Team")
            store.save({"name": "Operator changed"}, "team")
            store.seed_shared(seeds)
            self.assertEqual(store.load("team")["name"], "Operator changed")

    def test_shared_proxy_requires_complete_environment_and_local_takes_priority(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict("os.environ", {}, clear=True):
            root = Path(temporary)
            (root / "config").mkdir()
            shared = root / "config/amazon-crawler-profiles.shared.json"
            shared.write_text(json.dumps({"profiles": [{"name": "team", "proxy": {"serverEnv": "TEAM_SERVER", "passwordEnv": "TEAM_PASSWORD"}}]}))
            self.assertEqual(load_proxy_profiles(root)[0], [])
            with patch.dict("os.environ", {"TEAM_SERVER": "http://proxy.test:80", "TEAM_PASSWORD": "test-only"}):
                self.assertEqual(load_proxy_profiles(root)[0][0]["proxy"]["password"], "test-only")
            (root / "config/amazon-crawler-profiles.json").write_text('{"profiles": []}')
            self.assertEqual(load_proxy_profiles(root)[0], [])
