import assert from "node:assert/strict";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  SEO_FIELD_SET_VERSION,
  SEO_SNAPSHOT_SCHEMA_VERSION,
  SEO_VERSION_AUTHORITY,
  SeoVersionRepository,
  applySeoVersionMigrations,
  getSeoVersionMigrations,
} from "../seo-versioning";
import type { WorkerDatabase } from "../seo-worker/database";
import type { SeoContentSnapshotInput } from "../seo-versioning";

async function fixture() {
  const pg = await PGlite.create();
  const database: WorkerDatabase = {
    transaction: operation => pg.transaction(tx => operation({
      query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }),
    })),
  };
  let nextId = 0;
  await applySeoVersionMigrations(database, "public", () => 100);
  const repository = new SeoVersionRepository(database, "public", () => `id-${++nextId}`);
  return { pg, database, repository };
}

function snapshot(hashCharacter: string, overrides: Partial<SeoContentSnapshotInput> = {}): SeoContentSnapshotInput {
  return {
    contentHash: hashCharacter.repeat(64),
    title: "Quilt Set",
    descriptionHtml: "<p>Soft quilt.</p>",
    seoTitle: "Quilt Set",
    seoDescription: "A soft quilt set.",
    images: [{ mediaGid: "gid://shopify/MediaImage/1", imageUrl: "https://cdn.example/quilt.jpg", alt: "Floral quilt", width: 1200, height: 1200 }],
    aeoMetafields: { "custom.answer": "Machine washable" },
    handle: "quilt-set",
    onlineStoreUrl: "https://example.com/products/quilt-set/",
    observedCanonicalUrl: "https://example.com/products/quilt-set",
    shopifyStatus: "ACTIVE",
    vendor: "Jeminise",
    productType: "Quilt",
    tags: ["bedding", "quilt"],
    ...overrides,
  };
}

test("numbered migrations are additive, repeatable and freeze V1 constants", async () => {
  const f = await fixture();
  try {
    await applySeoVersionMigrations(f.database, "public", () => 200);
    assert.deepEqual((await f.pg.query<{ version: number; name: string }>("SELECT version,name FROM seo_version_migrations")).rows,
      [{ version: 1, name: "create-seo-version-ledger" }]);
    assert.equal(getSeoVersionMigrations("public").length, 1);
    assert.throws(() => getSeoVersionMigrations('bad"schema'), /Invalid SEO versioning schema/);
    assert.equal(SEO_SNAPSHOT_SCHEMA_VERSION, "seo-snapshot-v1");
    assert.equal(SEO_FIELD_SET_VERSION, "seo-fields-v1");
    assert.equal(SEO_VERSION_AUTHORITY, "postgresql");
  } finally { await f.pg.close(); }
});

test("baseline creates exactly one immutable v0 and preserves store isolation", async () => {
  const f = await fixture();
  try {
    await f.repository.setStoreFlags({ storeId: "store-a", readEnabled: true, writeEnabled: false }, 1);
    await f.repository.setStoreFlags({ storeId: "store-b", readEnabled: true, writeEnabled: false }, 1);
    const baseline = { storeId: "store-a", shopifyProductGid: "gid://shopify/Product/1", snapshot: snapshot("a"), observedAt: 10 };
    const [first, second] = await Promise.all([f.repository.ensureBaseline(baseline), f.repository.ensureBaseline(baseline)]);
    assert.deepEqual([first.created, second.created].sort(), [false, true]);
    assert.equal(first.version.id, second.version.id);
    assert.equal(first.version.versionNumber, 0);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_content_snapshots")).rows[0].count, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_product_url_history WHERE valid_to IS NULL")).rows[0].count, 1);
    await assert.rejects(f.repository.listVersions("store-b", baseline.shopifyProductGid), /SEO_PRODUCT_NOT_FOUND/);
    await assert.rejects(f.pg.query("UPDATE seo_versions SET version_number=4"), /SEO_IMMUTABLE_RECORD/);
    await assert.rejects(f.pg.query("DELETE FROM seo_content_snapshots"), /SEO_IMMUTABLE_RECORD/);
  } finally { await f.pg.close(); }
});

test("flags fence writes and commit is idempotent with no-change and conflict semantics", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.repository.ensureBaseline({ storeId: "store-a", shopifyProductGid: "p1", snapshot: snapshot("a"), observedAt: 1 }), /SEO_VERSION_READ_DISABLED/);
    await assert.rejects(f.repository.setStoreFlags({ storeId: "store-a", readEnabled: false, writeEnabled: true }, 1), /SEO_VERSION_READ_REQUIRED/);
    await f.repository.setStoreFlags({ storeId: "store-a", readEnabled: true, writeEnabled: false }, 2);
    const baseline = await f.repository.ensureBaseline({ storeId: "store-a", shopifyProductGid: "p1", snapshot: snapshot("a"), observedAt: 3 });
    const input = {
      storeId: "store-a", shopifyProductGid: "p1", operationId: "op-1", expectedVersionId: baseline.version.id,
      expectedContentHash: "a".repeat(64), snapshot: snapshot("b", { title: "New Quilt" }), source: "AUTO_SEO" as const,
      approvedBy: "reviewer", appliedBy: "publisher", appliedAt: 4,
    };
    await assert.rejects(f.repository.commitVersion(input), /SEO_VERSION_WRITE_DISABLED/);
    await f.repository.setStoreFlags({ storeId: "store-a", readEnabled: true, writeEnabled: true }, 5);
    const noChange = await f.repository.commitVersion({ ...input, operationId: "op-no-change", snapshot: snapshot("a") });
    assert.equal(noChange.outcome, "NO_CHANGE");
    assert.deepEqual(await f.repository.commitVersion({ ...input, operationId: "op-no-change", snapshot: snapshot("a") }), noChange);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_version_audit WHERE event_type='NO_CHANGE'")).rows[0].count, 1);
    assert.equal((await f.repository.listVersions("store-a", "p1")).length, 1);
    const committed = await f.repository.commitVersion(input);
    assert.equal(committed.outcome, "COMMITTED");
    assert.equal(committed.version.versionNumber, 1);
    assert.deepEqual(await f.repository.commitVersion(input), committed);
    await assert.rejects(f.repository.commitVersion({ ...input, shopifyProductGid: "other-product" }), /SEO_PRODUCT_NOT_FOUND/);
    assert.equal((await f.repository.listVersions("store-a", "p1")).length, 2);
    await assert.rejects(f.repository.commitVersion({ ...input, operationId: "op-stale", snapshot: snapshot("c") }), /CONTENT_CONFLICT/);
  } finally { await f.pg.close(); }
});

test("draft bases stay on committed snapshots while external observations create dirty evidence", async () => {
  const f = await fixture();
  try {
    await f.repository.setStoreFlags({ storeId: "store-a", readEnabled: true, writeEnabled: true }, 1);
    const baseline = await f.repository.ensureBaseline({ storeId: "store-a", shopifyProductGid: "p1", snapshot: snapshot("a"), observedAt: 2 });
    assert.deepEqual(await f.repository.observeExternalChange({
      storeId: "store-a", shopifyProductGid: "p1", snapshot: snapshot("a", {
        onlineStoreUrl: "https://example.com/products/quilt-renamed", shopifyStatus: "ARCHIVED",
      }), observedAt: 3, changedFields: [],
    }), { changed: false, externalChangeId: null });
    const contextOnly = (await f.pg.query<{ current_url: string; shopify_status: string; versioning_state: string }>(
      "SELECT current_url,shopify_status,versioning_state FROM seo_products",
    )).rows[0];
    assert.deepEqual(contextOnly, {
      current_url: "https://example.com/products/quilt-renamed",
      shopify_status: "ARCHIVED",
      versioning_state: "ARCHIVED",
    });
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_external_changes")).rows[0].count, 0);
    const drift = await f.repository.observeExternalChange({
      storeId: "store-a", shopifyProductGid: "p1", snapshot: snapshot("b", { title: "External title", onlineStoreUrl: "https://example.com/products/new-handle" }),
      observedAt: 4, changedFields: ["title", "url"],
    });
    assert.equal(drift.changed, true);
    await f.repository.recordDraftBase({ jobId: "job-1", storeId: "store-a", shopifyProductGid: "p1", inputContractVersion: "2.0.0", storeProfileVersion: "jeminise-v1", createdAt: 5 });
    await assert.rejects(f.repository.recordDraftBase({ jobId: "job-1", storeId: "store-a", shopifyProductGid: "p1", inputContractVersion: "wrong", storeProfileVersion: "jeminise-v1", createdAt: 6 }), /DRAFT_BASE_CONFLICT/);
    const draft = (await f.pg.query<{ based_on_version_id: string; based_on_snapshot_id: string }>("SELECT based_on_version_id,based_on_snapshot_id FROM seo_draft_bases")).rows[0];
    assert.equal(draft.based_on_version_id, baseline.version.id);
    assert.equal(draft.based_on_snapshot_id, baseline.version.snapshotId);
    assert.equal((await f.pg.query<{ versioning_state: string }>("SELECT versioning_state FROM seo_products")).rows[0].versioning_state, "DIRTY");
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_external_changes")).rows[0].count, 1);
    assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_product_url_history")).rows[0].count, 3);
  } finally { await f.pg.close(); }
});

test("rollback creates a forward-moving version with restored provenance", async () => {
  const f = await fixture();
  try {
    await f.repository.setStoreFlags({ storeId: "store-a", readEnabled: true, writeEnabled: true }, 1);
    const v0 = await f.repository.ensureBaseline({ storeId: "store-a", shopifyProductGid: "p1", snapshot: snapshot("a"), observedAt: 2 });
    const v1 = await f.repository.commitVersion({ storeId: "store-a", shopifyProductGid: "p1", operationId: "op-1",
      expectedVersionId: v0.version.id, expectedContentHash: "a".repeat(64), snapshot: snapshot("b"), source: "AUTO_SEO",
      approvedBy: "reviewer", appliedBy: "publisher", appliedAt: 3 });
    assert.equal(v1.outcome, "COMMITTED");
    const v2 = await f.repository.commitVersion({ storeId: "store-a", shopifyProductGid: "p1", operationId: "op-2",
      expectedVersionId: v1.version.id, expectedContentHash: "b".repeat(64), snapshot: snapshot("a"), source: "ROLLBACK",
      restoredFromVersionId: v0.version.id, approvedBy: "reviewer", appliedBy: "publisher", appliedAt: 4 });
    assert.equal(v2.outcome, "COMMITTED");
    assert.equal(v2.version.versionNumber, 2);
    assert.equal(v2.version.restoredFromVersionId, v0.version.id);
    assert.equal((await f.repository.listVersions("store-a", "p1"))[2]?.source, "ROLLBACK");
  } finally { await f.pg.close(); }
});
