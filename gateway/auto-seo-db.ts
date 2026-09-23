import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { loadLocalEnv } from "./store-config-loader";

export interface AutoSeoDbOptions {
  readonly dbPath?: string;
  readonly memory?: boolean;
}

let activeDb: DatabaseSync | null = null;

export function resolveAutoSeoDbPath(overrides?: AutoSeoDbOptions): string {
  if (overrides?.memory) {
    return ":memory:";
  }
  if (overrides?.dbPath) {
    return overrides.dbPath === ":memory:"
      ? ":memory:"
      : path.resolve(process.cwd(), overrides.dbPath);
  }
  const localEnv = loadLocalEnv();
  const rawPath =
    process.env.AUTO_SEO_DB_PATH ??
    localEnv.AUTO_SEO_DB_PATH ??
    ".local-data/auto-seo.sqlite3";

  return rawPath === ":memory:" ? ":memory:" : path.resolve(process.cwd(), rawPath);
}

export function initAutoSeoDbSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_seo_product_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_id TEXT NOT NULL UNIQUE,
      workflow_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      shop_domain TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_handle TEXT NOT NULL,
      product_title TEXT NOT NULL,
      shopify_updated_at TEXT,
      snapshot_json TEXT NOT NULL,
      snapshot_sha256 TEXT NOT NULL,
      downstream_status TEXT NOT NULL CHECK (downstream_status IN ('NOT_SENT', 'SENT', 'FAILED')),
      downstream_http_status INTEGER,
      downstream_error TEXT,
      downstream_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      CONSTRAINT uq_auto_seo_workflow_store_product UNIQUE (workflow_id, store_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_auto_seo_store_product
    ON auto_seo_product_backups(store_id, product_id);

    CREATE INDEX IF NOT EXISTS idx_auto_seo_created_at
    ON auto_seo_product_backups(created_at);
  `);
}

export function getAutoSeoDb(options?: AutoSeoDbOptions): DatabaseSync {
  if (activeDb) {
    return activeDb;
  }
  const resolvedPath = resolveAutoSeoDbPath(options);
  if (resolvedPath !== ":memory:") {
    const dir = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (resolvedPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  initAutoSeoDbSchema(db);
  activeDb = db;
  return activeDb;
}

export function setAutoSeoDb(db: DatabaseSync | null): void {
  activeDb = db;
}

export function closeAutoSeoDb(): void {
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
}
