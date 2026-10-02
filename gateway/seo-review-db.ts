import type { DatabaseSync } from "node:sqlite";

export type SeoReviewStatus = "pending" | "approved" | "rejected";

export interface SeoReviewItemRecord {
  readonly itemId: string;
  readonly storeId: string;
  readonly productId: string;
  readonly handle: string;
  readonly title: string;
  readonly reviewStatus: SeoReviewStatus;
  readonly generatedPayload: string;
  readonly shopifyUpdatedAt?: string | null;
  readonly notes?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface ListSeoReviewItemsOptions {
  readonly storeId?: string;
  readonly status?: SeoReviewStatus | string;
  readonly limit?: number;
  readonly offset?: number;
}

export function initSeoReviewDbSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seo_review_items (
      item_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      title TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
      generated_payload TEXT NOT NULL,
      shopify_updated_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      CONSTRAINT uq_seo_review_store_product UNIQUE (store_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_seo_review_store_status ON seo_review_items(store_id, review_status, created_at DESC);
  `);

  const cols = db.prepare("PRAGMA table_info(seo_review_items)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "notes")) {
    db.exec("ALTER TABLE seo_review_items ADD COLUMN notes TEXT");
  }
  if (!cols.some((c) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE seo_review_items ADD COLUMN deleted_at TEXT");
  }
}

export function upsertSeoReviewItem(db: DatabaseSync, item: SeoReviewItemRecord): void {
  const existing = db
    .prepare("SELECT item_id FROM seo_review_items WHERE item_id = ? OR (store_id = ? AND product_id = ?)")
    .get(item.itemId, item.storeId, item.productId) as { item_id: string } | undefined;

  const now = new Date().toISOString();
  const shopifyUpdatedAt = item.shopifyUpdatedAt ?? null;
  const notes = item.notes ?? null;

  if (existing) {
    const stmt = db.prepare(`
      UPDATE seo_review_items
      SET item_id = ?,
          store_id = ?,
          product_id = ?,
          handle = ?,
          title = ?,
          review_status = ?,
          generated_payload = ?,
          shopify_updated_at = ?,
          notes = ?,
          deleted_at = NULL,
          updated_at = ?
      WHERE item_id = ?
    `);
    stmt.run(
      item.itemId,
      item.storeId,
      item.productId,
      item.handle,
      item.title,
      item.reviewStatus,
      item.generatedPayload,
      shopifyUpdatedAt,
      notes,
      item.updatedAt ?? now,
      existing.item_id,
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO seo_review_items (
        item_id,
        store_id,
        product_id,
        handle,
        title,
        review_status,
        generated_payload,
        shopify_updated_at,
        notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.itemId,
      item.storeId,
      item.productId,
      item.handle,
      item.title,
      item.reviewStatus,
      item.generatedPayload,
      shopifyUpdatedAt,
      notes,
      item.createdAt ?? now,
      item.updatedAt ?? now,
    );
  }
}

interface RawSeoReviewItemRow {
  item_id: string;
  store_id: string;
  product_id: string;
  handle: string;
  title: string;
  review_status: SeoReviewStatus;
  generated_payload: string;
  shopify_updated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToRecord(row: RawSeoReviewItemRow): SeoReviewItemRecord {
  return {
    itemId: row.item_id,
    storeId: row.store_id,
    productId: row.product_id,
    handle: row.handle,
    title: row.title,
    reviewStatus: row.review_status,
    generatedPayload: row.generated_payload,
    shopifyUpdatedAt: row.shopify_updated_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSeoReviewItem(db: DatabaseSync, itemId: string): SeoReviewItemRecord | null {
  const row = db
    .prepare("SELECT * FROM seo_review_items WHERE item_id = ? AND deleted_at IS NULL")
    .get(itemId) as RawSeoReviewItemRow | undefined;

  return row ? mapRowToRecord(row) : null;
}

export function listSeoReviewItems(
  db: DatabaseSync,
  options?: ListSeoReviewItemsOptions,
): { items: SeoReviewItemRecord[]; total: number } {
  const conditions: string[] = ["deleted_at IS NULL"];
  const params: Array<string | number | null> = [];

  if (options?.storeId && options.storeId.trim()) {
    conditions.push("store_id = ?");
    params.push(options.storeId.trim());
  }

  if (options?.status && options.status.trim()) {
    conditions.push("review_status = ?");
    params.push(options.status.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM seo_review_items ${whereClause}`)
    .get(...params) as { count: number | bigint };

  const total = Number(countRow.count);

  const limit = typeof options?.limit === "number" && options.limit > 0 ? options.limit : 50;
  const offset = typeof options?.offset === "number" && options.offset >= 0 ? options.offset : 0;

  const rows = db
    .prepare(
      `SELECT * FROM seo_review_items ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as RawSeoReviewItemRow[];

  return {
    items: rows.map(mapRowToRecord),
    total,
  };
}

export function updateSeoReviewStatus(
  db: DatabaseSync,
  itemId: string,
  status: "pending" | "approved" | "rejected",
  notes?: string,
): boolean {
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    throw new Error(`Invalid status: ${String(status)}. Must be 'pending', 'approved', or 'rejected'.`);
  }

  const now = new Date().toISOString();
  if (notes !== undefined) {
    const stmt = db.prepare(
      "UPDATE seo_review_items SET review_status = ?, notes = ?, updated_at = ? WHERE item_id = ?",
    );
    const result = stmt.run(status, notes, now, itemId);
    return Number(result.changes) > 0;
  }

  const stmt = db.prepare(
    "UPDATE seo_review_items SET review_status = ?, updated_at = ? WHERE item_id = ?",
  );
  const result = stmt.run(status, now, itemId);
  return Number(result.changes) > 0;
}

export function deleteSeoReviewItem(db: DatabaseSync, itemId: string): boolean {
  const result = db
    .prepare(
      "UPDATE seo_review_items SET deleted_at = ?, updated_at = ? WHERE item_id = ? AND deleted_at IS NULL",
    )
    .run(new Date().toISOString(), new Date().toISOString(), itemId);

  return Number(result.changes) > 0;
}

export function updateSeoReviewPayload(
  db: DatabaseSync,
  itemId: string,
  payload: unknown,
): boolean {
  if (payload === undefined || payload === null) {
    throw new Error("Payload cannot be undefined or null");
  }

  const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const now = new Date().toISOString();

  let titleUpdate: string | undefined;
  let handleUpdate: string | undefined;

  if (typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    if (typeof p.title === "string" && p.title.trim()) {
      titleUpdate = p.title.trim();
    } else if (typeof p.productTitle === "string" && p.productTitle.trim()) {
      titleUpdate = p.productTitle.trim();
    }

    if (typeof p.handle === "string" && p.handle.trim()) {
      handleUpdate = p.handle.trim();
    } else if (typeof p.productHandle === "string" && p.productHandle.trim()) {
      handleUpdate = p.productHandle.trim();
    }
  }

  let result;
  if (titleUpdate && handleUpdate) {
    result = db
      .prepare(
        "UPDATE seo_review_items SET title = ?, handle = ?, generated_payload = ?, updated_at = ? WHERE item_id = ?",
      )
      .run(titleUpdate, handleUpdate, payloadStr, now, itemId);
  } else if (titleUpdate) {
    result = db
      .prepare(
        "UPDATE seo_review_items SET title = ?, generated_payload = ?, updated_at = ? WHERE item_id = ?",
      )
      .run(titleUpdate, payloadStr, now, itemId);
  } else if (handleUpdate) {
    result = db
      .prepare(
        "UPDATE seo_review_items SET handle = ?, generated_payload = ?, updated_at = ? WHERE item_id = ?",
      )
      .run(handleUpdate, payloadStr, now, itemId);
  } else {
    result = db
      .prepare("UPDATE seo_review_items SET generated_payload = ?, updated_at = ? WHERE item_id = ?")
      .run(payloadStr, now, itemId);
  }

  return Number(result.changes) > 0;
}
