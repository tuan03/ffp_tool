import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  listAvailableStoreProfileIds,
  loadStoreAdsProfile,
  parseSimpleYaml,
  validateStoreAdsProfile,
} from "../ads-intelligence/store-profile";

describe("Ads Intelligence: Store Profile Loader & Validator", () => {
  it("loads and validates Chillgen store profile from config/stores/chillgen.ads.json", () => {
    const profile = loadStoreAdsProfile("chillgen");

    assert.equal(profile.storeId, "chillgen");
    assert.equal(profile.mode, "read_only");
    assert.deepEqual(profile.marketCountries, ["US"]);
    assert.equal(profile.reportingCurrency, "USD");

    // Meta config
    assert.deepEqual(profile.meta.accountIds, ["act_1010295448281555"]);
    assert.equal(profile.meta.apiVersion, "v26.0");
    assert.equal(profile.meta.accountTimezone, "America/Los_Angeles");
    assert.equal(profile.meta.purchaseActionType, "offsite_conversion.fb_pixel_purchase");

    // GA4 config
    assert.equal(profile.ga4.propertyId, "555699138");
    assert.equal(profile.ga4.propertyTimezone, "America/Los_Angeles");

    // Shopify config
    assert.equal(profile.shopify.shopDomain, "chillgen.myshopify.com");
    assert.equal(profile.shopify.apiVersion, "2026-07");

    // Competitor config
    assert.equal(profile.competitors.primaryProvider, "scrapecreators");
    assert.equal(profile.competitors.backupProvider, "searchapi");
    assert.equal(profile.competitors.monthlyCostCapUsd, 65.0);
    assert.equal(profile.competitors.watchlist.length, 3);

    // Business economics
    assert.equal(profile.business.targetCpa, 18.0);
    assert.equal(profile.business.targetContributionPerOrder, 6.0);
    assert.equal(profile.business.breakEvenRoas, 2.5);
    assert.equal(profile.business.breakEvenCpa, 24.0);

    // Safety and write isolation
    assert.equal(profile.actions.externalWritesEnabled, false);
    assert.equal(profile.actions.approvalRequired, true);
  });

  it("throws clear error when store profile file does not exist", () => {
    assert.throws(
      () => loadStoreAdsProfile("non_existent_store_xyz"),
      /Không tìm thấy file cấu hình Store Ads Profile/,
    );
  });

  it("validates required fields and rejects malformed configs", () => {
    // Missing storeId
    assert.throws(
      () => validateStoreAdsProfile({}),
      /Store profile thiếu storeId hợp lệ/,
    );

    // Missing marketCountries
    assert.throws(
      () => validateStoreAdsProfile({ storeId: "store-1" }),
      /Store profile cần ít nhất một marketCountry/,
    );

    // Invalid currency
    assert.throws(
      () => validateStoreAdsProfile({ storeId: "store-1", marketCountries: ["US"], reportingCurrency: "US" }),
      /Store profile thiếu reportingCurrency/,
    );

    // Missing meta
    assert.throws(
      () => validateStoreAdsProfile({ storeId: "store-1", marketCountries: ["US"], reportingCurrency: "USD" }),
      /Store profile thiếu cấu hình 'meta'/,
    );

    // Missing shopify shopDomain
    assert.throws(
      () =>
        validateStoreAdsProfile({
          storeId: "store-1",
          marketCountries: ["US"],
          reportingCurrency: "USD",
          meta: {},
          ga4: {},
          shopify: {},
        }),
      /Cấu hình shopify thiếu shopDomain/,
    );
  });

  it("lists available profile IDs while excluding examples and non-ads files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "store-profiles-test-"));
    try {
      writeFileSync(join(tempDir, "store-a.ads.json"), JSON.stringify({ storeId: "store-a" }));
      writeFileSync(join(tempDir, "store-b.ads.yaml"), "storeId: store-b\n");
      writeFileSync(join(tempDir, "store-c.ads.example.json"), JSON.stringify({ storeId: "store-c" }));
      writeFileSync(join(tempDir, "other.json"), "{}");

      const ids = listAvailableStoreProfileIds({ configDir: tempDir });
      assert.deepEqual([...ids].sort(), ["store-a", "store-b"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loads and validates Chillgen store profile from YAML file config/stores/chillgen.ads.yaml", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "store-yaml-test-"));
    try {
      const yamlContent = `
# Store Profile Test
store_id: chillgen-yaml
mode: read_only
market_countries:
  - US
reporting_currency: USD
meta:
  account_ids:
    - act_1010295448281555
  account_timezone: America/Los_Angeles
  api_version: v26.0
  purchase_action_type: offsite_conversion.fb_pixel_purchase
ga4:
  property_id: "555699138"
shopify:
  shop_domain: chillgen.myshopify.com
business:
  target_cpa: 18.0
rules:
  allow_financial_recommendations: true
`;
      writeFileSync(join(tempDir, "chillgen-yaml.ads.yaml"), yamlContent);
      const profile = loadStoreAdsProfile("chillgen-yaml", { configDir: tempDir });

      assert.equal(profile.storeId, "chillgen-yaml");
      assert.deepEqual(profile.marketCountries, ["US"]);
      assert.equal(profile.reportingCurrency, "USD");
      assert.deepEqual(profile.meta.accountIds, ["act_1010295448281555"]);
      assert.equal(profile.ga4.propertyId, "555699138");
      assert.equal(profile.shopify.shopDomain, "chillgen.myshopify.com");
      assert.equal(profile.business.targetCpa, 18.0);
      assert.equal(profile.rules.allowFinancialRecommendations, true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("parseSimpleYaml parses scalar types, inline arrays, and nested structures", () => {
    const rawYaml = `
# Configuration Header
store:
  id: test-store
  active: true
  cost: 65.5
  tags: [US, UK]
  empty_field: null
`;
    const parsed = parseSimpleYaml(rawYaml) as Record<string, unknown>;
    assert.deepEqual(parsed, {
      store: {
        id: "test-store",
        active: true,
        cost: 65.5,
        tags: ["US", "UK"],
        empty_field: null,
      },
    });
  });
});
