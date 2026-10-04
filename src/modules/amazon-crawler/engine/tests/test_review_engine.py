"""Focused contracts for the Amazon review crawler and exports."""

import unittest
import random
import threading
from pathlib import Path
from unittest.mock import Mock, patch

from engine.review_engine import normalize_review_source, parse_review_page, crawl_review_pages, crawl_reviews_with_agent
from engine.review_export import build_review_workbook, JUDGEME_FIELDS, QA_FIELDS


class ReviewEngineTests(unittest.TestCase):
    def test_agent_fetches_product_context_without_visiting_review_pages(self):
        pool = Mock()
        pool.fetch.return_value = '''<h1 id="productTitle">Pattern Rug</h1>
        <div id="productDescription">Autumn deer print for a living room.</div>
        <div id="feature-bullets"><li><span class="a-list-item">Printed deer artwork</span></li></div>
        <div id="customer_review-R1"><span data-hook="review-star-rating">5 stars</span>
        <span data-hook="review-body">This review must not be collected.</span></div>'''
        updates = []
        cancel_event = threading.Event()
        with patch("engine.review_engine.PlaywrightPool", return_value=pool), \
             patch("engine.review_engine.resolve_proxy_assignments", return_value=([], [])):
            output = crawl_reviews_with_agent("B012345678", root=Path("unused"),
                settings={"maxPages": 10, "contextOnly": True}, proxy_config_path=None,
                progress=updates.append, cancel_event=cancel_event)
        pool.fetch.assert_called_once_with("https://www.amazon.com/dp/B012345678", cancel_event=cancel_event)
        pool.close.assert_called_once()
        self.assertEqual(output["context"]["title"], "Pattern Rug")
        self.assertEqual(output["context"]["description"], "Autumn deer print for a living room.")
        self.assertEqual(output["context"]["bullets"], ["Printed deer artwork"])
        self.assertEqual(output["reviews"], [])
        self.assertEqual(output["pagesFetched"], 0)
        self.assertEqual(output["stopReason"], "context_ready")
        self.assertEqual(updates[-1]["phase"], "context")
        self.assertEqual(updates[-1]["completed"], 1)

    def test_context_only_agent_reports_challenges_and_missing_product_facts(self):
        for html, expected_reason in [
            ('<form id="ap_signin_form"></form>', "signin"),
            ('<form action="/validateCaptcha"></form>', "captcha"),
            ("<html><body>No product facts</body></html>", "context_unavailable"),
        ]:
            with self.subTest(reason=expected_reason):
                pool = Mock()
                pool.fetch.return_value = html
                with patch("engine.review_engine.PlaywrightPool", return_value=pool), \
                     patch("engine.review_engine.resolve_proxy_assignments", return_value=([], [])):
                    output = crawl_reviews_with_agent("B012345678", root=Path("unused"), settings={},
                        proxy_config_path=None, progress=lambda _update: None, cancel_event=threading.Event())
                pool.fetch.assert_called_once()
                pool.close.assert_called_once()
                self.assertEqual(output["stopReason"], expected_reason)
                self.assertEqual(output["reviews"], [])
                self.assertTrue(output["warnings"])

    def test_context_only_agent_does_not_fetch_when_cancelled(self):
        pool = Mock()
        cancel_event = threading.Event()
        cancel_event.set()
        with patch("engine.review_engine.PlaywrightPool", return_value=pool), \
             patch("engine.review_engine.resolve_proxy_assignments", return_value=([], [])):
            output = crawl_reviews_with_agent("B012345678", root=Path("unused"), settings={},
                proxy_config_path=None, progress=lambda _update: None, cancel_event=cancel_event)
        pool.fetch.assert_not_called()
        pool.close.assert_called_once()
        self.assertEqual(output["stopReason"], "cancelled")

    def test_context_only_agent_rejects_wrong_asin_and_closes_browser_after_fetch_failure(self):
        for response, expected_reason in [
            ('<input id="ASIN" value="B098765432"><h1 id="productTitle">Different Rug</h1>', "context_unavailable"),
            (RuntimeError("Browser could not load the product page"), "fetch_failed"),
        ]:
            with self.subTest(reason=expected_reason):
                pool = Mock()
                if isinstance(response, Exception):
                    pool.fetch.side_effect = response
                else:
                    pool.fetch.return_value = response
                with patch("engine.review_engine.PlaywrightPool", return_value=pool), \
                     patch("engine.review_engine.resolve_proxy_assignments", return_value=([], [])):
                    output = crawl_reviews_with_agent("B012345678", root=Path("unused"), settings={},
                        proxy_config_path=None, progress=lambda _update: None, cancel_event=threading.Event())
                pool.fetch.assert_called_once()
                pool.close.assert_called_once()
                self.assertEqual(output["stopReason"], expected_reason)
                self.assertEqual(output["context"]["title"], "")
                self.assertTrue(output["warnings"])

    def test_normalizes_asin_and_product_url(self):
        self.assertEqual(normalize_review_source("B012345678")[0], "B012345678")
        self.assertEqual(normalize_review_source("https://www.amazon.com/dp/B012345678")[0], "B012345678")

    def test_parses_review_cards_and_next_page(self):
        html = '''<div id="customer_review-R1"><span class="a-profile-name">Mia</span>
        <span data-hook="review-star-rating">5.0 out of 5 stars</span>
        <span data-hook="review-body">Clear design.</span></div>
        <ul class="a-pagination"><li class="a-last"><a href="/product-reviews/B012345678?pageNumber=2">Next</a></li></ul>'''
        reviews, next_url = parse_review_page(html)
        self.assertEqual(reviews[0]["reviewId"], "R1")
        self.assertEqual(reviews[0]["body"], "Clear design.")
        self.assertIn("pageNumber=2", next_url)

    def test_crawl_deduplicates_pages_and_keeps_partial_challenge_result(self):
        card = '<div id="customer_review-R1"><span data-hook="review-star-rating">5 stars</span><span data-hook="review-body">Clear design.</span></div>'
        pages = {
            "https://www.amazon.com/dp/B012345678": '<h1 id="productTitle">Pattern Rug</h1><div id="feature-bullets"><li><span class="a-list-item">Printed deer artwork</span></li></div>',
            "https://www.amazon.com/portal/customer-reviews/B012345678/": card + '<li class="a-last"><a href="?pageNumber=2">Next</a></li>',
            "https://www.amazon.com/portal/customer-reviews/B012345678/?pageNumber=2": card + '<form id="ap_signin_form"></form>',
        }
        output = crawl_review_pages("B012345678", fetch_page=pages.__getitem__, max_pages=3)
        self.assertEqual(output["reviewCount"], 1)
        self.assertEqual(output["stopReason"], "signin")
        self.assertEqual(output["context"]["bullets"], ["Printed deer artwork"])

    def test_real_export_excludes_synthetic_and_preview_keeps_disclosure(self):
        real = {"reviewId": "R1", "body": "Clear design.", "rating": 5, "author": "Mia", "source": "amazon", "synthetic": False}
        ai = {"reviewId": "SYNTH-1", "body": "The pattern is clear.", "rating": 5, "author": "Alex", "source": "ai_sample", "synthetic": True, "promptVersion": "review_sample_v3"}
        real_book, real_rows = build_review_workbook("real", "B012345678", [real, ai], [{"id": "101", "handle": "rug"}])
        self.assertEqual([cell.value for cell in real_book.active[1]], JUDGEME_FIELDS)
        self.assertEqual(real_rows, 1)
        self.assertEqual(real_book.active[2][3].value, "R1")
        preview, preview_rows = build_review_workbook("preview", "B012345678", [real, ai], [{"id": "101", "handle": "rug"}])
        self.assertEqual([cell.value for cell in preview.active[1]], QA_FIELDS)
        self.assertEqual(preview_rows, 2)
        self.assertEqual(preview.active[3][12].value, "TRUE")

    def test_random_count_and_extra_images_are_applied_per_product(self):
        reviews = [{"reviewId": f"R{index}", "body": f"Review body {index}", "rating": 5,
                    "author": f"Author {index}", "synthetic": False} for index in range(5)]
        workbook, rows = build_review_workbook(
            "real", "B012345678", reviews, [{"id": "101"}, {"id": "102"}],
            randomize_review_count=True, min_reviews_per_product=2,
            extra_picture_urls=["https://example.com/extra.jpg"], rng=random.Random(7),
        )
        self.assertGreaterEqual(rows, 4)
        self.assertLessEqual(rows, 10)
        self.assertEqual({row[0].value for row in workbook.active.iter_rows(min_row=2)}, {"101", "102"})
        self.assertGreaterEqual(sum("extra.jpg" in str(row[14].value) for row in workbook.active.iter_rows(min_row=2)), 2)


if __name__ == "__main__":
    unittest.main()
