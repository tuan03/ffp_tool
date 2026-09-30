import type { Pool } from "pg";

import { withSeoTransaction } from "./postgres";

interface SeoMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

const MIGRATIONS: readonly SeoMigration[] = [
  {
    version: 1,
    name: "initial durable seo content storage",
    statements: [
      `CREATE TABLE IF NOT EXISTS seo_site_niche_cache (
        domain TEXT PRIMARY KEY,
        niche TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS seo_pipeline_runs (
        run_id TEXT PRIMARY KEY,
        input_hash TEXT NOT NULL UNIQUE,
        store_id TEXT,
        product_id TEXT,
        handle TEXT,
        source_version TEXT,
        shopify_updated_at TIMESTAMPTZ,
        provider_id TEXT,
        model TEXT,
        pipeline_version TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_error JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS seo_pipeline_runs_recovery_idx
        ON seo_pipeline_runs(status, updated_at)
        WHERE status IN ('pending', 'running', 'failed')`,
      `CREATE TABLE IF NOT EXISTS seo_stage_checkpoints (
        input_hash TEXT NOT NULL REFERENCES seo_pipeline_runs(input_hash) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        stage_hash TEXT NOT NULL,
        upstream_hash TEXT,
        status TEXT NOT NULL,
        prompt_version TEXT,
        model TEXT,
        checkpoint JSONB NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        retry_log JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_error JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (input_hash, stage)
      )`,
      `CREATE INDEX IF NOT EXISTS seo_stage_checkpoints_resume_idx
        ON seo_stage_checkpoints(input_hash, status, updated_at)`,
      `CREATE TABLE IF NOT EXISTS seo_result_cache (
        cache_key TEXT PRIMARY KEY,
        store_id TEXT,
        product_id TEXT,
        input_hash TEXT NOT NULL,
        source_version TEXT,
        image_fingerprint TEXT,
        variant_summary_hash TEXT,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        pipeline_version TEXT NOT NULL,
        result JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS seo_result_cache_lookup_idx
        ON seo_result_cache(store_id, product_id, source_version)`,
      `CREATE TABLE IF NOT EXISTS seo_keyword_corpus_revisions (
        store_id TEXT PRIMARY KEY,
        revision BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS seo_keyword_products (
        store_id TEXT NOT NULL,
        product_key TEXT NOT NULL,
        product_id TEXT,
        handle TEXT,
        url TEXT,
        title TEXT,
        keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (store_id, product_key)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS seo_keyword_products_product_id_idx
        ON seo_keyword_products(store_id, product_id) WHERE product_id IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS seo_keyword_products_handle_idx
        ON seo_keyword_products(store_id, LOWER(handle)) WHERE handle IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS seo_keyword_claims (
        store_id TEXT NOT NULL,
        normalized_keyword TEXT NOT NULL,
        product_key TEXT NOT NULL,
        keyword TEXT NOT NULL,
        rank INTEGER NOT NULL,
        embedding JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (store_id, normalized_keyword),
        FOREIGN KEY (store_id, product_key)
          REFERENCES seo_keyword_products(store_id, product_key) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS seo_keyword_claims_product_idx
        ON seo_keyword_claims(store_id, product_key)`,
      `CREATE TABLE IF NOT EXISTS seo_provider_circuits (
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('closed', 'open', 'half_open')),
        failure_count INTEGER NOT NULL DEFAULT 0,
        opened_at TIMESTAMPTZ,
        retry_after TIMESTAMPTZ,
        last_error JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (provider_id, model)
      )`,
      `CREATE TABLE IF NOT EXISTS seo_review_handoffs (
        handoff_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES seo_pipeline_runs(run_id) ON DELETE CASCADE,
        store_id TEXT,
        product_id TEXT,
        source_version TEXT,
        input_hash TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS seo_outbox (
        event_id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS seo_outbox_pending_idx
        ON seo_outbox(created_at) WHERE published_at IS NULL`,
      `CREATE TABLE IF NOT EXISTS seo_legacy_imports (
        source_type TEXT NOT NULL,
        source_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (source_type, source_key, fingerprint)
      )`,
    ],
  },
  {
    version: 2,
    name: "lease durable seo outbox deliveries",
    statements: [
      "ALTER TABLE seo_outbox ADD COLUMN IF NOT EXISTS locked_by TEXT",
      "ALTER TABLE seo_outbox ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ",
      "ALTER TABLE seo_outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      `CREATE INDEX IF NOT EXISTS seo_outbox_delivery_idx
        ON seo_outbox(next_attempt_at, created_at)
        WHERE published_at IS NULL`,
    ],
  },
  {
    version: 3,
    name: "bind seo outbox events to exact review handoffs",
    statements: [
      "ALTER TABLE seo_outbox ADD COLUMN IF NOT EXISTS handoff_id TEXT",
      `UPDATE seo_outbox AS event SET handoff_id=handoff.handoff_id
       FROM seo_review_handoffs AS handoff
       WHERE event.handoff_id IS NULL
         AND event.event_id LIKE 'seo-review-ready:%'
         AND handoff.handoff_id='seo-review:' || SUBSTRING(event.event_id FROM LENGTH('seo-review-ready:') + 1)`,
      "CREATE INDEX IF NOT EXISTS seo_outbox_handoff_idx ON seo_outbox(handoff_id)",
    ],
  },
];

export async function runSeoContentMigrations(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS seo_content_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  for (const migration of MIGRATIONS) {
    await withSeoTransaction(pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('seo_content_schema_migrations'))");
      const existing = await client.query<{ version: number }>(
        "SELECT version FROM seo_content_schema_migrations WHERE version = $1",
        [migration.version],
      );
      if (existing.rowCount) return;
      for (const statement of migration.statements) await client.query(statement);
      await client.query(
        "INSERT INTO seo_content_schema_migrations(version, name) VALUES ($1, $2)",
        [migration.version, migration.name],
      );
    });
  }
}

export const SEO_CONTENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;
