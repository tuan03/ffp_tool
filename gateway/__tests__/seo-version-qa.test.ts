import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";
import type { SeoContentSnapshotInput } from "../seo-versioning";

import { createTestEnqueue } from "./seo-v2-fixtures";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

function baselineSnapshot(): SeoContentSnapshotInput {
  return {
    contentHash: "a".repeat(64),
    title: "QA duvet cover",
    descriptionHtml: "<p>Baseline description</p>",
    seoTitle: "QA duvet cover",
    seoDescription: "Baseline metadata",
    images: [{
      mediaGid: "gid://shopify/MediaImage/123",
      imageUrl: "https://cdn.shopify.com/qa-duvet.jpg",
      alt: "QA duvet cover",
      width: 1_200,
      height: 1_200,
    }],
    aeoMetafields: {},
    handle: "qa-duvet-cover",
    onlineStoreUrl: "https://qa.example/products/qa-duvet-cover",
    observedCanonicalUrl: "https://qa.example/products/qa-duvet-cover",
    shopifyStatus: "ACTIVE",
    vendor: "QA",
    productType: "Duvet Cover",
    tags: ["qa"],
  };
}

integrationTest("versioned enqueue and regeneration pin draft bases without allocating a version and fence browser publish", async () => {
  assert.ok(databaseUrl);
  const schema = `seo_version_qa_${randomUUID().replaceAll("-", "")}`;
  const storeId = "qa-store";
  const productId = "123";
  const productGid = `gid://shopify/Product/${productId}`;
  let now = 1_000;
  const queue = new PostgresCustomGptQueue({ databaseUrl, schema }, () => now++);
  const inspection = new Pool({ connectionString: databaseUrl });

  try {
    await queue.versioning.setStoreFlags({ storeId, readEnabled: true, writeEnabled: true }, now++);
    const baseline = await queue.versioning.ensureBaseline({
      storeId,
      shopifyProductGid: productGid,
      snapshot: baselineSnapshot(),
      observedAt: now++,
    });
    assert.equal(baseline.version.versionNumber, 0);

    const first = await queue.enqueue(createTestEnqueue({ storeId, productId, sourceRevision: "catalog-v1" }));
    const regenerated = await queue.enqueue(createTestEnqueue({ storeId, productId, sourceRevision: "catalog-v2" }));
    assert.notEqual(regenerated.id, first.id);

    const draftBases = await inspection.query<{
      job_id: string;
      based_on_version_id: string;
      based_on_content_hash: string;
    }>(`SELECT job_id,based_on_version_id,based_on_content_hash
        FROM "${schema}".seo_draft_bases ORDER BY created_at,job_id`);
    assert.deepEqual(draftBases.rows.map(row => row.job_id).sort(), [first.id, regenerated.id].sort());
    assert.ok(draftBases.rows.every(row => row.based_on_version_id === baseline.version.id));
    assert.ok(draftBases.rows.every(row => row.based_on_content_hash === "a".repeat(64)));

    const versionCount = await inspection.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "${schema}".seo_versions`,
    );
    assert.equal(versionCount.rows[0]?.count, 1);

    const readyJob = { ...regenerated, status: "REVIEW_READY" };
    await inspection.query(
      `UPDATE "${schema}".gpt_jobs SET status='REVIEW_READY',payload=$1 WHERE id=$2`,
      [JSON.stringify(readyJob), regenerated.id],
    );
    await inspection.query(
      `INSERT INTO "${schema}".gpt_review_state(job_id,payload) VALUES ($1,$2)`,
      [regenerated.id, JSON.stringify({ reviewDecision: "approved", updatedAt: now++ })],
    );

    await assert.rejects(queue.beginSync(storeId, regenerated.id), /BACKEND_PUBLISH_REQUIRED/);
    assert.equal((await inspection.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "${schema}".seo_versions`,
    )).rows[0]?.count, 1);
    assert.equal((await inspection.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "${schema}".gpt_sync`,
    )).rows[0]?.count, 0);
  } finally {
    await queue.close();
    try {
      await inspection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await inspection.end();
    }
  }
});
