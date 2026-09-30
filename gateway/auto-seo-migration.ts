import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { Pool } from "pg";

import { AutoSeoPostgresRepository, requireLocalAutoSeoDatabase } from "./auto-seo-postgres-repository";

const TABLE = "auto_seo_product_backups";
const FIELDS = [
  "backup_id", "workflow_id", "store_id", "shop_domain", "product_id",
  "product_handle", "product_title", "shopify_updated_at", "snapshot_json",
  "snapshot_sha256", "gpt_settings_json", "downstream_status",
  "downstream_http_status", "downstream_error", "downstream_sent_at", "created_at",
] as const;
type Field = typeof FIELDS[number];
type Backup = Record<Field, string | number | null>;
const OPTIONAL = new Set<Field>([
  "shopify_updated_at", "gpt_settings_json", "downstream_http_status",
  "downstream_error", "downstream_sent_at",
]);

export interface MigrationOptions {
  readonly sourcePath: string;
  readonly databaseUrl: string;
  readonly schema?: string;
  readonly dryRun?: boolean;
  /** Simulates a concurrent SQLite writer immediately before COMMIT in integration tests. */
  readonly beforeCommitForTesting?: () => void | Promise<void>;
  /** Injects a post-COMMIT failure in migration integration tests only. */
  readonly afterCommitForTesting?: () => void | Promise<void>;
}

export interface SourceIndex {
  readonly name: string;
  readonly isUnique: boolean;
  readonly isPartial: boolean;
  readonly columns: readonly string[];
}

export interface MigrationReport {
  readonly preflight: {
    readonly sourcePath: string;
    readonly sourceCount: number;
    readonly columns: readonly string[];
    readonly indexes: readonly SourceIndex[];
    readonly requiredUniqueKeys: { readonly backupId: boolean; readonly workflowStoreProduct: boolean };
    readonly missingOptionalColumns: readonly string[];
    readonly reviewCount: number | null;
  };
  readonly targetIdentity: string;
  readonly targetCountBefore: number;
  readonly plannedInserts: number;
  readonly alreadyMigrated: number;
  readonly conflicts: number;
  readonly inserted: number;
  readonly migratedCount: number;
  readonly mismatches: number;
  readonly committed: boolean;
}

export interface AutoSeoSourceState {
  readonly preflight: MigrationReport["preflight"];
  readonly contentHash: string;
  readonly fileFingerprint: string;
}

function fingerprintSourceFiles(sourcePath: string): { contentHash: string; fileFingerprint: string } {
  const databaseBytes = readFileSync(sourcePath);
  const contentHash = createHash("sha256").update(databaseBytes).digest("hex");
  const fingerprint = createHash("sha256");
  for (const suffix of ["", "-wal"]) {
    const filePath = `${sourcePath}${suffix}`;
    fingerprint.update(suffix);
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      fingerprint.update(String(stats.size));
      fingerprint.update(String(stats.mtimeMs));
      fingerprint.update(suffix === "" ? databaseBytes : readFileSync(filePath));
    } else {
      fingerprint.update("absent");
    }
  }
  return { contentHash, fileFingerprint: fingerprint.digest("hex") };
}

/** Finishes every SQLite access before taking the source file fingerprint. */
export function captureAutoSeoSourceState(sourcePath: string): AutoSeoSourceState {
  const { preflight } = readSource(sourcePath);
  return { preflight, ...fingerprintSourceFiles(sourcePath) };
}

export function isAutoSeoSourceUnchanged(before: AutoSeoSourceState, after: AutoSeoSourceState): boolean {
  return before.contentHash === after.contentHash &&
    before.fileFingerprint === after.fileFingerprint &&
    JSON.stringify(before.preflight) === JSON.stringify(after.preflight);
}

function readSource(sourcePath: string): { preflight: MigrationReport["preflight"]; backups: Backup[] } {
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(TABLE);
    if (!table) throw new Error(`Source table ${TABLE} is missing`);
    const columns = db.prepare(`PRAGMA table_info(${TABLE})`).all().map(row => String(row.name));
    const indexes: SourceIndex[] = db.prepare(`PRAGMA index_list(${TABLE})`).all().map(row => {
      const name = String(row.name);
      const quotedName = `"${name.replaceAll('"', '""')}"`;
      return {
        name,
        isUnique: row.unique === 1,
        isPartial: row.partial === 1,
        columns: db.prepare(`PRAGMA index_info(${quotedName})`).all().map(column => String(column.name)),
      };
    });
    const hasUniqueColumns = (required: readonly string[]): boolean => indexes.some(index =>
      index.isUnique && !index.isPartial && index.columns.length === required.length &&
      index.columns.every((column, position) => column === required[position]),
    );
    const requiredUniqueKeys = {
      backupId: hasUniqueColumns(["backup_id"]),
      workflowStoreProduct: hasUniqueColumns(["workflow_id", "store_id", "product_id"]),
    };
    const missingUniqueKeys = [
      ...(!requiredUniqueKeys.backupId ? ["backup_id"] : []),
      ...(!requiredUniqueKeys.workflowStoreProduct ? ["workflow_id, store_id, product_id"] : []),
    ];
    if (missingUniqueKeys.length) {
      throw new Error(`AUTO_SEO_SOURCE_UNIQUE_CONSTRAINT_MISSING: ${missingUniqueKeys.join("; ")}`);
    }
    const missingRequired = FIELDS.filter(field => !OPTIONAL.has(field) && !columns.includes(field));
    if (missingRequired.length) throw new Error(`Source missing required columns: ${missingRequired.join(", ")}`);
    const missingOptionalColumns = FIELDS.filter(field => OPTIONAL.has(field) && !columns.includes(field));
    const backups = db.prepare(`SELECT * FROM ${TABLE}`).all().map(row => {
      const backup = {} as Backup;
      for (const field of FIELDS) {
        const value = columns.includes(field) ? row[field] : null;
        if (value !== null && typeof value !== "string" && typeof value !== "number") {
          throw new Error(`Invalid source value for ${field}`);
        }
        backup[field] = value;
      }
      return backup;
    });
    const reviewExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seo_review_items'").get();
    const reviewCount = reviewExists ? Number(db.prepare("SELECT COUNT(*) AS count FROM seo_review_items").get()?.count) : null;
    return {
      preflight: { sourcePath: path.resolve(sourcePath), sourceCount: backups.length, columns, indexes, requiredUniqueKeys, missingOptionalColumns, reviewCount },
      backups,
    };
  } finally {
    db.close();
  }
}

function equalBackup(source: Backup, target: Backup): boolean {
  return FIELDS.every(field => source[field] === target[field]);
}

export async function migrateAutoSeoBackups(options: MigrationOptions): Promise<MigrationReport> {
  requireLocalAutoSeoDatabase(options.databaseUrl);
  const sourceBefore = options.dryRun ? undefined : captureAutoSeoSourceState(options.sourcePath);
  const { preflight, backups } = readSource(options.sourcePath);
  const repository = new AutoSeoPostgresRepository({ databaseUrl: options.databaseUrl, schema: options.schema });
  const schema = options.schema ?? "public";
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    await repository.verifyLocalTarget();
    const client = await pool.connect();
    try {
      await client.query(options.dryRun ? "BEGIN READ ONLY" : "BEGIN");
      let committed = false;
      try {
        if (!options.dryRun) await client.query(`LOCK TABLE ${schema}.${TABLE} IN SHARE ROW EXCLUSIVE MODE`);
        const constraints = (await client.query<{ definition: string }>(
          "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass",
          [`${schema}.${TABLE}`],
        )).rows.map(row => row.definition);
        if (!constraints.some(definition => definition.includes("UNIQUE (backup_id)")) ||
            !constraints.some(definition => definition.includes("UNIQUE (workflow_id, store_id, product_id)"))) {
          throw new Error("Target Auto SEO unique constraints are missing");
        }
        const targetCountBefore = Number((await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${schema}.${TABLE}`)).rows[0]?.count ?? 0);
        const targetRows = (await client.query<Backup>(
          `SELECT ${FIELDS.join(", ")} FROM ${schema}.${TABLE}`,
        )).rows;
        const byId = new Map(targetRows.map(row => [row.backup_id, row]));
        const tupleKey = (backup: Backup): string => JSON.stringify([backup.workflow_id, backup.store_id, backup.product_id]);
        const byTuple = new Map(targetRows.map(row => [tupleKey(row), row]));
        let plannedInserts = 0;
        let alreadyMigrated = 0;
        let conflicts = 0;
        for (const backup of backups) {
          const existing = byId.get(backup.backup_id);
          if (!existing && byTuple.has(tupleKey(backup))) conflicts++;
          else if (!existing) plannedInserts++;
          else if (equalBackup(backup, existing)) alreadyMigrated++;
          else conflicts++;
        }
        const reportBase = {
          preflight, targetIdentity: "127.0.0.1:5432/ffp_tool as ffp_tool",
          targetCountBefore, plannedInserts, alreadyMigrated, conflicts,
        };
        if (options.dryRun) {
          await client.query("ROLLBACK");
          return { ...reportBase, inserted: 0, migratedCount: alreadyMigrated, mismatches: conflicts, committed: false };
        }
        if (conflicts) throw new Error(`${conflicts} Auto SEO backup conflict(s); transaction rolled back`);
        for (const backup of backups) {
          if (byId.has(backup.backup_id)) continue;
          await client.query(
            `INSERT INTO ${schema}.${TABLE} (${FIELDS.join(", ")}) VALUES (${FIELDS.map((_, index) => `$${index + 1}`).join(", ")})`,
            FIELDS.map(field => backup[field]),
          );
        }
        const verified = backups.length ? (await client.query<Backup>(
          `SELECT ${FIELDS.join(", ")} FROM ${schema}.${TABLE} WHERE backup_id = ANY($1::text[])`,
          [backups.map(backup => backup.backup_id)],
        )).rows : [];
        const verifiedById = new Map(verified.map(row => [row.backup_id, row]));
        const mismatches = backups.filter(backup => {
          const target = verifiedById.get(backup.backup_id);
          return !target || !equalBackup(backup, target);
        }).length;
        if (verified.length !== backups.length || mismatches) throw new Error(`${mismatches} Auto SEO verification mismatch(es); transaction rolled back`);
        await options.beforeCommitForTesting?.();
        const sourceBeforeCommit = captureAutoSeoSourceState(options.sourcePath);
        if (sourceBefore && !isAutoSeoSourceUnchanged(sourceBefore, sourceBeforeCommit)) {
          throw new Error("AUTO_SEO_SOURCE_CHANGED_DURING_MIGRATION: SQLite source changed before COMMIT; transaction rolled back. Stop or quiesce writers and rerun preflight and migration verification.");
        }
        await client.query("COMMIT");
        committed = true;
        await options.afterCommitForTesting?.();
        const committedRows = backups.length ? (await client.query<Backup>(
          `SELECT ${FIELDS.join(", ")} FROM ${schema}.${TABLE} WHERE backup_id = ANY($1::text[])`,
          [backups.map(backup => backup.backup_id)],
        )).rows : [];
        const committedById = new Map(committedRows.map(row => [row.backup_id, row]));
        const postCommitMismatches = backups.filter(backup => {
          const target = committedById.get(backup.backup_id);
          return !target || !equalBackup(backup, target);
        }).length;
        if (postCommitMismatches) throw new Error(`${postCommitMismatches} post-commit Auto SEO verification mismatch(es)`);
        return { ...reportBase, inserted: plannedInserts, migratedCount: committedRows.length, mismatches: postCommitMismatches, committed: true };
      } catch (error) {
        if (committed) {
          throw new Error("AUTO_SEO_MIGRATION_COMMITTED_POST_VERIFY_FAILED: transaction COMMIT succeeded; post-commit verification failed; target needs manual investigation. SQLite source was opened read-only.", { cause: error });
        }
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
    await repository.close();
  }
}
