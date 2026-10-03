import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { buildReportRequest, normalizeReportFilters, compareReportRows, loadSearchReport, runReportStep } from "../seo-performance/report";
import { PerformanceRepository } from "../seo-performance/repository";
import type { PerformanceDatabase, JobRecord } from "../seo-performance/repository";
import { PERFORMANCE_SCHEMA_SQL } from "../seo-performance/schema";
import { GoogleSearchClient } from "../seo-performance/google-client";

test("report filters use strict dates and equal previous periods", () => {
  const filters = normalizeReportFilters({ startDate: "2026-01-10", endDate: "2026-01-20", country: "USA" });
  assert.equal(filters.country, "usa");
  assert.throws(() => normalizeReportFilters({ startDate: "2026-02-30", endDate: "2026-03-02" }));
  assert.throws(() => normalizeReportFilters({ startDate: "2026-02-10", endDate: "2026-01-10" }));
  const request = buildReportRequest(filters, "previous", "total", 0);
  assert.equal(request.startDate, "2025-12-30");
  assert.equal(request.endDate, "2026-01-09");
  assert.equal(request.aggregationType, "byProperty");
});

test("PostgreSQL reports checkpoint, deduplicate, paginate and isolate stores", async () => {
  const database = await PGlite.create();
  const adapter: PerformanceDatabase = {
    query: async <Row,>(sql: string, values?: unknown[]) => {
      if (sql === PERFORMANCE_SCHEMA_SQL) { await database.exec(sql); return { rows: [], rowCount: 0 }; }
      const result = await database.query<Row>(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
    }, connect: async () => ({ query: adapter.query, release: () => {} }), end: () => database.close(),
  };
  const repository = new PerformanceRepository("", adapter);
  const filters = { startDate: "2026-01-10", endDate: "2026-01-20" };
  const google = new GoogleSearchClient(adapter, { enabled: true, databaseUrl: "", clientId: "", clientSecret: "", redirectUri: "", encryptionKey: "" });
  let calls = 0;
  google.request = async (_url, body) => {
    calls++;
    const request = body as { dimensions: string[]; startDate: string };
    return { rows: Array.from({ length: request.dimensions[0] === "query" ? 55 : 1 }, (_, index) => ({ keys: request.dimensions[0] === "date" ? [request.startDate] : [String(index)], clicks: index + 1, impressions: (index + 1) * 10, position: 5 })) };
  };
  try {
    await repository.initialize();
    await repository.map("a", "sc-domain:example.com", "https://example.com");
    await repository.map("b", "sc-domain:other.example", "https://other.example");
    await adapter.query("INSERT INTO sp_connection VALUES(1,'encrypted',false,'generation')");
    const first = await loadSearchReport(repository, "a", filters, {});
    assert.equal(first.current, null);
    assert.equal((await loadSearchReport(repository, "a", filters, { dimension: "page" })).jobId, first.jobId);
    assert.notEqual((await loadSearchReport(repository, "b", filters, {})).jobId, first.jobId);
    for (let index = 0; index < 12; index++) {
      const job = (await adapter.query<JobRecord>("SELECT * FROM sp_jobs WHERE id=$1", [first.jobId])).rows[0];
      const step = await runReportStep(repository, google, job, "sc-domain:example.com");
      if (index === 2) await runReportStep(repository, google, job, "sc-domain:example.com");
      await adapter.query("UPDATE sp_jobs SET payload=$2,status=$3,progress=$4 WHERE id=$1", [job.id, JSON.stringify(step.payload), step.done ? "done" : "running", step.progress]);
    }
    const report = await loadSearchReport(repository, "a", filters, {});
    assert.equal(report.rows.total, 55);
    assert.equal(report.rows.items.length, 50);
    assert.equal(report.rows.items[0].key, "54");
    assert.equal(report.rows.nextOffset, 50);
    assert.equal(report.current?.clicks, 1); // Never sum query rows into property KPI.
    assert.equal((await loadSearchReport(repository, "a", filters, { offset: 50 })).rows.items.length, 5);
    assert.equal(calls, 13); // Cache reads and pagination make no Google requests.
    await adapter.query("UPDATE sp_connection SET reconnect=true");
    await assert.rejects(loadSearchReport(repository, "a", filters, {}), /RECONNECT/);
  } finally { await database.close(); }
});

test("all dimensions share Google-side filters; page changes aggregation", () => {
  const filters = normalizeReportFilters({ startDate: "2026-01-10", endDate: "2026-01-20", country: "usa", device: "MOBILE", query: "blanket", page: "/products/" });
  for (const dimension of ["total", "date", "query", "page", "country", "device"] as const) {
    const request = buildReportRequest(filters, "current", dimension, 25000);
    assert.equal(request.dimensionFilterGroups[0].filters.length, 4);
    assert.equal(request.aggregationType, "auto");
    assert.equal(request.startRow, 25000);
    assert.equal(request.rowLimit, 25000);
    assert.equal(request.dataState, "final");
  }
});

test("report worker continues full API pages and surfaces the safety ceiling", async () => {
  const adapter: PerformanceDatabase = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => ({ query: adapter.query, release: () => {} }), end: async () => {} };
  const repository = new PerformanceRepository("", adapter);
  const google = new GoogleSearchClient(adapter, { enabled: true, databaseUrl: "", clientId: "", clientSecret: "", redirectUri: "", encryptionKey: "" });
  let size = 25000;
  let observedOffset = -1;
  google.request = async (_url, body) => {
    observedOffset = (body as { startRow: number }).startRow;
    return { rows: Array.from({ length: size }, (_, index) => ({ keys: [String(index)], clicks: 1, impressions: 10, position: 2 })) };
  };
  const job: JobRecord = { id: "test", store_id: "demo", kind: "report", status: "running", payload: { filters: { startDate: "2026-01-10", endDate: "2026-01-20" }, step: 2 }, progress: 0, attempts: 0, error: null, updated_at: new Date("2026-02-01") };
  const first = await runReportStep(repository, google, job, "sc-domain:example.com");
  assert.equal(first.payload.startRow, 25000);
  assert.equal(first.payload.step, 2);
  size = 0;
  const second = await runReportStep(repository, google, { ...job, payload: first.payload }, "sc-domain:example.com");
  assert.equal(observedOffset, 25000);
  assert.equal(second.payload.step, 3);
  assert.equal(second.payload.limited, false);
  size = 25000;
  const capped = await runReportStep(repository, google, { ...job, payload: { ...job.payload, startRow: 75000 } }, "sc-domain:example.com");
  assert.equal(capped.payload.limited, true);
  assert.equal(capped.payload.step, 3);
});

test("comparisons retain new/lost rows, sort before pagination, and avoid invented position", () => {
  const metric = (clicks: number) => ({ clicks, impressions: 100, ctr: clicks / 100, position: 8 });
  const rows = compareReportRows([{ key: "new", ...metric(30) }], [{ key: "lost", ...metric(20) }], "declining", "clicks");
  assert.equal(rows[0].key, "lost");
  assert.equal(rows[0].current, null);
  assert.equal(rows[0].delta.position, null);
  assert.equal(rows[0].delta.clicks, -20);
  assert.equal(rows.length, 1);
  assert.equal(compareReportRows([{ key: "new", ...metric(30) }], [], "growing", "clicks")[0].delta.clicks, 30);
});
