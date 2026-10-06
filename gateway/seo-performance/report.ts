import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { SearchMetrics, SearchReport, SearchReportDimension, SearchReportFilters, SearchReportRow, SearchReportView } from "../../src/modules/seo-performance";
import { pacificDate, shiftDate } from "./analytics";
import { digest, searchRowSchema } from "./google-client";
import type { GoogleSearchClient } from "./google-client";
import type { JobRecord, PerformanceRepository } from "./repository";

const textFilter = z.string().trim().max(1000).refine(value => !value.includes("\0"));
export const reportFiltersSchema = z.object({ startDate: z.string().date(), endDate: z.string().date(), country: z.string().regex(/^[a-zA-Z]{3}$/).transform(value => value.toLowerCase()).optional(), device: z.enum(["DESKTOP", "MOBILE", "TABLET"]).optional(), query: textFilter.optional(), page: textFilter.optional() }).strict();
export const reportViewSchema = z.object({ dimension: z.enum(["date", "query", "page", "country", "device"]).default("query"), order: z.enum(["top", "growing", "declining"]).default("top"), metric: z.enum(["clicks", "impressions", "ctr", "position"]).default("clicks"), offset: z.number().int().min(0).max(100000).default(0) }).strict();
const DIMENSIONS = ["total", "date", "query", "page", "country", "device"] as const;
const ROW_CAP = 100000;
interface MetricRow extends SearchMetrics { key: string }
export function normalizeReportFilters(raw: unknown): SearchReportFilters {
  const parsed = reportFiltersSchema.parse(raw);
  const days = (Date.parse(parsed.endDate) - Date.parse(parsed.startDate)) / 86400000 + 1;
  if (days < 1 || days > 90 || parsed.endDate > shiftDate(pacificDate(new Date()), -3)) throw new Error("INVALID_DATE_RANGE");
  return { startDate: parsed.startDate, endDate: parsed.endDate, ...(parsed.country ? { country: parsed.country } : {}), ...(parsed.device ? { device: parsed.device } : {}), ...(parsed.query ? { query: parsed.query } : {}), ...(parsed.page ? { page: parsed.page } : {}) };
}
function previousPeriod(filters: SearchReportFilters): { start: string; end: string } {
  const days = (Date.parse(filters.endDate) - Date.parse(filters.startDate)) / 86400000 + 1;
  return { start: shiftDate(filters.startDate, -days), end: shiftDate(filters.startDate, -1) };
}
export function buildReportRequest(filters: SearchReportFilters, period: "current" | "previous", dimension: SearchReportDimension, startRow: number) {
  const previous = previousPeriod(filters);
  const dimensionFilters = (["country", "device", "query", "page"] as const).flatMap(key => filters[key] ? [{ dimension: key, operator: key === "query" || key === "page" ? "contains" : "equals", expression: filters[key] }] : []);
  return { startDate: period === "current" ? filters.startDate : previous.start, endDate: period === "current" ? filters.endDate : previous.end, dimensions: dimension === "total" ? [] : [dimension], dimensionFilterGroups: [{ groupType: "and", filters: dimensionFilters }], aggregationType: dimension === "page" || filters.page ? "auto" : "byProperty", type: "web", dataState: "final", rowLimit: 25000, startRow };
}
export function compareReportRows(current: readonly MetricRow[], previous: readonly MetricRow[], order: SearchReportView["order"] = "top", metric: keyof SearchMetrics = "clicks"): SearchReportRow[] {
  const now = new Map(current.map(row => [row.key, row]));
  const before = new Map(previous.map(row => [row.key, row]));
  const rows = [...new Set([...now.keys(), ...before.keys()])].map(key => {
    const current = now.get(key) ?? null; const previous = before.get(key) ?? null;
    return { key, current, previous, delta: { clicks: (current?.clicks ?? 0) - (previous?.clicks ?? 0), impressions: (current?.impressions ?? 0) - (previous?.impressions ?? 0), ctr: current && previous ? current.ctr - previous.ctr : null, position: current && previous ? current.position - previous.position : null } };
  });
  const score = (row: SearchReportRow) => order === "top" ? row.current?.[metric] ?? -Infinity : row.delta[metric] ?? (order === "declining" ? Infinity : -Infinity);
  // For position, negative delta is improvement. Missing values always sort last.
  const ranked = order === "top" ? rows : rows.filter(row => {
    const delta = row.delta[metric];
    return delta !== null && (order === "growing" ? 1 : -1) * (metric === "position" ? -1 : 1) * delta > 0;
  });
  return ranked.sort((a, b) => {
    if (order === "top" && (!a.current || !b.current)) return a.current === b.current ? a.key.localeCompare(b.key) : a.current ? -1 : 1;
    if (order !== "top" && (a.delta[metric] === null || b.delta[metric] === null)) return a.delta[metric] === b.delta[metric] ? a.key.localeCompare(b.key) : a.delta[metric] === null ? 1 : -1;
    const direction = order === "declining" ? 1 : -1;
    return (score(a) - score(b)) * direction * (metric === "position" ? -1 : 1) || a.key.localeCompare(b.key);
  });
}

export async function loadSearchReport(repository: PerformanceRepository, storeId: string, rawFilters: unknown, rawView: unknown): Promise<SearchReport> {
  const filters = normalizeReportFilters(rawFilters); const view = reportViewSchema.parse(rawView);
  const mapping = await repository.requireMapping(storeId);
  let generation: string | undefined;
  if (mapping.gscConnectionId) {
    const googleConn = (await repository.pool.query<{ generation: string; status: string }>(
      "SELECT generation, status FROM sp_google_connections WHERE id=$1",
      [mapping.gscConnectionId],
    )).rows[0];
    if (googleConn && googleConn.status === "CONNECTED") {
      generation = googleConn.generation;
    }
  }
  if (!generation) {
    const legacyConn = (await repository.pool.query<{ generation: string; reconnect: boolean }>(
      "SELECT generation, reconnect FROM sp_connection WHERE id=1",
    )).rows[0];
    if (!legacyConn || legacyConn.reconnect) throw new Error("GSC_RECONNECT_REQUIRED");
    generation = legacyConn.generation;
  }
  const fingerprint = digest(JSON.stringify({ property: mapping.property, filters, generation }));
  const job = await repository.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sp-report:${storeId}`]);
    const existing = (await client.query<JobRecord>("SELECT * FROM sp_jobs WHERE store_id=$1 AND kind='report' AND payload->>'fingerprint'=$2 AND (status IN ('pending','running') OR (status='done' AND updated_at>now()-interval '24 hours') OR (status='failed' AND updated_at>now()-interval '1 minute')) ORDER BY updated_at DESC LIMIT 1", [storeId, fingerprint])).rows[0];
    if (existing) return existing;
    const active = Number((await client.query<{ count: string }>("SELECT count(*) AS count FROM sp_jobs WHERE store_id=$1 AND kind='report' AND status IN ('pending','running')", [storeId])).rows[0].count);
    if (active >= 3) throw new Error("REPORT_QUEUE_FULL");
    const id = randomUUID();
    return (await client.query<JobRecord>("INSERT INTO sp_jobs(id,store_id,kind,request_key,payload) VALUES($1,$2,'report',$1,$3) RETURNING *", [id, storeId, JSON.stringify({ filters, fingerprint })])).rows[0];
  });
  const previous = previousPeriod(filters);
  const syncError = (await repository.pool.query<{ error: string | null }>("SELECT error FROM sp_jobs WHERE store_id=$1 AND kind='sync' ORDER BY updated_at DESC LIMIT 1", [storeId])).rows[0]?.error;
  const base = { jobId: job.id, status: job.status, progress: job.progress, error: job.error ?? syncError ?? null, fetchedAt: job.status === "done" ? job.updated_at.toISOString() : null, stale: job.status !== "done" || Boolean(job.error || syncError), property: mapping.property, filters, previousStart: previous.start, previousEnd: previous.end, limited: Boolean(job.payload.limited) };
  if (job.status !== "done") return { ...base, current: null, previous: null, timeline: [], rows: { items: [], total: 0, nextOffset: null } };
  const records = (await repository.pool.query<{ period: string; dimension: string; row_key: string; clicks: number; impressions: number; position: number }>("SELECT * FROM sp_report_rows WHERE job_id=$1 AND dimension=ANY($2::text[])", [job.id, ["total", "date", view.dimension]])).rows;
  const getRows = (dimension: string, period: string): MetricRow[] => records.filter(row => row.dimension === dimension && row.period === period).map(row => ({ key: row.row_key, clicks: row.clicks, impressions: row.impressions, position: row.position, ctr: row.impressions ? row.clicks / row.impressions : 0 }));
  const timeline = compareReportRows(getRows("date", "current"), getRows("date", "previous").map(row => ({ ...row, key: shiftDate(row.key, (Date.parse(filters.startDate) - Date.parse(previous.start)) / 86400000) }))).sort((a, b) => a.key.localeCompare(b.key));
  const rows = view.dimension === "date" ? timeline : compareReportRows(getRows(view.dimension, "current"), getRows(view.dimension, "previous"), view.order, view.metric);
  return { ...base, current: getRows("total", "current")[0] ?? null, previous: getRows("total", "previous")[0] ?? null, timeline, rows: { items: rows.slice(view.offset, view.offset + 50), total: rows.length, nextOffset: view.offset + 50 < rows.length ? view.offset + 50 : null } };
}

export async function runReportStep(repository: PerformanceRepository, google: GoogleSearchClient, job: JobRecord, property: string) {
  const filters = normalizeReportFilters(job.payload.filters);
  const step = Number(job.payload.step ?? 0); const startRow = Number(job.payload.startRow ?? 0);
  const dimension = DIMENSIONS[step % DIMENSIONS.length]; const period = step < DIMENSIONS.length ? "current" : "previous";
  const request = buildReportRequest(filters, period, dimension, startRow);
  const response = z.object({ rows: z.array(searchRowSchema).default([]) }).parse(await google.request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, request));
  const capped = startRow + response.rows.length >= ROW_CAP;
  const complete = response.rows.length < 25000 || capped;
  await repository.transaction(async client => {
    if (!startRow) await client.query("DELETE FROM sp_report_rows WHERE job_id=$1 AND period=$2 AND dimension=$3", [job.id, period, dimension]);
    await client.query("INSERT INTO sp_report_rows(job_id,period,dimension,row_key,clicks,impressions,position) SELECT $1,$2,$3,x.key,x.clicks,x.impressions,x.position FROM jsonb_to_recordset($4::jsonb) AS x(key text,clicks float8,impressions float8,position float8) ON CONFLICT(job_id,period,dimension,key_hash) DO UPDATE SET clicks=excluded.clicks,impressions=excluded.impressions,position=excluded.position", [job.id, period, dimension, JSON.stringify(response.rows.map(row => ({ ...row, key: row.keys?.[0] ?? "" })))]);
  });
  const next = complete ? step + 1 : step;
  return { done: next === 12, progress: Math.floor(next / 12 * 100), payload: { ...job.payload, step: next, startRow: complete ? 0 : startRow + response.rows.length, limited: Boolean(job.payload.limited) || capped }, delay: 1 };
}
