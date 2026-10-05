import assert from "node:assert/strict";
import test from "node:test";

import {
  GSC_ROW_LIMIT,
  buildG01PropertyRequest,
  buildG02PageRequest,
  buildG03ObservedQueryRequest,
  buildG04SliceRequest,
  buildG05ComparisonRequests,
  buildGscSearchAnalyticsUrl,
  normalizeGscCountry,
  normalizeGscDevice,
  normalizeGscRow,
  type GscRawSearchRow,
} from "../seo-performance/gsc-contracts";
import { replaceCompletedGscPartition, stageGscPartition } from "../seo-performance/gsc-ingestion";

const range = { startDate: "2026-08-01", endDate: "2026-08-28" } as const;
const rawProperty = "https://www.example.com/";
const page = "https://www.example.com/products/Quilt?market=US";

function row(key: string, clicks = 2): GscRawSearchRow {
  return { keys: [key], clicks, impressions: 10, ctr: clicks / 10, position: 4.5 };
}

test("G01-G05 keep property totals independent and preserve finalized filters", () => {
  const totals = buildG01PropertyRequest({ rawProperty, range });
  const timeline = buildG01PropertyRequest({ rawProperty, range, groupByDate: true, filters: { country: "usa", device: "MOBILE" } });
  const pages = buildG02PageRequest({ rawProperty, range });
  const exactPage = buildG02PageRequest({ rawProperty, range, page });
  const queries = buildG03ObservedQueryRequest({ rawProperty, range, page });
  const countries = buildG04SliceRequest({ rawProperty, range, dimension: "country", page });
  const comparison = buildG05ComparisonRequests({
    base: queries,
    before: { startDate: "2026-07-01", endDate: "2026-07-28" },
    after: range,
  });

  assert.equal(totals.request.dimensions.length, 0);
  assert.equal(totals.request.aggregationType, "byProperty");
  assert.deepEqual(timeline.request.dimensions, ["date"]);
  assert.equal(timeline.request.dataState, "final");
  assert.equal(timeline.request.rowLimit, 25_000);
  assert.deepEqual(timeline.request.dimensionFilterGroups[0].filters, [
    { dimension: "country", operator: "equals", expression: "usa" },
    { dimension: "device", operator: "equals", expression: "MOBILE" },
  ]);
  assert.deepEqual(pages.request.dimensions, ["page"]);
  assert.deepEqual(exactPage.request.dimensions, []);
  assert.equal(exactPage.request.aggregationType, "auto");
  assert.deepEqual(queries.request.dimensions, ["query"]);
  assert.deepEqual(countries.request.dimensions, ["country"]);
  assert.equal(comparison[0].contractId, "G05");
  assert.deepEqual([comparison[0].request.startDate, comparison[1].request.startDate], ["2026-07-01", "2026-08-01"]);
  assert.deepEqual(comparison[0].request.dimensionFilterGroups, comparison[1].request.dimensionFilterGroups);
});

test("property identity remains raw and URL construction encodes it exactly once", () => {
  const domainProperty = "sc-domain:example.com";
  const contract = buildG01PropertyRequest({ rawProperty: domainProperty, range });
  assert.equal(contract.rawProperty, domainProperty);
  assert.equal(buildGscSearchAnalyticsUrl(contract.rawProperty),
    "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
  assert.equal(buildGscSearchAnalyticsUrl(rawProperty),
    "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwww.example.com%2F/searchAnalytics/query");
});

test("country and device values normalize to canonical provider shapes", () => {
  assert.equal(normalizeGscCountry(" usa "), "USA");
  assert.equal(normalizeGscDevice("mobile"), "MOBILE");
  assert.equal(normalizeGscDevice("smartphone"), "UNKNOWN");
  assert.throws(() => normalizeGscCountry("us"), /GSC_COUNTRY_INVALID/);
});

test("page, query, country and device rows keep distinct normalized shapes", () => {
  const exactPage = buildG02PageRequest({ rawProperty, range, page });
  const queries = buildG03ObservedQueryRequest({ rawProperty, range, page });
  const countries = buildG04SliceRequest({ rawProperty, range, dimension: "country", page });
  const devices = buildG04SliceRequest({ rawProperty, range, dimension: "device", page });
  const metric = { clicks: 2, impressions: 10, ctr: 0.2, position: 4.5 } as const;
  assert.deepEqual(normalizeGscRow(exactPage, metric), {
    dataset: "page", identity: `page:${page}`, page, ...metric,
  });
  assert.deepEqual(normalizeGscRow(queries, { keys: ["haunted quilt"], ...metric }), {
    dataset: "query", identity: `query:${page}\0haunted quilt`, page, query: "haunted quilt", ...metric,
  });
  assert.deepEqual(normalizeGscRow(countries, { keys: ["usa"], ...metric }), {
    dataset: "country", identity: "country:USA", country: "USA", countryMappingVersion: "iso-3166-alpha3-v1", ...metric,
  });
  assert.deepEqual(normalizeGscRow(devices, { keys: ["mobile"], ...metric }), {
    dataset: "device", identity: "device:MOBILE", device: "MOBILE", deviceMappingVersion: "gsc-device-v1", ...metric,
  });
});

test("pagination uses 25000 offsets, deduplicates identical rows and keeps coverage distinct", async () => {
  const contract = buildG03ObservedQueryRequest({ rawProperty, range: { startDate: "2026-08-01", endDate: "2026-08-01" }, page });
  const first = Array.from({ length: GSC_ROW_LIMIT }, (_, index) => row(`query-${index}`));
  const offsets: number[] = [];
  const completed = await stageGscPartition({
    contract,
    dataThrough: "2026-08-01",
    fetchPage: async current => {
      offsets.push(current.request.startRow);
      return current.request.startRow === 0 ? { rows: first } : { rows: [row("query-0"), row("last")] };
    },
  });
  assert.deepEqual(offsets, [0, 25_000]);
  assert.equal(completed.rows.length, 25_001);
  assert.equal(completed.quality.fetchComplete, true);
  assert.equal(completed.quality.sourceCoverage, "REQUEST_COMPLETE_WITH_PROVIDER_LIMITS");
  assert.equal(completed.quality.rowsReceived, 25_002);
  assert.equal(completed.quality.providerRowLimitReached, false);
});

test("a full 50000-row partition stops at the provider ceiling and labels provider limits", async () => {
  const contract = buildG04SliceRequest({ rawProperty, range: { startDate: "2026-08-01", endDate: "2026-08-01" }, dimension: "device" });
  const offsets: number[] = [];
  const completed = await stageGscPartition({
    contract,
    dataThrough: "2026-08-01",
    fetchPage: async current => {
      offsets.push(current.request.startRow);
      return { rows: Array.from({ length: GSC_ROW_LIMIT }, () => row("MOBILE")) };
    },
  });
  assert.deepEqual(offsets, [0, 25_000]);
  assert.equal(completed.quality.rowsReceived, 50_000);
  assert.equal(completed.quality.providerRowLimitReached, true);
  assert.equal(completed.quality.sourceCoverage, "REQUEST_COMPLETE_WITH_PROVIDER_LIMITS");
});

test("middle-page failure never publishes a completed partition", async () => {
  const contract = buildG03ObservedQueryRequest({ rawProperty, range: { startDate: "2026-08-01", endDate: "2026-08-01" }, page });
  let replacements = 0;
  await assert.rejects(replaceCompletedGscPartition({
    contract,
    dataThrough: "2026-08-01",
    fetchPage: async current => {
      if (current.request.startRow > 0) throw new Error("provider failed");
      return { rows: Array.from({ length: GSC_ROW_LIMIT }, (_, index) => row(`query-${index}`)) };
    },
    replace: async () => { replacements += 1; },
  }), /provider failed/);
  assert.equal(replacements, 0);
});

test("conflicting duplicate identities fail the partition instead of double counting", async () => {
  const contract = buildG03ObservedQueryRequest({ rawProperty, range: { startDate: "2026-08-01", endDate: "2026-08-01" }, page });
  await assert.rejects(stageGscPartition({
    contract,
    dataThrough: "2026-08-01",
    fetchPage: async () => ({ rows: [row("same", 2), row("same", 3)] }),
  }), /GSC_DUPLICATE_ROW_CONFLICT/);
});
