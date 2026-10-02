import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { Pool } from "pg";

import { AutoSeoPostgresRepository, requireAutoSeoMigrationDatabase } from "./auto-seo-postgres-repository";

interface LegacyReviewRow {
  readonly item_id: string;
  readonly store_id: string;
  readonly product_id: string;
  readonly handle: string;
  readonly title: string;
  readonly review_status: string;
  readonly generated_payload: string;
  readonly shopify_updated_at: string | null;
  readonly notes: string | null;
  readonly deleted_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly backup_id?: string | null;
  readonly source_origin?: string | null;
}

export interface AutoSeoReviewMigrationReport {
  readonly sourceTableExisted: boolean;
  readonly sourceRows: number;
  readonly inserted: number;
  readonly existing: number;
  readonly conflicts: number;
  readonly sourceUnchanged: true;
}

export interface AutoSeoReviewMigrationOptions {
  readonly sourcePath: string;
  readonly databaseUrl: string;
  readonly schema?: string;
  readonly allowProductionTarget?: boolean;
  /** Only resolve identical snapshots when exactly one predates review creation. */
  readonly allowEquivalentHistoricalBackup?: boolean;
  /** Simulates an independent SQLite writer immediately before COMMIT in local tests. */
  readonly beforeCommitForTesting?: () => void | Promise<void>;
  /** Simulates an independent SQLite writer after COMMIT in local tests. */
  readonly afterCommitForTesting?: () => void | Promise<void>;
}

interface SourceState {
  readonly fingerprint: string;
  readonly tableExisted: boolean;
  readonly rowCount: number;
  readonly columns: readonly string[];
  readonly indexes: readonly string[];
  readonly rows: readonly LegacyReviewRow[];
}

function fingerprintSource(sourcePath: string): string {
  const hash = createHash("sha256");
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${sourcePath}${suffix}`;
    hash.update(suffix);
    hash.update(existsSync(file) ? readFileSync(file) : "absent");
  }
  return hash.digest("hex");
}

function captureSourceState(sourcePath: string): SourceState {
  // Capture before the first query so a writer during the read window is visible.
  const beforeRead = fingerprintSource(sourcePath);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let rows: LegacyReviewRow[];
  let sourceTableExisted: boolean;
  let columns: string[] = [];
  let indexes: string[] = [];
  try {
    sourceTableExisted = Boolean(source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seo_review_items'").get());
    if (!sourceTableExisted) {
      rows = [];
    } else {
      columns = source.prepare("PRAGMA table_info(seo_review_items)").all().map(column => String(column.name));
      const required = ["item_id", "store_id", "product_id", "handle", "title", "review_status", "generated_payload", "shopify_updated_at", "created_at", "updated_at"];
      if (required.some(column => !columns.includes(column))) throw new Error("AUTO_SEO_REVIEW_MIGRATION_SOURCE_SCHEMA_INVALID");
      indexes = source.prepare("PRAGMA index_list(seo_review_items)").all().map(index => {
        const name = String(index.name);
        const escaped = `"${name.replaceAll('"', '""')}"`;
        const keys = source.prepare(`PRAGMA index_info(${escaped})`).all().map(column => String(column.name));
        return JSON.stringify({ name, unique: index.unique, partial: index.partial, keys });
      });
      const notes = columns.includes("notes") ? "notes" : "NULL AS notes";
      const deleted = columns.includes("deleted_at") ? "deleted_at" : "NULL AS deleted_at";
      const backup = columns.includes("backup_id") ? "backup_id" : "NULL AS backup_id";
      const origin = columns.includes("source_origin") ? "source_origin" : "NULL AS source_origin";
      rows = source.prepare(`SELECT item_id,store_id,product_id,handle,title,review_status,generated_payload,shopify_updated_at,${notes},${deleted},created_at,updated_at,${backup},${origin} FROM seo_review_items ORDER BY item_id`).all() as unknown as LegacyReviewRow[];
    }
  } finally { source.close(); }
  if (fingerprintSource(sourcePath) !== beforeRead) throw new Error("AUTO_SEO_REVIEW_MIGRATION_SOURCE_CHANGED: SQLite changed during source read");
  return { fingerprint: beforeRead, tableExisted: sourceTableExisted, rowCount: rows.length, columns, indexes, rows };
}

function verifySourceState(sourcePath: string, baseline: SourceState): void {
  const current = captureSourceState(sourcePath);
  if (current.fingerprint !== baseline.fingerprint ||
      current.tableExisted !== baseline.tableExisted ||
      current.rowCount !== baseline.rowCount ||
      JSON.stringify(current.columns) !== JSON.stringify(baseline.columns) ||
      JSON.stringify(current.indexes) !== JSON.stringify(baseline.indexes)) {
    throw new Error("AUTO_SEO_REVIEW_MIGRATION_SOURCE_CHANGED: SQLite review source changed");
  }
}

export async function migrateAutoSeoReviewsLocal(options: AutoSeoReviewMigrationOptions): Promise<AutoSeoReviewMigrationReport> {
  requireAutoSeoMigrationDatabase(options.databaseUrl, options.allowProductionTarget);
  const schema = options.schema ?? "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid PostgreSQL schema identifier");
  const baseline = captureSourceState(options.sourcePath);
  const rows = baseline.rows;
  const sourceTableExisted = baseline.tableExisted;
  if (rows.length === 0) {
    verifySourceState(options.sourcePath, baseline);
    return { sourceTableExisted, sourceRows: 0, inserted: 0, existing: 0, conflicts: 0, sourceUnchanged: true };
  }
  if (rows.some(row => row.source_origin && row.source_origin !== "auto_seo")) {
    throw new Error("AUTO_SEO_REVIEW_MIGRATION_MIXED_SOURCE_BLOCKER: shared review table contains other sources");
  }
  const targetVerifier = new AutoSeoPostgresRepository({ databaseUrl: options.databaseUrl, schema });
  try { await targetVerifier.verifyLocalTarget(); }
  finally { await targetVerifier.close(); }
  const pool = new Pool({ connectionString: options.databaseUrl });
  const client = await pool.connect().catch(async error => { await pool.end(); throw error; });
  let inserted = 0;
  let existing = 0;
  let committed = false;
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const backups = row.backup_id
        ? await client.query<{ backup_id: string; snapshot_json: string; snapshot_sha256: string; created_at: string }>(`SELECT backup_id,snapshot_json,snapshot_sha256,created_at FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1 AND store_id=$2 AND product_id=$3`, [row.backup_id, row.store_id, row.product_id])
        : await client.query<{ backup_id: string; snapshot_json: string; snapshot_sha256: string; created_at: string }>(`SELECT backup_id,snapshot_json,snapshot_sha256,created_at FROM ${schema}.auto_seo_product_backups WHERE store_id=$1 AND product_id=$2`, [row.store_id, row.product_id]);
      let candidates = backups.rows;
      if (!row.backup_id && candidates.length > 1 && options.allowEquivalentHistoricalBackup) {
        const first = candidates[0];
        const isSameSnapshot = first && candidates.every(candidate => candidate.snapshot_json === first.snapshot_json && candidate.snapshot_sha256 === first.snapshot_sha256);
        const historical = candidates.filter(candidate => Date.parse(candidate.created_at) <= Date.parse(row.created_at));
        if (isSameSnapshot && historical.length === 1) candidates = historical;
      }
      if (candidates.length !== 1) throw new Error(`AUTO_SEO_REVIEW_MIGRATION_BACKUP_BLOCKER: ${row.item_id} has ${candidates.length} candidate backups`);
      const backupId = candidates[0]?.backup_id;
      const target = await client.query<LegacyReviewRow & { backup_id: string; source_origin: string }>(`SELECT * FROM ${schema}.seo_review_items WHERE item_id=$1 OR (store_id=$2 AND product_id=$3) FOR UPDATE`, [row.item_id, row.store_id, row.product_id]);
      if (target.rows.length > 0) {
        const candidate = target.rows[0];
        const fields = ["item_id", "store_id", "product_id", "handle", "title", "review_status", "generated_payload", "shopify_updated_at", "notes", "deleted_at", "created_at", "updated_at"] as const;
        if (target.rows.length !== 1 || !candidate || fields.some(field => candidate[field] !== row[field]) || candidate.backup_id !== backupId || candidate.source_origin !== "auto_seo") {
          throw new Error(`AUTO_SEO_REVIEW_MIGRATION_CONFLICT: ${row.item_id}`);
        }
        existing++;
        continue;
      }
      await client.query(`INSERT INTO ${schema}.seo_review_items (item_id,store_id,product_id,handle,title,review_status,generated_payload,shopify_updated_at,notes,deleted_at,created_at,updated_at,source_origin,backup_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'auto_seo',$13)`, [row.item_id, row.store_id, row.product_id, row.handle, row.title, row.review_status, row.generated_payload, row.shopify_updated_at, row.notes, row.deleted_at, row.created_at, row.updated_at, backupId]);
      inserted++;
    }
    const verified = await client.query<{ item_id: string }>(`SELECT item_id FROM ${schema}.seo_review_items WHERE item_id = ANY($1::text[])`, [rows.map(row => row.item_id)]);
    if (verified.rows.length !== rows.length) throw new Error("AUTO_SEO_REVIEW_MIGRATION_TARGET_VERIFY_FAILED");
    await options.beforeCommitForTesting?.();
    verifySourceState(options.sourcePath, baseline);
    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
  await options.afterCommitForTesting?.();
  try {
    verifySourceState(options.sourcePath, baseline);
  } catch (error) {
    throw new Error("AUTO_SEO_REVIEW_MIGRATION_COMMITTED_SOURCE_CHANGED: target may already contain committed review rows; stop SQLite writers and rerun migration verification", { cause: error });
  }
  return { sourceTableExisted, sourceRows: rows.length, inserted, existing, conflicts: 0, sourceUnchanged: true };
}
