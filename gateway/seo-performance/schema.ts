export const PERFORMANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sp_connection (id INTEGER PRIMARY KEY CHECK(id=1), encrypted_token TEXT NOT NULL, reconnect BOOLEAN NOT NULL DEFAULT false, generation TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_oauth_states (digest TEXT PRIMARY KEY, session_digest TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS sp_mappings (store_id TEXT PRIMARY KEY, property TEXT NOT NULL UNIQUE, origin TEXT NOT NULL UNIQUE, last_sync TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS sp_metrics (store_id TEXT NOT NULL, day DATE NOT NULL, dataset TEXT NOT NULL CHECK(dataset IN ('property','page','query')), page TEXT NOT NULL DEFAULT '', query TEXT NOT NULL DEFAULT '', dimension_key TEXT GENERATED ALWAYS AS (md5(length(page)::text || ':' || page || query)) STORED, clicks DOUBLE PRECISION NOT NULL, impressions DOUBLE PRECISION NOT NULL, position DOUBLE PRECISION NOT NULL, PRIMARY KEY(store_id,day,dataset,dimension_key));
CREATE INDEX IF NOT EXISTS sp_metrics_period ON sp_metrics(store_id,day,dataset);
CREATE TABLE IF NOT EXISTS sp_days (store_id TEXT NOT NULL, day DATE NOT NULL, dataset TEXT NOT NULL, complete BOOLEAN NOT NULL DEFAULT false, truncated BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY(store_id,day,dataset));
CREATE TABLE IF NOT EXISTS sp_pages (store_id TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, product_id TEXT, source JSONB, snapshot_id TEXT, checked_at TIMESTAMPTZ, attempted_at TIMESTAMPTZ, audit JSONB, inspection JSONB, inspected_at TIMESTAMPTZ, PRIMARY KEY(store_id,url));
CREATE TABLE IF NOT EXISTS sp_snapshots (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, url TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sp_jobs (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, kind TEXT NOT NULL, request_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', progress INTEGER NOT NULL DEFAULT 0, payload JSONB NOT NULL DEFAULT '{}', error TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(store_id,kind,request_key));
CREATE UNIQUE INDEX IF NOT EXISTS sp_one_background_job ON sp_jobs(store_id,kind) WHERE status IN ('pending','running') AND kind IN ('sync','crawl');
CREATE TABLE IF NOT EXISTS sp_inspection_quota (property TEXT NOT NULL, day DATE NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(property,day));
CREATE TABLE IF NOT EXISTS sp_recommendations (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, url TEXT NOT NULL, snapshot_id TEXT NOT NULL, payload JSONB NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', job_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(store_id,actor,request_id));
CREATE TABLE IF NOT EXISTS sp_events (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, store_id TEXT NOT NULL, event TEXT NOT NULL, details JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sp_events_store ON sp_events(store_id,id DESC);
CREATE TABLE IF NOT EXISTS sp_report_rows (job_id TEXT NOT NULL REFERENCES sp_jobs(id) ON DELETE CASCADE, period TEXT NOT NULL, dimension TEXT NOT NULL, row_key TEXT NOT NULL, key_hash TEXT GENERATED ALWAYS AS (md5(row_key)) STORED, clicks FLOAT8 NOT NULL, impressions FLOAT8 NOT NULL, position FLOAT8 NOT NULL, PRIMARY KEY(job_id,period,dimension,key_hash));
CREATE UNIQUE INDEX IF NOT EXISTS sp_events_key ON sp_events(store_id,event,(details->>'key')) WHERE details ? 'key';
`;

/** Individual statements let the numbered migration runner avoid multi-command prepared queries. */
export const PERFORMANCE_SCHEMA_STATEMENTS = PERFORMANCE_SCHEMA_SQL
  .split(";\n")
  .map(statement => statement.trim())
  .filter(statement => statement.length > 0)
  .map(statement => statement.endsWith(";") ? statement.slice(0, -1) : statement);
