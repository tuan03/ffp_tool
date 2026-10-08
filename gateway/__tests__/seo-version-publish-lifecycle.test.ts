import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { buildAeoMetafieldValues } from "../../src/modules/shopify-sync";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { createCanonicalSeoSnapshot } from "../seo-versioning/canonical-snapshot";
import { SeoPublishVersioningIntegration } from "../seo-versioning/publish-integration";
import { SeoVersionRepository } from "../seo-versioning/repository";
import { applySeoVersionMigrations } from "../seo-versioning/schema";
import type { SeoContentSnapshot } from "../seo-versioning/snapshot-types";
import type { WorkerDatabase } from "../seo-worker/database";
import { SeoPublishRepository } from "../seo-worker/publish-repository";
import type { PublishFields, PublishOperation } from "../seo-worker/publish-repository";
import { processSeoPublish } from "../seo-worker/publish-worker";

import { createTestEnqueue } from "./seo-v2-fixtures";

function snapshot(overrides: Partial<SeoContentSnapshot> = {}): SeoContentSnapshot {
  return createCanonicalSeoSnapshot({
    storeId: "demo",
    shopifyProductGid: "gid://shopify/Product/123",
    capturedAtUtc: "2026-10-05T00:00:00.000Z",
    source: "BASELINE",
    title: "Old",
    descriptionHtml: "Description",
    seoTitle: "Title",
    seoDescription: "Meta",
    images: [{ mediaGid: "gid://shopify/MediaImage/1", imageUrl: "https://cdn.example/1.jpg", alt: "Old alt", width: 100, height: 100 }],
    aeoMetafields: [{ namespace: "custom", key: "aeo_quick_summary", type: "multi_line_text_field", value: "Old summary" }],
    handle: "product",
    onlineStoreUrl: "https://example.com/products/product",
    shopifyStatus: "ACTIVE",
    vendor: "Jeminise",
    productType: "Quilt",
    tags: ["quilt"],
    shopifyUpdatedAt: "v1",
    ...overrides,
  });
}

function persistenceSnapshot(value: SeoContentSnapshot) {
  return {
    contentHash: value.contentHash,
    title: value.title,
    descriptionHtml: value.descriptionHtml ?? "",
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    images: value.images.map(image => ({ ...image, imageUrl: image.imageUrl ?? "" })),
    aeoMetafields: Object.fromEntries(value.aeoMetafields.map(field => [`${field.namespace}.${field.key}`, field.value])),
    handle: value.handle,
    onlineStoreUrl: value.onlineStoreUrl,
    observedCanonicalUrl: value.onlineStoreUrl,
    shopifyStatus: value.shopifyStatus,
    vendor: value.vendor,
    productType: value.productType,
    tags: value.tags,
  };
}

function applyFields(current: SeoContentSnapshot, fields: PublishFields): SeoContentSnapshot {
  const metafields = new Map(current.aeoMetafields.map(field => [`${field.namespace}.${field.key}`, field]));
  for (const field of fields.metafields ?? []) {
    if (field.key !== "seo_version") metafields.set(`${field.namespace}.${field.key}`, field);
  }
  return createCanonicalSeoSnapshot({
    ...current,
    source: "POST_PUBLISH",
    title: fields.title,
    descriptionHtml: fields.descriptionHtml,
    seoTitle: fields.seo.title,
    seoDescription: fields.seo.description,
    aeoMetafields: [...metafields.values()],
  });
}

const oldAeo = { quickSummary: "Old approved summary", faq: [{ question: "Old question?", answer: "Old answer." }],
  jsonLd: JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Product", name: "Old" }, { "@type": "FAQPage" }] }) };
const newAeoReview = {
  aeoQuickSummary: { value: "New approved summary" }, aeoFaq: { value: [{ question: "New question?", answer: "New answer." }] },
  aeoJsonLd: { value: JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Product", name: "New" }, { "@type": "FAQPage" }] }) },
};

async function fixture(noChange = false, withAeo = false) {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  const database: WorkerDatabase = { transaction: operation => pg.transaction(tx => operation({
    query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }),
  })) };
  let now = 1_000;
  await applySeoVersionMigrations(database, "public", () => now);
  const versions = new SeoVersionRepository(database, "public");
  await versions.setStoreFlags({ storeId: "demo", readEnabled: true, writeEnabled: true }, now);
  const original = snapshot(withAeo ? { aeoMetafields: [
    { namespace: "custom", key: "aeo_quick_summary", type: "multi_line_text_field", value: oldAeo.quickSummary },
    { namespace: "custom", key: "aeo_faq", type: "json", value: JSON.stringify(oldAeo.faq) },
    ...buildAeoMetafieldValues(oldAeo),
  ] } : {});
  const baseline = await versions.ensureBaseline({
    storeId: "demo", shopifyProductGid: original.shopifyProductGid, snapshot: persistenceSnapshot(original), observedAt: now,
  });
  const review = {
    reviewDecision: "approved", updatedAt: 7,
    productTitle: { value: noChange ? "Old" : "New" }, productDescription: { value: "Description" },
    seoTitle: { value: "Title" }, seoDescription: { value: "Meta" },
    ...(withAeo ? newAeoReview : {}),
  };
  const enqueue = createTestEnqueue({ storeId: "demo", productId: "123", sourceRevision: "v1", original: { updatedAt: "v1", seoVersion: 0 } });
  await pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ('job','demo','d','REVIEW_READY',$1,1,'codex_mcp')",
    [JSON.stringify({ input: enqueue.input, execution: enqueue.execution, original: enqueue.execution.originalSnapshot })]);
  await pg.query("INSERT INTO gpt_review_state(job_id,payload) VALUES ('job',$1)", [JSON.stringify(review)]);
  await pg.query("INSERT INTO seo_worker_stores(store_id,enabled) VALUES ('demo',true)");
  await versions.recordDraftBase({ jobId: "job", storeId: "demo", shopifyProductGid: original.shopifyProductGid,
    inputContractVersion: "2.0.0", storeProfileVersion: "jeminise-v1", createdAt: now });
  const integration = new SeoPublishVersioningIntegration(versions);
  const publisher = new SeoPublishRepository(database, () => now, integration);
  const operation = await publisher.enqueue({ storeId: "demo", jobId: "job", reviewUpdatedAt: 7, requestId: "sync", operator: "operator" });
  return { pg, publisher, operation, integration, original, baseline, advance: () => { now += 120_001; } };
}

test("authoritative publish blocks a stale full-content hash before Shopify write", async () => {
  const f = await fixture();
  let writes = 0;
  try {
    const changed = snapshot({ images: [{ ...f.original.images[0]!, alt: "External alt" }] });
    await processSeoPublish(f.publisher, {
      read: async () => ({ version: "v1", seoVersion: 0, fields: f.operation.fields, snapshot: changed }),
      write: async () => { writes += 1; },
    }, f.integration);
    assert.equal((await f.publisher.get("demo", f.operation.id)).errorCode, "CONTENT_CONFLICT");
    assert.equal(writes, 0);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_publish_versions")).rows[0].count, 0);
  } finally { await f.pg.close(); }
});

test("authoritative no-change is terminal with zero Shopify writes and zero new version rows", async () => {
  const f = await fixture(true);
  let writes = 0;
  try {
    await processSeoPublish(f.publisher, {
      read: async () => ({ version: "v1", seoVersion: 0, fields: f.operation.fields, snapshot: f.original }),
      write: async () => { writes += 1; },
    }, f.integration);
    const done = await f.publisher.get("demo", f.operation.id);
    assert.equal(done.state, "SUCCEEDED");
    assert.equal(done.errorCode, "NO_CHANGE");
    assert.equal(writes, 0);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_publish_versions")).rows[0].count, 0);
  } finally { await f.pg.close(); }
});

test("verified Admin publish records applied time without fabricating public-effective time", async () => {
  const f = await fixture();
  let live = f.original;
  let liveFields: PublishFields = { ...f.operation.fields, title: "Old" };
  let writes = 0;
  try {
    await processSeoPublish(f.publisher, {
      read: async () => ({ version: writes ? "v2" : "v1", seoVersion: writes ? 1 : 0, fields: liveFields, snapshot: live }),
      write: async (operation: PublishOperation) => {
        writes += 1;
        liveFields = operation.fields;
        live = applyFields(live, operation.fields);
      },
    }, f.integration);
    assert.equal((await f.publisher.get("demo", f.operation.id)).seoVersion, 1);
    assert.equal(writes, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 2);
    const receipt = (await f.pg.query<{ seo_version_id: string }>("SELECT seo_version_id FROM seo_publish_versions")).rows[0];
    assert.ok(receipt.seo_version_id);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions WHERE publish_operation_id=$1", [f.operation.id])).rows[0].count, 1);
    const version = (await f.pg.query<{ applied_at_utc: number; public_effective_at_utc: number | null }>(
      "SELECT applied_at_utc,public_effective_at_utc FROM seo_versions WHERE publish_operation_id=$1",
      [f.operation.id],
    )).rows[0];
    assert.deepEqual(version, { applied_at_utc: 1_000, public_effective_at_utc: null });
  } finally { await f.pg.close(); }
});

test("lost response recovery commits one version without repeating the Shopify write", async () => {
  const f = await fixture();
  let live = f.original;
  let liveFields: PublishFields = { ...f.operation.fields, title: "Old" };
  let writes = 0;
  try {
    const transport = {
      read: async () => ({ version: writes ? "v2" : "v1", seoVersion: writes ? 1 : 0, fields: liveFields, snapshot: live }),
      write: async (operation: PublishOperation) => {
        writes += 1;
        liveFields = operation.fields;
        live = applyFields(live, operation.fields);
        throw new Error("response lost");
      },
    };
    await processSeoPublish(f.publisher, transport, f.integration);
    f.advance();
    await processSeoPublish(f.publisher, transport, f.integration);
    assert.equal(writes, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 2);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_publish_versions")).rows[0].count, 1);
    const version = (await f.pg.query<{ applied_at_utc: number; public_effective_at_utc: number | null }>(
      "SELECT applied_at_utc,public_effective_at_utc FROM seo_versions WHERE publish_operation_id=$1",
      [f.operation.id],
    )).rows[0];
    assert.deepEqual(version, { applied_at_utc: 121_001, public_effective_at_utc: null });
  } finally { await f.pg.close(); }
});

test("partial read-back mismatch never commits an authoritative version", async () => {
  const f = await fixture();
  let writes = 0;
  try {
    await processSeoPublish(f.publisher, {
      read: async () => writes === 0
        ? { version: "v1", seoVersion: 0, fields: { ...f.operation.fields, title: "Old" }, snapshot: f.original }
        : { version: "v2", seoVersion: 1, fields: { ...f.operation.fields, title: "Partial" }, snapshot: snapshot({ title: "Partial", shopifyUpdatedAt: "v2" }) },
      write: async () => { writes += 1; },
    }, f.integration);
    assert.equal((await f.publisher.get("demo", f.operation.id)).errorCode, "RECONCILIATION_REQUIRED");
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_publish_versions")).rows[0].count, 0);
  } finally { await f.pg.close(); }
});

test("rollback publishes forward and records the restored historical version", async () => {
  const f = await fixture(false, true);
  let live = f.original;
  let liveFields: PublishFields = { ...f.operation.fields, title: "Old" };
  try {
    await processSeoPublish(f.publisher, {
      read: async () => ({ version: live.shopifyUpdatedAt, seoVersion: live.title === "Old" ? 0 : 1, fields: liveFields, snapshot: live }),
      write: async (operation) => {
        liveFields = operation.fields;
        live = applyFields(live, operation.fields);
      },
    }, f.integration);

    const appliedSnapshot = (await f.pg.query<{ aeo_metafields: Record<string, string> }>(
      "SELECT s.aeo_metafields FROM seo_content_snapshots s JOIN seo_versions v ON v.snapshot_id=s.id WHERE v.publish_operation_id=$1", [f.operation.id],
    )).rows[0];
    assert.match(appliedSnapshot?.aeo_metafields["custom.aeo_suite_html"] ?? "", /New approved summary/);
    assert.match(appliedSnapshot?.aeo_metafields["custom.aeo_json_ld"] ?? "", /FAQPage/);

    const rollbackEnqueue = createTestEnqueue({ storeId: "demo", productId: "123", sourceRevision: "v2",
      original: { updatedAt: "v2", seoVersion: 1 } });
    const rollbackReview = {
      reviewDecision: "approved", updatedAt: 8,
      productTitle: { value: "Old" }, productDescription: { value: "Description" },
      seoTitle: { value: "Title" }, seoDescription: { value: "Meta" },
      aeoQuickSummary: { value: oldAeo.quickSummary }, aeoFaq: { value: oldAeo.faq }, aeoJsonLd: { value: oldAeo.jsonLd },
    };
    await f.pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ('rollback-job','demo','rollback','REVIEW_READY',$1,2,'codex_mcp')",
      [JSON.stringify({ input: rollbackEnqueue.input, execution: rollbackEnqueue.execution, original: rollbackEnqueue.execution.originalSnapshot })]);
    await f.pg.query("INSERT INTO gpt_review_state(job_id,payload) VALUES ('rollback-job',$1)", [JSON.stringify(rollbackReview)]);
    const versions = new SeoVersionRepository({ transaction: operation => f.pg.transaction(tx => operation({
      query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }),
    })) }, "public");
    await versions.recordDraftBase({ jobId: "rollback-job", storeId: "demo", shopifyProductGid: f.original.shopifyProductGid,
      inputContractVersion: "2.0.0", storeProfileVersion: "jeminise-v1", createdAt: 2_000 });
    const rollback = await f.publisher.enqueue({ storeId: "demo", jobId: "rollback-job", reviewUpdatedAt: 8,
      requestId: "rollback", operator: "operator", versionSource: "ROLLBACK", restoredFromVersionId: f.baseline.version.id });
    live = createCanonicalSeoSnapshot({ ...live, shopifyUpdatedAt: "v2" });
    liveFields = { ...rollback.fields, title: "New" };
    await processSeoPublish(f.publisher, {
      read: async () => ({ version: live.shopifyUpdatedAt, seoVersion: live.title === "New" ? 1 : 2, fields: liveFields, snapshot: live }),
      write: async (operation) => {
        liveFields = operation.fields;
        live = applyFields(live, operation.fields);
      },
    }, f.integration);
    const restored = (await f.pg.query<{ version_number: number; source: string; restored_from_version_id: string }>(
      "SELECT version_number,source,restored_from_version_id FROM seo_versions ORDER BY version_number DESC LIMIT 1",
    )).rows[0];
    assert.deepEqual(restored, { version_number: 2, source: "ROLLBACK", restored_from_version_id: f.baseline.version.id });
    assert.equal(live.aeoMetafields.find(field => field.key === "aeo_suite_html")?.value,
      f.original.aeoMetafields.find(field => field.key === "aeo_suite_html")?.value);
    assert.equal(live.aeoMetafields.find(field => field.key === "aeo_json_ld")?.value, oldAeo.jsonLd);
  } finally { await f.pg.close(); }
});
