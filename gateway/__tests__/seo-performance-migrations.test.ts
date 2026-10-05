import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  applyPerformanceMigrations,
  SEO_PERFORMANCE_SCHEMA_VERSION,
} from "../seo-performance/migrations";
import type {
  PerformanceMigrationConnection,
  PerformanceMigrationDatabase,
} from "../seo-performance/migrations";
import { PERFORMANCE_SCHEMA_SQL } from "../seo-performance/schema";

interface TestDatabase {
  readonly database: PGlite;
  readonly adapter: PerformanceMigrationDatabase;
}

async function createTestDatabase(
  shouldFail?: (sql: string) => boolean,
): Promise<TestDatabase> {
  const database = await PGlite.create();
  const connection: PerformanceMigrationConnection = {
    query: async <Row,>(sql: string, values?: readonly unknown[]) => {
      if (shouldFail?.(sql)) throw new Error("INJECTED_MIGRATION_FAILURE");
      const result = await database.query<Row>(sql, values ? [...values] : undefined);
      return {
        rows: result.rows,
        rowCount: result.affectedRows || result.rows.length,
      };
    },
    release: () => {},
  };
  return { database, adapter: { connect: async () => connection } };
}

test("SEO Performance migrations create the complete schema and rerun idempotently", async () => {
  const fixture = await createTestDatabase();
  try {
    await applyPerformanceMigrations(fixture.adapter);
    await applyPerformanceMigrations(fixture.adapter);

    const migrations = await fixture.database.query<{ version: number }>(
      "SELECT version FROM sp_schema_migrations ORDER BY version",
    );
    assert.deepEqual(
      migrations.rows.map(row => Number(row.version)),
      Array.from({ length: SEO_PERFORMANCE_SCHEMA_VERSION }, (_, index) => index + 1),
    );
    const tables = await fixture.database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN (
         'sp_connection','sp_mappings','sp_google_connections',
         'sp_oauth_states_v2','sp_store_integrations'
       ) ORDER BY table_name`,
    );
    assert.deepEqual(
      tables.rows.map(row => row.table_name),
      [
        "sp_connection",
        "sp_google_connections",
        "sp_mappings",
        "sp_oauth_states_v2",
        "sp_store_integrations",
      ],
    );
  } finally {
    await fixture.database.close();
  }
});

test("SEO Performance migrations backfill legacy credentials and mappings without deleting them", async () => {
  const fixture = await createTestDatabase();
  try {
    await fixture.database.exec(PERFORMANCE_SCHEMA_SQL);
    await fixture.database.query(
      "INSERT INTO sp_connection(id,encrypted_token,reconnect,generation) VALUES(1,$1,true,$2)",
      ["legacy-ciphertext", "legacy-generation"],
    );
    await fixture.database.query(
      "INSERT INTO sp_mappings(store_id,property,origin,last_sync) VALUES($1,$2,$3,$4)",
      [
        "jeminise",
        "sc-domain:example.com",
        "https://example.com",
        "2026-10-01T00:00:00.000Z",
      ],
    );

    await applyPerformanceMigrations(fixture.adapter);
    await applyPerformanceMigrations(fixture.adapter);

    const connection = await fixture.database.query<{
      encrypted_refresh_token: string;
      status: string;
      granted_scopes: string[];
    }>("SELECT encrypted_refresh_token,status,granted_scopes FROM sp_google_connections");
    assert.equal(connection.rows[0].encrypted_refresh_token, "legacy-ciphertext");
    assert.equal(connection.rows[0].status, "RECONNECT_REQUIRED");
    assert.deepEqual(connection.rows[0].granted_scopes, [
      "https://www.googleapis.com/auth/webmasters.readonly",
    ]);

    const integration = await fixture.database.query<{
      connection_id: string;
      mapping_revision: number;
      status: string;
      gsc_property_raw: string;
      storefront_origin: string;
    }>("SELECT * FROM sp_store_integrations");
    assert.equal(integration.rows.length, 1);
    assert.deepEqual(
      {
        connectionId: integration.rows[0].connection_id,
        revision: Number(integration.rows[0].mapping_revision),
        status: integration.rows[0].status,
        property: integration.rows[0].gsc_property_raw,
        origin: integration.rows[0].storefront_origin,
      },
      {
        connectionId: "legacy-google-primary",
        revision: 1,
        status: "RECONNECT_REQUIRED",
        property: "sc-domain:example.com",
        origin: "https://example.com",
      },
    );
    assert.equal(
      Number((await fixture.database.query<{ count: string }>(
        "SELECT count(*) AS count FROM sp_connection",
      )).rows[0].count),
      1,
    );
    assert.equal(
      Number((await fixture.database.query<{ count: string }>(
        "SELECT count(*) AS count FROM sp_mappings",
      )).rows[0].count),
      1,
    );
  } finally {
    await fixture.database.close();
  }
});

test("legacy mappings without a credential remain explicit and recoverable", async () => {
  const fixture = await createTestDatabase();
  try {
    await fixture.database.exec(PERFORMANCE_SCHEMA_SQL);
    await fixture.database.query(
      "INSERT INTO sp_mappings(store_id,property,origin) VALUES($1,$2,$3)",
      ["store-without-grant", "sc-domain:orphan.example", "https://orphan.example"],
    );
    await applyPerformanceMigrations(fixture.adapter);
    const integration = await fixture.database.query<{
      connection_id: string | null;
      status: string;
    }>("SELECT connection_id,status FROM sp_store_integrations");
    assert.deepEqual(integration.rows, [
      { connection_id: null, status: "NOT_CONFIGURED" },
    ]);
  } finally {
    await fixture.database.close();
  }
});

test("migration metadata mismatch fails closed without changing the ledger", async () => {
  const fixture = await createTestDatabase();
  try {
    await fixture.database.exec(`CREATE TABLE sp_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    ); INSERT INTO sp_schema_migrations(version,name) VALUES(1,'wrong name');`);
    await assert.rejects(
      applyPerformanceMigrations(fixture.adapter),
      /SEO_PERFORMANCE_MIGRATION_MISMATCH/,
    );
    const ledger = await fixture.database.query<{ name: string }>(
      "SELECT name FROM sp_schema_migrations WHERE version=1",
    );
    assert.equal(ledger.rows[0].name, "wrong name");
    const tables = await fixture.database.query<{ count: string }>(
      `SELECT count(*) AS count FROM information_schema.tables
       WHERE table_schema='public' AND table_name='sp_google_connections'`,
    );
    assert.equal(Number(tables.rows[0].count), 0);
  } finally {
    await fixture.database.close();
  }
});

test("a failed migration rolls back schema and ledger changes", async () => {
  const fixture = await createTestDatabase(sql =>
    sql.includes("CREATE TABLE IF NOT EXISTS sp_store_integrations"),
  );
  try {
    await assert.rejects(
      applyPerformanceMigrations(fixture.adapter),
      /INJECTED_MIGRATION_FAILURE/,
    );
    const tables = await fixture.database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'sp_%'`,
    );
    assert.deepEqual(tables.rows, []);
  } finally {
    await fixture.database.close();
  }
});

test("only one current integration revision is allowed per store and source", async () => {
  const fixture = await createTestDatabase();
  try {
    await applyPerformanceMigrations(fixture.adapter);
    const values = [
      "jeminise",
      "GSC",
      1,
      "CONNECTED",
      "sc-domain:example.com",
      "https://example.com",
    ];
    await fixture.database.query(
      `INSERT INTO sp_store_integrations(
        store_id,source,mapping_revision,status,gsc_property_raw,storefront_origin
      ) VALUES($1,$2,$3,$4,$5,$6)`,
      values,
    );
    await assert.rejects(
      fixture.database.query(
        `INSERT INTO sp_store_integrations(
          store_id,source,mapping_revision,status,gsc_property_raw,storefront_origin
        ) VALUES($1,$2,$3,$4,$5,$6)`,
        [values[0], values[1], 2, ...values.slice(3)],
      ),
      /sp_store_integrations_current|duplicate key/i,
    );
    await fixture.database.query(
      `UPDATE sp_store_integrations
       SET is_current=false,retired_at=now()
       WHERE store_id=$1 AND source=$2 AND mapping_revision=$3`,
      values.slice(0, 3),
    );
    await fixture.database.query(
      `INSERT INTO sp_store_integrations(
        store_id,source,mapping_revision,status,gsc_property_raw,storefront_origin
      ) VALUES($1,$2,$3,$4,$5,$6)`,
      [values[0], values[1], 2, ...values.slice(3)],
    );
  } finally {
    await fixture.database.close();
  }
});
