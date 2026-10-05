import type { WorkerDatabase, WorkerSql } from "../seo-worker/database";

interface SeoVersionMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

function prefix(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid SEO versioning schema");
  return `"${schema}".`;
}

export function getSeoVersionMigrations(schema: string): readonly SeoVersionMigration[] {
  const p = prefix(schema);
  return [{
    version: 1,
    name: "create-seo-version-ledger",
    statements: [
      `CREATE TABLE IF NOT EXISTS ${p}seo_version_store_settings (
        store_id TEXT PRIMARY KEY,
        read_enabled BOOLEAN NOT NULL DEFAULT false,
        write_enabled BOOLEAN NOT NULL DEFAULT false,
        updated_at BIGINT NOT NULL,
        CHECK (NOT write_enabled OR read_enabled)
      )`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_products (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        shopify_product_gid TEXT NOT NULL,
        current_version_id TEXT,
        current_observed_snapshot_id TEXT,
        current_url TEXT,
        shopify_status TEXT NOT NULL,
        first_seen_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        archived_at BIGINT,
        deleted_at BIGINT,
        prior_history_unknown BOOLEAN NOT NULL DEFAULT true,
        versioning_state TEXT NOT NULL CHECK (versioning_state IN ('ACTIVE','DIRTY','ARCHIVED','DELETED')),
        UNIQUE(store_id, shopify_product_gid),
        UNIQUE(store_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_content_snapshots (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        captured_at_utc BIGINT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('BASELINE','BEFORE_PUBLISH','AFTER_PUBLISH','EXTERNAL_OBSERVATION')),
        snapshot_schema_version TEXT NOT NULL,
        field_set_version TEXT NOT NULL,
        content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
        title TEXT NOT NULL,
        description_html TEXT NOT NULL,
        seo_title TEXT,
        seo_description TEXT,
        images JSONB NOT NULL CHECK (jsonb_typeof(images)='array'),
        aeo_metafields JSONB NOT NULL CHECK (jsonb_typeof(aeo_metafields)='object'),
        handle TEXT NOT NULL,
        online_store_url TEXT,
        observed_canonical_url TEXT,
        shopify_status TEXT NOT NULL,
        vendor TEXT,
        product_type TEXT,
        tags JSONB NOT NULL CHECK (jsonb_typeof(tags)='array'),
        extension_fields JSONB NOT NULL CHECK (jsonb_typeof(extension_fields)='object'),
        UNIQUE(store_id, product_id, id),
        FOREIGN KEY(store_id, product_id) REFERENCES ${p}seo_products(store_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_versions (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        version_number BIGINT NOT NULL CHECK (version_number >= 0),
        snapshot_id TEXT NOT NULL,
        before_snapshot_id TEXT,
        predecessor_version_id TEXT,
        source TEXT NOT NULL CHECK (source IN ('BASELINE','AUTO_SEO','ROLLBACK','IMPORTED')),
        publish_operation_id TEXT,
        restored_from_version_id TEXT,
        approved_by TEXT,
        applied_by TEXT,
        model_id TEXT,
        prompt_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
        pipeline_version TEXT,
        store_profile_version TEXT,
        batch_id TEXT,
        job_id TEXT,
        applied_at_utc BIGINT NOT NULL,
        public_effective_at_utc BIGINT,
        created_at_utc BIGINT NOT NULL,
        UNIQUE(store_id, product_id, version_number),
        UNIQUE(store_id, product_id, id),
        UNIQUE(store_id, product_id, snapshot_id),
        UNIQUE(publish_operation_id),
        FOREIGN KEY(store_id, product_id) REFERENCES ${p}seo_products(store_id, id),
        FOREIGN KEY(store_id, product_id, snapshot_id) REFERENCES ${p}seo_content_snapshots(store_id, product_id, id),
        FOREIGN KEY(store_id, product_id, predecessor_version_id) REFERENCES ${p}seo_versions(store_id, product_id, id),
        FOREIGN KEY(store_id, product_id, restored_from_version_id) REFERENCES ${p}seo_versions(store_id, product_id, id),
        CHECK ((version_number=0 AND source='BASELINE' AND predecessor_version_id IS NULL AND before_snapshot_id IS NULL)
          OR (version_number>0 AND source!='BASELINE' AND predecessor_version_id IS NOT NULL AND before_snapshot_id IS NOT NULL)),
        CHECK ((source='ROLLBACK' AND restored_from_version_id IS NOT NULL) OR (source!='ROLLBACK' AND restored_from_version_id IS NULL))
      )`,
      `ALTER TABLE ${p}seo_versions ADD CONSTRAINT seo_versions_before_snapshot_fk
        FOREIGN KEY(store_id, product_id, before_snapshot_id) REFERENCES ${p}seo_content_snapshots(store_id, product_id, id)`,
      `ALTER TABLE ${p}seo_products ADD CONSTRAINT seo_products_current_version_fk
        FOREIGN KEY(store_id, id, current_version_id) REFERENCES ${p}seo_versions(store_id, product_id, id)`,
      `ALTER TABLE ${p}seo_products ADD CONSTRAINT seo_products_current_observed_snapshot_fk
        FOREIGN KEY(store_id, id, current_observed_snapshot_id) REFERENCES ${p}seo_content_snapshots(store_id, product_id, id)`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_draft_bases (
        job_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        based_on_version_id TEXT NOT NULL,
        based_on_snapshot_id TEXT NOT NULL,
        based_on_content_hash TEXT NOT NULL,
        input_contract_version TEXT NOT NULL,
        store_profile_version TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        FOREIGN KEY(store_id, product_id) REFERENCES ${p}seo_products(store_id, id),
        FOREIGN KEY(store_id, product_id, based_on_version_id) REFERENCES ${p}seo_versions(store_id, product_id, id),
        FOREIGN KEY(store_id, product_id, based_on_snapshot_id) REFERENCES ${p}seo_content_snapshots(store_id, product_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_version_operation_receipts (
        operation_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('COMMITTED','NO_CHANGE')),
        version_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        FOREIGN KEY(store_id, product_id) REFERENCES ${p}seo_products(store_id, id),
        FOREIGN KEY(store_id, product_id, version_id) REFERENCES ${p}seo_versions(store_id, product_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_product_url_history (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, product_id TEXT NOT NULL,
        raw_url TEXT NOT NULL, normalized_url TEXT NOT NULL, canonical_url TEXT,
        alias_type TEXT NOT NULL, mapping_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        valid_from BIGINT NOT NULL, valid_to BIGINT,
        FOREIGN KEY(store_id, product_id) REFERENCES ${p}seo_products(store_id, id)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS seo_product_url_history_open
        ON ${p}seo_product_url_history(store_id, product_id) WHERE valid_to IS NULL`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_external_changes (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, product_id TEXT NOT NULL,
        committed_version_id TEXT NOT NULL, previous_observed_snapshot_id TEXT NOT NULL,
        observed_snapshot_id TEXT NOT NULL, observed_at BIGINT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'EXTERNAL_UNKNOWN', changed_fields JSONB NOT NULL,
        resolved_at BIGINT, resolution TEXT,
        FOREIGN KEY(store_id, product_id) REFERENCES ${p}seo_products(store_id, id),
        FOREIGN KEY(store_id, product_id, committed_version_id) REFERENCES ${p}seo_versions(store_id, product_id, id),
        FOREIGN KEY(store_id, product_id, previous_observed_snapshot_id) REFERENCES ${p}seo_content_snapshots(store_id, product_id, id),
        FOREIGN KEY(store_id, product_id, observed_snapshot_id) REFERENCES ${p}seo_content_snapshots(store_id, product_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS ${p}seo_version_audit (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, product_id TEXT,
        event_type TEXT NOT NULL, reference_id TEXT, payload JSONB NOT NULL,
        created_at BIGINT NOT NULL
      )`,
      `CREATE OR REPLACE FUNCTION ${p}reject_seo_immutable_update() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'SEO_IMMUTABLE_RECORD'; END; $$ LANGUAGE plpgsql`,
      `CREATE TRIGGER seo_content_snapshots_immutable BEFORE UPDATE OR DELETE ON ${p}seo_content_snapshots
        FOR EACH ROW EXECUTE FUNCTION ${p}reject_seo_immutable_update()`,
      `CREATE TRIGGER seo_versions_immutable BEFORE UPDATE OR DELETE ON ${p}seo_versions
        FOR EACH ROW EXECUTE FUNCTION ${p}reject_seo_immutable_update()`,
      `CREATE TRIGGER seo_version_operation_receipts_immutable BEFORE UPDATE OR DELETE ON ${p}seo_version_operation_receipts
        FOR EACH ROW EXECUTE FUNCTION ${p}reject_seo_immutable_update()`,
      `CREATE TRIGGER seo_version_audit_immutable BEFORE UPDATE OR DELETE ON ${p}seo_version_audit
        FOR EACH ROW EXECUTE FUNCTION ${p}reject_seo_immutable_update()`,
    ],
  }];
}

export async function applySeoVersionMigrations(database: WorkerDatabase, schema = "public", now: () => number = Date.now): Promise<void> {
  const p = prefix(schema);
  await database.transaction(async (sql: WorkerSql) => {
    await sql.query(`CREATE TABLE IF NOT EXISTS ${p}seo_version_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL
    )`);
    const applied = await sql.query(`SELECT version, name FROM ${p}seo_version_migrations ORDER BY version`);
    const appliedNames = new Map(applied.rows.map(row => [Number(row.version), String(row.name)]));
    for (const migration of getSeoVersionMigrations(schema)) {
      const existingName = appliedNames.get(migration.version);
      if (existingName !== undefined) {
        if (existingName !== migration.name) throw new Error("SEO_VERSION_MIGRATION_MISMATCH");
        continue;
      }
      for (const statement of migration.statements) await sql.query(statement);
      await sql.query(`INSERT INTO ${p}seo_version_migrations(version,name,applied_at) VALUES ($1,$2,$3)`, [migration.version, migration.name, now()]);
    }
  });
}
