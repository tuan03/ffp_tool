import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { Pool } from "pg";

import { bootstrapAutoSeoSchema } from "../auto-seo-startup";
import { startGatewayServerWhenReady } from "../server";

const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

async function withFreshSchema(run: (pool: Pool, schema: string) => Promise<void>): Promise<void> {
  if (!databaseUrl) throw new Error("AUTO_SEO_TEST_DATABASE_URL is required");
  const schema = `auto_seo_b5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await run(pool, schema);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
}

test("startup rejects missing Auto SEO PostgreSQL configuration", async () => {
  await assert.rejects(bootstrapAutoSeoSchema({ databaseUrl: "" }), /AUTO_SEO_DATABASE_URL/);
  await assert.rejects(startGatewayServerWhenReady({ port: 0 }, { databaseUrl: "" }), /AUTO_SEO_DATABASE_URL/);
});

integrationTest("startup creates and verifies both tables in a fresh schema and is idempotent", async () => {
  await withFreshSchema(async (pool, schema) => {
    if (!databaseUrl) throw new Error("AUTO_SEO_TEST_DATABASE_URL is required");
    assert.equal((await pool.query("SELECT to_regclass($1) AS table_name", [`${schema}.auto_seo_product_backups`])).rows[0]?.table_name, null);
    await bootstrapAutoSeoSchema({ databaseUrl, schema });
    await pool.query(`
      INSERT INTO ${schema}.auto_seo_product_backups
        (backup_id, workflow_id, store_id, shop_domain, product_id, product_handle,
         product_title, snapshot_json, snapshot_sha256, downstream_status)
      VALUES ('b5-backup', 'b5-workflow', 'b5-store', 'b5.example.com', 'b5-product',
              'b5-handle', 'Original', '{"id":"b5-product","title":"Original"}', 'sha256', 'NOT_SENT')
    `);
    await pool.query(`
      INSERT INTO ${schema}.seo_review_items
        (item_id, store_id, product_id, handle, title, generated_payload, source_origin, backup_id)
      VALUES ('b5-review', 'b5-store', 'b5-product', 'b5-handle', 'Review', '{}', 'auto_seo', 'b5-backup')
    `);
    await bootstrapAutoSeoSchema({ databaseUrl, schema });
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name", [schema],
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), ["auto_seo_product_backups", "seo_review_items"]);
    const indexes = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname=$1", [schema],
    );
    for (const indexName of ["idx_auto_seo_store_product", "idx_auto_seo_created_at", "idx_seo_review_store_status"]) {
      assert.equal(indexes.rows.filter((row) => row.indexname === indexName).length, 1);
    }
    const constraints = await pool.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=$1::regnamespace", [schema],
    );
    for (const definition of ["UNIQUE (backup_id)", "UNIQUE (workflow_id, store_id, product_id)", "UNIQUE (store_id, product_id)", "FOREIGN KEY (backup_id)"]) {
      assert.ok(constraints.rows.some((row) => row.definition.includes(definition)), definition);
    }
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${schema}.auto_seo_product_backups`)).rows[0]?.count, 1);
    const review = await pool.query<{ backup_id: string }>(`SELECT backup_id FROM ${schema}.seo_review_items WHERE item_id='b5-review'`);
    assert.equal(review.rows[0]?.backup_id, "b5-backup");
  });
});

integrationTest("startup rejects a backup unique constraint found only on another table", async () => {
  await withFreshSchema(async (pool, schema) => {
    if (!databaseUrl) throw new Error("AUTO_SEO_TEST_DATABASE_URL is required");
    await bootstrapAutoSeoSchema({ databaseUrl, schema });
    await pool.query(`ALTER TABLE ${schema}.auto_seo_product_backups DROP CONSTRAINT uq_auto_seo_workflow_store_product`);
    await pool.query(`
      CREATE TABLE ${schema}.other_backups (
        workflow_id TEXT, store_id TEXT, product_id TEXT,
        CONSTRAINT uq_auto_seo_workflow_store_product UNIQUE (workflow_id, store_id, product_id)
      )
    `);
    await assert.rejects(bootstrapAutoSeoSchema({ databaseUrl, schema }), /schema verification failed/);
  });
});

integrationTest("startup rejects a review unique constraint found only on another table", async () => {
  await withFreshSchema(async (pool, schema) => {
    if (!databaseUrl) throw new Error("AUTO_SEO_TEST_DATABASE_URL is required");
    await bootstrapAutoSeoSchema({ databaseUrl, schema });
    await pool.query(`ALTER TABLE ${schema}.seo_review_items DROP CONSTRAINT uq_seo_review_store_product`);
    await pool.query(`
      CREATE TABLE ${schema}.other_reviews (
        store_id TEXT, product_id TEXT,
        CONSTRAINT uq_seo_review_store_product UNIQUE (store_id, product_id)
      )
    `);
    await assert.rejects(bootstrapAutoSeoSchema({ databaseUrl, schema }), /schema verification failed/);
  });
});

integrationTest("startup rejects a required index found only on another table", async () => {
  await withFreshSchema(async (pool, schema) => {
    if (!databaseUrl) throw new Error("AUTO_SEO_TEST_DATABASE_URL is required");
    await bootstrapAutoSeoSchema({ databaseUrl, schema });
    await pool.query(`DROP INDEX ${schema}.idx_auto_seo_store_product`);
    await pool.query(`CREATE TABLE ${schema}.other_products (store_id TEXT, product_id TEXT)`);
    await pool.query(`CREATE INDEX idx_auto_seo_store_product ON ${schema}.other_products(store_id, product_id)`);
    await assert.rejects(bootstrapAutoSeoSchema({ databaseUrl, schema }), /schema verification failed/);
  });
});
