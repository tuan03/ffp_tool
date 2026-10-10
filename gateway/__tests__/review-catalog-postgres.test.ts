import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";
import { AutoSeoPostgresReviewRepository } from "../auto-seo-review-postgres";
import { AutoSeoPostgresRepository } from "../auto-seo-postgres-repository";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;

test("PostgreSQL catalogs scope, paginate and project saved edits without full snapshots", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const schema = `review_catalog_test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: databaseUrl });
  const queue = new PostgresCustomGptQueue({ databaseUrl, schema });
  const auto = new AutoSeoPostgresReviewRepository({ databaseUrl, schema });
  const backups = new AutoSeoPostgresRepository({ databaseUrl, schema });
  try {
    await queue.initialize(); await backups.initializeSchema(); await auto.initializeSchema();
    for (let index = 0; index < 55; index++) {
      const storeId = index === 54 ? "other" : "demo";
      const payload = { source: "auto_seo", sourceIdentity: String(index), original: { title: "Original", images: [{ url: "https://example.test/image" }], descriptionHtml: "large backup".repeat(10000) }, result: { output: { productTitle: `Generated ${index}` } }, updatedAt: index + 1000 };
      await pool.query(`INSERT INTO "${schema}".gpt_jobs(id,store_id,dedup,status,payload,created_at) VALUES($1,$2,$1,'REVIEW_READY',$3,$4)`, [String(index), storeId, JSON.stringify(payload), index + 1000]);
    }
    await pool.query(`INSERT INTO "${schema}".gpt_review_state(job_id,payload) VALUES('53',$1)`, [JSON.stringify({ productTitle: { value: "Edited 100%" }, reviewDecision: "approved", updatedAt: 2000 })]);
    const first = await queue.reviewList({ storeId: "demo" });
    assert.equal(first.total, 54); assert.equal(first.items.length, 50); assert.equal(first.nextOffset, 50);
    assert.equal(first.items[0].title, "Edited 100%"); assert.equal(first.items[0].decision, "approved");
    assert.ok(JSON.stringify(first).length < 30000);
    assert.equal((await queue.reviewList({ storeId: "demo", search: "100%" })).total, 1);
    assert.equal((await queue.reviewList({ storeId: "demo", offset: 50 })).items.length, 4);
    assert.equal((await queue.reviewList({ storeId: "other" })).total, 1);
    await pool.query(`INSERT INTO "${schema}".seo_review_items(item_id,store_id,product_id,handle,title,review_status,generated_payload,updated_at,source_origin) VALUES('legacy','demo','123','old','Old','pending',$1,'2026-10-10T12:00:00Z','auto_seo')`, [JSON.stringify({ productTitle: "Light legacy", images: [{ sourceUrl: "https://example.test/legacy" }], productDescription: "large seo".repeat(10000) })]);
    const legacy = await auto.listSummaries({ storeId: "demo" });
    assert.equal(legacy.total, 1); assert.equal(legacy.items[0].title, "Light legacy");
    assert.equal((await auto.listSummaries({ storeId: "other" })).total, 0);
    assert.ok(JSON.stringify(legacy).length < 1000);
  } finally {
    await queue.close(); await auto.close(); await backups.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
  }
});
