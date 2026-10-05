import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  actionMap,
  AdsIntelligenceError,
  parseDecimalString,
  ratio,
  websiteMetrics,
} from "../ads-intelligence/conversions";

function action(name: string, value: string | number | null): { action_type: string; value: string | number | null } {
  return { action_type: name, value };
}

describe("Ads Intelligence: Conversions Engine (Ported from meta_demo/conversions.py)", () => {
  it("website-only purchase mapping: ignores generic or omni aliases and preserves decimal purchases", () => {
    const raw = {
      actions: [
        action("offsite_conversion.fb_pixel_purchase", "2.5"),
        action("purchase", "20"),
        action("omni_purchase", "30"),
        action("landing_page_view", "10"),
        action("offsite_conversion.fb_pixel_add_to_cart", "4"),
        action("offsite_conversion.fb_pixel_initiate_checkout", "3"),
      ],
      action_values: [
        action("offsite_conversion.fb_pixel_purchase", "150"),
        action("omni_purchase", "999"),
      ],
      website_purchase_roas: [
        action("offsite_conversion.fb_pixel_purchase", "3"),
      ],
    };

    const { metrics, warnings } = websiteMetrics(raw, "50");

    assert.equal(metrics.purchase, "2.5");
    assert.equal(metrics.purchase_value, "150");
    assert.equal(metrics.cpa, "20"); // 50 / 2.5 = 20
    assert.equal(metrics.roas, "3");  // 150 / 50 = 3
    assert.equal(metrics.website_roas_api, "3");
    assert.equal(metrics.add_to_cart, "4");
    assert.equal(metrics.checkout, "3");
    assert.equal(metrics.landing_page_views, "10");
    assert.equal(warnings.length, 0);
  });

  it("zero purchase in returned actions: zero value and roas=0, but cpa is null", () => {
    const raw = {
      actions: [action("landing_page_view", "8")],
    };

    const { metrics, warnings } = websiteMetrics(raw, "9.05");

    assert.equal(metrics.purchase, "0");
    assert.equal(metrics.conversion_states.purchase, "not_reported");
    assert.equal(metrics.purchase_value, "0");
    assert.equal(metrics.conversion_states.purchase_value, "inferred_no_reported_purchases");
    assert.equal(metrics.roas, "0");
    assert.equal(metrics.cpa, null);
    assert.equal(metrics.conversion_states.cpa, "zero_purchases");
    assert.equal(warnings.length, 0);
  });

  it("missing actions field: unknown/null values, never falsely assumes zero", () => {
    const { metrics } = websiteMetrics({}, "5");

    assert.equal(metrics.purchase, null);
    assert.equal(metrics.purchase_value, null);
    assert.equal(metrics.cpa, null);
    assert.equal(metrics.roas, null);
    assert.equal(metrics.conversion_states.purchase, "field_not_returned");
  });

  it("positive purchase with missing value: does not force roas to zero", () => {
    const raw = {
      actions: [action("offsite_conversion.fb_pixel_purchase", "2")],
    };

    const { metrics } = websiteMetrics(raw, "50");

    assert.equal(metrics.cpa, "25");
    assert.equal(metrics.purchase_value, null);
    assert.equal(metrics.roas, null);
    assert.equal(metrics.conversion_states.roas, "input_missing");
  });

  it("generic purchase without website pixel does not become website zero", () => {
    const raw = {
      actions: [action("omni_purchase", "3")],
    };

    const { metrics, warnings } = websiteMetrics(raw, "50");

    assert.equal(metrics.purchase, null);
    assert.equal(metrics.conversion_states.purchase, "website_scope_unresolved");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /Chưa xác định được chuyển đổi website/);
  });

  it("zero or missing spend avoids infinite or NaN roas/cpa", () => {
    for (const spend of [null, undefined, "0", 0]) {
      const { metrics } = websiteMetrics({ actions: [] }, spend);
      assert.equal(metrics.roas, null);
      assert.equal(metrics.cpa, null);
    }
  });

  it("rejects bad action arrays and duplicate action types", () => {
    assert.throws(
      () => websiteMetrics({ actions: "invalid" as unknown as [] }, "5"),
      /actions không phải danh sách action/,
    );

    assert.throws(
      () => websiteMetrics({ actions: [action("purchase", "NaN")] }, "5"),
      /actions có giá trị action không hợp lệ/,
    );

    assert.throws(
      () => websiteMetrics({ actions: [action("purchase", -1)] }, "5"),
      /actions có giá trị action không hợp lệ/,
    );

    assert.throws(
      () =>
        websiteMetrics(
          {
            actions: [action("purchase", "1"), action("purchase", "2")],
          },
          "5",
        ),
      /actions có action_type trùng; không tự cộng để tránh đếm trùng/,
    );
  });

  it("preserves both derived and api roas when mismatch occurs, adding warning", () => {
    const raw = {
      actions: [action("offsite_conversion.fb_pixel_purchase", "1")],
      action_values: [action("offsite_conversion.fb_pixel_purchase", "20")],
      website_purchase_roas: [action("offsite_conversion.fb_pixel_purchase", "3")],
    };

    const { metrics, warnings } = websiteMetrics(raw, "10");

    assert.equal(metrics.roas, "2"); // 20 / 10 = 2
    assert.equal(metrics.website_roas_api, "3");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /ROAS tính từ website purchase value khác website_purchase_roas API/);
  });

  it("warns if API returns positive purchase value with zero purchases", () => {
    const raw = {
      actions: [action("landing_page_view", "10")],
      action_values: [action("offsite_conversion.fb_pixel_purchase", "50")],
    };

    const { metrics, warnings } = websiteMetrics(raw, "20");

    assert.equal(metrics.purchase, "0");
    assert.equal(metrics.purchase_value, "50");
    assert.ok(warnings.some((w) => w.includes("API trả website purchase value dương nhưng không có website purchase")));
  });

  it("ratio helper handles division safely and trims trailing zeroes", () => {
    assert.equal(ratio(null, 10), null);
    assert.equal(ratio(10, null), null);
    assert.equal(ratio(10, 0), null);
    assert.equal(ratio("100", "4"), "25");
    assert.equal(ratio("10", "4"), "2.5");
    assert.equal(ratio("1", "3"), "0.3333333333");
  });

  it("actionMap returns null when field is not present", () => {
    assert.equal(actionMap({}, "actions"), null);
  });

  it("handles scientific notation and leading plus in action values without crashing", () => {
    const raw = {
      actions: [
        action("offsite_conversion.fb_pixel_purchase", "1e3"), // 1000 purchases
        action("landing_page_view", "+500"),                   // 500 views
      ],
      action_values: [
        action("offsite_conversion.fb_pixel_purchase", "1.5e4"), // 15000 revenue
      ],
    };

    const { metrics } = websiteMetrics(raw, "5e3"); // 5000 spend

    assert.equal(metrics.purchase, "1000");
    assert.equal(metrics.landing_page_views, "500");
    assert.equal(metrics.purchase_value, "15000");
    assert.equal(metrics.cpa, "5"); // 5000 / 1000 = 5
    assert.equal(metrics.roas, "3"); // 15000 / 5000 = 3
  });

  it("parseDecimalString safely parses numbers, floats, integers and scientific notation", () => {
    assert.equal(parseDecimalString(100), "100");
    assert.equal(parseDecimalString(12.34), "12.34");
    assert.equal(parseDecimalString("100"), "100");
    assert.equal(parseDecimalString("0.5"), "0.5");
    assert.equal(parseDecimalString(".5"), ".5");
    assert.equal(parseDecimalString("+10"), "10");
    assert.equal(parseDecimalString("1e3"), "1000");
    assert.equal(parseDecimalString("1.5e2"), "150");

    assert.throws(() => parseDecimalString(""), /Invalid number/);
    assert.throws(() => parseDecimalString("-5"), /Invalid decimal format/);
    assert.throws(() => parseDecimalString("abc"), /Invalid decimal format/);
    assert.throws(() => parseDecimalString(NaN), /Invalid number/);
    assert.throws(() => parseDecimalString(Infinity), /Invalid number/);
    assert.throws(() => parseDecimalString(null), /Invalid value type/);
  });
});
