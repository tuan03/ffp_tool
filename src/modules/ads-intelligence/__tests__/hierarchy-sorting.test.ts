import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { HierarchyTab } from "../ui/tabs/HierarchyTab";
import type { AdsHierarchyCampaign } from "../types";

const mockCampaignsWithDates: readonly AdsHierarchyCampaign[] = [
  {
    id: "camp_old",
    name: "Old Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    objective: "OUTCOME_SALES",
    budgetType: "CAMPAIGN",
    dailyBudget: "50.00",
    spend: "500.00",
    purchases: "10",
    purchaseValue: "1000.00",
    cpa: "50.00",
    roas: "2.0",
    createdTime: "2026-01-15T08:00:00+0000",
    adsets: [
      {
        id: "adset_old_1",
        name: "Old AdSet 1",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        dailyBudget: null,
        optimizationGoal: "OFFSITE_CONVERSIONS",
        spend: "250.00",
        purchases: "5",
        cpa: "50.00",
        roas: "2.0",
        createdTime: "2026-01-16T08:00:00+0000",
        ads: [
          {
            id: "ad_old_1",
            name: "Old Ad 1",
            status: "ACTIVE",
            effectiveStatus: "ACTIVE",
            spend: "250.00",
            impressions: "1000",
            linkClicks: "50",
            linkCtr: "5.0%",
            purchases: "5",
            purchaseValue: "500.00",
            cpa: "50.00",
            roas: "2.0",
            createdTime: "2026-01-17T08:00:00+0000",
          },
        ],
      },
    ],
  },
  {
    id: "camp_new",
    name: "New Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    objective: "OUTCOME_SALES",
    budgetType: "CAMPAIGN",
    dailyBudget: "100.00",
    spend: "100.00",
    purchases: "2",
    purchaseValue: "200.00",
    cpa: "50.00",
    roas: "2.0",
    createdTime: "2026-04-01T12:00:00+0000",
    adsets: [],
  },
];

test("HierarchyTab renders Ngày tạo column and sorts by createdTime desc by default", () => {
  const html = renderToString(React.createElement(HierarchyTab, { campaigns: mockCampaignsWithDates }));

  // Should have "Ngày tạo" in header
  assert.ok(html.includes("Ngày tạo"), "Expected header to include 'Ngày tạo'");

  // By default, New Campaign (2026-04-01) should appear before Old Campaign (2026-01-15)
  const newIndex = html.indexOf("New Campaign");
  const oldIndex = html.indexOf("Old Campaign");
  assert.ok(newIndex !== -1, "New Campaign should be rendered");
  assert.ok(oldIndex !== -1, "Old Campaign should be rendered");
  assert.ok(newIndex < oldIndex, `New Campaign (pos ${newIndex}) must appear before Old Campaign (pos ${oldIndex})`);

  // Date format should appear
  assert.ok(html.includes("2026-04-01"), "Formatted date 2026-04-01 should be rendered");
  assert.ok(html.includes("2026-01-15"), "Formatted date 2026-01-15 should be rendered");
});
