import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Pool } from "pg";

import { PostgresSeoCheckpointStore } from "../checkpoint/postgres-checkpoint-store";
import type { SeoCheckpoint } from "../checkpoint/types";
import { PostgresSeoConflictCorpus } from "../conflict-control/postgres-seo-conflict-corpus";
import type { SeoConflictCorpusFile } from "../conflict-control/seo-conflict-corpus";
import { PostgresSiteNicheCache } from "../site-niche/postgres-site-niche-cache";
import { queryOne } from "./postgres";

export interface SeoLegacyImportOptions {
  readonly nicheSqlitePath?: string;
  readonly corpusJsonPaths?: readonly string[];
  readonly checkpointDirectory?: string;
}

export interface SeoLegacyImportResult {
  readonly nicheEntries: number;
  readonly corpusProducts: number;
  readonly checkpoints: number;
  readonly skippedSources: number;
}

type LegacySqliteDatabase = {
  prepare(sql: string): { all(): readonly { domain: string; niche: string; expires_at: number }[] };
  close(): void;
};

function fingerprint(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function isImported(pool: Pool, sourceType: string, sourceKey: string, hash: string): Promise<boolean> {
  return Boolean(await queryOne<{ imported: number }>(pool,
    `SELECT 1 AS imported FROM seo_legacy_imports
     WHERE source_type=$1 AND source_key=$2 AND fingerprint=$3`, [sourceType, sourceKey, hash]));
}

async function markImported(pool: Pool, sourceType: string, sourceKey: string, hash: string): Promise<void> {
  await pool.query(
    `INSERT INTO seo_legacy_imports(source_type,source_key,fingerprint)
     VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [sourceType, sourceKey, hash]);
}

async function pathExists(candidate: string): Promise<boolean> {
  try { await fs.access(candidate); return true; } catch { return false; }
}

/** Idempotently imports only the three SEO Content legacy stores; GPT Custom state is intentionally excluded. */
export async function importSeoContentLegacyData(
  pool: Pool,
  options: SeoLegacyImportOptions = {},
): Promise<SeoLegacyImportResult> {
  let nicheEntries = 0;
  let corpusProducts = 0;
  let checkpoints = 0;
  let skippedSources = 0;
  const useDefaultSources = Object.keys(options).length === 0;
  const nichePath = options.nicheSqlitePath
    ? path.resolve(options.nicheSqlitePath)
    : useDefaultSources ? path.resolve(".local-data/seo-content-niche.sqlite3") : undefined;
  if (nichePath && await pathExists(nichePath)) {
    const stats = await fs.stat(nichePath);
    const hash = fingerprint(`${stats.size}:${stats.mtimeMs}`);
    if (await isImported(pool, "niche-sqlite", nichePath, hash)) skippedSources++;
    else {
      const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
      const module = await dynamicImport("better-sqlite3") as { default: new (filename: string, options: { readonly: boolean }) => LegacySqliteDatabase };
      const db = new module.default(nichePath, { readonly: true });
      try {
        const cache = new PostgresSiteNicheCache(pool);
        const rows = db.prepare("SELECT domain,niche,expires_at FROM site_niche_cache WHERE expires_at > 0").all();
        for (const row of rows) {
          await cache.set(row.domain, row.niche);
          nicheEntries++;
        }
      } finally { db.close(); }
      await markImported(pool, "niche-sqlite", nichePath, hash);
    }
  }

  let corpusPaths = options.corpusJsonPaths ?? [];
  if (useDefaultSources) {
    const runtimeDirectory = path.resolve(".runtime");
    corpusPaths = await pathExists(runtimeDirectory)
      ? (await fs.readdir(runtimeDirectory))
          .filter(name => /^seo-conflict-corpus(?:-.+)?\.json$/i.test(name))
          .map(name => path.join(runtimeDirectory, name))
      : [];
  }
  for (const corpusPathInput of corpusPaths) {
    const corpusPath = path.resolve(corpusPathInput);
    if (!await pathExists(corpusPath)) continue;
    const content = await fs.readFile(corpusPath, "utf8");
    const hash = fingerprint(content);
    if (await isImported(pool, "corpus-json", corpusPath, hash)) { skippedSources++; continue; }
    const parsed = JSON.parse(content) as SeoConflictCorpusFile;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.products)) throw new Error(`Invalid legacy corpus: ${corpusPath}`);
    for (const product of parsed.products) {
      const corpus = new PostgresSeoConflictCorpus(pool, { storeId: product.storeId });
      await corpus.upsertProduct({ identity: product, title: product.title, approvedKeywords: product.keywords });
      corpusProducts++;
    }
    await markImported(pool, "corpus-json", corpusPath, hash);
  }

  const checkpointDirectory = options.checkpointDirectory
    ? path.resolve(options.checkpointDirectory)
    : useDefaultSources ? path.resolve(".runtime/seo-checkpoints") : undefined;
  if (checkpointDirectory && await pathExists(checkpointDirectory)) {
    const store = new PostgresSeoCheckpointStore(pool);
    for (const name of await fs.readdir(checkpointDirectory)) {
      if (!name.endsWith(".json")) continue;
      const checkpointPath = path.join(checkpointDirectory, name);
      const content = await fs.readFile(checkpointPath, "utf8");
      const hash = fingerprint(content);
      if (await isImported(pool, "checkpoint-json", checkpointPath, hash)) { skippedSources++; continue; }
      const parsed = JSON.parse(content) as { readonly schemaVersion?: unknown; readonly inputHash?: unknown; readonly stages?: unknown };
      if (parsed.schemaVersion === 1) {
        // V1 includes legacy semantic fields and is intentionally not resumable.
        await markImported(pool, "checkpoint-json-v1-skipped", checkpointPath, hash);
        skippedSources++;
        continue;
      }
      if (parsed.schemaVersion !== 2 || typeof parsed.inputHash !== "string" || !parsed.stages) {
        throw new Error(`Invalid legacy checkpoint: ${checkpointPath}`);
      }
      const checkpoint = parsed as SeoCheckpoint;
      await store.set(checkpoint);
      await markImported(pool, "checkpoint-json", checkpointPath, hash);
      checkpoints++;
    }
  }
  return { nicheEntries, corpusProducts, checkpoints, skippedSources };
}
