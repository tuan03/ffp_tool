import { PERFORMANCE_SCHEMA_STATEMENTS } from "./schema";

const GOOGLE_SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface PerformanceMigrationConnection {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: Row[]; readonly rowCount: number | null }>;
  release(): void;
}

export interface PerformanceMigrationDatabase {
  connect(): Promise<PerformanceMigrationConnection>;
}

interface PerformanceMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

const PERFORMANCE_MIGRATIONS: readonly PerformanceMigration[] = [
  {
    version: 1,
    name: "bootstrap legacy seo performance schema",
    statements: PERFORMANCE_SCHEMA_STATEMENTS,
  },
  {
    version: 2,
    name: "add google connections and versioned store integrations",
    statements: [
      `CREATE TABLE IF NOT EXISTS sp_google_connections (
        id TEXT PRIMARY KEY,
        encrypted_refresh_token TEXT NOT NULL,
        cipher_version INTEGER NOT NULL DEFAULT 1 CHECK (cipher_version > 0),
        granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        status TEXT NOT NULL CHECK (status IN ('CONNECTED','RECONSENT_REQUIRED','RECONNECT_REQUIRED','DISCONNECTED')),
        generation TEXT NOT NULL,
        last_error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        disconnected_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS sp_oauth_states_v2 (
        state_digest TEXT PRIMARY KEY,
        session_digest TEXT NOT NULL,
        store_id TEXT NOT NULL,
        connection_id TEXT REFERENCES sp_google_connections(id),
        requested_sources TEXT[] NOT NULL,
        requested_scopes TEXT[] NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS sp_oauth_states_v2_expiry
        ON sp_oauth_states_v2(expires_at)`,
      `CREATE TABLE IF NOT EXISTS sp_store_integrations (
        store_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('GSC','GA4')),
        mapping_revision INTEGER NOT NULL CHECK (mapping_revision > 0),
        connection_id TEXT REFERENCES sp_google_connections(id),
        is_current BOOLEAN NOT NULL DEFAULT true,
        status TEXT NOT NULL CHECK (status IN ('CONNECTED','MISSING_PERMISSION','RECONNECT_REQUIRED','DISCONNECTED','NOT_CONFIGURED')),
        gsc_property_raw TEXT,
        ga4_property_id TEXT,
        storefront_origin TEXT NOT NULL,
        stream_id TEXT,
        hostname_scope TEXT,
        timezone TEXT,
        currency TEXT,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        retired_at TIMESTAMPTZ,
        PRIMARY KEY(store_id,source,mapping_revision),
        CHECK (
          (source='GSC' AND gsc_property_raw IS NOT NULL AND ga4_property_id IS NULL)
          OR
          (source='GA4' AND gsc_property_raw IS NULL AND ga4_property_id IS NOT NULL)
        ),
        CHECK (
          (is_current AND retired_at IS NULL)
          OR
          (NOT is_current AND retired_at IS NOT NULL)
        )
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS sp_store_integrations_current
        ON sp_store_integrations(store_id,source) WHERE is_current`,
      `CREATE INDEX IF NOT EXISTS sp_store_integrations_connection
        ON sp_store_integrations(connection_id)`,
      `INSERT INTO sp_google_connections(
        id,encrypted_refresh_token,cipher_version,granted_scopes,status,generation
      )
      SELECT
        'legacy-google-primary',
        encrypted_token,
        1,
        ARRAY['${GOOGLE_SEARCH_CONSOLE_SCOPE}']::TEXT[],
        CASE WHEN reconnect THEN 'RECONNECT_REQUIRED' ELSE 'CONNECTED' END,
        generation
      FROM sp_connection
      WHERE id=1
      ON CONFLICT(id) DO NOTHING`,
      `INSERT INTO sp_store_integrations(
        store_id,source,mapping_revision,connection_id,is_current,status,
        gsc_property_raw,storefront_origin,verified_at
      )
      SELECT
        mapping.store_id,
        'GSC',
        1,
        connection.id,
        true,
        CASE
          WHEN connection.id IS NULL THEN 'NOT_CONFIGURED'
          WHEN connection.status='RECONNECT_REQUIRED' THEN 'RECONNECT_REQUIRED'
          ELSE 'CONNECTED'
        END,
        mapping.property,
        mapping.origin,
        mapping.last_sync
      FROM sp_mappings AS mapping
      LEFT JOIN sp_google_connections AS connection
        ON connection.id='legacy-google-primary'
      ON CONFLICT(store_id,source,mapping_revision) DO NOTHING`,
    ],
  },
  {
    version: 3,
    name: "add provider facts inspection benchmarks and sync partitions",
    statements: [
      `CREATE TABLE IF NOT EXISTS sp_sync_runs (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('GSC','GA4','INSPECTION','BENCHMARK','RECOMMENDATION','HEALTH')),
        mapping_revision INTEGER,
        mode TEXT NOT NULL CHECK (mode IN ('BACKFILL','INCREMENTAL','ON_DEMAND','EVALUATE')),
        status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','PARTIAL','DONE','FAILED','CANCELLED')),
        data_through DATE,
        last_error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS sp_sync_runs_store_source ON sp_sync_runs(store_id,source,created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS sp_sync_partitions (
        run_id TEXT NOT NULL REFERENCES sp_sync_runs(id) ON DELETE CASCADE,
        partition_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
        cursor TEXT,
        rows_fetched INTEGER NOT NULL DEFAULT 0 CHECK (rows_fetched >= 0),
        fetch_complete BOOLEAN NOT NULL DEFAULT false,
        source_coverage TEXT NOT NULL DEFAULT 'UNKNOWN',
        quality JSONB NOT NULL DEFAULT '{}'::jsonb,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_error_code TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(run_id,partition_key)
      )`,
      `CREATE TABLE IF NOT EXISTS sp_ga4_facts (
        store_id TEXT NOT NULL,
        mapping_revision INTEGER NOT NULL,
        property_id TEXT NOT NULL,
        day DATE NOT NULL,
        dataset TEXT NOT NULL CHECK (dataset IN ('LANDING','ENGAGEMENT','EVENT','REVENUE','ITEM')),
        dimension_key TEXT NOT NULL,
        dimensions JSONB NOT NULL,
        metrics JSONB NOT NULL,
        quality JSONB NOT NULL DEFAULT '{}'::jsonb,
        data_revision TEXT NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(store_id,mapping_revision,property_id,day,dataset,dimension_key)
      )`,
      `CREATE INDEX IF NOT EXISTS sp_ga4_facts_lookup ON sp_ga4_facts(store_id,day,dataset)`,
      `CREATE TABLE IF NOT EXISTS sp_inspection_history (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        mapping_revision INTEGER NOT NULL,
        url TEXT NOT NULL,
        version_id TEXT,
        verdict TEXT,
        coverage_state TEXT,
        last_crawl_at TIMESTAMPTZ,
        fetch_state TEXT,
        robots_state TEXT,
        indexing_state TEXT,
        google_canonical TEXT,
        user_canonical TEXT,
        result_link TEXT,
        derived_state TEXT NOT NULL,
        technical_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
        inspected_at TIMESTAMPTZ NOT NULL,
        raw_payload JSONB NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS sp_inspection_history_url ON sp_inspection_history(store_id,url,inspected_at DESC)`,
      `CREATE TABLE IF NOT EXISTS sp_benchmark_runs (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        version_id TEXT,
        mode TEXT NOT NULL CHECK (mode IN ('CALENDAR','VERSION')),
        checkpoint_days INTEGER CHECK (checkpoint_days IN (7,14,28)),
        rules_version TEXT NOT NULL,
        metric_contract_version TEXT NOT NULL,
        data_revision TEXT NOT NULL,
        filters JSONB NOT NULL,
        before_window JSONB,
        after_window JSONB,
        output JSONB NOT NULL,
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(store_id,product_id,version_id,mode,checkpoint_days,rules_version,metric_contract_version,data_revision,filters)
      )`,
      `CREATE INDEX IF NOT EXISTS sp_benchmark_runs_product ON sp_benchmark_runs(store_id,product_id,calculated_at DESC)`,
      `ALTER TABLE sp_recommendations DROP CONSTRAINT IF EXISTS sp_recommendations_status_check`,
      `ALTER TABLE sp_recommendations ADD CONSTRAINT sp_recommendations_status_check CHECK (status IN (
        'proposed','draft_queued','draft_ready','applied_closed','dismissed','snoozed','stale',
        'draft_failed','draft_cancelled','no_change_closed','queued','applied'
      ))`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS benchmark_run_id TEXT REFERENCES sp_benchmark_runs(id)`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS rules_version TEXT`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS reason_code TEXT`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS product_id TEXT`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS version_id TEXT`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS content_hash TEXT`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ`,
      `ALTER TABLE sp_recommendations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
      `CREATE UNIQUE INDEX IF NOT EXISTS sp_recommendations_deterministic
        ON sp_recommendations(store_id,product_id,version_id,reason_code,rules_version)
        WHERE product_id IS NOT NULL AND version_id IS NOT NULL AND reason_code IS NOT NULL AND rules_version IS NOT NULL`,
    ],
  },
];

export const SEO_PERFORMANCE_SCHEMA_VERSION =
  PERFORMANCE_MIGRATIONS.at(-1)?.version ?? 0;

export async function applyPerformanceMigrations(
  database: PerformanceMigrationDatabase,
): Promise<void> {
  const connection = await database.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      "SELECT pg_advisory_xact_lock(hashtext('sp_schema_migrations'))",
    );
    await connection.query(`CREATE TABLE IF NOT EXISTS sp_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const applied = await connection.query<{ version: number; name: string }>(
      "SELECT version,name FROM sp_schema_migrations ORDER BY version",
    );
    const knownVersions = new Map(
      PERFORMANCE_MIGRATIONS.map(migration => [migration.version, migration.name]),
    );
    for (const row of applied.rows) {
      const expectedName = knownVersions.get(Number(row.version));
      if (expectedName === undefined) {
        throw new Error("SEO_PERFORMANCE_MIGRATION_AHEAD");
      }
      if (expectedName !== row.name) {
        throw new Error("SEO_PERFORMANCE_MIGRATION_MISMATCH");
      }
    }

    const appliedVersions = new Set(
      applied.rows.map(row => Number(row.version)),
    );
    for (const migration of PERFORMANCE_MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;
      for (const statement of migration.statements) {
        await connection.query(statement);
      }
      await connection.query(
        "INSERT INTO sp_schema_migrations(version,name) VALUES($1,$2)",
        [migration.version, migration.name],
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    try {
      await connection.query("ROLLBACK");
    } catch {
      // Preserve the migration failure; a rollback error must not hide its cause.
    }
    throw error;
  } finally {
    connection.release();
  }
}
