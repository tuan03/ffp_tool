import { randomUUID } from "node:crypto";

import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

import type { PerformanceMapping } from "../../src/modules/seo-performance";
import { pacificDate, shiftDate } from "./analytics";
import { Ga4DataClient } from "./ga4-client";
import type { Ga4PanelKind } from "./ga4-contracts";
import { digest } from "./google-client";
import type { GoogleSearchClient } from "./google-client";
import { inspectHtml } from "./page-audit";
import { crawlDelay, fetchPublicDocument, isCrawlAllowed, loadRobots } from "./public-fetch";
import type { JobRecord, PerformanceRepository } from "./repository";
import { normalizePageUrl } from "./url-policy";
import { runReportStep } from "./report";
import { deriveInspectionState, normalizeUrlInspection } from "./url-inspection";

export interface PerformanceSourceReader {
  readonly products: (storeId: string, cursor?: string) => Promise<{ products: Record<string, unknown>[]; cursor: string | null }>;
  readonly product: (storeId: string, id: string) => Promise<Record<string, unknown>>;
  readonly summary: (storeId: string, id: string) => Promise<string | undefined>;
}
export class PerformanceWorker {
  constructor(private readonly repository: PerformanceRepository, private readonly google: GoogleSearchClient, private readonly source: PerformanceSourceReader) {}
  async tick(): Promise<void> {
    const repository = this.repository;
    await repository.initialize();
    // One connection-scoped lock fences all job steps, including their HTTP side effects.
    const lock = await repository.pool.connect();
    try {
      const acquired = (await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('ffp-performance-worker')) AS locked")).rows[0].locked;
      if (!acquired) return;
      try {
        const connected = await lock.query("SELECT 1 FROM sp_connection WHERE id=1 AND NOT reconnect");
        if (connected.rowCount) {
          const stores = await lock.query<{ store_id: string }>("SELECT store_id FROM sp_mappings WHERE last_sync IS NULL OR last_sync < now()-interval '1 day'");
          for (const store of stores.rows) await repository.startJob(store.store_id, "sync", `daily:${pacificDate(new Date())}`);
        }
        const job = (await lock.query<JobRecord>("SELECT * FROM sp_jobs WHERE status IN ('pending','running') AND next_at<=now() ORDER BY next_at,id LIMIT 1")).rows[0];
        if (!job) return;
        await lock.query("UPDATE sp_jobs SET status='running',updated_at=now() WHERE id=$1", [job.id]);
        try {
          const mapping = job.kind === "ga4_sync" ? null : await repository.requireMapping(job.store_id);
          const outcome = job.kind === "ga4_sync" ? await this.ga4Sync(job)
            : job.kind === "report" ? await runReportStep(repository, this.google, job, mapping!.property)
              : job.kind === "sync" || job.kind === "gsc_sync" ? await this.sync(job, mapping!)
                : job.kind === "crawl" ? await this.crawl(job, mapping!) : await this.inspection(job, mapping!);
          await lock.query("UPDATE sp_jobs SET status=$2,payload=$3,progress=$4,attempts=0,error=NULL,next_at=now()+($5 * interval '1 second'),updated_at=now() WHERE id=$1", [job.id, outcome.done ? "done" : "running", JSON.stringify(outcome.payload), outcome.progress, outcome.delay ?? 1]);
          if (outcome.done) await repository.event(job.store_id, `${job.kind.toUpperCase()}_COMPLETED`, { jobId: job.id, ...outcome.payload });
        } catch (error) {
          const code = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : "PERFORMANCE_JOB_FAILED";
          const retry = job.attempts < 4 && !["GSC_RECONNECT_REQUIRED", "INSPECTION_DAILY_LIMIT", "PAGE_NOT_FOUND", "CRAWL_ADDRESS_FORBIDDEN", "CRAWL_ORIGIN_FORBIDDEN"].includes(code);
          await lock.query("UPDATE sp_jobs SET status=$2,error=$3,attempts=attempts+1,next_at=now()+($4 * interval '1 second'),updated_at=now() WHERE id=$1", [job.id, retry ? "pending" : "failed", code, Math.min(3600, 60 * 2 ** job.attempts)]);
        }
      } finally { await lock.query("SELECT pg_advisory_unlock(hashtext('ffp-performance-worker'))"); }
    } finally { lock.release(); }
  }
  private async sync(job: JobRecord, mapping: PerformanceMapping): Promise<StepResult> {
    const end = typeof job.payload.end === "string" ? job.payload.end : shiftDate(pacificDate(new Date()), -3);
    const days = typeof job.payload.days === "number" ? job.payload.days : mapping.lastSync ? 7 : 90;
    const dayIndex = Number(job.payload.dayIndex ?? 0);
    const datasetIndex = Number(job.payload.datasetIndex ?? 0);
    const startRow = Number(job.payload.startRow ?? 0);
    const datasets = ["property", "page", "query"] as const;
    const dataset = datasets[datasetIndex];
    const day = shiftDate(end, -(days - 1) + dayIndex);
    const rows = await this.google.analytics(mapping.property, day, dataset, startRow, mapping.gscConnectionId ?? undefined);
    const capped = startRow + rows.length >= 50000;
    const complete = rows.length < 25000 || capped;
    await this.repository.transaction(async client => {
      if (!startRow) {
        await client.query("DELETE FROM sp_metrics WHERE store_id=$1 AND day=$2 AND dataset=$3", [job.store_id, day, dataset]);
        await client.query("INSERT INTO sp_days(store_id,day,dataset,complete) VALUES($1,$2,$3,false) ON CONFLICT(store_id,day,dataset) DO UPDATE SET complete=false,truncated=false", [job.store_id, day, dataset]);
      }
      const values = rows.map(row => ({ page: dataset === "property" ? "" : row.keys?.[0] ?? "", query: dataset === "query" ? row.keys?.[1] ?? "" : "", clicks: row.clicks, impressions: row.impressions, position: row.position }));
      // Bulk ingest bounded API pages; metrics retain Google's exact canonical URL.
      await client.query("INSERT INTO sp_metrics(store_id,day,dataset,page,query,clicks,impressions,position) SELECT $1,$2,$3,x.page,x.query,x.clicks,x.impressions,x.position FROM jsonb_to_recordset($4::jsonb) AS x(page text,query text,clicks float8,impressions float8,position float8) ON CONFLICT(store_id,day,dataset,dimension_key) DO UPDATE SET clicks=excluded.clicks,impressions=excluded.impressions,position=excluded.position", [job.store_id, day, dataset, JSON.stringify(values)]);
      if (complete) await client.query("UPDATE sp_days SET complete=true,truncated=$4 WHERE store_id=$1 AND day=$2 AND dataset=$3", [job.store_id, day, dataset, capped]);
    });
    if (dataset === "page") await this.repository.putDiscoveredPages(job.store_id, rows.flatMap(row => row.keys?.[0] ? [row.keys[0]] : []));
    const nextDataset = complete ? (datasetIndex + 1) % 3 : datasetIndex;
    const nextDay = complete && datasetIndex === 2 ? dayIndex + 1 : dayIndex;
    const done = nextDay >= days;
    if (done) await this.repository.pool.query("UPDATE sp_mappings SET last_sync=now() WHERE store_id=$1", [job.store_id]);
    return { done, progress: done ? 100 : Math.floor((nextDay * 3 + nextDataset) / (days * 3) * 100), payload: { end, days, dayIndex: nextDay, datasetIndex: nextDataset, startRow: complete ? 0 : startRow + rows.length } };
  }
  private async ga4Sync(job: JobRecord): Promise<StepResult> {
    const integration = (await this.repository.pool.query<{
      mapping_revision: number; connection_id: string; ga4_property_id: string; storefront_origin: string;
      stream_id: string | null; hostname_scope: string; timezone: string; currency: string;
    }>(`SELECT mapping_revision,connection_id,ga4_property_id,storefront_origin,stream_id,hostname_scope,timezone,currency
      FROM sp_store_integrations WHERE store_id=$1 AND source='GA4' AND is_current AND status='CONNECTED'`, [job.store_id])).rows[0];
    if (!integration?.connection_id || !integration.ga4_property_id || !integration.hostname_scope) throw new Error("GA4_MAPPING_REQUIRED");
    const end = typeof job.payload.end === "string" ? job.payload.end : shiftDate(new Date().toISOString().slice(0, 10), -2);
    const hasFacts = await this.repository.pool.query("SELECT 1 FROM sp_ga4_facts WHERE store_id=$1 LIMIT 1", [job.store_id]);
    const days = typeof job.payload.days === "number" ? job.payload.days : hasFacts.rowCount ? 7 : 90;
    const dayIndex = Number(job.payload.dayIndex ?? 0);
    const panelIndex = Number(job.payload.panelIndex ?? 0);
    const panels: readonly Ga4PanelKind[] = ["landing_engagement", "event_activity", "landing_revenue", "item_performance"];
    const day = shiftDate(end, -(days - 1) + dayIndex);
    const panelKind = panels[panelIndex];
    const client = new Ga4DataClient(() => this.google.tokenForConnection(integration.connection_id));
    const result = await client.panel(panelKind, {
      propertyId: integration.ga4_property_id,
      hostnameScope: integration.hostname_scope,
      streamId: integration.stream_id,
      startDate: day,
      endDate: day,
    });
    if (result.status === "available") {
      const dataRevision = digest(JSON.stringify({ day, panelKind, rows: result.rows, quality: result.quality }));
      await this.repository.transaction(async sql => {
        await sql.query("DELETE FROM sp_ga4_facts WHERE store_id=$1 AND mapping_revision=$2 AND property_id=$3 AND day=$4 AND dataset=$5", [job.store_id, integration.mapping_revision, integration.ga4_property_id, day, panelKindToDataset(panelKind)]);
        const facts = result.rows.map(row => ({ dimensionKey: digest(JSON.stringify(row.dimensions)), dimensions: row.dimensions, metrics: row.metrics }));
        await sql.query(`INSERT INTO sp_ga4_facts(store_id,mapping_revision,property_id,day,dataset,dimension_key,dimensions,metrics,quality,data_revision)
          SELECT $1,$2,$3,$4,$5,row.dimension_key,row.dimensions,row.metrics,$7,$8
          FROM jsonb_to_recordset($6::jsonb) AS row(dimension_key text,dimensions jsonb,metrics jsonb)`, [
          job.store_id, integration.mapping_revision, integration.ga4_property_id, day, panelKindToDataset(panelKind), JSON.stringify(facts.map(fact => ({ dimension_key: fact.dimensionKey, dimensions: fact.dimensions, metrics: fact.metrics }))), JSON.stringify(result.quality), dataRevision,
        ]);
      });
    } else {
      await this.repository.event(job.store_id, "GA4_PANEL_UNAVAILABLE", { day, panelKind, reason: result.reason });
    }
    const nextPanel = (panelIndex + 1) % panels.length;
    const nextDay = nextPanel === 0 ? dayIndex + 1 : dayIndex;
    const done = nextDay >= days;
    return { done, progress: done ? 100 : Math.floor((nextDay * panels.length + nextPanel) / (days * panels.length) * 100), payload: { end, days, dayIndex: nextDay, panelIndex: nextPanel } };
  }
  private async crawl(job: JobRecord, mapping: PerformanceMapping): Promise<StepResult> {
    const state = crawlState.parse(job.payload);
    if (state.robots === undefined) {
      const robots = await loadRobots(mapping.origin);
      await this.repository.putPage(job.store_id, mapping.origin);
      return { done: false, progress: 0, payload: { ...state, robots, sitemapQueue: [`${mapping.origin}/sitemap.xml`] } };
    }
    if (!state.inventoryDone) {
      const inventory = await this.source.products(job.store_id, state.productCursor ?? undefined);
      for (const product of inventory.products) {
        if (typeof product.onlineStoreUrl === "string") await this.repository.putPage(job.store_id, product.onlineStoreUrl, product);
      }
      return { done: false, progress: 0, payload: { ...state, inventoryDone: !inventory.cursor, productCursor: inventory.cursor } };
    }
    if (state.sitemapQueue.length && state.sitemapsVisited.length < 100) {
      const sitemap = state.sitemapQueue[0];
      const remaining = state.sitemapQueue.slice(1);
      if (isCrawlAllowed(mapping.origin, state.robots, sitemap)) {
        const document = await fetchPublicDocument(sitemap, mapping.origin, 0, state.robots);
        if (document.status === 200) {
          if (/<!DOCTYPE|<!ENTITY/i.test(document.body)) throw new Error("UNSAFE_SITEMAP_XML");
          const parsed: unknown = new XMLParser({ ignoreAttributes: true, processEntities: false }).parse(document.body);
          const entries = sitemapDocument.parse(parsed);
          const nested = toArray(entries.sitemapindex?.sitemap).map(item => item.loc);
          for (const url of nested) if (new URL(url).origin === mapping.origin && !state.sitemapsVisited.includes(url) && url !== sitemap && !remaining.includes(url)) remaining.push(url);
          await this.repository.putDiscoveredPages(job.store_id, toArray(entries.urlset?.url).map(entry => entry.loc));
        }
      }
      return { done: false, progress: 0, payload: { ...state, sitemapQueue: remaining.slice(0, 100), sitemapsVisited: [...state.sitemapsVisited, sitemap] }, delay: crawlDelay(mapping.origin, state.robots) };
    }
    if (state.checked >= 1000) return { done: true, progress: 100, payload: { ...state, limitReached: true, notice: "Only 1000 URLs inspected. Start another crawl to continue with the oldest snapshots." } };
    const page = (await this.repository.pool.query<{ url: string }>("SELECT url FROM sp_pages WHERE store_id=$1 AND NOT(url=ANY($2::text[])) ORDER BY attempted_at NULLS FIRST,url LIMIT 1", [job.store_id, state.visited])).rows[0];
    if (!page) return { done: true, progress: 100, payload: { ...state, limitReached: state.sitemapQueue.length > 0 } };
    if (isCrawlAllowed(mapping.origin, state.robots, page.url)) {
      try {
        const sourcePage = await this.repository.page(job.store_id, page.url);
        let expectedSummary: string | undefined;
        if (sourcePage.product_id) {
          await this.repository.putPage(job.store_id, page.url, await this.source.product(job.store_id, sourcePage.product_id));
          expectedSummary = await this.source.summary(job.store_id, sourcePage.product_id);
        }
        const document = await fetchPublicDocument(page.url, mapping.origin, 0, state.robots);
        if (!/text\/html/i.test(document.contentType) && document.status < 400) throw new Error("CRAWL_NOT_HTML");
        const audit = inspectHtml({ url: document.url, status: document.status, html: document.body, robotsHeader: document.robots, expectedSummary });
        await this.repository.saveAudit(job.store_id, page.url, audit);
      } catch {
        await this.repository.event(job.store_id, "PAGE_CHECK_FAILED", { url: page.url, message: "Page or source could not be inspected; no content conclusions made." });
      }
    } else await this.repository.event(job.store_id, "ROBOTS_DISALLOWED", { url: page.url });
    // Failed/blocked URLs must not monopolize the first 1000 slots on every run.
    await this.repository.pool.query("UPDATE sp_pages SET attempted_at=now() WHERE store_id=$1 AND url=$2", [job.store_id, page.url]);
    return { done: false, progress: Math.min(99, Math.floor((state.checked + 1) / 10)), payload: { ...state, checked: state.checked + 1, visited: [...state.visited, page.url] }, delay: crawlDelay(mapping.origin, state.robots) };
  }
  private async inspection(job: JobRecord, mapping: PerformanceMapping): Promise<StepResult> {
    const url = z.string().url().parse(job.payload.url);
    const page = await this.repository.page(job.store_id, url);
    if (page.inspected_at && Date.now() - page.inspected_at.getTime() < 86400000) return { done: true, progress: 100, payload: { url, cached: true } };
    const reserved = await this.repository.pool.query("INSERT INTO sp_inspection_quota(property,day,used) VALUES($1,$2,1) ON CONFLICT(property,day) DO UPDATE SET used=sp_inspection_quota.used+1 WHERE sp_inspection_quota.used<100 RETURNING used", [mapping.property, pacificDate(new Date())]);
    if (!reserved.rowCount) throw new Error("INSPECTION_DAILY_LIMIT");
    const inspection = await this.google.inspect(mapping.property, url, mapping.gscConnectionId ?? undefined);
    const inspectedAt = new Date().toISOString();
    const evidence = normalizeUrlInspection({ response: inspection, inspectedAt });
    const versionTables = page.product_id
      ? (await this.repository.pool.query<{ available: boolean }>("SELECT to_regclass('seo_products') IS NOT NULL AND to_regclass('seo_versions') IS NOT NULL AS available")).rows[0]?.available
      : false;
    const version = page.product_id && versionTables ? (await this.repository.pool.query<{ id: string; public_effective_at_utc: number | null }>(
      `SELECT version.id,version.public_effective_at_utc
       FROM seo_products product JOIN seo_versions version ON version.id=product.current_version_id
       WHERE product.store_id=$1 AND product.shopify_product_gid=ANY($2::text[]) LIMIT 1`,
      [job.store_id, [page.product_id, `gid://shopify/Product/${page.product_id}`]],
    )).rows[0] : undefined;
    const publicEffectiveAt = version?.public_effective_at_utc == null ? null : new Date(version.public_effective_at_utc).toISOString();
    const assessment = deriveInspectionState({ evidence, publicEffectiveAt });
    await this.repository.transaction(async client => {
      await client.query("UPDATE sp_pages SET inspection=$3,inspected_at=$4 WHERE store_id=$1 AND url=$2", [job.store_id, url, JSON.stringify(inspection), inspectedAt]);
      await client.query(`INSERT INTO sp_inspection_history(
        id,store_id,mapping_revision,url,version_id,verdict,coverage_state,last_crawl_at,fetch_state,
        robots_state,indexing_state,google_canonical,user_canonical,result_link,derived_state,
        technical_flags,inspected_at,raw_payload
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [
        randomUUID(), job.store_id, mapping.mappingRevision ?? 1, url, version?.id ?? null,
        evidence.verdict, evidence.coverage, evidence.lastCrawl, evidence.fetch, evidence.robots,
        evidence.indexing, evidence.googleCanonical, evidence.userCanonical, evidence.resultLink,
        assessment.state, JSON.stringify(assessment.technicalFlags), inspectedAt, JSON.stringify(inspection),
      ]);
    });
    return { done: true, progress: 100, payload: { url } };
  }
}
interface StepResult { done: boolean; progress: number; payload: Record<string, unknown>; delay?: number }
const crawlState = z.object({ robots: z.string().optional(), inventoryDone: z.boolean().default(false), productCursor: z.string().nullable().default(null), sitemapQueue: z.array(z.string()).default([]), sitemapsVisited: z.array(z.string()).default([]), visited: z.array(z.string()).default([]), checked: z.number().default(0) });
const sitemapEntry = z.object({ loc: z.string().url() });
const sitemapEntries = z.union([sitemapEntry, z.array(sitemapEntry)]).optional();
const sitemapDocument = z.object({ sitemapindex: z.object({ sitemap: sitemapEntries }).optional(), urlset: z.object({ url: sitemapEntries }).optional() });
function toArray<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function panelKindToDataset(kind: Ga4PanelKind): "LANDING" | "ENGAGEMENT" | "EVENT" | "REVENUE" | "ITEM" {
  if (kind === "event_activity") return "EVENT";
  if (kind === "landing_revenue") return "REVENUE";
  if (kind === "item_performance") return "ITEM";
  return "LANDING";
}
