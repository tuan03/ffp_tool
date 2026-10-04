export function getSeoPublishSchemaSql(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid publish schema");
  const p = `"${schema}".`;
  return `CREATE TABLE IF NOT EXISTS ${p}seo_publish_operations (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES ${p}gpt_jobs(id),
    store_id TEXT NOT NULL, product_id TEXT NOT NULL, request_id TEXT NOT NULL,
    review_revision BIGINT NOT NULL, review_fingerprint TEXT NOT NULL, operator TEXT NOT NULL, fields JSONB NOT NULL,
    source_version TEXT NOT NULL, baseline_version BIGINT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('QUEUED','CHECKING','WRITING','UNCERTAIN','SUCCEEDED','BLOCKED')),
    lease_id TEXT, lease_until BIGINT, attempts INTEGER NOT NULL DEFAULT 0,
    retry_at BIGINT NOT NULL DEFAULT 0, error_code TEXT, seo_version BIGINT,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(store_id,request_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS seo_publish_active_product ON ${p}seo_publish_operations(store_id,product_id) WHERE state!='SUCCEEDED';
  ALTER TABLE ${p}seo_publish_operations ADD COLUMN IF NOT EXISTS has_write_intent BOOLEAN NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS ${p}seo_publish_versions (
    operation_id TEXT PRIMARY KEY REFERENCES ${p}seo_publish_operations(id),
    store_id TEXT NOT NULL, product_id TEXT NOT NULL, version BIGINT NOT NULL,
    confirmed_at BIGINT NOT NULL, UNIQUE(store_id,product_id,version)
  );`;
}
