import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { PostgresQueueDatabase, QUEUE_LOCK, QUEUE_TABLES } from "./postgres-database";
import type { SeoQueuePostgresOptions } from "./postgres-database";

const COLUMNS: Record<typeof QUEUE_TABLES[number], readonly string[]> = {
  gpt_settings: ["store_id", "payload"],
  gpt_jobs: ["id", "store_id", "dedup", "status", "batch_id", "payload", "created_at", "provider", "queue_order"],
  gpt_batches: ["id", "store_id", "request_id", "token", "expires_at", "active", "provider", "owner_id", "queue_order"],
  gpt_mutations: ["scope", "request_id", "digest", "response"],
  gpt_deliveries: ["job_id", "payload", "delivered"],
  gpt_review_state: ["job_id", "payload"],
  gpt_sync: ["job_id", "token", "status"],
  gpt_audit: ["id", "store_id", "job_id", "event", "created_at"],
};

export interface SeoQueueMigrationReport {
  readonly counts: Readonly<Record<string, number>>;
  readonly sourceDigest: string;
  readonly alreadyImported: boolean;
  readonly sourceUnchanged: true;
}

function fingerprint(path: string): string {
  const digest = createHash("sha256");
  for (const suffix of ["", "-wal"]) {
    digest.update(suffix);
    const bytes = existsSync(path + suffix) ? readFileSync(path + suffix) : undefined;
    // Opening a WAL-mode backup read-only may create an empty WAL sidecar.
    // Only WAL bytes containing records represent source changes.
    digest.update(bytes && (suffix === "" || bytes.length > 0) ? bytes : "absent");
  }
  return digest.digest("hex");
}

/** Explicit offline import only. Runtime never opens the legacy SQLite file. */
export async function migrateSeoQueue(options: SeoQueuePostgresOptions & {
  readonly sourcePath: string;
  readonly beforeCommitForTesting?: () => Promise<void> | void;
}): Promise<SeoQueueMigrationReport> {
  if (!existsSync(options.sourcePath)) throw new Error("SEO_QUEUE_MIGRATION_SOURCE_MISSING");
  const sourceDigest = fingerprint(options.sourcePath);
  const source = new DatabaseSync(options.sourcePath, { readOnly: true });
  const snapshots = new Map<string, readonly Record<string, unknown>[]>();
  const counts: Record<string, number> = {};
  try {
    for (const table of QUEUE_TABLES) {
      if (!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`SEO_QUEUE_MIGRATION_TABLE_MISSING: ${table}`);
      const orderColumn = table === "gpt_jobs" || table === "gpt_batches" ? ",rowid AS queue_order" : "";
      const rows = source.prepare(`SELECT *${orderColumn} FROM ${table} ORDER BY rowid`).all();
      snapshots.set(table, rows);
      counts[table] = rows.length;
      for (const row of rows) {
        for (const column of COLUMNS[table]) if (!(column in row)) throw new Error(`SEO_QUEUE_MIGRATION_COLUMN_MISSING: ${table}.${column}`);
      }
    }
  } finally { source.close(); }
  if (fingerprint(options.sourcePath) !== sourceDigest) throw new Error("SEO_QUEUE_MIGRATION_SOURCE_CHANGED");
  const database = new PostgresQueueDatabase(options);
  try {
    await database.initialize();
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [QUEUE_LOCK, database.schema]);
      const marker = await client.query(`SELECT counts_json FROM "${database.schema}".seo_queue_migrations WHERE source_digest=$1`, [sourceDigest]);
      if (marker.rowCount) {
        if (fingerprint(options.sourcePath) !== sourceDigest) throw new Error("SEO_QUEUE_MIGRATION_SOURCE_CHANGED");
        await client.query("COMMIT");
        return { counts, sourceDigest, alreadyImported: true, sourceUnchanged: true };
      }
      for (const table of QUEUE_TABLES) {
        const target = `"${database.schema}".${table}`;
        const existing = await client.query<{ count: string }>(`SELECT count(*) FROM ${target}`);
        if (Number(existing.rows[0]?.count)) throw new Error(`SEO_QUEUE_MIGRATION_TARGET_NOT_EMPTY: ${table}`);
        const columns = COLUMNS[table];
        for (const row of snapshots.get(table) ?? []) {
          await client.query(`INSERT INTO ${target} (${columns.join(",")}) VALUES (${columns.map((_column, index) => `$${index + 1}`).join(",")})`, columns.map(column => row[column]));
        }
        const imported = await client.query<{ count: string }>(`SELECT count(*) FROM ${target}`);
        if (Number(imported.rows[0]?.count) !== counts[table]) throw new Error(`SEO_QUEUE_MIGRATION_COUNT_MISMATCH: ${table}`);
        // Compare every cell, including full SEO/AEO JSON, tokens and sync history before committing.
        const copied = await client.query<Record<string, unknown>>(`SELECT ${columns.join(",")} FROM ${target} ORDER BY ${table === "gpt_jobs" || table === "gpt_batches" ? "queue_order" : table === "gpt_audit" ? "id" : columns.join(",")}`);
        const canonicalRows = (rows: readonly Record<string, unknown>[]) => rows.map(row => JSON.stringify(columns.map(column => row[column] === null ? null : String(row[column])))).sort();
        if (JSON.stringify(canonicalRows(copied.rows)) !== JSON.stringify(canonicalRows(snapshots.get(table) ?? []))) throw new Error(`SEO_QUEUE_MIGRATION_CONTENT_MISMATCH: ${table}`);
      }
      for (const [table, column] of [["gpt_jobs", "queue_order"], ["gpt_batches", "queue_order"], ["gpt_audit", "id"]]) {
        const target = `"${database.schema}".${table}`;
        await client.query(`SELECT setval(pg_get_serial_sequence($1,$2),COALESCE((SELECT max(${column}) FROM ${target}),1),(SELECT count(*)>0 FROM ${target}))`, [`${database.schema}.${table}`, column]);
      }
      await options.beforeCommitForTesting?.();
      if (fingerprint(options.sourcePath) !== sourceDigest) throw new Error("SEO_QUEUE_MIGRATION_SOURCE_CHANGED");
      await client.query(`INSERT INTO "${database.schema}".seo_queue_migrations (source_digest,counts_json) VALUES ($1,$2)`, [sourceDigest, JSON.stringify(counts)]);
      await client.query("COMMIT");
      return { counts, sourceDigest, alreadyImported: false, sourceUnchanged: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await database.close(); }
}
