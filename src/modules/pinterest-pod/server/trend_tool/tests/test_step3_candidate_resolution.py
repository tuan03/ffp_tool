import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from PIL import Image

import pinterest_pod_bridge as bridge
import trend_tool.pipeline as pipeline
from trend_tool.config import PipelineConfig, ProductTarget


class Step3CandidateResolutionTests(unittest.TestCase):
    def test_find_run_dir_for_candidate_ids_from_manifest_or_images(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            run_dir = root / "run_20261002_101648"
            (run_dir / "task5_crawl" / "downloaded_images").mkdir(parents=True)
            cand_img = run_dir / "task5_crawl" / "downloaded_images" / "3cbec61a46e39daf.jpg"
            Image.new("RGB", (32, 32), "blue").save(cand_img)

            review_manifest = {
                "status": "ready_for_review",
                "candidates": [
                    {
                        "image_id": "3cbec61a46e39daf",
                        "id": "3cbec61a46e39daf",
                        "local_path": str(cand_img),
                        "query": "rug",
                    }
                ],
            }
            (run_dir / "candidate_review.json").write_text(json.dumps(review_manifest), encoding="utf-8")

            with patch.object(bridge, "LOCAL_OUTPUT_DIR", root), patch.object(bridge, "STANDALONE_OUTPUT_DIR", root):
                found = bridge.find_run_dir_for_candidate_ids({"3cbec61a46e39daf"})
                self.assertIsNotNone(found)
                self.assertEqual(found.name, "run_20261002_101648")

                # Test finding by image file even if candidate_review.json is missing
                (run_dir / "candidate_review.json").unlink()
                found_by_img = bridge.find_run_dir_for_candidate_ids({"3cbec61a46e39daf"})
                self.assertIsNotNone(found_by_img)
                self.assertEqual(found_by_img.name, "run_20261002_101648")

    def test_fork_selected_candidates_recovers_missing_path_from_sibling_run(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            crawl_run = root / "run_20261002_101648"
            (crawl_run / "task5_crawl" / "downloaded_images").mkdir(parents=True)
            cand_img = crawl_run / "task5_crawl" / "downloaded_images" / "test_cand_123.jpg"
            Image.new("RGB", (32, 32), "green").save(cand_img)

            config = PipelineConfig(
                target=ProductTarget(name="rug", width_px=32, height_px=32),
                output_root=root,
            )

            # Source candidate has no valid local_path in source_run_dir, but exists in sibling crawl_run
            cands = [{"image_id": "test_cand_123", "id": "test_cand_123", "local_path": ""}]
            forked, new_run = pipeline.fork_selected_candidates_to_new_run(
                cands,
                source_run_dir=root / "nonexistent_source",
                output_root=root,
                config=config,
            )
            self.assertEqual(len(forked), 1)
            self.assertTrue(Path(forked[0].local_path).exists())
            self.assertEqual(Path(forked[0].local_path).name, "test_cand_123.jpg")

    def test_run_production_recovers_candidate_from_sibling_run(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            crawl_run = root / "run_20261002_101648"
            (crawl_run / "task5_crawl" / "downloaded_images").mkdir(parents=True)
            cand_img = crawl_run / "task5_crawl" / "downloaded_images" / "cand_recover.jpg"
            Image.new("RGB", (32, 32), "purple").save(cand_img)

            prod_run = root / "run_20261002_102001"
            prod_run.mkdir(parents=True)

            config = PipelineConfig(
                target=ProductTarget(name="rug", width_px=32, height_px=32),
                output_root=root,
                design_mode="direct_print",
                gemini_backend="off",
                export_cmyk=False,
                task4_variants_per_product=1,
            )

            # Candidate without local_path should be recovered from crawl_run in output_root
            candidate_item = {"image_id": "cand_recover", "id": "cand_recover", "local_path": ""}
            with patch("trend_tool.pipeline.render_product_from_print", side_effect=RuntimeError("no canvas")), \
                 patch("trend_tool.pipeline.time.sleep"), \
                 patch("trend_tool.pipeline.build_direct_ai_mockup", return_value=None):
                result = pipeline.run_production_from_candidates([candidate_item], config, run_dir=prod_run)

            self.assertEqual(result.run_dir, prod_run)
            copied_img = prod_run / "task5_crawl" / "downloaded_images" / "cand_recover.jpg"
            self.assertTrue(copied_img.exists())

    def test_produce_pod_job_resolves_candidate_paths_when_source_job_disconnected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            crawl_run = root / "run_20261002_101648"
            (crawl_run / "task5_crawl" / "downloaded_images").mkdir(parents=True)
            cand_img = crawl_run / "task5_crawl" / "downloaded_images" / "cand_abc.jpg"
            Image.new("RGB", (32, 32), "yellow").save(cand_img)

            review_manifest = {
                "status": "ready_for_review",
                "candidates": [
                    {
                        "image_id": "cand_abc",
                        "id": "cand_abc",
                        "local_path": str(cand_img),
                        "query": "rug",
                    }
                ],
            }
            (crawl_run / "candidate_review.json").write_text(json.dumps(review_manifest), encoding="utf-8")

            with patch.object(bridge, "LOCAL_OUTPUT_DIR", root), \
                 patch.object(bridge, "STANDALONE_OUTPUT_DIR", root), \
                 patch.object(bridge, "TEMP_DIR", root / "temp"), \
                 patch.object(bridge, "ACTIVE_JOBS", {}), \
                 patch("threading.Thread.start"):  # Do not actually start thread in unit test
                result = bridge.produce_pod_job({
                    "jobId": "unknown_stopped_uuid_123",
                    "selected_candidates": [{"id": "cand_abc"}],
                    "product": "rug",
                    "niche": "boho rug",
                }, base_url="http://localhost")

                self.assertTrue(result["ok"])
                local_job_id = result["jobId"]
                self.assertIn(local_job_id, bridge.ACTIVE_JOBS)
                job_req = bridge.ACTIVE_JOBS[local_job_id]["request"]
                produced_cands = job_req["selected_candidates"]
                self.assertEqual(len(produced_cands), 1)
                self.assertTrue(Path(produced_cands[0]["local_path"]).exists())
                self.assertEqual(Path(produced_cands[0]["local_path"]).name, "cand_abc.jpg")

    def test_worker_initializes_active_jobs_and_propagates_failures(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with patch.object(bridge, "LOCAL_OUTPUT_DIR", root), \
                 patch.object(bridge, "TEMP_DIR", root / "temp"), \
                 patch.object(bridge, "ACTIVE_JOBS", {}), \
                 patch("trend_tool.pipeline.run_production_from_candidates", side_effect=RuntimeError("Simulated pipeline failure")):

                job_id = "test_fail_job_456"
                req_body = {
                    "workflow_stage": "production",
                    "selected_candidates": [{"image_id": "cand_x", "local_path": str(root / "cand_x.jpg")}],
                    "niche": "rug",
                    "product": "rug",
                }

                with self.assertRaises(RuntimeError) as ctx:
                    bridge._run_local_pipeline_worker(job_id, req_body, "http://localhost")

                self.assertIn("Simulated pipeline failure", str(ctx.exception))
                self.assertIn(job_id, bridge.ACTIVE_JOBS)
                self.assertEqual(bridge.ACTIVE_JOBS[job_id]["status"], "failed")
                self.assertIn("Simulated pipeline failure", bridge.ACTIVE_JOBS[job_id]["error"])

                manifest = bridge.load_job_manifest(job_id)
                self.assertIsNotNone(manifest)
                self.assertEqual(manifest["status"], "failed")


if __name__ == "__main__":
    unittest.main()
