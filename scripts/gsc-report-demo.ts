/** Opt-in, read-only Google/cache reconciliation. Never prints credentials or query text. */
import assert from "node:assert/strict";

import { z } from "zod";

import { parseSeoPerformanceEnvironment } from "../src/config/seo-performance-environment";
import { GoogleSearchClient, searchRowSchema } from "../gateway/seo-performance/google-client";
import { PerformanceRepository } from "../gateway/seo-performance/repository";
import { buildReportRequest, normalizeReportFilters } from "../gateway/seo-performance/report";

const [storeId, startDate, endDate] = process.argv.slice(2);
if (!storeId || !startDate || !endDate || process.env.GSC_DEMO_ALLOW_LIVE !== "true") throw new Error("Set GSC_DEMO_ALLOW_LIVE=true; arguments: storeId YYYY-MM-DD YYYY-MM-DD");
const config = parseSeoPerformanceEnvironment(process.env);
const repository = new PerformanceRepository(config.databaseUrl);
try {
  const filters = normalizeReportFilters({ startDate, endDate });
  const mapping = await repository.requireMapping(storeId);
  const google = new GoogleSearchClient(repository.pool, config);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(mapping.property)}/searchAnalytics/query`;
  const summary: Record<string, unknown> = { storeId, property: mapping.property, filters, searchType: "web", dataState: "final", timezone: "America/Los_Angeles", checkedAt: new Date().toISOString() };
  for (const period of ["current", "previous"] as const) {
    const request = buildReportRequest(filters, period, "total", 0);
    const rows = z.object({ rows: z.array(searchRowSchema).default([]) }).parse(await google.request(endpoint, request)).rows;
    const direct = rows[0] ? { ...rows[0], ctr: rows[0].impressions ? rows[0].clicks / rows[0].impressions : 0 } : null;
    const cached = await repository.metrics(storeId, request.startDate, request.endDate, "property");
    const deltas = direct && cached ? { clicks: direct.clicks - cached.clicks, impressions: direct.impressions - cached.impressions, ctr: direct.ctr - cached.ctr, position: direct.position - cached.position } : null;
    summary[period] = { direct, cached, deltas };
    if (direct && cached) {
      assert.ok(Math.abs(direct.clicks - cached.clicks) < 0.001, "Cached clicks differ; investigate freshness/date/filter");
      assert.ok(Math.abs(direct.impressions - cached.impressions) < 0.001, "Cached impressions differ; investigate freshness/date/filter");
      assert.ok(Math.abs(direct.ctr - cached.ctr) < 0.00001, "Cached CTR differs");
      assert.ok(Math.abs(direct.position - cached.position) < 0.01, "Cached position differs");
    }
  }
  for (const dimension of ["query", "page", "country", "device"] as const) {
    const rows = z.object({ rows: z.array(searchRowSchema).default([]) }).parse(await google.request(endpoint, buildReportRequest(filters, "current", dimension, 0))).rows;
    summary[dimension] = { firstPageRows: rows.length, hasMorePossible: rows.length === 25000 };
  }
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : "GSC_DEMO_FAILED: check configuration, permissions and API availability; credentials suppressed.");
  process.exitCode = 1;
} finally { await repository.pool.end(); }
