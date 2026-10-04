/** Additive metadata only. Product inputs and drafts remain in the existing queue. */
export function getSeoWorkerSchemaSql(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid SEO worker schema");
  const prefix = `"${schema}".`;
  return `
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_metric_coverage (id BOOLEAN PRIMARY KEY CHECK(id), started_at BIGINT NOT NULL);
    INSERT INTO ${prefix}seo_worker_metric_coverage VALUES (true,floor(extract(epoch FROM clock_timestamp())*1000)::bigint) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_metric_events (id TEXT PRIMARY KEY,store_id TEXT NOT NULL,kind TEXT NOT NULL,occurred_at BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS seo_worker_metric_window ON ${prefix}seo_worker_metric_events(store_id,occurred_at);
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_stores (
      store_id TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_cutovers (store_id TEXT PRIMARY KEY, draining BOOLEAN NOT NULL);
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_tokens (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, worker_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
      revoked_at BIGINT, last_used_at BIGINT,
      CHECK (expires_at > created_at)
    );
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_sessions (
      id TEXT PRIMARY KEY, token_id TEXT NOT NULL REFERENCES ${prefix}seo_worker_tokens(id),
      store_id TEXT NOT NULL, worker_id TEXT NOT NULL, active BOOLEAN NOT NULL,
      created_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS seo_worker_active_session ON ${prefix}seo_worker_sessions(store_id,worker_id) WHERE active;
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_runs (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, worker_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES ${prefix}seo_worker_sessions(id),
      target BIGINT NOT NULL CHECK (target > 0), successful BIGINT NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK (state IN ('RUNNING','PARTIAL','COMPLETED')),
      stop_reason TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
      CHECK (successful >= 0 AND successful <= target)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS seo_worker_active_run ON ${prefix}seo_worker_runs(store_id,worker_id) WHERE state='RUNNING';
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_jobs (
      job_id TEXT PRIMARY KEY REFERENCES ${prefix}gpt_jobs(id),
      store_id TEXT NOT NULL, product_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('READY','LEASED','PROCESSING','SUBMITTING','READY_FOR_REVIEW','RETRY_WAIT','BLOCKED','FAILED_FINAL','CANCELLED','CLOSED')),
      pipeline_active BOOLEAN NOT NULL DEFAULT true,
      attempt_count INTEGER NOT NULL DEFAULT 0, repair_count INTEGER NOT NULL DEFAULT 0,
      lease_version INTEGER NOT NULL DEFAULT 0, lease_id TEXT, worker_id TEXT,
      session_id TEXT REFERENCES ${prefix}seo_worker_sessions(id),
      run_id TEXT REFERENCES ${prefix}seo_worker_runs(id),
      token_id TEXT REFERENCES ${prefix}seo_worker_tokens(id),
      expires_at BIGINT, last_progress_at BIGINT, retry_at BIGINT,
      last_error_code TEXT, updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS seo_worker_product_pipeline ON ${prefix}seo_worker_jobs(store_id,product_key) WHERE pipeline_active;
    CREATE UNIQUE INDEX IF NOT EXISTS seo_worker_single_lease ON ${prefix}seo_worker_jobs(session_id) WHERE lease_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS seo_worker_single_machine_lease ON ${prefix}seo_worker_jobs(store_id,worker_id) WHERE lease_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS seo_worker_recovery ON ${prefix}seo_worker_jobs(expires_at) WHERE lease_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_attempts (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ${prefix}gpt_jobs(id),
      session_id TEXT NOT NULL REFERENCES ${prefix}seo_worker_sessions(id),
      run_id TEXT NOT NULL REFERENCES ${prefix}seo_worker_runs(id),
      lease_version INTEGER NOT NULL, started_at BIGINT NOT NULL, ended_at BIGINT,
      result TEXT, UNIQUE(job_id,lease_version)
    );
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_successes (
      job_id TEXT PRIMARY KEY REFERENCES ${prefix}gpt_jobs(id),
      run_id TEXT NOT NULL REFERENCES ${prefix}seo_worker_runs(id), completed_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_requests (
      scope TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
      response JSONB NOT NULL, PRIMARY KEY(scope,request_id)
    );
    CREATE INDEX IF NOT EXISTS seo_worker_attempt_started ON ${prefix}seo_worker_attempts(started_at);
    CREATE INDEX IF NOT EXISTS seo_worker_attempt_ended ON ${prefix}seo_worker_attempts(ended_at);
    CREATE INDEX IF NOT EXISTS seo_worker_success_completed ON ${prefix}seo_worker_successes(completed_at);
    CREATE INDEX IF NOT EXISTS seo_worker_state_counts ON ${prefix}seo_worker_jobs(store_id,state);
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_image_receipts (
      job_id TEXT NOT NULL REFERENCES ${prefix}gpt_jobs(id), lease_version INTEGER NOT NULL,
      image_id TEXT NOT NULL, sha256 TEXT NOT NULL, viewed_at BIGINT NOT NULL,
      PRIMARY KEY(job_id,lease_version,image_id)
    );
    CREATE TABLE IF NOT EXISTS ${prefix}seo_worker_revisions (
      store_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
      previous_job_id TEXT NOT NULL UNIQUE REFERENCES ${prefix}gpt_jobs(id),
      job_id TEXT NOT NULL UNIQUE REFERENCES ${prefix}gpt_jobs(id),
      operator TEXT NOT NULL, created_at BIGINT NOT NULL,
      PRIMARY KEY(store_id,request_id)
    );
  `;
}
