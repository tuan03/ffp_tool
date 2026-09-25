#!/usr/bin/env python3
"""Unit tests for Pinterest POD Studio: Trend Discovery, Graphic Printability Gate, and Candidate Rescue."""

import os
import sys
import unittest
from pathlib import Path

# Ensure server root is in sys.path
SERVER_ROOT = Path(__file__).resolve().parents[2]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

# Mock environment to avoid external network calls during unit tests
os.environ["MOCK_PINTEREST"] = "1"
os.environ["CI"] = "1"

from pinterest_pod_bridge import (
    ACTIVE_JOBS,
    JOB_CACHE_LOCK,
    _classify_reject_reason,
    create_pod_job,
    discover_pinterest_trends,
    infer_product_type_from_niche,
    rescue_pod_candidate,
)
from trend_tool.config import PipelineConfig, ProductTarget


class TestPinterestTrendDiscoveryAndRescue(unittest.TestCase):
    """Test suite covering Tier 1 & 2 discovery, Graphic Printability Gate, and Candidate Rescue."""

    def test_infer_product_type_from_niche(self):
        self.assertEqual(infer_product_type_from_niche("vintage leather bag"), "bag")
        self.assertEqual(infer_product_type_from_niche("canvas tote bag pattern"), "bag")
        self.assertEqual(infer_product_type_from_niche("cozy fleece blanket"), "blanket")
        self.assertEqual(infer_product_type_from_niche("wool throw quilt"), "blanket")
        self.assertEqual(infer_product_type_from_niche("persian medallion rug"), "rug")
        self.assertEqual(infer_product_type_from_niche("bathroom floor mat"), "rug")
        self.assertEqual(infer_product_type_from_niche("spooky cute ghost stickers"), "custom")

    def test_classify_reject_reason_categories(self):
        # Recipe
        reason, code = _classify_reject_reason("autumn pumpkin soup crockpot recipes")
        self.assertEqual(code, "NON_PRINTABLE_RECIPE")
        self.assertIn("công thức", reason)

        # Beauty / nails
        reason, code = _classify_reject_reason("almond fall nail art gel manicure")
        self.assertEqual(code, "NON_PRINTABLE_BEAUTY")
        self.assertIn("móng tay", reason)

        # 3D exterior / staging
        reason, code = _classify_reject_reason("front porch patio fall staging")
        self.assertEqual(code, "NON_PRINTABLE_3D_SPACE")
        self.assertIn("ngoại thất", reason)

        # Memes / text quotes
        reason, code = _classify_reject_reason("daily positive workout gym text quotes")
        self.assertEqual(code, "NON_PRINTABLE_TEXT_MEME")
        self.assertIn("trích dẫn", reason)

        # Wallpapers
        reason, code = _classify_reject_reason("aesthetic iphone wallpaper lock screen")
        self.assertEqual(code, "NON_PRINTABLE_WALLPAPER")
        self.assertIn("hình nền", reason)

    def test_discover_pinterest_trends_success(self):
        res = discover_pinterest_trends({
            "niche": "leather bag vintage",
            "trend_type": "growing",
            "region": "US",
            "interest": "womens_fashion",
        })
        self.assertTrue(res["ok"])
        self.assertEqual(res["niche"], "leather bag vintage")
        self.assertEqual(res["product"], "bag")
        self.assertEqual(res["trend_type"], "growing")
        self.assertEqual(res["region"], "US")

        # Must provide 3 to 5 theme clusters
        clusters = res["clusters"]
        self.assertGreaterEqual(len(clusters), 3)
        self.assertLessEqual(len(clusters), 5)

        for cluster in clusters:
            self.assertIn("cluster_id", cluster)
            self.assertIn("theme_name", cluster)
            self.assertIn("theme_name_vi", cluster)
            self.assertIn("sample_motifs", cluster)
            self.assertIn("fused_queries", cluster)
            self.assertGreater(len(cluster["fused_queries"]), 0)
            # Ensure queries are fused with 2D seamless pattern vectors
            self.assertTrue(any("seamless pattern vector" in q or "print design flat" in q for q in cluster["fused_queries"]))
            self.assertIn("growth_mom_avg", cluster)

        # Graphic Printability Gate
        self.assertGreater(len(res["accepted_keywords"]), 0)
        self.assertGreater(len(res["rejected_keywords"]), 0)
        for rk in res["rejected_keywords"]:
            self.assertFalse(rk.get("is_accepted", True))
            self.assertTrue(bool(rk.get("reject_reason")))
            self.assertTrue(bool(rk.get("reject_reason_code")))

    def test_discover_pinterest_trends_multi_query_matrix(self):
        res = discover_pinterest_trends({
            "niche": "halloween spooky cute blanket",
            "trend_type": "ALL",
            "region": "ALL",
        })
        self.assertTrue(res["ok"])
        self.assertEqual(res["trend_type"], "all")
        self.assertEqual(res["region"], "ALL")
        self.assertIn("query_matrix_stats", res)
        stats = res["query_matrix_stats"]
        self.assertEqual(stats["total_queries"], 18)
        self.assertGreaterEqual(stats["successful_queries"], 1)
        self.assertEqual(len(stats["markets"]), 6)
        self.assertEqual(len(stats["trend_types"]), 3)
        self.assertGreater(stats["raw_keywords_count"], 0)
        self.assertGreater(stats["unique_keywords_count"], 0)

        # Keywords must contain market and trend_type metadata
        for kw in res["accepted_keywords"]:
            self.assertIn("markets", kw)
            self.assertIn("trend_types", kw)
            self.assertIn("occurrences", kw)
            self.assertGreaterEqual(len(kw["markets"]), 1)
            self.assertGreaterEqual(len(kw["trend_types"]), 1)

    def test_discover_pinterest_trends_empty_niche(self):
        with self.assertRaises(ValueError):
            discover_pinterest_trends({"niche": ""})

        with self.assertRaises(ValueError):
            discover_pinterest_trends({"niche": "   "})

    def test_rescue_pod_candidate_from_rejected(self):
        test_job_id = "job_unit_test_rescue_1"
        with JOB_CACHE_LOCK:
            ACTIVE_JOBS[test_job_id] = {
                "job_id": test_job_id,
                "status": "ready_for_review",
                "candidates": [
                    {
                        "id": "cand_pin_01",
                        "image_id": "cand_pin_01",
                        "title": "Existing Candidate",
                        "is_direct_printable": True,
                        "candidate_category": "direct_printable",
                    }
                ],
                "rejected_candidates": [
                    {
                        "id": "cand_rej_88",
                        "image_id": "cand_rej_88",
                        "title": "Rejected Lifestyle Bag Pin",
                        "image_url": "https://example.com/lifestyle_bag.jpg",
                        "local_path": "/tmp/lifestyle_bag.jpg",
                        "candidate_category": "rejected",
                        "is_rejected": True,
                        "reject_reason": "Ảnh người mẫu chụp góc nghiêng",
                    }
                ],
            }

        res = rescue_pod_candidate(test_job_id, "cand_rej_88", base_url="http://127.0.0.1:8768")
        self.assertTrue(res["ok"])
        rescued = res["candidate"]
        self.assertEqual(rescued["candidate_category"], "breakthrough_concept")
        self.assertTrue(rescued["is_breakthrough_concept"])
        self.assertFalse(rescued["is_rejected"])
        self.assertTrue(rescued["recommended"])

        # Check job in-memory state
        with JOB_CACHE_LOCK:
            job = ACTIVE_JOBS[test_job_id]
            self.assertEqual(len(job["candidates"]), 2)
            self.assertEqual(len(job["rejected_candidates"]), 0)
            self.assertTrue(any(c["id"] == "cand_rej_88" for c in job["candidates"]))

    def test_rescue_already_active_candidate(self):
        test_job_id = "job_unit_test_rescue_2"
        with JOB_CACHE_LOCK:
            ACTIVE_JOBS[test_job_id] = {
                "job_id": test_job_id,
                "candidates": [
                    {
                        "id": "cand_pin_02",
                        "image_id": "cand_pin_02",
                        "title": "Direct Printable Bag",
                        "is_direct_printable": True,
                        "candidate_category": "direct_printable",
                    }
                ],
                "rejected_candidates": [],
            }

        res = rescue_pod_candidate(test_job_id, "cand_pin_02")
        self.assertTrue(res["ok"])
        self.assertEqual(res["candidate"]["candidate_category"], "breakthrough_concept")
        self.assertTrue(res["candidate"]["is_breakthrough_concept"])

    def test_rescue_nonexistent_job_raises_lookup_error(self):
        with self.assertRaises(LookupError):
            rescue_pod_candidate("nonexistent_job_xyz_999", "cand_01")

    def test_pipeline_config_supports_custom_queries_and_clusters(self):
        target = ProductTarget(name="bag", width_px=4500, height_px=5400)
        cfg = PipelineConfig(
            target=target,
            output_root=Path("/tmp/out"),
            trend_niche="leather bag",
            custom_queries=("vintage distressed leather bag seamless pattern vector",),
            selected_clusters=({"cluster_id": "cluster_vintage"},),
            trend_interest="womens_fashion",
        )
        self.assertEqual(len(cfg.custom_queries), 1)
        self.assertIn("seamless pattern vector", cfg.custom_queries[0])
        self.assertEqual(len(cfg.selected_clusters), 1)
        self.assertEqual(cfg.trend_interest, "womens_fashion")

    def test_vision_filter_disabled_bypasses_ai_and_accepts_all_images(self):
        from pinterest.image_crawler.vision_filter import ProductVisionFilter
        from pinterest.image_crawler.ranker import rank_images
        from pinterest.shared.models import ImageCandidate

        os.environ["DISABLE_VISION_FILTER"] = "1"
        try:
            cand = ImageCandidate(
                image_id="test_img_123",
                query="vintage seamless pattern",
                trend_id="trend_01",
                trend="vintage",
                image_url="https://i.pinimg.com/test.jpg",
                pin_id="111",
                pin_url="https://pinterest.com/pin/111",
                local_path="",
                width=1000,
                height=1000,
                dhash="0",
                source="pinterest",
            )
            vfilter = ProductVisionFilter(niche="leather bag")
            self.assertEqual(vfilter.mode, "off")
            self.assertIsNone(vfilter.client)

            results = vfilter.analyze([cand])
            self.assertIn("test_img_123", results)
            self.assertTrue(results["test_img_123"].accepted)
            self.assertEqual(results["test_img_123"].product_role, "PRIMARY")

            selected, rejected = rank_images(
                candidates=[cand],
                vision_results=results,
                top_images=10,
                min_score=20.0,
                accepted_roles={"PRIMARY"},
                min_product_visibility=75.0,
                min_trend_relevance=70.0,
                niche="leather bag",
                crawl_purpose="inspiration",
            )
            self.assertEqual(len(selected), 1)
            self.assertEqual(len(rejected), 0)
            self.assertEqual(selected[0].image_id, "test_img_123")
        finally:
            os.environ.pop("DISABLE_VISION_FILTER", None)


if __name__ == "__main__":
    unittest.main()
