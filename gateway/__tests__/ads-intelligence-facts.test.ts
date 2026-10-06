import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeSnapshotSha256, createNormalizedMetaFact } from "../ads-intelligence/facts";
import { normalize } from "../ads-intelligence/insights";
import type { MetaAccountInfo, RawMetaInsightRow } from "../ads-intelligence/types";

const ACCOUNT_USD: MetaAccountInfo = {
  id: "act_1010295448281555",
  currency: "USD",
  timezone_name: "America/Los_Angeles",
};

describe("Ads Intelligence: Facts & Snapshot Hashing", () => {
  describe("computeSnapshotSha256", () => {
    it("produces identical deterministic hashes regardless of object key order", () => {
      const obj1 = { a: 1, b: "test", nested: { x: 10, y: 20 } };
      const obj2 = { nested: { y: 20, x: 10 }, b: "test", a: 1 };

      const hash1 = computeSnapshotSha256(obj1);
      const hash2 = computeSnapshotSha256(obj2);

      assert.equal(hash1, hash2);
      assert.match(hash1, /^[0-9a-f]{64}$/);
    });

    it("produces different hashes for different payloads", () => {
      const hash1 = computeSnapshotSha256({ spend: "100.00" });
      const hash2 = computeSnapshotSha256({ spend: "100.01" });

      assert.notEqual(hash1, hash2);
    });
  });

  describe("createNormalizedMetaFact", () => {
    const rawRow: RawMetaInsightRow = {
      account_id: "1010295448281555",
      account_currency: "USD",
      campaign_id: "1001",
      campaign_name: "Cold Traffic - Rugs",
      date_start: "2026-09-25",
      date_stop: "2026-10-01",
      spend: "50.00",
      impressions: "2000",
      reach: "1500",
      frequency: "1.3333333333",
      cpm: "25",
      clicks: "40",
      inline_link_clicks: "25",
      ctr: "2",
      inline_link_click_ctr: "1.25",
      cpc: "1.25",
      actions: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
      ],
      action_values: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "120" },
      ],
      website_purchase_roas: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "2.4" },
      ],
    };

    it("evaluates data maturity as PROVISIONAL and blocks scale decisions when ending within last 7 days", () => {
      // Reference date: 2026-10-03 (yesterday in LA is 2026-10-02, last 7 days starts 2026-09-26)
      // Since date_stop is 2026-10-01, it is >= 2026-09-26 -> PROVISIONAL
      const refDate = new Date(Date.UTC(2026, 9, 3, 0, 0, 0));
      const normalizedRow = normalize(rawRow, "campaign", ACCOUNT_USD, "2026-09-25", "2026-10-01");

      const fact = createNormalizedMetaFact({
        storeId: "chillgen",
        row: normalizedRow,
        timezone: "America/Los_Angeles",
        now: refDate,
      });

      assert.equal(fact.storeId, "chillgen");
      assert.equal(fact.source, "meta");
      assert.equal(fact.entityLevel, "campaign");
      assert.equal(fact.entityId, "1001");
      assert.equal(fact.entityName, "Cold Traffic - Rugs");
      assert.equal(fact.periodStart, "2026-09-25");
      assert.equal(fact.periodEnd, "2026-10-01");
      assert.equal(fact.spend, "50.00");
      assert.equal(fact.conversions.purchase, "2");
      assert.equal(fact.conversions.purchase_value, "120");
      assert.equal(fact.conversions.cpa, "25");
      assert.equal(fact.conversions.roas, "2.4");

      // Quality and maturity gates
      assert.equal(fact.dataQuality.maturity, "PROVISIONAL");
      assert.deepEqual(fact.dataQuality.blockedDecisions, ["SCALE_ON_PROFIT", "KILL_ON_CPA"]);
      assert.ok(fact.dataQuality.warnings.some((w) => w.includes("PROVISIONAL")));
      assert.match(fact.snapshotSha256, /^[0-9a-f]{64}$/);
      assert.equal(fact.factId, "fact:chillgen:meta:campaign:1001:2026-09-25:2026-10-01");
    });

    it("evaluates data maturity as FINALIZED when date window ended beyond 7 days ago", () => {
      // Window ended on 2026-09-10; reference date is 2026-10-03 (23 days ago)
      const refDate = new Date(Date.UTC(2026, 9, 3, 0, 0, 0));
      const pastRow: RawMetaInsightRow = {
        ...rawRow,
        date_start: "2026-09-01",
        date_stop: "2026-09-10",
      };
      const normalizedRow = normalize(pastRow, "campaign", ACCOUNT_USD, "2026-09-01", "2026-09-10");

      const fact = createNormalizedMetaFact({
        storeId: "chillgen",
        row: normalizedRow,
        timezone: "America/Los_Angeles",
        now: refDate,
      });

      assert.equal(fact.dataQuality.maturity, "FINALIZED");
      assert.deepEqual(fact.dataQuality.blockedDecisions, []);
      assert.equal(fact.factId, "fact:chillgen:meta:campaign:1001:2026-09-01:2026-09-10");
    });
  });
});
