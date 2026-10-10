import { Pool } from "pg";

import { getAutoSeoDatabaseUrl } from "./auto-seo-database-url";
import type { ListSeoReviewItemsOptions, SeoReviewItemRecord, SeoReviewStatus } from "./seo-review-db";
import { reviewListWhere, reviewStageSql } from "./review-list-query";
import { emptySeoReviewCounts, getSeoReviewActions } from "../src/shared/seo-review-list";
import type { SeoReviewListItem, SeoReviewListPage, SeoReviewListQuery } from "../src/shared/seo-review-list";

export interface AutoSeoReviewInput extends SeoReviewItemRecord {
  readonly backupId: string;
}

export interface AutoSeoDurableReview extends SeoReviewItemRecord {
  readonly backupId: string;
  readonly sourceOrigin: "auto_seo";
  readonly reviewArchivedAt?: number;
  readonly originalBackup: {
    readonly productTitle: string;
    readonly productDescription: string;
    readonly handle?: string;
    readonly seoTitle?: string;
    readonly seoDescription?: string;
    readonly backedUpAt?: number;
  };
}

interface ReviewRow {
  readonly item_id: string;
  readonly store_id: string;
  readonly product_id: string;
  readonly handle: string;
  readonly title: string;
  readonly review_status: SeoReviewStatus;
  readonly generated_payload: string;
  readonly shopify_updated_at: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly backup_id: string;
  readonly snapshot_json: string | null;
  readonly backup_store_id: string | null;
  readonly backup_product_id: string | null;
  readonly backup_created_at: string | null;
  readonly deleted_at: string | null;
  readonly archived_at: string | null;
}

function mapHydrated(row: ReviewRow): AutoSeoDurableReview {
  if (!row.snapshot_json || row.backup_store_id !== row.store_id || row.backup_product_id !== row.product_id) {
    throw new Error(`AUTO_SEO_REVIEW_INTEGRITY: exact backup missing for review ${row.item_id}`);
  }
  let snapshot: unknown;
  try { snapshot = JSON.parse(row.snapshot_json); }
  catch { throw new Error(`AUTO_SEO_REVIEW_INTEGRITY: invalid backup snapshot for review ${row.item_id}`); }
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`AUTO_SEO_REVIEW_INTEGRITY: invalid backup snapshot for review ${row.item_id}`);
  }
  const product = snapshot as Record<string, unknown>;
  if (product.id !== row.product_id || typeof product.title !== "string" || !product.title.trim()) {
    throw new Error(`AUTO_SEO_REVIEW_INTEGRITY: backup product mismatch for review ${row.item_id}`);
  }
  const seo = product.seo && typeof product.seo === "object" ? product.seo as Record<string, unknown> : {};
  const timestamp = Date.parse((row.backup_created_at ?? "").replace(" ", "T"));
  return {
    itemId: row.item_id, storeId: row.store_id, productId: row.product_id,
    handle: row.handle, title: row.title, reviewStatus: row.review_status,
    generatedPayload: row.generated_payload, shopifyUpdatedAt: row.shopify_updated_at,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
    backupId: row.backup_id, sourceOrigin: "auto_seo",
    ...(row.archived_at ? { reviewArchivedAt: Date.parse(row.archived_at) } : {}),
    originalBackup: {
      productTitle: product.title,
      productDescription: typeof product.descriptionHtml === "string" ? product.descriptionHtml : typeof product.description === "string" ? product.description : "",
      ...(typeof product.handle === "string" ? { handle: product.handle } : {}),
      ...(typeof seo.title === "string" ? { seoTitle: seo.title } : {}),
      ...(typeof seo.description === "string" ? { seoDescription: seo.description } : {}),
      ...(Number.isFinite(timestamp) ? { backedUpAt: timestamp } : {}),
    },
  };
}

export class AutoSeoPostgresReviewRepository {
  private readonly pool: Pool;
  private readonly schema: string;

  public constructor(options: { readonly databaseUrl: string; readonly schema?: string }) {
    const url = new URL(options.databaseUrl);
    if (url.protocol !== "postgresql:" || !url.hostname || !url.pathname.slice(1) || !url.username || !url.password) {
      throw new Error("AUTO_SEO_DATABASE_URL must be a Node PostgreSQL URL");
    }
    const schema = options.schema ?? "public";
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid PostgreSQL schema identifier");
    this.schema = schema;
    this.pool = new Pool({ connectionString: options.databaseUrl });
  }

  public async initializeSchema(): Promise<void> {
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS ${this.schema};
      CREATE TABLE IF NOT EXISTS ${this.schema}.seo_review_items (
        item_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        title TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
        generated_payload TEXT NOT NULL,
        shopify_updated_at TEXT,
        notes TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        updated_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        source_origin TEXT CHECK (source_origin IS NULL OR source_origin='auto_seo'),
        backup_id TEXT REFERENCES ${this.schema}.auto_seo_product_backups(backup_id),
        CONSTRAINT uq_seo_review_store_product UNIQUE (store_id,product_id)
      );
      ALTER TABLE ${this.schema}.seo_review_items ADD COLUMN IF NOT EXISTS deleted_at TEXT;
      ALTER TABLE ${this.schema}.seo_review_items ADD COLUMN IF NOT EXISTS archived_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_seo_review_store_status ON ${this.schema}.seo_review_items(store_id,review_status,created_at DESC);
    `);
  }

  public async saveReview(item: AutoSeoReviewInput): Promise<void> {
    if (!item.itemId || !item.storeId || !item.productId || !item.backupId) throw new Error("AUTO_SEO_REVIEW_INVALID_INPUT");
    const now = new Date().toISOString();
    const result = await this.pool.query(`
      INSERT INTO ${this.schema}.seo_review_items (
        item_id,store_id,product_id,handle,title,review_status,generated_payload,
        shopify_updated_at,notes,created_at,updated_at,source_origin,backup_id
      )
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'auto_seo',$12
      FROM ${this.schema}.auto_seo_product_backups
      WHERE backup_id=$12 AND store_id=$2 AND product_id=$3
      ON CONFLICT (store_id,product_id) DO UPDATE SET
        item_id=EXCLUDED.item_id,handle=EXCLUDED.handle,title=EXCLUDED.title,
        review_status=EXCLUDED.review_status,generated_payload=EXCLUDED.generated_payload,
        shopify_updated_at=EXCLUDED.shopify_updated_at,notes=EXCLUDED.notes,
        archived_at=CASE WHEN ${this.schema}.seo_review_items.backup_id IS DISTINCT FROM EXCLUDED.backup_id THEN NULL ELSE ${this.schema}.seo_review_items.archived_at END,
        deleted_at=NULL,updated_at=EXCLUDED.updated_at,source_origin='auto_seo',backup_id=EXCLUDED.backup_id
      WHERE ${this.schema}.seo_review_items.source_origin='auto_seo'
    `, [item.itemId, item.storeId, item.productId, item.handle, item.title, item.reviewStatus,
      item.generatedPayload, item.shopifyUpdatedAt ?? null, item.notes ?? null,
      item.createdAt ?? now, item.updatedAt ?? now, item.backupId]);
    if (result.rowCount !== 1) throw new Error(`AUTO_SEO_REVIEW_INTEGRITY: backup ${item.backupId} does not match review product`);
  }

  private selectSql(): string {
    return `SELECT r.*,b.snapshot_json,b.store_id AS backup_store_id,b.product_id AS backup_product_id,b.created_at AS backup_created_at
      FROM ${this.schema}.seo_review_items r
      LEFT JOIN ${this.schema}.auto_seo_product_backups b ON b.backup_id=r.backup_id`;
  }

  public async findHydrated(itemId: string): Promise<AutoSeoDurableReview | null> {
    const result = await this.pool.query<ReviewRow>(`${this.selectSql()} WHERE r.item_id=$1 AND r.source_origin='auto_seo' AND r.deleted_at IS NULL`, [itemId]);
    return result.rows[0] ? mapHydrated(result.rows[0]) : null;
  }

  public async listHydrated(options?: ListSeoReviewItemsOptions): Promise<{ items: AutoSeoDurableReview[]; total: number }> {
    const conditions = ["r.source_origin='auto_seo'", "r.deleted_at IS NULL"];
    const params: Array<string | number> = [];
    if (options?.storeId?.trim()) { params.push(options.storeId.trim()); conditions.push(`r.store_id=$${params.length}`); }
    if (options?.status?.trim()) { params.push(options.status.trim()); conditions.push(`r.review_status=$${params.length}`); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const count = await this.pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${this.schema}.seo_review_items r ${where}`, params);
    params.push(typeof options?.limit === "number" && options.limit > 0 ? options.limit : 50);
    const limitIndex = params.length;
    params.push(typeof options?.offset === "number" && options.offset >= 0 ? options.offset : 0);
    const result = await this.pool.query<ReviewRow>(`${this.selectSql()} ${where} ORDER BY replace(r.created_at,' ','T')::timestamp DESC LIMIT $${limitIndex} OFFSET $${params.length}`, params);
    return { items: result.rows.map(mapHydrated), total: Number(count.rows[0]?.count ?? 0) };
  }
  public async listSummaries(query: SeoReviewListQuery): Promise<SeoReviewListPage> {
    const catalog = reviewStageSql(`SELECT r.item_id AS id,r.store_id,r.product_id,
      COALESCE(r.generated_payload::jsonb->>'productTitle',r.generated_payload::jsonb->>'title',r.title) AS title,r.handle,
      '' AS asin,COALESCE(r.generated_payload::jsonb#>>'{images,0,webp,url}',r.generated_payload::jsonb#>>'{images,0,sourceUrl}','') AS thumbnail_url,
      r.review_status AS decision,'idle' AS sync_status,
      COALESCE(extract(epoch FROM replace(r.archived_at,' ','T')::timestamp)*1000,0) AS archived_at,
      false AS is_superseded,false AS is_unresolved,extract(epoch FROM replace(r.updated_at,' ','T')::timestamp)*1000 AS updated_at
      FROM ${this.schema}.seo_review_items r WHERE r.source_origin='auto_seo' AND r.deleted_at IS NULL`);
    const where = reviewListWhere(query);
    const bind = (sql: string): string => { let index = 0; return sql.replace(/\?/g, () => `$${++index}`); };
    const count = await this.pool.query<{ total: string }>(bind(`SELECT COUNT(*) AS total FROM (${catalog}) catalog WHERE ${where.sql}`), [...where.parameters]);
    const rows = await this.pool.query<Record<string, unknown>>(bind(`SELECT * FROM (${catalog}) catalog WHERE ${where.sql} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`), [...where.parameters, query.limit ?? 50, query.offset ?? 0]);
    const counts = emptySeoReviewCounts();
    const grouped = await this.pool.query<Record<string, unknown>>(`SELECT review_stage,COUNT(*) AS total FROM (${catalog}) catalog WHERE store_id=$1 GROUP BY review_stage`, [query.storeId]);
    for (const row of grouped.rows) counts[row.review_stage as keyof typeof counts] = Number(row.total);
    const items = rows.rows.map((row): SeoReviewListItem => ({ id: String(row.product_id), recordId: String(row.id), storeId: String(row.store_id), source: "auto_seo",
      productId: String(row.product_id), title: String(row.title), handle: String(row.handle), thumbnailUrl: String(row.thumbnail_url),
      decision: row.decision as SeoReviewListItem["decision"], syncStatus: "idle", updatedAt: Number(row.updated_at),
      archivedAt: Number(row.archived_at) || undefined, stage: row.review_stage as SeoReviewListItem["stage"],
      actions: getSeoReviewActions({ decision: row.decision as SeoReviewListItem["decision"], syncStatus: "idle", archivedAt: Number(row.archived_at) }) }));
    const total = Number(count.rows[0]?.total ?? 0);
    const next = (query.offset ?? 0) + items.length;
    return { items, total, counts, nextOffset: next < total ? next : null };
  }

  public async archive(itemId: string, storeId: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE ${this.schema}.seo_review_items SET archived_at=COALESCE(archived_at,$1),updated_at=$1
      WHERE item_id=$2 AND store_id=$3 AND source_origin='auto_seo' AND deleted_at IS NULL`, [new Date().toISOString(), itemId, storeId]);
    return (result.rowCount ?? 0) > 0;
  }

  public async updateStatus(itemId: string, status: SeoReviewStatus, notes?: string): Promise<boolean> {
    if (!["pending", "approved", "rejected"].includes(status)) throw new Error("Invalid review status");
    const result = notes === undefined
      ? await this.pool.query(`UPDATE ${this.schema}.seo_review_items SET review_status=$1,updated_at=$2 WHERE item_id=$3 AND source_origin='auto_seo' AND deleted_at IS NULL AND archived_at IS NULL`, [status, new Date().toISOString(), itemId])
      : await this.pool.query(`UPDATE ${this.schema}.seo_review_items SET review_status=$1,notes=$2,updated_at=$3 WHERE item_id=$4 AND source_origin='auto_seo' AND deleted_at IS NULL AND archived_at IS NULL`, [status, notes, new Date().toISOString(), itemId]);
    return (result.rowCount ?? 0) > 0;
  }

  public async updatePayload(itemId: string, payload: unknown): Promise<boolean> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload must be an object");
    const serialized = JSON.stringify(payload);
    const record = payload as Record<string, unknown>;
    const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : typeof record.productTitle === "string" && record.productTitle.trim() ? record.productTitle.trim() : null;
    const handle = typeof record.handle === "string" && record.handle.trim() ? record.handle.trim() : typeof record.productHandle === "string" && record.productHandle.trim() ? record.productHandle.trim() : null;
    const result = await this.pool.query(`UPDATE ${this.schema}.seo_review_items SET title=COALESCE($1,title),handle=COALESCE($2,handle),generated_payload=(generated_payload::jsonb || $3::jsonb)::text,updated_at=$4 WHERE item_id=$5 AND source_origin='auto_seo' AND deleted_at IS NULL AND archived_at IS NULL`, [title, handle, serialized, new Date().toISOString(), itemId]);
    return (result.rowCount ?? 0) > 0;
  }

  public async delete(itemId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `UPDATE ${this.schema}.seo_review_items SET deleted_at=$1,updated_at=$1 WHERE item_id=$2 AND source_origin='auto_seo' AND deleted_at IS NULL`,
      [now, itemId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async findPendingByStoreAndProductIds(
    storeId: string,
    productIds: readonly string[],
  ): Promise<readonly { readonly productId: string; readonly shopifyUpdatedAt: string | null }[]> {
    if (productIds.length === 0) return [];
    const result = await this.pool.query<{ product_id: string; shopify_updated_at: string | null }>(`
      SELECT product_id, shopify_updated_at
      FROM ${this.schema}.seo_review_items
      WHERE store_id=$1 AND product_id=ANY($2::text[]) AND source_origin='auto_seo'
        AND review_status='pending' AND deleted_at IS NULL
    `, [storeId, productIds]);
    return result.rows.map(row => ({ productId: row.product_id, shopifyUpdatedAt: row.shopify_updated_at }));
  }

  public async close(): Promise<void> { await this.pool.end(); }
}

let runtimeRepository: AutoSeoPostgresReviewRepository | undefined;
export function getAutoSeoReviewRepository(): AutoSeoPostgresReviewRepository {
  if (runtimeRepository) return runtimeRepository;
  const databaseUrl = getAutoSeoDatabaseUrl();
  if (!databaseUrl) throw new Error("AUTO_SEO_DATABASE_URL or DATABASE_URL is required for Auto SEO reviews");
  runtimeRepository = new AutoSeoPostgresReviewRepository({ databaseUrl });
  return runtimeRepository;
}
