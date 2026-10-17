from __future__ import annotations

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from engine.crawler_core import AmazonCrawler, CrawlSettings


def source_variant(asin: str, size: str, *, color: str = "Blue", customization_raw: dict | None = None) -> dict:
    return {
        "asin": asin, "url": f"https://www.amazon.com/dp/{asin}",
        "options": {"Color": color, "Size": size},
        "price": {"raw": "$20.00", "amount": 20.0, "currency": "USD"},
        "media": [], "customizationRaw": customization_raw, "customization": None,
        "customizationFingerprint": None, "priceInference": {"isInferred": False, "sourceAsins": []},
        "warnings": [],
    }


def family_for(variants: list[dict]) -> dict:
    return {
        "parentAsin": "B0PARENT00", "sourceTitle": "Canvas Bag", "description": None,
        "bulletPoints": [], "categories": [], "productDetails": {}, "media": [],
        "sourceVariants": variants,
        "variantMatrix": {"dimensions": {}, "expectedCount": len(variants), "discoveredCount": len(variants), "complete": True, "safetyCap": 500},
        "diagnostics": {"fetchMode": "cache"},
    }


class SizeOptionLabelTests(unittest.TestCase):
    def project(self, family: dict, profile: str = "default") -> list[dict]:
        with tempfile.TemporaryDirectory() as directory:
            crawler = AmazonCrawler(root=Path(directory), settings=CrawlSettings(profile_slug=profile))
            return crawler._products_from_family(family)

    def test_default_cleans_size_only_and_preserves_raw_family_and_identity(self) -> None:
        variants = [source_variant("B012345678", "3x3 ft - S - For entryways", color="Hot Pink")]
        original = deepcopy(variants)
        family = family_for(variants)
        product = self.project(family)[0]

        self.assertEqual(family["sourceVariants"], original)
        self.assertEqual(product["sourceVariants"][0]["options"], {"Color": "Hot Pink", "Size": "3x3 ft - S"})
        self.assertEqual(product["variants"][0]["options"], {"Color": "Hot Pink", "Size": "3x3 ft - S"})
        self.assertIsNone(product["splitContext"]["value"])
        self.assertEqual(product["sourceKey"], "amazon:B0PARENT00:none:none")

    def test_cleans_descriptive_size_and_preserves_dimension(self) -> None:
        product = self.project(family_for([source_variant("B012345678", "Medium: 4x6ft (Popular) - Fits 7x10ft room")]))[0]
        self.assertEqual(product["variants"][0]["options"]["Size"], "Medium: 4x6ft")

    def test_collision_keeps_original_size_labels_and_warns(self) -> None:
        family = family_for([
            source_variant("B012345678", "3x3 ft - S (Popular)"),
            source_variant("B012345679", "3x3 ft - S (Recommended)"),
        ])
        products = self.project(family)
        self.assertEqual([product["sourceVariants"][0]["options"]["Size"] for product in products], [
            "3x3 ft - S (Popular)", "3x3 ft - S (Recommended)",
        ])
        self.assertTrue(all(any("size label" in warning.lower() and "collision" in warning.lower() for warning in product["warnings"]) for product in products))

    def test_size_split_cleans_title_without_changing_source_key_or_group_id(self) -> None:
        family = family_for([
            source_variant("B012345678", "3x3 ft - S - For entryways"),
            source_variant("B012345679", "Medium: 4x6ft (Popular) - Fits 7x10ft room"),
        ])
        default_products = self.project(family)
        original_products = self.project(family, "jeminise")
        self.assertEqual([product["id"] for product in default_products], [product["id"] for product in original_products])
        self.assertEqual([product["sourceKey"] for product in default_products], [product["sourceKey"] for product in original_products])
        self.assertEqual([product["variants"][0]["id"] for product in default_products], [product["variants"][0]["id"] for product in original_products])
        self.assertEqual([product["title"] for product in default_products], ["Canvas Bag - 3x3 ft - S", "Canvas Bag - Medium: 4x6ft"])
        self.assertEqual(default_products[0]["sourceVariants"][0]["options"]["Size"], "3x3 ft - S")

    def test_size_notes_do_not_erase_real_size(self) -> None:
        from engine.size_option_labels import clean_size_label

        self.assertEqual(clean_size_label("XS (1 Kid) - Best Choice"), "XS")
        self.assertEqual(clean_size_label("120 x 180 cm (3–4 Kids)"), "120 x 180 cm")
        self.assertEqual(clean_size_label("Very Small"), "Very Small")
        self.assertEqual(clean_size_label("4x6 inch - Super Small - Recommended"), "4x6 inch")

    def test_customization_free_size_and_option_name_are_cleaned(self) -> None:
        raw = {"components": [{"componentType": "OptionChooserComponent", "id": "gift-size", "label": "Gift Size (Popular)",
                               "options": [{"id": "first", "label": "M (1 Kid)", "price": 0},
                                           {"id": "second", "label": "L (3–4 Kids)", "price": 0}]}]}
        product = self.project(family_for([source_variant("B012345678", "One Size", customization_raw=raw)]))[0]
        group = product["customization"]["optionGroups"][0]
        self.assertEqual(group["id"], "gift-size")
        self.assertEqual(group["label"], "Gift Size")
        self.assertEqual([(option["id"], option["label"]) for option in group["options"]], [("first", "M"), ("second", "L")])

    def test_empty_size_value_keeps_original_and_warns(self) -> None:
        product = self.project(family_for([source_variant("B012345678", "Very Small")]))[0]
        self.assertEqual(product["sourceVariants"][0]["options"]["Size"], "Very Small")
        self.assertTrue(any("no real size" in warning for warning in product["warnings"]))

    def test_customization_size_groups_clean_only_their_labels(self) -> None:
        customization_raw = {"components": [
            {"componentType": "OptionChooserComponent", "id": "bag-size", "label": "Bag Size", "required": True,
             "options": [{"id": "medium", "label": "Medium: 4x6ft (Popular) - Fits 7x10ft room", "price": 5},
                         {"id": "large", "label": "Large: 5x7ft (Best Seller)", "price": 10}]},
            {"componentType": "OptionChooserComponent", "id": "color", "label": "Color", "required": True,
             "options": [{"id": "pink", "label": "Hot Pink", "price": 0}]},
        ]}
        product = self.project(family_for([source_variant("B012345678", "One Size", customization_raw=customization_raw)]))[0]
        size_group = product["customization"]["pricing"]["paidOptionGroups"][0]
        self.assertEqual([option["label"] for option in size_group["options"]], ["Medium: 4x6ft", "Large: 5x7ft"])
        self.assertEqual([option["price"]["amount"] for option in size_group["options"]], [5.0, 10.0])
        self.assertEqual({variant["options"]["Bag Size"] for variant in product["variants"]}, {"Medium: 4x6ft", "Large: 5x7ft"})
        self.assertEqual(product["customization"]["optionGroups"][0]["options"][0]["label"], "Hot Pink")

    def test_special_profiles_do_not_use_default_cleaner(self) -> None:
        for profile in ("preaurem", "jeminise"):
            with self.subTest(profile=profile):
                product = self.project(family_for([source_variant("B012345678", "3x3 ft - S - For entryways")]), profile)[0]
                self.assertEqual(product["variants"][0]["options"]["Size"], "3x3 ft - S - For entryways")


if __name__ == "__main__":
    unittest.main()
