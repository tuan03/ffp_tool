import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import type { PageAudit, PerformanceIntegrationSummary, PerformanceMapping, PerformanceFilters, PerformanceList, PerformancePage, SearchMetrics, SeoRecommendation, RecommendationInput, PerformanceEvent, PerformanceJob } from "../../src/modules/seo-performance";
import { aggregateMetrics, opportunityReasons, pacificDate, shiftDate } from "./analytics";
import { digest } from "./google-client";
import { applyPerformanceMigrations } from "./migrations";
import { normalizePageUrl, pageKind } from "./url-policy";

export interface PageRecord { store_id: string; url: string; kind: PerformancePage["kind"]; product_id: string | null; source: Record<string, unknown> | null; snapshot_id: string | null; checked_at: Date | null; audit: PageAudit | null; inspection: unknown; inspected_at: Date | null }
export interface JobRecord { id: string; store_id: string; kind: PerformanceJob["kind"]; status: PerformanceJob["status"]; payload: Record<string, unknown>; progress: number; attempts: number; error: string | null; updated_at: Date }
interface RecommendationRecord { id: string; store_id: string; digest: string; payload: RecommendationInput; actor: string; status: SeoRecommendation["status"]; job_id: string | null; created_at: Date }
export const RULES_VERSION = "seo-performance-v1";
export interface PerformanceConnection {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  release(): void;
}
export interface PerformanceDatabase {
  query: PerformanceConnection["query"];
  connect(): Promise<PerformanceConnection>;
  end(): Promise<void>;
}
export class PerformanceRepository {
  readonly pool: PerformanceDatabase;
  private initialization?: Promise<void>;
  constructor(databaseUrl: string, database?: PerformanceDatabase) { this.pool = database ?? new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 30000 }); }
  async initialize(): Promise<void> {
    if (!this.initialization) this.initialization = applyPerformanceMigrations(this.pool).catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }
  async transaction<T>(run: (client: PerformanceConnection) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async mapping(storeId: string): Promise<PerformanceMapping | null> {
    const current = (await this.pool.query<{
      store_id: string; mapping_revision: number; connection_id: string | null; gsc_property_raw: string;
      storefront_origin: string; timezone: string | null; last_sync: Date | null;
    }>(`SELECT integration.store_id,integration.mapping_revision,integration.connection_id,integration.gsc_property_raw,
        integration.storefront_origin,integration.timezone,mapping.last_sync
      FROM sp_store_integrations integration
      LEFT JOIN sp_mappings mapping ON mapping.store_id=integration.store_id AND mapping.property=integration.gsc_property_raw
      WHERE integration.store_id=$1 AND integration.source='GSC' AND integration.is_current`, [storeId])).rows[0];
    if (current) return {
      storeId: current.store_id,
      property: current.gsc_property_raw,
      origin: current.storefront_origin,
      lastSync: current.last_sync?.toISOString() ?? null,
      mappingRevision: current.mapping_revision,
      gscConnectionId: current.connection_id,
      timeZone: current.timezone,
    };
    const row = (await this.pool.query<{ store_id: string; property: string; origin: string; last_sync: Date | null }>("SELECT * FROM sp_mappings WHERE store_id=$1", [storeId])).rows[0];
    return row ? { storeId: row.store_id, property: row.property, origin: row.origin, lastSync: row.last_sync?.toISOString() ?? null } : null;
  }
  async requireMapping(storeId: string): Promise<PerformanceMapping> { const mapping = await this.mapping(storeId); if (!mapping) throw new Error("GSC_MAPPING_REQUIRED"); return mapping; }
  async map(storeId: string, property: string, origin: string): Promise<void> {
    // Rebinding existing analytics to another property would misattribute history.
    const existing = await this.mapping(storeId);
    if (existing && (existing.property !== property || existing.origin !== origin)) throw new Error("MAPPING_CHANGE_REQUIRES_NEW_HISTORY");
    await this.pool.query("INSERT INTO sp_mappings(store_id,property,origin) VALUES($1,$2,$3) ON CONFLICT(store_id) DO NOTHING", [storeId, property, origin]);
  }
  async connectionFor(storeId: string, source: "GSC" | "GA4"): Promise<string> {
    const mapped = (await this.pool.query<{ connection_id: string }>(
      "SELECT connection_id FROM sp_store_integrations WHERE store_id=$1 AND source=$2 AND is_current AND connection_id IS NOT NULL",
      [storeId, source],
    )).rows[0];
    if (mapped) return mapped.connection_id;
    const consented = (await this.pool.query<{ connection_id: string }>(
      `SELECT connection_id FROM sp_oauth_states_v2
       WHERE store_id=$1 AND consumed_at IS NOT NULL AND connection_id IS NOT NULL AND $2=ANY(requested_sources)
       ORDER BY consumed_at DESC LIMIT 1`,
      [storeId, source],
    )).rows[0];
    if (!consented) throw new Error("GOOGLE_CONNECTION_REQUIRED");
    return consented.connection_id;
  }
  async integrations(storeId: string): Promise<readonly PerformanceIntegrationSummary[]> {
    const rows = (await this.pool.query<{
      source: "GSC" | "GA4"; status: PerformanceIntegrationSummary["status"]; connection_id: string | null;
      mapping_revision: number; gsc_property_raw: string | null; ga4_property_id: string | null;
      storefront_origin: string; stream_id: string | null; hostname_scope: string | null; timezone: string | null;
      currency: string | null; last_sync: Date | null;
    }>(`SELECT integration.*,mapping.last_sync FROM sp_store_integrations integration
      LEFT JOIN sp_mappings mapping ON mapping.store_id=integration.store_id AND integration.source='GSC'
      WHERE integration.store_id=$1 AND integration.is_current ORDER BY integration.source`, [storeId])).rows;
    const bySource = new Map(rows.map(row => [row.source, row]));
    const latestConnection = async (source: "GSC" | "GA4"): Promise<string | null> => {
      try { return await this.connectionFor(storeId, source); } catch { return null; }
    };
    const summaries: PerformanceIntegrationSummary[] = [];
    for (const source of ["GSC", "GA4"] as const) {
      const row = bySource.get(source);
      const freshness = {
        dataThrough: row?.last_sync?.toISOString().slice(0, 10) ?? null,
        fetchedAt: row?.last_sync?.toISOString() ?? null,
        lastSuccessfulSync: row?.last_sync?.toISOString() ?? null,
        stale: !row?.last_sync || Date.now() - row.last_sync.getTime() > 4 * 86400000,
        staleReason: !row?.last_sync ? "NEVER_SYNCED" : Date.now() - row.last_sync.getTime() > 4 * 86400000 ? "SOURCE_STALE" : null,
      };
      const connectionId = row?.connection_id ?? await latestConnection(source);
      if (source === "GSC") summaries.push({ source: "gsc", status: row?.status ?? "NOT_CONFIGURED", connectionId, mappingRevision: row?.mapping_revision ?? null, origin: row?.storefront_origin ?? null, freshness, quality: [], property: row?.gsc_property_raw ?? null });
      else summaries.push({ source: "ga4", status: row?.status ?? "NOT_CONFIGURED", connectionId, mappingRevision: row?.mapping_revision ?? null, origin: row?.storefront_origin ?? null, freshness, quality: [], property: row?.ga4_property_id && row.hostname_scope && row.timezone && row.currency ? { propertyId: row.ga4_property_id, streamId: row.stream_id, hostnameScope: row.hostname_scope, timeZone: row.timezone, currencyCode: row.currency } : null });
    }
    return summaries;
  }
  async mapIntegration(input: {
    readonly storeId: string; readonly source: "GSC" | "GA4"; readonly connectionId: string;
    readonly origin: string; readonly gscProperty?: string; readonly ga4PropertyId?: string;
    readonly streamId?: string; readonly hostnameScope?: string; readonly timeZone?: string; readonly currencyCode?: string;
  }): Promise<number> {
    if (input.source === "GSC" && !input.gscProperty) throw new Error("GSC_PROPERTY_REQUIRED");
    if (input.source === "GA4" && (!input.ga4PropertyId || !/^\d+$/.test(input.ga4PropertyId) || !input.hostnameScope || !input.timeZone || !input.currencyCode)) throw new Error("GA4_MAPPING_REQUIRED");
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sp-mapping:${input.storeId}:${input.source}`]);
      const connection = (await client.query<{ status: string }>("SELECT status FROM sp_google_connections WHERE id=$1 FOR UPDATE", [input.connectionId])).rows[0];
      if (!connection || connection.status !== "CONNECTED") throw new Error("GOOGLE_CONNECTION_REQUIRED");
      const previous = (await client.query<{ mapping_revision: number }>("SELECT mapping_revision FROM sp_store_integrations WHERE store_id=$1 AND source=$2 AND is_current FOR UPDATE", [input.storeId, input.source])).rows[0];
      const revision = (previous?.mapping_revision ?? 0) + 1;
      if (previous) await client.query("UPDATE sp_store_integrations SET is_current=false,retired_at=now() WHERE store_id=$1 AND source=$2 AND is_current", [input.storeId, input.source]);
      await client.query(`INSERT INTO sp_store_integrations(
        store_id,source,mapping_revision,connection_id,status,gsc_property_raw,ga4_property_id,
        storefront_origin,stream_id,hostname_scope,timezone,currency,verified_at
      ) VALUES($1,$2,$3,$4,'CONNECTED',$5,$6,$7,$8,$9,$10,$11,now())`, [
        input.storeId, input.source, revision, input.connectionId, input.gscProperty ?? null,
        input.ga4PropertyId ?? null, input.origin, input.streamId ?? null, input.hostnameScope ?? null,
        input.timeZone ?? (input.source === "GSC" ? "America/Los_Angeles" : null), input.currencyCode ?? null,
      ]);
      return revision;
    });
  }
  async range(storeId: string, filters: PerformanceFilters = {}): Promise<{ start: string; end: string; previousStart: string; previousEnd: string }> {
    const latest = (await this.pool.query<{ day: string | null }>("SELECT max(day)::text AS day FROM sp_days WHERE store_id=$1 AND dataset='property' AND complete=true", [storeId])).rows[0]?.day;
    const end = filters.endDate ?? latest ?? shiftDate(pacificDate(new Date()), -3);
    const start = filters.startDate ?? shiftDate(end, -27);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) throw new Error("INVALID_DATE_RANGE");
    const length = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (length < 1 || length > 90 || end > pacificDate(new Date())) throw new Error("INVALID_DATE_RANGE");
    return { start, end, previousStart: shiftDate(start, -length), previousEnd: shiftDate(start, -1) };
  }
  async metrics(storeId: string, start: string, end: string, dataset: "property" | "page", page = ""): Promise<SearchMetrics | null> {
    if (!await this.hasCompletePeriod(storeId, start, end, dataset)) return null;
    const rows = await this.pool.query<{ clicks: number; impressions: number; position: number }>("SELECT m.clicks,m.impressions,m.position FROM sp_metrics m JOIN sp_days d USING(store_id,day,dataset) WHERE m.store_id=$1 AND m.day BETWEEN $2 AND $3 AND m.dataset=$4 AND m.page=$5 AND d.complete", [storeId, start, end, dataset, page]);
    return aggregateMetrics(rows.rows);
  }
  async hasCompletePeriod(storeId: string, start: string, end: string, dataset: string): Promise<boolean> {
    const count = Number((await this.pool.query<{ count: string }>("SELECT count(*) AS count FROM sp_days WHERE store_id=$1 AND day BETWEEN $2 AND $3 AND dataset=$4 AND complete", [storeId, start, end, dataset])).rows[0].count);
    return count === (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  }
  async putDiscoveredPages(storeId: string, rawUrls: readonly string[]): Promise<void> {
    const mapping = await this.requireMapping(storeId);
    const pages = [...new Set(rawUrls)].flatMap(rawUrl => {
      try {
        const url = normalizePageUrl(rawUrl);
        return new URL(url).origin === mapping.origin && url.length <= 2000 ? [{ url, kind: pageKind(url) }] : [];
      } catch { return []; }
    });
    await this.pool.query("INSERT INTO sp_pages(store_id,url,kind) SELECT $1,x.url,x.kind FROM jsonb_to_recordset($2::jsonb) AS x(url text,kind text) ON CONFLICT(store_id,url) DO NOTHING", [storeId, JSON.stringify(pages)]);
  }
  async putPage(storeId: string, rawUrl: string, source?: Record<string, unknown>): Promise<void> {
    const mapping = await this.requireMapping(storeId);
    const url = normalizePageUrl(rawUrl);
    if (url.length > 2000) throw new Error("PAGE_URL_TOO_LONG");
    if (new URL(url).origin !== mapping.origin) return;
    await this.pool.query("INSERT INTO sp_pages(store_id,url,kind,product_id,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(store_id,url) DO UPDATE SET product_id=COALESCE(excluded.product_id,sp_pages.product_id),source=COALESCE(excluded.source,sp_pages.source)", [storeId, url, pageKind(url), typeof source?.id === "string" ? source.id : null, source ? JSON.stringify(source) : null]);
  }
  async page(storeId: string, rawUrl: string, executor: Pick<PerformanceDatabase, "query"> = this.pool): Promise<PageRecord> {
    const row = (await executor.query<PageRecord>("SELECT * FROM sp_pages WHERE store_id=$1 AND url=$2", [storeId, normalizePageUrl(rawUrl)])).rows[0];
    if (!row) throw new Error("PAGE_NOT_FOUND");
    return row;
  }
  async saveAudit(storeId: string, url: string, audit: PageAudit): Promise<void> {
    const page = await this.page(storeId, url);
    const snapshotId = digest(JSON.stringify({ storeId, url, audit, source: page.source }));
    await this.transaction(async client => {
      await client.query("INSERT INTO sp_snapshots(id,store_id,url,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [snapshotId, storeId, url, JSON.stringify({ audit, source: page.source })]);
      await client.query("UPDATE sp_pages SET snapshot_id=$3,checked_at=now(),audit=$4 WHERE store_id=$1 AND url=$2", [storeId, url, snapshotId, JSON.stringify(audit)]);
    });
  }
  async pages(storeId: string, filters: PerformanceFilters = {}): Promise<PerformanceList<PerformancePage>> {
    const range = await this.range(storeId, filters);
    const where = "p.store_id=$1 AND ($2::text IS NULL OR p.kind=$2) AND ($3='' OR strpos(lower(p.url),lower($3))>0)";
    const parameters = [storeId, filters.kind ?? null, filters.search ?? ""];
    const total = Number((await this.pool.query<{ total: string }>(`SELECT count(*) AS total FROM sp_pages p WHERE ${where}`, parameters)).rows[0].total);
    const rows = await this.pool.query<PageRecord>(`SELECT p.* FROM sp_pages p WHERE ${where} ORDER BY p.url LIMIT 50 OFFSET $4`, [...parameters, filters.offset ?? 0]);
    // One aggregate query for all URLs in this page, not one network call per product.
    const metrics = await this.pool.query<{ page: string; period: string; clicks: number; impressions: number; position: number }>("SELECT m.page,CASE WHEN m.day >= $2::date THEN 'current' ELSE 'previous' END AS period,sum(m.clicks)::float8 AS clicks,sum(m.impressions)::float8 AS impressions,COALESCE(sum(m.position*m.impressions)/NULLIF(sum(m.impressions),0),0)::float8 AS position FROM sp_metrics m JOIN sp_days d USING(store_id,day,dataset) WHERE m.store_id=$1 AND m.day BETWEEN $3 AND $4 AND m.dataset='page' AND d.complete AND m.page=ANY($5::text[]) GROUP BY m.page,period", [storeId, range.start, range.previousStart, range.end, rows.rows.map(row => row.url)]);
    const peers = await this.pool.query<{ kind: string; bucket: number; ctr: number }>("SELECT kind,floor(position/5)::int AS bucket,percentile_cont(0.5) WITHIN GROUP(ORDER BY clicks/NULLIF(impressions,0)) AS ctr FROM (SELECT p.kind,m.page,sum(m.clicks) AS clicks,sum(m.impressions) AS impressions,sum(m.position*m.impressions)/NULLIF(sum(m.impressions),0) AS position FROM sp_metrics m JOIN sp_days d USING(store_id,day,dataset) JOIN sp_pages p ON p.store_id=m.store_id AND p.url=m.page WHERE m.store_id=$1 AND m.day BETWEEN $2 AND $3 AND m.dataset='page' AND d.complete GROUP BY p.kind,m.page HAVING sum(m.impressions)>=100) x GROUP BY kind,bucket HAVING count(*)>=5", [storeId, range.start, range.end]);
    const currentComplete = await this.hasCompletePeriod(storeId, range.start, range.end, "page");
    const previousComplete = await this.hasCompletePeriod(storeId, range.previousStart, range.previousEnd, "page");
    const items = rows.rows.map(row => {
      const current = currentComplete ? aggregateMetrics(metrics.rows.filter(metric => metric.page === row.url && metric.period === "current")) : null;
      const previous = previousComplete ? aggregateMetrics(metrics.rows.filter(metric => metric.page === row.url && metric.period === "previous")) : null;
      const peer = peers.rows.find(peer => peer.kind === row.kind && peer.bucket === Math.floor((current?.position ?? 0) / 5));
      return { url: row.url, kind: row.kind, productId: row.product_id, snapshotId: row.snapshot_id, checkedAt: row.checked_at?.toISOString() ?? null, audit: row.audit, current, previous, opportunities: [...opportunityReasons(current, previous, peer?.ctr ?? null), ...(row.audit?.findings.map(finding => finding.code) ?? [])] };
    });
    const next = (filters.offset ?? 0) + items.length;
    return { items, total, nextOffset: next < total ? next : null };
  }
  async queries(storeId: string, url: string, filters: PerformanceFilters = {}): Promise<PerformanceList<{ query: string; metrics: SearchMetrics }>> {
    const { start, end } = await this.range(storeId, filters);
    const base = "FROM sp_metrics m JOIN sp_days d USING(store_id,day,dataset) WHERE m.store_id=$1 AND m.page=$2 AND m.dataset='query' AND m.day BETWEEN $3 AND $4 AND d.complete";
    const values = [storeId, normalizePageUrl(url), start, end];
    const total = Number((await this.pool.query<{ total: string }>(`SELECT count(DISTINCT query) AS total ${base}`, values)).rows[0].total);
    const rows = (await this.pool.query<{ query: string; clicks: number; impressions: number; position: number }>(`SELECT query,sum(clicks)::float8 AS clicks,sum(impressions)::float8 AS impressions,COALESCE(sum(position*impressions)/NULLIF(sum(impressions),0),0)::float8 AS position ${base} GROUP BY query ORDER BY impressions DESC,query LIMIT 50 OFFSET $5`, [...values, filters.offset ?? 0])).rows;
    const items = rows.map(row => ({ query: row.query, metrics: { clicks: row.clicks, impressions: row.impressions, position: row.position, ctr: row.impressions ? row.clicks / row.impressions : 0 } }));
    return { items, total, nextOffset: (filters.offset ?? 0) + items.length < total ? (filters.offset ?? 0) + items.length : null };
  }
  async startJob(storeId: string, kind: PerformanceJob["kind"], requestKey: string, payload: Record<string, unknown> = {}): Promise<{ jobId: string }> {
    if (kind === "ga4_sync") {
      const mapping = await this.pool.query("SELECT 1 FROM sp_store_integrations WHERE store_id=$1 AND source='GA4' AND is_current AND status='CONNECTED'", [storeId]);
      if (!mapping.rowCount) throw new Error("GA4_MAPPING_REQUIRED");
    } else await this.requireMapping(storeId);
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sp-job:${storeId}:${kind}`]);
      const existing = (await client.query<{ id: string }>("SELECT id FROM sp_jobs WHERE store_id=$1 AND kind=$2 AND (request_key=$3 OR (kind IN ('sync','gsc_sync','ga4_sync','crawl','benchmark','recommendation','health') AND status IN ('pending','running'))) ORDER BY updated_at DESC LIMIT 1", [storeId, kind, requestKey])).rows[0];
      if (existing) return { jobId: existing.id };
      const jobId = randomUUID();
      await client.query("INSERT INTO sp_jobs(id,store_id,kind,request_key,payload) VALUES($1,$2,$3,$4,$5)", [jobId, storeId, kind, requestKey, JSON.stringify(payload)]);
      return { jobId };
    });
  }
  async jobs(storeId: string): Promise<PerformanceJob[]> {
    return (await this.pool.query<JobRecord>("SELECT * FROM sp_jobs WHERE store_id=$1 ORDER BY updated_at DESC LIMIT 10", [storeId])).rows.map(row => ({ id: row.id, kind: row.kind, status: row.status, progress: row.progress, error: row.error, updatedAt: row.updated_at.toISOString() }));
  }
  async event(storeId: string, event: string, details: Readonly<Record<string, unknown>>): Promise<void> { await this.pool.query("INSERT INTO sp_events(store_id,event,details) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [storeId, event, JSON.stringify(details)]); }
  async recommendations(storeId: string, offset = 0): Promise<PerformanceList<SeoRecommendation>> {
    const total = Number((await this.pool.query<{ total: string }>("SELECT count(*) AS total FROM sp_recommendations WHERE store_id=$1", [storeId])).rows[0].total);
    const rows = (await this.pool.query<RecommendationRecord>("SELECT * FROM sp_recommendations WHERE store_id=$1 ORDER BY created_at DESC,id LIMIT 50 OFFSET $2", [storeId, offset])).rows;
    const items = rows.map(row => ({ ...row.payload, id: row.id, actor: row.actor, status: row.status, jobId: row.job_id, createdAt: row.created_at.toISOString() }));
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
  }
  async recommendation(storeId: string, id: string, transaction?: PerformanceConnection): Promise<RecommendationRecord> {
    const row = (await (transaction ?? this.pool).query<RecommendationRecord>(`SELECT * FROM sp_recommendations WHERE store_id=$1 AND id=$2${transaction ? " FOR UPDATE" : ""}`, [storeId, id])).rows[0];
    if (!row) throw new Error("RECOMMENDATION_NOT_FOUND");
    return row;
  }
  async saveRecommendation(storeId: string, actor: string, input: RecommendationInput, rulesVersion: string): Promise<{ id: string }> {
    const fingerprint = digest(JSON.stringify(input));
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sp-rec:${storeId}:${actor}:${input.requestId}`]);
      const existing = (await client.query<{ id: string; digest: string }>("SELECT id,digest FROM sp_recommendations WHERE store_id=$1 AND actor=$2 AND request_id=$3", [storeId, actor, input.requestId])).rows[0];
      if (existing) { if (existing.digest !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT"); return { id: existing.id }; }
      const page = (await client.query<PageRecord>("SELECT * FROM sp_pages WHERE store_id=$1 AND url=$2 FOR UPDATE", [storeId, input.url])).rows[0];
      if (!page || page.snapshot_id !== input.snapshotId || !page.audit || input.rulesVersion !== rulesVersion) throw new Error("STALE_SEO_EVIDENCE");
      if (!page.checked_at || Date.now() - page.checked_at.getTime() > 7 * 86400000) throw new Error("STALE_SEO_EVIDENCE");
      const id = randomUUID();
      await client.query("INSERT INTO sp_recommendations(id,store_id,request_id,digest,url,snapshot_id,payload,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id, storeId, input.requestId, fingerprint, input.url, input.snapshotId, JSON.stringify(input), actor]);
      return { id };
    });
  }
  async history(storeId: string, offset = 0): Promise<PerformanceList<PerformanceEvent>> {
    const total = Number((await this.pool.query<{ total: string }>("SELECT count(*) AS total FROM sp_events WHERE store_id=$1", [storeId])).rows[0].total);
    const items = (await this.pool.query<{ id: string; event: string; created_at: Date; details: Record<string, unknown> }>("SELECT * FROM sp_events WHERE store_id=$1 ORDER BY id DESC LIMIT 50 OFFSET $2", [storeId, offset])).rows.map(row => ({ id: row.id, event: row.event, createdAt: row.created_at.toISOString(), details: row.details }));
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
  }
}
