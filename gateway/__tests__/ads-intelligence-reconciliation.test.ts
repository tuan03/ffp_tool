import test from "node:test";
import assert from "node:assert/strict";
import { ShopifyOrdersClient } from "../ads-intelligence/shopify-client";
import { adsIntelligenceService } from "../ads-intelligence/service";

test("ShopifyOrdersClient: returns calibrated settlement ledger for Chillgen", async () => {
  const client = new ShopifyOrdersClient();
  const summary = await client.getOrderSummary("chillgen");

  assert.equal(summary.status, "CONNECTED");
  assert.equal(summary.totalOrders, 10);
  assert.equal(summary.netSales, "533.50");
  assert.equal(summary.grossSales, "568.50");
  assert.equal(summary.totalRefunds, "35.00");
  assert.equal(summary.averageOrderValue, "53.35");
  assert.equal(summary.currency, "USD");
  assert.ok(summary.source.includes("chillgen.myshopify.com"));
});

test("ShopifyOrdersClient: returns calibrated settlement ledger for Wrydeco", async () => {
  const client = new ShopifyOrdersClient();
  const summary = await client.getOrderSummary("wrydeco");

  assert.equal(summary.status, "CONNECTED");
  assert.equal(summary.totalOrders, 182);
  assert.equal(summary.netSales, "14210.00");
  assert.equal(summary.grossSales, "14850.00");
  assert.equal(summary.totalRefunds, "640.00");
  assert.equal(summary.averageOrderValue, "78.08");
  assert.equal(summary.currency, "USD");
});

test("ShopifyOrdersClient: returns calibrated settlement ledger for Jeminise", async () => {
  const client = new ShopifyOrdersClient();
  const summary = await client.getOrderSummary("jeminise");

  assert.equal(summary.status, "CONNECTED");
  assert.equal(summary.totalOrders, 1);
  assert.equal(summary.netSales, "109.90");
  assert.equal(summary.grossSales, "109.90");
  assert.equal(summary.totalRefunds, "0.00");
});

test("AdsIntelligenceService: getReconciliationReport computes three-way reconciliation report", async () => {
  const report = await adsIntelligenceService.getReconciliationReport("chillgen");

  assert.equal(report.storeId, "chillgen");
  assert.ok(typeof report.periodStart === "string");
  assert.ok(typeof report.periodEnd === "string");

  // Meta metrics
  assert.ok(typeof report.meta.spend === "string");
  assert.ok(typeof report.meta.purchases === "string");
  assert.ok(typeof report.meta.linkClicks === "string");

  // GA4 metrics (Unconfigured for chillgen, handled cleanly as NOT_CONFIGURED)
  assert.equal(report.ga4.status, "NOT_CONFIGURED");
  assert.equal(report.ga4.sessions, null);

  // Shopify metrics
  assert.equal(report.shopify.totalOrders, 10);
  assert.equal(report.shopify.netSales, "533.50");
  assert.ok(report.shopify.mer !== null);
  assert.ok(report.shopify.blendedCpa !== null);

  // Gaps & Discrepancies
  assert.ok(typeof report.gaps.purchaseDiscrepancy === "number");
  assert.ok(typeof report.gaps.revenueDiscrepancy === "string");
  assert.ok(typeof report.gaps.clickDropPct === "string");
  assert.ok(Array.isArray(report.gaps.notes));
  assert.ok(report.gaps.notes.length > 0);

  // Second call must be from Cost Guard Cache
  const cachedReport = await adsIntelligenceService.getReconciliationReport("chillgen");
  assert.equal(cachedReport.fromCache, true);
  assert.ok(typeof cachedReport.cachedAt === "string");
});
