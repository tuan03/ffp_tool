"""Comprehensive Etsy crawler, auth vault, coordinator, and agent integration tests."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text

from engine.distributed.coordinator_migrations import MIGRATIONS, migrate_coordinator
from engine.distributed.coordinator_models import (
    CrawlProductItem,
    CrawlTask,
    EtsyOAuthCredential,
    create_database_engine,
    create_session_factory,
)
from engine.distributed.coordinator_server import create_coordinator_app
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.etsy_auth_store import (
    ETSY_TOKEN_ENDPOINT,
    PRIMARY_CREDENTIAL_ID,
    EtsyAuthDisabledError,
    EtsyAuthError,
    EtsyAuthStore,
    EtsyRateLimitError,
)
from engine.distributed.client_agent import DistributedCrawlerAgent
from engine.distributed.client_config import AgentConfig
from engine.distributed.protocol import AgentLimits, hello_message, payload_checksum, settings_fingerprint, utc_iso, utc_now
from engine.etsy_crawler import (
    EtsyExcludedListingError,
    EtsyListingNotFoundError,
    apply_playwright_prices,
    apply_playwright_variants,
    build_ffp_etsy_crawled_product,
    fetch_etsy_api_baseline,
    merge_etsy_browser_verification,
    parse_etsy_api_listing,
)
from engine.etsy_personalization import convert_etsy_personalization_to_customizer
from engine.etsy_sources import normalize_etsy_input, normalize_etsy_inputs
from engine.playwright_pool import CaptchaTimeout, PlaywrightPool


def _sample_etsy_listing_api(
    listing_id: int = 1876543210,
    *,
    is_digital: bool = False,
    listing_type: str = "physical",
    has_variations: bool = True,
    buyer_price_loaded: bool = True,
    all_sold_out: bool = False,
    include_digital_variant: bool = False,
    personalization_payload: dict | None = None,
    is_personalizable: bool = False,
) -> dict:
    products = [
        {
            "product_id": 990011,
            "sku": "SELLER-SKU-1",
            "is_deleted": False,
            "property_values": [
                {"property_id": 100, "property_name": "Size", "value_ids": [1001], "values": ["Small"]},
                {"property_id": 200, "property_name": "Color", "value_ids": [2001], "values": ["Navy Blue"]},
            ],
            "offerings": [
                {
                    "offering_id": 8801,
                    "quantity": 0 if all_sold_out else 5,
                    "is_enabled": not all_sold_out,
                    "is_deleted": False,
                    "price": {"amount": 2499, "divisor": 100, "currency_code": "USD"},
                }
            ],
        },
        {
            "product_id": 990012,
            "sku": "SELLER-SKU-2",
            "is_deleted": False,
            "property_values": [
                {"property_id": 100, "property_name": "Size", "value_ids": [1002], "values": ["Large"]},
                {"property_id": 200, "property_name": "Color", "value_ids": [2002], "values": ["Crimson Red"]},
            ],
            "offerings": [
                {
                    "offering_id": 8802,
                    "quantity": 0 if all_sold_out else 3,
                    "is_enabled": not all_sold_out,
                    "is_deleted": False,
                    "price": {"amount": 3499, "divisor": 100, "currency_code": "USD"},
                }
            ],
        },
        {
            # Sold-out variant must always be excluded from Shopify output
            "product_id": 990013,
            "sku": "SELLER-SKU-SOLDOUT",
            "is_deleted": False,
            "property_values": [
                {"property_id": 100, "property_name": "Size", "value_ids": [1003], "values": ["XL"]},
                {"property_id": 200, "property_name": "Color", "value_ids": [2001], "values": ["Navy Blue"]},
            ],
            "offerings": [
                {
                    "offering_id": 8803,
                    "quantity": 0,
                    "is_enabled": True,
                    "is_deleted": False,
                    "price": {"amount": 3999, "divisor": 100, "currency_code": "USD"},
                }
            ],
        },
    ]
    if include_digital_variant:
        products.append(
            {
                "product_id": 990014,
                "sku": "SELLER-SKU-DIGITAL",
                "is_deleted": False,
                "property_values": [
                    {"property_id": 100, "property_name": "Size", "value_ids": [1004], "values": ["Digital PNG"]},
                    {"property_id": 200, "property_name": "Color", "value_ids": [2001], "values": ["Navy Blue"]},
                ],
                "offerings": [
                    {
                        "offering_id": 8804,
                        "quantity": 99,
                        "is_enabled": True,
                        "is_deleted": False,
                        "price": {"amount": 999, "divisor": 100, "currency_code": "USD"},
                    }
                ],
            }
        )
    if not has_variations:
        products = [
            {
                "product_id": 990000,
                "sku": "SINGLE-SKU",
                "is_deleted": False,
                "property_values": [],
                "offerings": [
                    {
                        "offering_id": 8800,
                        "quantity": 0 if all_sold_out else 8,
                        "is_enabled": not all_sold_out,
                        "is_deleted": False,
                        "price": {"amount": 2950, "divisor": 100, "currency_code": "USD"},
                    }
                ],
            }
        ]
    listing: dict = {
        "listing_id": listing_id,
        "shop_id": 554433,
        "title": "Custom Embroidered Pet Sweatshirt",
        "description": "Soft cotton embroidered sweatshirt made to order.",
        "state": "active",
        "quantity": 0 if all_sold_out else 8,
        "listing_type": listing_type,
        "is_digital": is_digital,
        "has_variations": has_variations,
        "is_personalizable": is_personalizable or bool(personalization_payload),
        "personalization_is_required": False,
        "price": {"amount": 2499 if has_variations else 2950, "divisor": 100, "currency_code": "USD"},
        "tags": ["embroidered hoodie", "pet portrait", "custom gift"],
        "materials": ["cotton", "polyester"],
        "taxonomy_path": ["Clothing", "Unisex Adult Clothing", "Hoodies & Sweatshirts"],
        "shop": {"shop_id": 554433, "shop_name": "CozyStitchStudio"},
        "images": [
            {
                "listing_image_id": 7001,
                "url_fullxfull": "https://i.etsystatic.com/554433/r/il/aaa111/7001/il_fullxfull.7001.jpg",
                "alt_text": "Navy Blue Sweatshirt",
            },
            {
                "listing_image_id": 7002,
                "url_fullxfull": "https://i.etsystatic.com/554433/r/il/bbb222/7002/il_fullxfull.7002.jpg",
                "alt_text": "Crimson Red Sweatshirt",
            },
        ],
        "videos": [
            {
                "video_id": 3101,
                "video_url": "https://v.etsystatic.com/video/upload/v1/etsy_demo_3101.mp4",
                "thumbnail_url": "https://i.etsystatic.com/554433/r/il/vid/3101.jpg",
                "video_state": "active",
            }
        ],
        "inventory": {"products": products},
    }
    if buyer_price_loaded:
        listing["buyer_price"] = {
            "original_price": {"amount": 2499 if has_variations else 2950, "divisor": 100, "currency_code": "USD"},
            "discounted_price": {"amount": 2499 if has_variations else 2950, "divisor": 100, "currency_code": "USD"},
        }
    if personalization_payload is not None:
        listing["personalization"] = personalization_payload
    return listing


class EtsyInputNormalizationTests(unittest.TestCase):
    def test_etsy_browser_does_not_open_amazon_or_set_amazon_cookies(self):
        async def verify():
            with tempfile.TemporaryDirectory() as directory:
                pool = PlaywrightPool(profile_root=Path(directory), profiles=1, tabs_per_profile=1,
                                      headless=True, captcha_timeout=10, zip_code="90001", source_platform="etsy")
                context = MagicMock()
                context.add_cookies = AsyncMock()
                runtime = MagicMock()
                runtime.chromium.launch_persistent_context = AsyncMock(return_value=context)
                pool._runtime = runtime
                with patch.object(pool, "_ensure_runtime", AsyncMock()), patch.object(pool, "_set_amazon_zip", AsyncMock()) as amazon_zip:
                    self.assertIs(await pool._launch_context(0), context)
                    amazon_zip.assert_not_awaited()
                    context.add_cookies.assert_not_awaited()
        asyncio.run(verify())

    def test_normalizes_urls_and_bare_ids_and_deduplicates_preserving_order(self):
        parsed, rejected = normalize_etsy_inputs(
            [
                "https://www.etsy.com/listing/1876543210/custom-embroidered-sweatshirt?click_key=abc&pro=1",
                "1876543210",
                "https://fr.etsy.com/de-en/listing/1999888777/another-item?ref=shop_home",
                " 1999888777 ",
                "123456789",
            ]
        )
        self.assertEqual(rejected, [])
        self.assertEqual([item.listing_id for item in parsed], ["1876543210", "1999888777", "123456789"])
        self.assertEqual(parsed[0].canonical_url, "https://www.etsy.com/listing/1876543210")
        self.assertEqual(parsed[1].canonical_url, "https://www.etsy.com/listing/1999888777")

    def test_rejects_amazon_shop_and_invalid_inputs(self):
        for bad in (
            "",
            "B0FR4MSS2H",
            "https://www.amazon.com/dp/B0FR4MSS2H",
            "https://www.etsy.com/shop/CozyStitchStudio",
            "12345",
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    normalize_etsy_input(bad)


class EtsyAuthStoreTests(unittest.TestCase):
    def test_missing_encryption_key_rejects_credential_storage_in_local_too(self):
        with patch.dict(os.environ, {}, clear=True):
            vault = EtsyAuthStore(self.sessions)
            with self.assertRaises(EtsyAuthError):
                vault.update_credentials(keystring="test-key", shared_secret="test-secret")

    def test_default_local_environment_cannot_refresh_vps_owned_tokens(self):
        with patch.dict(os.environ, {}, clear=True):
            def unexpected_request(*args):
                raise AssertionError("A non-owner environment must never call Etsy OAuth")
            vault = EtsyAuthStore(self.sessions, encryption_secret="unit-test-key", http_transport=unexpected_request)
            vault.update_credentials(keystring="key", shared_secret="secret", access_token="expired",
                                     refresh_token="refresh", token_expires_at=(utc_now() - timedelta(minutes=5)).isoformat(),
                                     refresh_enabled=True, environment_owner="vps")
            with self.assertRaises(EtsyAuthDisabledError):
                vault.get_valid_credentials(require_oauth=True)

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        db_path = (Path(self.tempdir.name) / "etsy-auth.sqlite3").as_posix()
        self.engine = create_database_engine(f"sqlite:///{db_path}")
        migrate_coordinator(self.engine)
        self.sessions = create_session_factory(self.engine)

    def tearDown(self):
        self.engine.dispose()
        self.tempdir.cleanup()

    def test_encrypts_at_rest_never_exposes_secrets_and_never_overwrites_on_redeploy(self):
        vault = EtsyAuthStore(self.sessions, encryption_secret="unit-test-encryption-key-0123456789")
        status = vault.update_credentials(
            keystring="etsy_key_abcdef123456",
            shared_secret="super_secret_shared_xyz",
            access_token="88776655.fresh_access_token_value",
            refresh_token="88776655.fresh_refresh_token_value",
            token_expires_at=(utc_now() + timedelta(hours=1)).isoformat(),
            refresh_enabled=True,
            environment_owner="local",
        )
        serialized = json.dumps(status)
        self.assertNotIn("etsy_key_abcdef123456", serialized)
        self.assertNotIn("super_secret_shared_xyz", serialized)
        self.assertNotIn("fresh_access_token_value", serialized)
        self.assertNotIn("fresh_refresh_token_value", serialized)
        self.assertTrue(status["configured"])
        self.assertEqual(status["etsyUserId"], "88776655")
        self.assertEqual(status["keystringHint"], "etsy...456")

        with self.sessions() as session:
            row = session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
            self.assertIsNotNone(row)
            assert row is not None
            self.assertNotIn("fresh_access_token_value", row.access_token_ciphertext or "")
            self.assertNotIn("super_secret_shared_xyz", row.shared_secret_ciphertext or "")

        # Simulate redeploy with stale .env tokens -> MUST NOT overwrite newer DB tokens!
        with patch.dict(
            os.environ,
            {
                "ETSY_API_KEYSTRING": "stale_env_key",
                "ETSY_SHARED_SECRET": "stale_env_secret",
                "ETSY_ACCESS_TOKEN": "88776655.stale_env_access",
                "ETSY_REFRESH_TOKEN": "88776655.stale_env_refresh",
            },
            clear=False,
        ):
            seeded = vault.bootstrap_from_env_if_empty()
            self.assertFalse(seeded)
            creds = vault.get_valid_credentials(require_oauth=True)
            self.assertEqual(creds.access_token, "88776655.fresh_access_token_value")
            self.assertEqual(creds.refresh_token, "88776655.fresh_refresh_token_value")

    def test_concurrent_token_refresh_coalesces_into_single_oauth_call(self):
        refresh_calls = 0
        call_lock = threading.Lock()
        barrier = threading.Barrier(4)

        def fake_transport(method: str, url: str, headers: dict, body: bytes | None, timeout: float):
            nonlocal refresh_calls
            self.assertEqual(method, "POST")
            self.assertEqual(url, ETSY_TOKEN_ENDPOINT)
            with call_lock:
                refresh_calls += 1
            return (
                200,
                {"content-type": "application/json"},
                json.dumps(
                    {
                        "access_token": "88776655.rotated_access_v2",
                        "refresh_token": "88776655.rotated_refresh_v2",
                        "expires_in": 3600,
                    }
                ).encode("utf-8"),
            )

        vault = EtsyAuthStore(
            self.sessions,
            encryption_secret="unit-test-encryption-key-0123456789",
            http_transport=fake_transport,
        )
        vault.update_credentials(
            keystring="key_12345678",
            shared_secret="secret_12345678",
            access_token="88776655.expired_access_v1",
            refresh_token="88776655.initial_refresh_v1",
            token_expires_at=(utc_now() - timedelta(minutes=5)).isoformat(),
            refresh_enabled=True,
            environment_owner="local",
        )

        def worker():
            barrier.wait(timeout=5)
            return vault.get_valid_credentials(require_oauth=True)

        with patch.dict(os.environ, {"ETSY_TOKEN_ENVIRONMENT": "local", "ETSY_TOKEN_REFRESH_ENABLED": "true"}, clear=False):
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: worker(), range(4)))

        self.assertEqual(refresh_calls, 1)
        for creds in results:
            self.assertEqual(creds.access_token, "88776655.rotated_access_v2")
            self.assertEqual(creds.refresh_token, "88776655.rotated_refresh_v2")
            self.assertEqual(creds.token_generation, 2)

    def test_single_environment_guard_blocks_refresh_on_non_owner_node(self):
        vault = EtsyAuthStore(self.sessions, encryption_secret="unit-test-encryption-key-0123456789")
        vault.update_credentials(
            keystring="key_12345678",
            shared_secret="secret_12345678",
            access_token="88776655.expired_access",
            refresh_token="88776655.valid_refresh",
            token_expires_at=(utc_now() - timedelta(minutes=5)).isoformat(),
            refresh_enabled=True,
            environment_owner="vps",
        )
        with patch.dict(os.environ, {"ETSY_TOKEN_ENVIRONMENT": "local"}, clear=False):
            with self.assertRaises(EtsyAuthDisabledError):
                vault.get_valid_credentials(require_oauth=True)

    def test_rate_limit_retry_after_and_daily_quota_exhaustion_stop_tight_retries(self):
        calls = 0

        def quota_exhausted_transport(method: str, url: str, headers: dict, body: bytes | None, timeout: float):
            nonlocal calls
            calls += 1
            return (
                429,
                {
                    "Retry-After": "120",
                    "X-Limit-Per-Day": "10000",
                    "X-Remaining-Today": "0",
                },
                b'{"error":"Daily quota exceeded"}',
            )

        slept: list[float] = []
        vault = EtsyAuthStore(
            self.sessions,
            encryption_secret="unit-test-encryption-key-0123456789",
            http_transport=quota_exhausted_transport,
            sleep_fn=slept.append,
        )
        vault.update_credentials(
            keystring="key_12345678",
            shared_secret="secret_12345678",
            access_token="88776655.valid_access",
            refresh_token="88776655.valid_refresh",
            token_expires_at=(utc_now() + timedelta(hours=1)).isoformat(),
        )
        with self.assertRaises(EtsyRateLimitError) as ctx:
            vault.request_json("openapi-ping", oauth=False)
        self.assertTrue(ctx.exception.quota_exhausted)
        self.assertEqual(ctx.exception.retry_after_seconds, 120.0)
        self.assertEqual(slept, [])
        self.assertEqual(calls, 1)

        # Subsequent call fails immediately from centralized gate without hitting Etsy again!
        with self.assertRaises(EtsyRateLimitError):
            vault.request_json("openapi-ping", oauth=False)
        self.assertEqual(calls, 1)


class EtsyProductAndPersonalizationTests(unittest.TestCase):
    def test_missing_browser_selectors_cannot_erase_api_variations(self):
        listing = parse_etsy_api_listing(_sample_etsy_listing_api(buyer_price_loaded=False), "https://www.etsy.com/listing/1876543210")
        listing["sourceMeta"]["inventoryLoaded"] = False
        result = apply_playwright_variants(listing, {"etsyVariationCount": 0,
            "etsyVariants": [{"optionValues": {}, "priceText": "$19.99"}]}, "1876543210")
        self.assertTrue(result["sourceMeta"]["hasVariations"])
        self.assertFalse(result["sourceMeta"].get("variantInventoryVerified", False))

    def test_partial_browser_option_combination_is_not_verified(self):
        listing = parse_etsy_api_listing(_sample_etsy_listing_api(buyer_price_loaded=False), "https://www.etsy.com/listing/1876543210")
        listing["sourceMeta"]["inventoryLoaded"] = False
        result = apply_playwright_variants(listing, {"etsyVariationCount": 2,
            "etsyVariants": [{"optionValues": {"Size": "Small"}, "priceText": "$19.99"}]}, "1876543210")
        self.assertFalse(result["sourceMeta"].get("variantInventoryVerified", False))

    def test_discount_banner_without_observed_price_does_not_verify_variant(self):
        listing = parse_etsy_api_listing(_sample_etsy_listing_api(buyer_price_loaded=False), "https://www.etsy.com/listing/1876543210")
        result = apply_playwright_prices(listing, {"etsyVariants": [
            {"optionValues": {"Size": "Small", "Color": "Navy Blue"}, "priceText": "", "discountPercentage": "20"}
        ]})
        self.assertEqual(result["sourceMeta"].get("displayPriceVerifiedCount", 0), 0)

    def test_truncated_browser_inventory_is_not_complete(self):
        listing = parse_etsy_api_listing(_sample_etsy_listing_api(buyer_price_loaded=False), "https://www.etsy.com/listing/1876543210")
        listing["sourceMeta"]["inventoryLoaded"] = False
        result = apply_playwright_variants(listing, {"etsyVariationCount": 2, "etsyInventoryComplete": False,
            "etsyVariants": [{"optionValues": {"Size": "Small", "Color": "Navy Blue"}, "priceText": "$19.99"}]}, "1876543210")
        self.assertFalse(result["sourceMeta"].get("variantInventoryVerified"))

    def test_preserves_exact_variants_prices_variation_images_and_videos_while_excluding_sold_out_and_digital(self):
        raw_listing = _sample_etsy_listing_api(
            1876543210,
            has_variations=True,
            buyer_price_loaded=True,
            include_digital_variant=True,
        )
        variation_images = [
            {"property_id": 200, "value_id": 2001, "image_id": 7001},
            {"property_id": 200, "value_id": 2002, "image_id": 7002},
        ]
        parsed = parse_etsy_api_listing(
            raw_listing,
            "https://www.etsy.com/listing/1876543210",
            variation_images=variation_images,
        )
        ffp_product = build_ffp_etsy_crawled_product(parsed)

        self.assertEqual(ffp_product["sourcePlatform"], "etsy")
        self.assertEqual(ffp_product["sourceProductId"], "1876543210")
        self.assertEqual(ffp_product["sourceKey"], "etsy:1876543210")
        self.assertEqual(ffp_product["asin"], "")
        self.assertTrue(ffp_product["evidenceComplete"])
        self.assertEqual(ffp_product["syncBlockers"], [])

        # 2 active physical variants kept; XL sold-out and Digital PNG excluded; NO Cartesian 2x2=4 invented!
        variants = ffp_product["variants"]
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0]["options"], {"Size": "Small", "Color": "Navy Blue"})
        self.assertEqual(variants[0]["price"]["amount"], 24.99)
        self.assertEqual(variants[0]["etsyProductId"], "990011")
        self.assertIn("7001", variants[0]["mediaUrl"])

        self.assertEqual(variants[1]["options"], {"Size": "Large", "Color": "Crimson Red"})
        self.assertEqual(variants[1]["price"]["amount"], 34.99)
        self.assertEqual(variants[1]["etsyProductId"], "990012")
        self.assertIn("7002", variants[1]["mediaUrl"])

        # Videos metadata preserved without breaking image media array
        self.assertEqual(len(ffp_product["videos"]), 1)
        self.assertIn("etsy_demo_3101.mp4", ffp_product["videos"][0]["url"])

    def test_single_variant_listing_and_digital_or_sold_out_rejection(self):
        single = parse_etsy_api_listing(
            _sample_etsy_listing_api(1800000001, has_variations=False, buyer_price_loaded=True),
            "https://www.etsy.com/listing/1800000001",
        )
        ffp_single = build_ffp_etsy_crawled_product(single)
        self.assertEqual(len(ffp_single["variants"]), 1)
        self.assertEqual(ffp_single["variants"][0]["price"]["amount"], 29.50)
        self.assertTrue(ffp_single["evidenceComplete"])

        with tempfile.TemporaryDirectory() as directory:
            engine = create_database_engine(f"sqlite:///{(Path(directory) / 'excl.db').as_posix()}")
            migrate_coordinator(engine)
            sessions = create_session_factory(engine)
            try:
                def make_transport(listing_data: dict):
                    def _transport(method: str, url: str, headers: dict, body: bytes | None, timeout: float):
                        return 200, {"content-type": "application/json"}, json.dumps(listing_data).encode("utf-8")
                    return _transport

                # Digital listing rejected
                vault_digital = EtsyAuthStore(
                    sessions,
                    encryption_secret="unit-test-encryption-key-0123456789",
                    http_transport=make_transport(_sample_etsy_listing_api(1800000002, is_digital=True)),
                )
                vault_digital.update_credentials(
                    keystring="k1234567", shared_secret="s1234567",
                    access_token="11.tok", refresh_token="11.ref",
                    token_expires_at=(utc_now() + timedelta(hours=1)).isoformat(),
                )
                with self.assertRaises(EtsyExcludedListingError):
                    fetch_etsy_api_baseline("1800000002", vault_digital)

                # 100% sold out listing rejected
                vault_soldout = EtsyAuthStore(
                    sessions,
                    encryption_secret="unit-test-encryption-key-0123456789",
                    http_transport=make_transport(_sample_etsy_listing_api(1800000003, all_sold_out=True)),
                )
                vault_soldout.update_credentials(
                    keystring="k1234567", shared_secret="s1234567",
                    access_token="11.tok", refresh_token="11.ref",
                    token_expires_at=(utc_now() + timedelta(hours=1)).isoformat(),
                )
                with self.assertRaises(EtsyExcludedListingError):
                    fetch_etsy_api_baseline("1800000003", vault_soldout)
            finally:
                engine.dispose()

    def test_personalization_maps_text_dropdown_upload_and_blocks_unmapped_required_fields(self):
        valid = convert_etsy_personalization_to_customizer(
            {
                "personalization_questions": [
                    {
                        "question_id": 1,
                        "question_type": "text_input",
                        "question_text": "Pet Name",
                        "helper_text": "Up to 15 letters",
                        "required": True,
                        "max_allowed_characters": 15,
                    },
                    {
                        "question_id": 2,
                        "question_type": "dropdown",
                        "question_text": "Thread Style",
                        "required": False,
                        "options": [{"label": "Classic"}, {"label": "Metallic"}],
                    },
                    {
                        "question_id": 3,
                        "question_type": "unlabeled_upload",
                        "question_text": "Upload Pet Photo",
                        "helper_text": "Clear front-facing photo",
                        "required": True,
                        "max_allowed_files": 2,
                    },
                ]
            },
            listing_id="1876543210",
            canonical_url="https://www.etsy.com/listing/1876543210",
        )
        self.assertEqual(valid.audit_status, "verified_custom")
        self.assertEqual(valid.blockers, [])
        assert valid.customization is not None
        self.assertEqual(len(valid.customization["textInputs"]), 1)
        self.assertEqual(valid.customization["textInputs"][0]["maxLength"], 15)
        self.assertEqual(valid.customization["textInputs"][0]["instructions"], "Up to 15 letters")
        self.assertTrue(valid.customization["textInputs"][0]["required"])
        self.assertEqual(len(valid.customization["optionGroups"]), 1)
        self.assertEqual(len(valid.customization["imageInputs"]), 2)
        self.assertTrue(valid.customization["imageInputs"][0]["required"])
        self.assertFalse(valid.customization["imageInputs"][1]["required"])

        # Unmapped required question MUST block auto-sync!
        blocked = convert_etsy_personalization_to_customizer(
            {
                "personalization_questions": [
                    {
                        "question_id": 99,
                        "question_type": "date_picker_custom_widget",
                        "question_text": "Exact Engraving Date",
                        "required": True,
                    }
                ]
            },
            listing_id="1876543210",
            canonical_url="https://www.etsy.com/listing/1876543210",
        )
        self.assertEqual(blocked.audit_status, "error")
        self.assertIsNone(blocked.customization)
        self.assertTrue(any("Exact Engraving Date" in msg for msg in blocked.blockers))

    def test_browser_price_verification_and_incomplete_evidence_blockers(self):
        # BuyerPrice not loaded -> requires Playwright US price verification
        api_listing = _sample_etsy_listing_api(1876543210, buyer_price_loaded=False)
        parsed = parse_etsy_api_listing(api_listing, "https://www.etsy.com/listing/1876543210")
        baseline = {
            "listingId": "1876543210",
            "canonicalUrl": "https://www.etsy.com/listing/1876543210",
            "apiProduct": parsed,
            "needsBrowserVariants": False,
            "needsPriceVerification": True,
        }

        # Case A: Browser encounters DataDome/CAPTCHA in headless mode -> manual intervention blocker!
        failed_merged = merge_etsy_browser_verification(
            baseline,
            None,
            browser_error="DataDome verification required",
            requires_manual_intervention=True,
        )
        failed_ffp = build_ffp_etsy_crawled_product(failed_merged)
        self.assertFalse(failed_ffp["evidenceComplete"])
        self.assertTrue(failed_ffp["requiresManualIntervention"])
        self.assertTrue(any("thao tác thủ công" in msg for msg in failed_ffp["syncBlockers"]))

        # Case B: Browser verifies exact sale prices per variant -> evidenceComplete=True!
        browser_ok = {
            "etsyVariationCount": 2,
            "etsyVariants": [
                {
                    "optionValues": {"Size": "Small", "Color": "Navy Blue"},
                    "priceText": "$19.99",
                    "originalPriceText": "$24.99",
                    "discountPercentage": "20",
                },
                {
                    "optionValues": {"Size": "Large", "Color": "Crimson Red"},
                    "priceText": "$27.99",
                    "originalPriceText": "$34.99",
                    "discountPercentage": "20",
                },
            ],
            "videoResources": [],
        }
        verified_merged = merge_etsy_browser_verification(baseline, browser_ok)
        verified_ffp = build_ffp_etsy_crawled_product(verified_merged)
        self.assertTrue(verified_ffp["evidenceComplete"])
        self.assertEqual(verified_ffp["syncBlockers"], [])
        self.assertEqual(verified_ffp["variants"][0]["price"]["amount"], 19.99)
        self.assertEqual(verified_ffp["variants"][1]["price"]["amount"], 27.99)


class EtsyCoordinatorAndMigrationTests(unittest.TestCase):
    def test_sqlite_v16_to_v17_migration_rebuilds_nullable_asin_preserving_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            db_file = Path(directory) / "legacy-v16.sqlite3"
            conn = sqlite3.connect(db_file)
            conn.executescript(
                """
                CREATE TABLE crawler_schema_migrations (
                    version INTEGER PRIMARY KEY
                );
                INSERT INTO crawler_schema_migrations(version)
                SELECT value FROM (
                    SELECT 1 AS value UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                    UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
                    UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
                    UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16
                );
                CREATE TABLE crawl_jobs (
                    id VARCHAR(36) PRIMARY KEY,
                    status VARCHAR(24) NOT NULL,
                    settings JSON NOT NULL,
                    accepted_inputs INTEGER NOT NULL,
                    rejected_inputs INTEGER NOT NULL,
                    created_at TIMESTAMP NOT NULL
                );
                INSERT INTO crawl_jobs VALUES ('job-1', 'completed', '{}', 1, 0, '2026-01-01T00:00:00Z');
                CREATE TABLE crawl_tasks (
                    id VARCHAR(36) PRIMARY KEY,
                    job_id VARCHAR(36) NOT NULL REFERENCES crawl_jobs(id),
                    ordinal INTEGER NOT NULL,
                    source TEXT NOT NULL,
                    asin VARCHAR(16) NOT NULL,
                    canonical_url TEXT NOT NULL,
                    status VARCHAR(24) NOT NULL,
                    max_retry INTEGER NOT NULL DEFAULT 3,
                    failure_count INTEGER NOT NULL DEFAULT 0,
                    requeue_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL
                );
                INSERT INTO crawl_tasks(id, job_id, ordinal, source, asin, canonical_url, status, created_at)
                VALUES ('task-amz-1', 'job-1', 0, 'B0FR4MSS2H', 'B0FR4MSS2H', 'https://www.amazon.com/dp/B0FR4MSS2H', 'completed', '2026-01-01T00:00:00Z');
                CREATE TABLE crawler_clients(id VARCHAR(64) PRIMARY KEY);
                CREATE TABLE retained_results(id INTEGER PRIMARY KEY, task_id TEXT REFERENCES crawl_tasks(id) ON DELETE CASCADE);
                INSERT INTO retained_results VALUES (1, 'task-amz-1');
                """
            )
            conn.close()

            engine = create_engine(f"sqlite:///{db_file.as_posix()}")
            @event.listens_for(engine, "connect")
            def enable_foreign_keys(connection, _record):
                connection.execute("PRAGMA foreign_keys=ON")
            try:
                migrate_coordinator(engine)
                with engine.begin() as connection:
                    row = connection.execute(
                        text("SELECT asin, source_platform, source_product_id FROM crawl_tasks WHERE id = 'task-amz-1'")
                    ).fetchone()
                    self.assertEqual(tuple(row), ("B0FR4MSS2H", "amazon", "B0FR4MSS2H"))
                    self.assertEqual(connection.scalar(text("SELECT COUNT(*) FROM retained_results")), 1)
                    self.assertEqual(connection.scalar(text("PRAGMA foreign_keys")), 1)
                    # Verify NULL asin insert succeeds for Etsy!
                    connection.execute(
                        text(
                            "INSERT INTO crawl_tasks(id, job_id, ordinal, source, source_platform, source_product_id, asin, canonical_url, status, created_at) "
                            "VALUES ('task-etsy-1', 'job-1', 1, '1876543210', 'etsy', '1876543210', NULL, 'https://www.etsy.com/listing/1876543210', 'queued', '2026-01-01T00:00:00Z')"
                        )
                    )
            finally:
                engine.dispose()

    @patch.dict(os.environ, {"FFP_ETSY_TOKEN_ENCRYPTION_KEY": "test-only-etsy-encryption-key"})
    def test_store_preset_isolation_multi_agent_capabilities_dedup_attention_review_and_recrawl(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db_url = f"sqlite:///{(root / 'coord.sqlite3').as_posix()}"

            def fake_etsy_http(method: str, url: str, headers: dict, body: bytes | None, timeout: float):
                if "openapi-ping" in url:
                    return 200, {"content-type": "application/json"}, b'{"application_id": 445566}'
                return (
                    200,
                    {"content-type": "application/json"},
                    json.dumps(_sample_etsy_listing_api(1876543210)).encode("utf-8"),
                )

            with patch("engine.distributed.coordinator_server.find_project_root", return_value=root):
                app = create_coordinator_app(database_url=db_url, operator_auth_disabled=True)

            with TestClient(app) as client:
                store: CoordinatorStore = app.state.store
                store.etsy_auth._http_transport = fake_etsy_http

                # 1. Configure store with Jeminise Amazon preset + vendor + pricing
                cfg = client.put(
                    "/api/v1/store-vendors/jeminise/crawl-settings",
                    json={
                        "vendor": "Jeminise Studio",
                        "profileSlug": "jeminise",
                        "imageProfileSlug": "default",
                        "applyJeminisePreset": True,
                    },
                )
                self.assertEqual(cfg.status_code, 200, cfg.text)

                # 2. Configure Etsy credentials via Admin endpoint & test connection
                cred_res = client.put(
                    "/api/v1/etsy/auth/credentials",
                    json={
                        "keystring": "etsy_live_key_999",
                        "sharedSecret": "etsy_live_secret_999",
                        "accessToken": "778899.access_tok",
                        "refreshToken": "778899.refresh_tok",
                        "tokenExpiresAt": (utc_now() + timedelta(hours=2)).isoformat(),
                        "refreshEnabled": True,
                        "environmentOwner": "local",
                    },
                )
                self.assertEqual(cred_res.status_code, 200, cred_res.text)
                self.assertNotIn("etsy_live_secret_999", cred_res.text)
                self.assertNotIn("access_tok", cred_res.text)

                ping_res = client.post("/api/v1/etsy/auth/test", json={"refreshOauth": False})
                self.assertEqual(ping_res.status_code, 200, ping_res.text)
                self.assertEqual(ping_res.json()["applicationId"], 445566)

                # 3. Create Etsy job with 1 Shopify-existing listing + 1 active listing
                job_res = client.post(
                    "/api/v1/crawl-jobs",
                    json={
                        "sourcePlatform": "etsy",
                        "urls": [
                            "https://www.etsy.com/listing/1876543210/custom-sweatshirt",
                            "1876543210",  # duplicate in same input batch
                            "1899999999",  # already on Shopify
                        ],
                        "existingShopifyListingIds": ["1899999999"],
                        "storeId": "jeminise",
                        "priceAddition": 7.0,
                        "discountPercent": 20,
                        "sequentialBatch": True,
                    },
                )
                self.assertEqual(job_res.status_code, 202, job_res.text)
                job_data = job_res.json()
                job_id = job_data["id"]

                # Preset isolation verified: vendor & pricing kept, Jeminise preset NOT applied!
                self.assertEqual(job_data["settings"]["channel"], "etsy")
                self.assertEqual(job_data["settings"]["vendor"], "Jeminise Studio")
                self.assertEqual(job_data["settings"]["priceAddition"], 7.0)
                self.assertEqual(job_data["settings"]["profileSlug"], "default")
                self.assertFalse(job_data["settings"]["applyJeminisePreset"])
                self.assertEqual(job_data["acceptedInputs"], 2)  # deduplicated 3 -> 2; 1 skipped for Shopify

                # 4. Register legacy Amazon-only agent vs Etsy-capable agent
                limits_stub = AgentLimits()
                legacy_hello = hello_message(
                    client_id="agent-legacy-amz",
                    display_name="Legacy Agent",
                    available_slots=2,
                    max_concurrent_inputs=2,
                    limits=limits_stub,
                    etsy_enabled=False,
                )
                etsy_hello = hello_message(
                    client_id="agent-etsy-ready",
                    display_name="Etsy Agent",
                    available_slots=2,
                    max_concurrent_inputs=2,
                    limits=limits_stub,
                    etsy_enabled=True,
                )
                store.register_client(legacy_hello)
                store.register_client(etsy_hello)

                # Legacy agent MUST NOT lease Etsy tasks!
                self.assertEqual(store.lease_tasks("agent-legacy-amz", 2), [])

                # Etsy agent leases the queued Etsy task!
                leases = store.lease_tasks("agent-etsy-ready", 2)
                self.assertEqual(len(leases), 1)
                lease = leases[0]
                self.assertEqual(lease["channel"], "etsy")
                self.assertEqual(lease["listingId"], "1876543210")
                self.assertEqual(lease["asin"], "")

                # 5. Activity & preflight endpoints see active crawling listing
                act = client.post(
                    "/api/v1/etsy-listings/activity",
                    json={"storeId": "jeminise", "listingIds": ["1876543210"]},
                ).json()
                self.assertEqual(act["activity"][0]["status"], "crawling")

                # 6. Worker fetches sanitized Etsy baseline from Server (ZERO tokens in response)
                base_res = client.post(
                    f"/api/v1/worker/tasks/{lease['taskId']}/etsy-baseline",
                    headers={"X-Client-Id": "agent-etsy-ready", "X-Lease-Id": lease["leaseId"]},
                    json={"clientId": "agent-etsy-ready", "leaseId": lease["leaseId"]},
                )
                self.assertEqual(base_res.status_code, 200, base_res.text)
                self.assertNotIn("access_tok", base_res.text)
                self.assertNotIn("refresh_tok", base_res.text)
                self.assertNotIn("etsy_live_secret_999", base_res.text)
                baseline = base_res.json()

                # 7. Simulate disconnect / lease expiry & retry -> requeues cleanly without duplicate task
                with store.sessions.begin() as session:
                    t_row = session.get(CrawlTask, lease["taskId"])
                    assert t_row is not None
                    t_row.lease_expires_at = utc_now() - timedelta(seconds=5)
                reaped = store.reap_expired()
                self.assertEqual(reaped["requeuedTasks"], 1)
                with store.sessions.begin() as session:
                    t_row = session.get(CrawlTask, lease["taskId"])
                    assert t_row is not None
                    self.assertEqual(t_row.status, "queued")
                    t_row.next_retry_at = utc_now() - timedelta(seconds=1)
                    if isinstance(t_row.last_error, dict):
                        t_row.last_error = {**t_row.last_error, "retryAfter": utc_iso(utc_now() - timedelta(seconds=1))}
                retry_leases = store.lease_tasks("agent-etsy-ready", 1)
                self.assertEqual(len(retry_leases), 1)
                retry_lease = retry_leases[0]
                self.assertEqual(retry_lease["taskId"], lease["taskId"])

                # 8. Build product with incomplete price verification -> parks in SEO Review -> Cần xử lý!
                unverified_product = build_ffp_etsy_crawled_product(
                    merge_etsy_browser_verification(
                        {**baseline, "needsPriceVerification": True},
                        None,
                        browser_error="Timeout reading buy box",
                    )
                )
                unverified_product["etsyContext"]["buyerPriceLoaded"] = False
                # Force blocker to verify attention-review flow
                unverified_product["syncBlockers"] = ["Chưa xác minh được giá hiển thị US cho listing Etsy #1876543210."]
                unverified_product["evidenceComplete"] = False

                product_env = {
                    "version": "distributed-2",
                    "taskId": retry_lease["taskId"],
                    "jobId": job_id,
                    "leaseId": retry_lease["leaseId"],
                    "clientId": "agent-etsy-ready",
                    "source": retry_lease["source"],
                    "asin": "",
                    "sourceKey": "etsy:1876543210",
                    "productId": "etsy-1876543210",
                    "product": unverified_product,
                }
                up_prod = client.put(
                    f"/api/v1/worker/tasks/{retry_lease['taskId']}/products/etsy:1876543210",
                    headers={"X-Client-Id": "agent-etsy-ready", "X-Lease-Id": retry_lease["leaseId"]},
                    json=product_env,
                )
                self.assertEqual(up_prod.status_code, 200, up_prod.text)
                item_id = up_prod.json()["productItemId"]

                # Claim & park in attention review
                claimed = client.post(
                    "/api/v1/internal/product-pipeline/claim",
                    json={"workerId": "worker-1", "storeId": "jeminise", "limit": 1},
                ).json()["items"]
                self.assertEqual(len(claimed), 1)
                self.assertEqual(claimed[0]["sourcePlatform"], "etsy")
                self.assertEqual(claimed[0]["sourceProductId"], "1876543210")

                park_res = client.post(
                    f"/api/v1/internal/product-pipeline/{item_id}/attention-review",
                    json={
                        "workerId": "worker-1",
                        "blockers": unverified_product["syncBlockers"],
                        "normalizedProduct": unverified_product,
                    },
                )
                self.assertEqual(park_res.status_code, 200, park_res.text)

                # Verify item appears in SEO Review -> Cần xử lý (`workspace=work`) with canSync=False!
                catalog = client.get("/api/v1/product-reviews/catalog?storeId=jeminise&workspace=work").json()
                self.assertEqual(catalog["total"], 1)
                review_row = catalog["items"][0]
                self.assertEqual(review_row["source"], "crawler")
                self.assertEqual(review_row["asin"], "")
                self.assertEqual(review_row["sourcePlatform"], "etsy")
                self.assertEqual(review_row["sourceProductId"], "1876543210")
                self.assertFalse(review_row["actions"]["canSync"])
                self.assertIn("1876543210", review_row["syncError"])

                # Complete worker result so job finishes
                core_res = {"status": "completed", "products": [unverified_product], "errors": [], "warnings": [], "durationMs": 100}
                res_env = {
                    "version": "distributed-1",
                    "taskId": retry_lease["taskId"],
                    "jobId": job_id,
                    "leaseId": retry_lease["leaseId"],
                    "clientId": "agent-etsy-ready",
                    "source": retry_lease["source"],
                    "asin": "",
                    "completedAt": utc_iso(utc_now()),
                    "resultChecksum": payload_checksum(core_res),
                    **core_res,
                }
                self.assertEqual(
                    client.put(
                        f"/api/v1/worker/tasks/{retry_lease['taskId']}/result",
                        headers={"X-Client-Id": "agent-etsy-ready", "X-Lease-Id": retry_lease["leaseId"]},
                        json=res_env,
                    ).status_code,
                    200,
                )

                # While item is in Review, preflight resolve blocks duplicate recrawl (`crawled_pending_sync`)
                preflight_busy = client.post(
                    "/api/v1/etsy-listings/resolve",
                    json={"storeId": "jeminise", "listingIds": ["1876543210"]},
                ).json()
                self.assertEqual(preflight_busy["listings"][0]["status"], "crawled_pending_sync")

                # 9. Delete/clear from Review -> recrawl MUST be allowed (`available`)!
                del_res = client.delete(f"/api/v1/product-reviews/{item_id}")
                self.assertEqual(del_res.status_code, 200, del_res.text)

                preflight_cleared = client.post(
                    "/api/v1/etsy-listings/resolve",
                    json={"storeId": "jeminise", "listingIds": ["1876543210"]},
                ).json()
                self.assertEqual(preflight_cleared["listings"][0]["status"], "available")

    def test_agent_executes_etsy_assignment_with_browser_price_verification_and_spools_outbox(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = AgentConfig.from_payload(
                {
                    "serverUrl": "http://127.0.0.1:8766",
                    "displayName": "Test Etsy Agent",
                    "dataDirectory": str(root / "agent-data"),
                    "limits": {"headless": True},
                },
                root / "amazon-crawler-agent.json",
            )
            seen_headless: list[bool] = []

            def fake_browser_extractor(url: str, settings, cancel_event):
                seen_headless.append(settings.headless)
                return {
                    "etsyVariationCount": 2,
                    "etsyVariants": [
                        {
                            "optionValues": {"Size": "Small", "Color": "Navy Blue"},
                            "priceText": "$21.99",
                            "originalPriceText": "$24.99",
                            "discountPercentage": "",
                        },
                        {
                            "optionValues": {"Size": "Large", "Color": "Crimson Red"},
                            "priceText": "$31.99",
                            "originalPriceText": "$34.99",
                            "discountPercentage": "",
                        },
                    ],
                    "videoResources": [],
                }

            agent = DistributedCrawlerAgent(
                project_root=root,
                config=config,
                etsy_browser_extractor=fake_browser_extractor,
            )
            self.assertTrue(agent._agent_capabilities()["etsy"])

            api_product = parse_etsy_api_listing(
                _sample_etsy_listing_api(1876543210, buyer_price_loaded=False),
                "https://www.etsy.com/listing/1876543210",
            )
            baseline = {
                "listingId": "1876543210",
                "canonicalUrl": "https://www.etsy.com/listing/1876543210",
                "apiProduct": api_product,
                "needsBrowserVariants": False,
                "needsPriceVerification": True,
            }
            job_settings = {"channel": "etsy", "sourcePlatform": "etsy", "storeId": "store-a"}
            assignment = {
                "taskId": "task-1",
                "jobId": "job-1",
                "leaseId": "lease-1",
                "source": "https://www.etsy.com/listing/1876543210",
                "sourcePlatform": "etsy",
                "sourceProductId": "1876543210",
                "listingId": "1876543210",
                "asin": "",
                "url": "https://www.etsy.com/listing/1876543210",
                "channel": "etsy",
                "settings": job_settings,
                "settingsFingerprint": settings_fingerprint(job_settings),
            }
            agent.store.save_assignment(assignment)

            async def run_test():
                loop = asyncio.get_running_loop()
                with patch.object(agent, "_fetch_etsy_baseline", return_value=baseline):
                    await asyncio.to_thread(agent._run_etsy_batch, [assignment], threading.Event(), loop)
                completion = await asyncio.wait_for(agent.completion_queue.get(), timeout=5)
                return completion

            completion = asyncio.run(run_test())
            self.assertEqual(completion["type"], "completed")
            # Agent's own headless setting (True) was respected!
            self.assertEqual(seen_headless, [True])
            upload_counts = agent.store.upload_counts()
            self.assertEqual(upload_counts["products"], 1)
            self.assertEqual(upload_counts["results"], 1)


if __name__ == "__main__":
    unittest.main()
