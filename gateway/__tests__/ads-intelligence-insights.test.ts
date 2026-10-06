import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  datesForAccount,
  normalize,
  qualityNotes,
} from "../ads-intelligence/insights";
import type {
  AdsEntityLevel,
  MetaAccountInfo,
  NormalizedMetaInsightRow,
  RawMetaInsightRow,
} from "../ads-intelligence/types";

const NOW = new Date(Date.UTC(2026, 9, 3, 0, 0, 0)); // 2026-10-03T00:00:00Z
const ACCOUNT_USD: MetaAccountInfo = {
  id: "act_123",
  currency: "USD",
  timezone_name: "America/Los_Angeles",
};

function makeRawRow(level: AdsEntityLevel = "campaign", changes: Partial<RawMetaInsightRow> = {}): RawMetaInsightRow {
  const base: Record<string, unknown> = {
    account_id: "123",
    account_currency: "USD",
    campaign_id: "1",
    campaign_name: "Demo",
    date_start: "2026-09-26",
    date_stop: "2026-10-02",
    spend: "12.34",
    impressions: "1000",
    reach: "800",
    frequency: "1.25",
    cpm: "12.34",
    clicks: "50",
    inline_link_clicks: "20",
    ctr: "5",
    inline_link_click_ctr: "2",
    cpc: "0.2468",
  };

  if (level === "adset" || level === "ad") {
    base.adset_id = "2";
    base.adset_name = "Set";
  }

  if (level === "ad") {
    base.ad_id = "3";
    base.ad_name = "Ad";
  }

  return { ...base, ...changes } as RawMetaInsightRow;
}

describe("Ads Intelligence: Insights Normalization & Anomaly Detection", () => {
  describe("datesForAccount", () => {
    it("computes last 7 completed days relative to account timezone", () => {
      const manila = datesForAccount("Asia/Manila", undefined, undefined, NOW);
      assert.deepEqual(manila, { since: "2026-09-26", until: "2026-10-02" });

      const la = datesForAccount("America/Los_Angeles", undefined, undefined, NOW);
      assert.deepEqual(la, { since: "2026-09-25", until: "2026-10-01" });
    });

    it("accepts valid custom since and until within limits", () => {
      const res = datesForAccount("Asia/Manila", "2026-09-20", "2026-09-30", NOW, 31);
      assert.deepEqual(res, { since: "2026-09-20", until: "2026-09-30" });
    });

    it("rejects invalid dates, reversed intervals, and dates reaching today", () => {
      // Reaches today in Manila (today is 2026-10-03)
      assert.throws(
        () => datesForAccount("Asia/Manila", "2026-10-03", "2026-10-03", NOW),
        /Khoảng ngày phải tăng dần và kết thúc trước hôm nay/,
      );

      // Reversed start/end
      assert.throws(
        () => datesForAccount("Asia/Manila", "2026-10-02", "2026-09-26", NOW),
        /Khoảng ngày phải tăng dần và kết thúc trước hôm nay/,
      );

      // Range >= max_days (31 days)
      assert.throws(
        () => datesForAccount("Asia/Manila", "2026-09-01", "2026-10-02", NOW, 31),
        /Chế độ này giới hạn 31 ngày mỗi truy vấn/,
      );

      // Invalid calendar date (Feb 30)
      assert.throws(
        () => datesForAccount("Asia/Manila", "2026-02-30", "2026-03-01", NOW),
        /Cần cả since\/until theo định dạng YYYY-MM-DD/,
      );

      // Bad format
      assert.throws(
        () => datesForAccount("Asia/Manila", "20260926", "2026-10-02", NOW),
        /Cần cả since\/until theo định dạng YYYY-MM-DD/,
      );

      // Missing since
      assert.throws(
        () => datesForAccount("Asia/Manila", null, "2026-10-02", NOW),
        /Cần cả since\/until theo định dạng YYYY-MM-DD/,
      );
    });

    it("rejects invalid timezone names", () => {
      assert.throws(
        () => datesForAccount("Invalid/Timezone", undefined, undefined, NOW),
        /Timezone tài khoản không hợp lệ hoặc thiếu tzdata/,
      );
    });
    it("supports null arguments to request default 7 days like Python None args", () => {
      const res = datesForAccount("Asia/Manila", null, null, NOW);
      assert.deepEqual(res, { since: "2026-09-26", until: "2026-10-02" });
    });

    it("handles dates cleanly across Daylight Saving Time transitions in America/Los_Angeles", () => {
      // 2026 Spring Forward in LA: Sunday, March 8, 2026
      // Set reference date: March 10, 2026
      const postDstDate = new Date(Date.UTC(2026, 2, 10, 12, 0, 0)); // March 10, 2026 UTC
      const res = datesForAccount("America/Los_Angeles", undefined, undefined, postDstDate);
      // Yesterday in LA is March 9; 7 days prior is March 3
      assert.deepEqual(res, { since: "2026-03-03", until: "2026-03-09" });

      // Custom window crossing the transition
      const customWindow = datesForAccount("America/Los_Angeles", "2026-03-05", "2026-03-09", postDstDate, 31);
      assert.deepEqual(customWindow, { since: "2026-03-05", until: "2026-03-09" });
    });
  });

  describe("normalize", () => {
    it("correctly normalizes account, campaign, adset, and ad level rows", () => {
      // Account level row
      const accountRaw: RawMetaInsightRow = {
        account_id: "123",
        account_currency: "USD",
        date_start: "2026-09-26",
        date_stop: "2026-10-02",
        spend: "1e2", // scientific notation: 100
        impressions: "1000",
        reach: "800",
        frequency: "1.25",
        cpm: "100",
        clicks: "50",
        inline_link_clicks: "20",
        ctr: "5",
        inline_link_click_ctr: "2",
        cpc: "2",
      };
      const accountFact = normalize(accountRaw, "account", ACCOUNT_USD, "2026-09-26", "2026-10-02");
      assert.equal(accountFact.level, "account");
      assert.equal(accountFact.object_id, "123");
      assert.equal(accountFact.spend, "100"); // normalized from 1e2

      const camp = normalize(makeRawRow("campaign"), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02");
      assert.equal(camp.level, "campaign");
      assert.equal(camp.object_id, "1");
      assert.equal(camp.spend, "12.34");
      assert.equal(camp.reach, "800");
      assert.equal(camp.cpc, "0.2468");

      const adset = normalize(makeRawRow("adset"), "adset", ACCOUNT_USD, "2026-09-26", "2026-10-02");
      assert.equal(adset.level, "adset");
      assert.equal(adset.object_id, "2");

      const ad = normalize(makeRawRow("ad"), "ad", ACCOUNT_USD, "2026-09-26", "2026-10-02");
      assert.equal(ad.level, "ad");
      assert.equal(ad.object_id, "3");
    });

    it("clears ratio metrics to null when denominators are zero", () => {
      const raw = makeRawRow("campaign", {
        reach: "0",
        frequency: "0",
        clicks: "0",
        cpc: "0",
        impressions: "0",
        cpm: "0",
        ctr: "0",
        inline_link_click_ctr: null,
      });

      const res = normalize(raw, "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02");
      assert.equal(res.frequency, null);
      assert.equal(res.cpc, null);
      assert.equal(res.cpm, null);
      assert.equal(res.ctr, null);
      assert.equal(res.inline_link_click_ctr, null);
    });

    it("rejects invalid responses: wrong account, currency, IDs, or dates", () => {
      // Wrong account
      assert.throws(
        () => normalize(makeRawRow("campaign", { account_id: "999" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02"),
        /Insights không khớp account\/currency yêu cầu/,
      );

      // Wrong currency
      assert.throws(
        () => normalize(makeRawRow("campaign", { account_currency: "VND" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02"),
        /Insights không khớp account\/currency yêu cầu/,
      );

      // Non-digit ID
      assert.throws(
        () => normalize(makeRawRow("campaign", { campaign_id: "abc" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02"),
        /Insights thiếu ID hoặc ID không hợp lệ/,
      );

      // Out of bounds dates
      assert.throws(
        () => normalize(makeRawRow("campaign", { date_stop: "2026-10-05" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02"),
        /Insights trả khoảng ngày ngoài yêu cầu hoặc không hợp lệ/,
      );

      // NaN metric
      assert.throws(
        () => normalize(makeRawRow("campaign", { spend: "NaN" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02"),
        /Metric spend không phải số hợp lệ/,
      );

      // Infinity metric
      assert.throws(
        () => normalize(makeRawRow("campaign", { ctr: "Infinity" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02"),
        /Metric ctr không phải số hợp lệ/,
      );
    });
  });

  describe("qualityNotes", () => {
    it("flags when inline_link_clicks exceeds clicks and when ad spend sum mismatches campaign spend", () => {
      const camp = normalize(makeRawRow("campaign", { spend: "20.00" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02");
      const ad = normalize(
        makeRawRow("ad", {
          spend: "8.31",
          clicks: "7",
          inline_link_clicks: "15", // higher than clicks
        }),
        "ad",
        ACCOUNT_USD,
        "2026-09-26",
        "2026-10-02",
      );

      const rows: Record<string, readonly NormalizedMetaInsightRow[]> = {
        campaign: [camp],
        ad: [ad],
      };

      const notes = qualityNotes(rows);
      assert.equal(notes.length, 2);
      assert.match(notes[0] ?? "", /Link clicks lớn hơn Clicks tổng/);
      assert.match(notes[1] ?? "", /Spend cấp campaign khác tổng các dòng ad/);
    });

    it("returns empty notes when data is coherent", () => {
      const camp = normalize(makeRawRow("campaign", { spend: "10.00" }), "campaign", ACCOUNT_USD, "2026-09-26", "2026-10-02");
      const ad = normalize(
        makeRawRow("ad", {
          spend: "10.00",
          clicks: "20",
          inline_link_clicks: "10",
        }),
        "ad",
        ACCOUNT_USD,
        "2026-09-26",
        "2026-10-02",
      );

      const notes = qualityNotes({
        campaign: [camp],
        ad: [ad],
      });
      assert.equal(notes.length, 0);
    });
  });
});
