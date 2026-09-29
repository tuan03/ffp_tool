from __future__ import annotations

import json
import multiprocessing
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.cache import RawFamilyCache
from engine.cache_storage import CacheLimits
from engine.tests.test_core import cache_family, cache_partial, source_variant

KEY = "B012345678:90001:us-v1"


def write_stale_partial(directory, child, ready, release):
    cache = RawFamilyCache(Path(directory))
    partial = cache.load_partial(KEY)
    variant = source_variant(child, "Ocean", "Twin")
    variant["customizationComplete"] = True
    partial["family"]["sourceVariants"].append(variant)
    partial["completedAsins"].append(child)
    ready.set()
    if not release.wait(10):
        raise RuntimeError("Writer release timed out")
    cache.save_partial(KEY, partial)


def crash_before_replace(directory):
    cache = RawFamilyCache(Path(directory))
    with patch("engine.cache.os.replace", side_effect=lambda *_: os._exit(19)):
        cache.save(KEY, cache_family())


def hold_cache_key(directory, ready, release):
    cache = RawFamilyCache(Path(directory))
    with cache.crawl_guard(KEY):
        ready.set()
        release.wait(10)


def append_children(directory, prefix):
    cache = RawFamilyCache(Path(directory))
    for index in range(10):
        cache.append_checkpoint(KEY, "child_page_complete", {"asin": f"{prefix}{index}", "child": {"title": "Complete page"}})


def crash_during_checkpoint_repair(directory):
    cache = RawFamilyCache(Path(directory))
    replace = os.replace
    def interrupted_replace(source, destination):
        if Path(destination).suffix == ".jsonl":
            os._exit(19)
        return replace(source, destination)
    with patch("engine.cache.os.replace", side_effect=interrupted_replace):
        cache.load_checkpoint(KEY)


class CacheIntegrityTests(unittest.TestCase):
    def test_deeply_nested_invalid_cache_is_quarantined(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache._path(KEY).write_text('{"schemaVersion":8,"family":' + '[' * 1500 + '0' + ']' * 1500 + '}', encoding="utf-8")
            self.assertIsNone(cache.load(KEY))
            self.assertEqual(cache.metrics_snapshot()["corrupt"], 1)

    def test_crash_during_checkpoint_repair_retains_previous_completed_stages(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.append_checkpoint(KEY, "parent_complete", {"parent": {"asin": "B012345678"}})
            cache.append_checkpoint(KEY, "matrix_complete", {"asinOptions": {}, "dimensions": {}})
            path = cache._checkpoint_path(KEY)
            with path.open("ab") as stream:
                stream.write(b'{"broken')
            worker = multiprocessing.get_context("spawn").Process(target=crash_during_checkpoint_repair, args=(directory,))
            worker.start()
            worker.join(10)
            try:
                self.assertEqual(worker.exitcode, 19)
                self.assertTrue(path.exists())
                resumed = RawFamilyCache(Path(directory)).load_checkpoint(KEY)
                self.assertIsNotNone(resumed["parent"])
                self.assertIsNotNone(resumed["matrix"])
            finally:
                if worker.is_alive():
                    worker.terminate()
                    worker.join(5)

    def test_corrupt_metrics_database_is_rebuilt_without_losing_family(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save(KEY, cache_family())
            cache.storage.database.write_bytes(b"corrupt sqlite metadata")
            restarted = RawFamilyCache(Path(directory))
            self.assertIsNotNone(restarted.load(KEY))
            self.assertEqual(restarted.metrics_snapshot()["corrupt"], 1)
            self.assertEqual(restarted.metrics_snapshot()["files"], 2)

    def test_capacity_rejection_keeps_active_cooldown_and_partial(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory), limits=CacheLimits(total_bytes=3000))
            cache.save_failure("blocked", status="temporarily_blocked", reason="captcha", retry_after_seconds=120)
            cache.save_partial(KEY, cache_partial())
            huge = cache_family()
            huge["description"] = "x" * 4000
            cache.save(KEY, huge)
            self.assertIsNotNone(cache.load_failure("blocked"))
            self.assertIsNotNone(cache.load_partial(KEY))
            self.assertEqual(cache.metrics_snapshot()["writeRejected"], 1)

    def test_file_count_limit_evicts_old_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory), limits=CacheLimits(total_files=2))
            cache.save("first", cache_family())
            cache.save("second", cache_family())
            cache.save("third", cache_family())
            self.assertIsNone(cache.load("first"))
            self.assertIsNotNone(cache.load("second"))
            self.assertIsNotNone(cache.load("third"))
            self.assertLessEqual(cache.metrics_snapshot()["files"], 2)

    def test_process_lock_is_released_when_owner_is_killed(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            context = multiprocessing.get_context("spawn")
            ready, release = context.Event(), context.Event()
            worker = context.Process(target=hold_cache_key, args=(directory, ready, release))
            worker.start()
            try:
                self.assertTrue(ready.wait(10))
                with cache.storage.lock(cache.storage.path_digest(cache._path(KEY)), "active", blocking=False) as acquired:
                    self.assertFalse(acquired)
                worker.terminate()
                worker.join(5)
                with cache.crawl_guard(KEY) as acquired:
                    self.assertTrue(acquired)
            finally:
                if worker.is_alive():
                    worker.terminate()
                    worker.join(5)

    def test_two_processes_append_checkpoints_without_losing_records(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.append_checkpoint(KEY, "parent_complete", {"parent": {"asin": "B012345678"}})
            cache.append_checkpoint(KEY, "matrix_complete", {"asinOptions": {}, "dimensions": {}})
            context = multiprocessing.get_context("spawn")
            workers = [context.Process(target=append_children, args=(directory, prefix)) for prefix in ("child-a-", "child-b-")]
            for worker in workers:
                worker.start()
            try:
                for worker in workers:
                    worker.join(10)
                    self.assertEqual(worker.exitcode, 0)
                self.assertEqual(len(cache.load_checkpoint(KEY)["children"]), 20)
                self.assertEqual(cache.metrics_snapshot()["corrupt"], 0)
            finally:
                for worker in workers:
                    if worker.is_alive():
                        worker.terminate()
                        worker.join(5)

    def test_failed_child_does_not_overwrite_a_completed_child(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            complete = cache_partial()
            complete["family"]["sourceVariants"][0]["customizationComplete"] = True
            complete.update({"completedAsins": ["B012345678"], "failedAsins": [], "retryableAsins": [], "nonRetryableAsins": []})
            cache.save_partial(KEY, complete)
            stale = cache_partial()
            stale["family"]["sourceVariants"][0].update({"price": None, "diagnostics": {"fetchMode": "failed"}})
            stale.update({"completedAsins": [], "failedAsins": ["B012345678"], "retryableAsins": ["B012345678"], "nonRetryableAsins": []})
            cache.save_partial(KEY, stale)
            merged = cache.load_partial(KEY)
            self.assertEqual(merged["completedAsins"], ["B012345678"])
            self.assertEqual(merged["failedAsins"], [])
            self.assertIsNotNone(merged["family"]["sourceVariants"][0]["price"])

    def test_valid_json_with_changed_contents_is_quarantined(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save(KEY, cache_family())
            path = cache._path(KEY)
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["family"]["sourceTitle"] = "Silent corruption"
            path.write_text(json.dumps(payload), encoding="utf-8")
            self.assertIsNone(cache.load(KEY))
            self.assertEqual(len(list((cache.directory / "quarantine").glob("*.corrupt"))), 1)
            self.assertEqual(cache.metrics_snapshot()["corrupt"], 1)

    def test_legacy_valid_cache_is_upgraded_without_recrawling(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            path = cache._path(KEY)
            path.write_text(json.dumps({"schemaVersion": 8, "family": cache_family()}), encoding="utf-8")
            self.assertIsNotNone(cache.load(KEY))
            self.assertIn("checksum", json.loads(path.read_text(encoding="utf-8")))

    def test_oversized_file_is_rejected_before_json_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory), limits=CacheLimits(entry_bytes=2048))
            cache._path(KEY).write_bytes(b" " * 4096)
            with patch("engine.cache.json.loads", side_effect=AssertionError("Must not parse a huge file")):
                self.assertIsNone(cache.load(KEY))
            self.assertEqual(cache.metrics_snapshot()["corrupt"], 1)

    def test_oversized_write_preserves_previous_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory), limits=CacheLimits(entry_bytes=2048))
            cache.save(KEY, cache_family())
            huge = cache_family()
            huge["description"] = "x" * 4096
            cache.save(KEY, huge)
            self.assertIsNotNone(cache.load(KEY))
            self.assertNotIn("description", cache.load(KEY))
            self.assertEqual(cache.metrics_snapshot()["writeRejected"], 1)

    def test_two_processes_merge_stale_partial_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            partial = cache_partial()
            partial.update({"completedAsins": [], "failedAsins": [], "retryableAsins": [], "nonRetryableAsins": []})
            cache.save_partial(KEY, partial)
            context = multiprocessing.get_context("spawn")
            ready_a, ready_b, release_a, release_b = [context.Event() for _ in range(4)]
            workers = [context.Process(target=write_stale_partial, args=(directory, child, ready, release))
                for child, ready, release in (("B012345679", ready_a, release_a), ("B012345680", ready_b, release_b))]
            for worker in workers:
                worker.start()
            try:
                self.assertTrue(ready_a.wait(10) and ready_b.wait(10))
                release_a.set()
                workers[0].join(10)
                release_b.set()
                workers[1].join(10)
                self.assertEqual([worker.exitcode for worker in workers], [0, 0])
                merged = cache.load_partial(KEY)
                self.assertEqual({v["asin"] for v in merged["family"]["sourceVariants"]}, {"B012345678", "B012345679", "B012345680"})
                self.assertTrue({"B012345679", "B012345680"}.issubset(merged["completedAsins"]))
            finally:
                for worker in workers:
                    if worker.is_alive():
                        worker.terminate()
                        worker.join(5)

    def test_complete_cache_survives_late_partial_and_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save(KEY, cache_family())
            cache.save_partial(KEY, cache_partial())
            cache.append_checkpoint(KEY, "parent_complete", {"parent": {"asin": "B012345678"}})
            self.assertIsNotNone(cache.load(KEY))
            self.assertIsNone(cache.load_partial(KEY))
            self.assertIsNone(cache.load_checkpoint(KEY))

    def test_checkpoint_checksum_keeps_other_completed_stages(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.append_checkpoint(KEY, "parent_complete", {"parent": {"asin": "B012345678"}})
            cache.append_checkpoint(KEY, "matrix_complete", {"asinOptions": {"B012345678": {}}, "dimensions": {}})
            cache.append_checkpoint(KEY, "child_page_complete", {"asin": "B012345678", "child": {"title": "Original"}})
            path = cache._checkpoint_path(KEY)
            records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            records[-1]["payload"]["child"]["title"] = "Changed"
            path.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
            checkpoint = cache.load_checkpoint(KEY)
            self.assertIsNotNone(checkpoint["parent"])
            self.assertIsNotNone(checkpoint["matrix"])
            self.assertNotIn("B012345678", checkpoint["children"])
            self.assertEqual(cache.metrics_snapshot()["corrupt"], 1)
            cache.load_checkpoint(KEY)
            self.assertEqual(cache.metrics_snapshot()["corrupt"], 1)

    def test_restart_cleans_tmp_after_process_crash_and_retains_family(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save(KEY, cache_family())
            worker = multiprocessing.get_context("spawn").Process(target=crash_before_replace, args=(directory,))
            worker.start()
            worker.join(10)
            try:
                self.assertEqual(worker.exitcode, 19)
                self.assertEqual(len(list(cache.directory.glob(".amazon-cache-*.tmp"))), 1)
                restarted = RawFamilyCache(Path(directory))
                self.assertIsNotNone(restarted.load(KEY))
                self.assertEqual(list(cache.directory.glob(".amazon-cache-*.tmp")), [])
            finally:
                if worker.is_alive():
                    worker.terminate()
                    worker.join(5)

    def test_maintenance_expires_unread_partial_and_uses_lru(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory), limits=CacheLimits(total_bytes=4000))
            cache.save_partial(KEY, cache_partial(), ttl_seconds=-1)
            cache.maintain(force=True)
            self.assertFalse(cache._path(KEY, "partial").exists())
            for key in ("older", "recent"):
                family = cache_family()
                family["description"] = "x" * 600
                cache.save(key, family)
            cache.load("older")
            family = cache_family()
            family["description"] = "x" * 1300
            cache.save("new", family)
            self.assertIsNotNone(cache.load("older"))
            self.assertIsNone(cache.load("recent"))
            self.assertLessEqual(cache.metrics_snapshot()["bytes"], 4000)
            self.assertGreaterEqual(cache.metrics_snapshot()["evicted"], 2)

    def test_cleanup_skips_key_held_by_another_process(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.save_partial(KEY, cache_partial())
            context = multiprocessing.get_context("spawn")
            ready, release = context.Event(), context.Event()
            worker = context.Process(target=hold_cache_key, args=(directory, ready, release))
            worker.start()
            try:
                self.assertTrue(ready.wait(10))
                cache.save_partial(KEY, cache_partial(), ttl_seconds=-1)
                cache.maintain(force=True)
                self.assertTrue(cache._path(KEY, "partial").exists())
                release.set()
                worker.join(10)
                cache.maintain(force=True)
                self.assertFalse(cache._path(KEY, "partial").exists())
            finally:
                if worker.is_alive():
                    worker.terminate()
                    worker.join(5)

    def test_metrics_persist_and_family_ttl_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RawFamilyCache(Path(directory))
            cache.load("missing")
            cache.save(KEY, cache_family())
            cache.load(KEY)
            restarted = RawFamilyCache(Path(directory))
            self.assertGreaterEqual(restarted.metrics_snapshot()["hit"], 1)
            self.assertGreaterEqual(restarted.metrics_snapshot()["miss"], 1)
            with patch("engine.cache_storage.time.time", return_value=10**11):
                restarted.maintain(force=True)
            self.assertIsNone(restarted.load(KEY))
