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
      const payload = { id: String(index), storeId, status: "REVIEW_READY", source: "auto_seo", sourceIdentity: String(index), original: { title: "Original", images: [{ url: "https://example.test/image" }], descriptionHtml: "large backup".repeat(10000) }, result: { output: { productTitle: `Generated ${index}` } }, updatedAt: index + 1000 };
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
    const beforeArchive = (await pool.query(`SELECT payload FROM "${schema}".gpt_jobs WHERE id='53'`)).rows[0].payload;
    await queue.archiveReview("demo", "53");
    assert.equal((await queue.reviewList({ storeId: "demo", workspace: "work" })).total, 53);
    const history = await queue.reviewList({ storeId: "demo", workspace: "history" });
    assert.equal(history.total, 1);
    assert.equal(history.counts?.history, 1);
    assert.equal(history.counts?.pending, 53);
    assert.equal(history.items[0].actions?.canSync, false);
    assert.equal(history.items[0].actions?.canDecide, false);
    assert.equal((await pool.query(`SELECT payload FROM "${schema}".gpt_jobs WHERE id='53'`)).rows[0].payload, beforeArchive);
    await assert.rejects(queue.beginSync("demo", "53"), /REVIEW_ARCHIVED/);
    await assert.rejects(queue.archiveReview("other", "53"), /not found/i);
    await pool.query(`INSERT INTO "${schema}".gpt_sync(job_id,token,status) VALUES('52','fixture','UNKNOWN')`);
    await assert.rejects(queue.archiveReview("demo", "52"), /REVIEW_BUSY/);
    assert.equal((await queue.reviewList({ storeId: "demo", workspace: "work", stage: "syncing" })).total, 1);
    const insertPublish = async (jobId: string, state: string, hasWriteIntent = false) => {
      await pool.query(`INSERT INTO "${schema}".seo_publish_operations(id,job_id,store_id,product_id,request_id,review_revision,review_fingerprint,operator,fields,source_version,baseline_version,state,has_write_intent,created_at,updated_at)
        VALUES($1,$1,'demo',$1,$1,1,'fixture','qa','{}','v1',0,$2,$3,1,1)`, [jobId, state, hasWriteIntent]);
    };
    await insertPublish("51", "SUCCEEDED");
    const receipt = (await pool.query(`SELECT * FROM "${schema}".seo_publish_operations WHERE job_id='51'`)).rows[0];
    const synced = await queue.reviewList({ storeId: "demo", workspace: "history" });
    assert.equal(synced.counts?.history, 2);
    assert.equal(synced.items.find(row => row.recordId === "51")?.actions?.canDecide, false);
    await queue.archiveReview("demo", "51");
    await queue.archiveReview("demo", "51");
    assert.deepEqual((await pool.query(`SELECT * FROM "${schema}".seo_publish_operations WHERE job_id='51'`)).rows[0], receipt);
    assert.equal((await queue.reviewState("demo", "51")).shopifySyncStatus, "synced");
    await insertPublish("50", "BLOCKED", true);
    await insertPublish("49", "QUEUED");
    await assert.rejects(queue.archiveReview("demo", "50"), /REVIEW_BUSY/);
    await assert.rejects(queue.archiveReview("demo", "49"), /REVIEW_BUSY/);
    assert.equal((await queue.reviewList({ storeId: "demo", stage: "failed" })).items[0].actions?.canArchive, false);
    await pool.query(`INSERT INTO "${schema}".seo_review_items(item_id,store_id,product_id,handle,title,review_status,generated_payload,updated_at,source_origin) VALUES('legacy','demo','123','old','Old','pending',$1,'2026-10-10T12:00:00Z','auto_seo')`, [JSON.stringify({ productTitle: "Light legacy", images: [{ sourceUrl: "https://example.test/legacy" }], productDescription: "large seo".repeat(10000) })]);
    const legacy = await auto.listSummaries({ storeId: "demo" });
    assert.equal(legacy.total, 1); assert.equal(legacy.items[0].title, "Light legacy");
    assert.equal((await auto.listSummaries({ storeId: "other" })).total, 0);
    assert.ok(JSON.stringify(legacy).length < 1000);
    assert.equal(await auto.archive("legacy", "other"), false);
    assert.equal(await auto.archive("legacy", "demo"), true);
    assert.equal((await auto.listSummaries({ storeId: "demo", workspace: "work" })).total, 0);
    assert.equal((await auto.listSummaries({ storeId: "demo", workspace: "history" })).total, 1);
    assert.equal((await pool.query(`SELECT generated_payload FROM "${schema}".seo_review_items WHERE item_id='legacy'`)).rows[0].generated_payload,
      JSON.stringify({ productTitle: "Light legacy", images: [{ sourceUrl: "https://example.test/legacy" }], productDescription: "large seo".repeat(10000) }));
    const backup = { backupId: "archive-backup-1", workflowId: "archive-qa", storeId: "demo", shopDomain: "demo.myshopify.com", productId: "456",
      productHandle: "original", productTitle: "Original", snapshotJson: JSON.stringify({ id: "456", title: "Original", descriptionHtml: "Keep backup" }), snapshotSha256: "a".repeat(64) };
    await backups.insertBackupBatch([backup, { ...backup, backupId: "archive-backup-2", workflowId: "archive-qa-2" }]);
    const review = { itemId: "archive-generation", storeId: "demo", productId: "456", backupId: backup.backupId, handle: "new", title: "New",
      reviewStatus: "pending" as const, generatedPayload: "{}", shopifyUpdatedAt: null };
    await auto.saveReview(review);
    await auto.archive(review.itemId, "demo");
    await auto.saveReview(review);
    assert.ok((await auto.findHydrated(review.itemId))?.reviewArchivedAt);
    await auto.saveReview({ ...review, backupId: "archive-backup-2" });
    assert.equal((await auto.findHydrated(review.itemId))?.reviewArchivedAt, undefined);
    assert.equal((await auto.findHydrated(review.itemId))?.originalBackup.productDescription, "Keep backup");
  } finally {
    await queue.close(); await auto.close(); await backups.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
  }
});
