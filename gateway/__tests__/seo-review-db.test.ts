import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  getSeoReviewItem,
  initSeoReviewDbSchema,
  listSeoReviewItems,
  updateSeoReviewPayload,
  updateSeoReviewStatus,
  upsertSeoReviewItem,
  type SeoReviewItemRecord,
} from "../seo-review-db";

function createMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSeoReviewDbSchema(db);
  return db;
}

function makeReviewItem(overrides?: Partial<SeoReviewItemRecord>): SeoReviewItemRecord {
  return {
    itemId: "store-1:prod-1",
    storeId: "store-1",
    productId: "prod-1",
    handle: "test-product-1",
    title: "Test Product 1",
    reviewStatus: "pending",
    generatedPayload: JSON.stringify({
      productTitle: "SEO Title 1",
      productDescription: "SEO Desc 1",
      productSeoTitle: "Meta Title 1",
      productSeoDescription: "Meta Desc 1",
      productHandle: "test-product-1",
    }),
    shopifyUpdatedAt: "2026-09-28T10:00:00.000Z",
    ...overrides,
  };
}

test("1. initSeoReviewDbSchema creates table and index idempotently", () => {
  const db = new DatabaseSync(":memory:");
  initSeoReviewDbSchema(db);
  initSeoReviewDbSchema(db); // Second call should not throw

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seo_review_items'")
    .all();
  assert.equal(tables.length, 1);

  const indices = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_seo_review_store_status'")
    .all();
  assert.equal(indices.length, 1);
});

test("2. upsertSeoReviewItem inserts new review item into SQLite", () => {
  const db = createMemoryDb();
  const item = makeReviewItem();

  upsertSeoReviewItem(db, item);

  const saved = getSeoReviewItem(db, item.itemId);
  assert.ok(saved);
  assert.equal(saved.itemId, item.itemId);
  assert.equal(saved.storeId, item.storeId);
  assert.equal(saved.productId, item.productId);
  assert.equal(saved.handle, item.handle);
  assert.equal(saved.title, item.title);
  assert.equal(saved.reviewStatus, "pending");
  assert.equal(saved.generatedPayload, item.generatedPayload);
  assert.equal(saved.shopifyUpdatedAt, item.shopifyUpdatedAt);
  assert.ok(saved.createdAt);
  assert.ok(saved.updatedAt);
});

test("3. getSeoReviewItem returns null for non-existent itemId", () => {
  const db = createMemoryDb();
  const item = getSeoReviewItem(db, "non-existent-id");
  assert.equal(item, null);
});

test("4. upsertSeoReviewItem updates existing row on store_id/product_id conflict", () => {
  const db = createMemoryDb();
  const item1 = makeReviewItem({ title: "Original Title", handle: "orig-handle" });
  upsertSeoReviewItem(db, item1);

  const item2 = makeReviewItem({
    itemId: "store-1:prod-1",
    title: "Updated Title",
    handle: "updated-handle",
    shopifyUpdatedAt: "2026-09-28T12:00:00.000Z",
  });
  upsertSeoReviewItem(db, item2);

  const countRow = db.prepare("SELECT COUNT(*) as count FROM seo_review_items").get() as { count: number | bigint };
  assert.equal(Number(countRow.count), 1);

  const updated = getSeoReviewItem(db, "store-1:prod-1");
  assert.ok(updated);
  assert.equal(updated.title, "Updated Title");
  assert.equal(updated.handle, "updated-handle");
  assert.equal(updated.shopifyUpdatedAt, "2026-09-28T12:00:00.000Z");
});

test("5. listSeoReviewItems returns total count and items list", () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "item-1", productId: "p-1" }));
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "item-2", productId: "p-2" }));
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "item-3", productId: "p-3" }));

  const res = listSeoReviewItems(db);
  assert.equal(res.total, 3);
  assert.equal(res.items.length, 3);
});

test("6. listSeoReviewItems filters by storeId", () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "s1-p1", storeId: "store-alpha", productId: "p-1" }));
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "s1-p2", storeId: "store-alpha", productId: "p-2" }));
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "s2-p1", storeId: "store-beta", productId: "p-3" }));

  const alphaItems = listSeoReviewItems(db, { storeId: "store-alpha" });
  assert.equal(alphaItems.total, 2);
  assert.equal(alphaItems.items.length, 2);
  assert.ok(alphaItems.items.every((it) => it.storeId === "store-alpha"));

  const betaItems = listSeoReviewItems(db, { storeId: "store-beta" });
  assert.equal(betaItems.total, 1);
  assert.equal(betaItems.items.length, 1);
  assert.equal(betaItems.items[0]?.storeId, "store-beta");
});

test("7. listSeoReviewItems filters by reviewStatus", () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "i-1", productId: "p-1", reviewStatus: "pending" }));
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "i-2", productId: "p-2", reviewStatus: "approved" }));
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "i-3", productId: "p-3", reviewStatus: "rejected" }));

  const pending = listSeoReviewItems(db, { status: "pending" });
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0]?.itemId, "i-1");

  const approved = listSeoReviewItems(db, { status: "approved" });
  assert.equal(approved.total, 1);
  assert.equal(approved.items[0]?.itemId, "i-2");

  const rejected = listSeoReviewItems(db, { status: "rejected" });
  assert.equal(rejected.total, 1);
  assert.equal(rejected.items[0]?.itemId, "i-3");
});

test("8. listSeoReviewItems supports limit and offset pagination", () => {
  const db = createMemoryDb();
  for (let i = 1; i <= 5; i++) {
    upsertSeoReviewItem(db, makeReviewItem({ itemId: `item-${i}`, productId: `p-${i}` }));
  }

  const page1 = listSeoReviewItems(db, { limit: 2, offset: 0 });
  assert.equal(page1.total, 5);
  assert.equal(page1.items.length, 2);

  const page2 = listSeoReviewItems(db, { limit: 2, offset: 2 });
  assert.equal(page2.total, 5);
  assert.equal(page2.items.length, 2);

  const page3 = listSeoReviewItems(db, { limit: 2, offset: 4 });
  assert.equal(page3.total, 5);
  assert.equal(page3.items.length, 1);
});

test("9. updateSeoReviewStatus updates status and notes; returns false for unknown itemId", () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "i-status-test" }));

  const updatedApproved = updateSeoReviewStatus(db, "i-status-test", "approved", "Looks great");
  assert.equal(updatedApproved, true);

  const recordApproved = getSeoReviewItem(db, "i-status-test");
  assert.ok(recordApproved);
  assert.equal(recordApproved.reviewStatus, "approved");
  assert.equal(recordApproved.notes, "Looks great");

  const updatedRejected = updateSeoReviewStatus(db, "i-status-test", "rejected", "Title too long");
  assert.equal(updatedRejected, true);

  const recordRejected = getSeoReviewItem(db, "i-status-test");
  assert.ok(recordRejected);
  assert.equal(recordRejected.reviewStatus, "rejected");
  assert.equal(recordRejected.notes, "Title too long");

  const notFound = updateSeoReviewStatus(db, "non-existent-id", "approved");
  assert.equal(notFound, false);
});

test("10. updateSeoReviewStatus throws for invalid status", () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "i-inv" }));

  assert.throws(
    () => {
      // @ts-expect-error test runtime validation
      updateSeoReviewStatus(db, "i-inv", "invalid_status");
    },
    /Invalid status/,
  );
});

test("11. updateSeoReviewPayload updates payload, title, handle, and updated_at", () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeReviewItem({ itemId: "i-payload-test", title: "Old Title", handle: "old-handle" }));

  const newPayload = {
    productTitle: "New Optimized Title",
    productHandle: "new-optimized-handle",
    productDescription: "New description text",
    productSeoTitle: "New SEO Title",
    productSeoDescription: "New SEO Desc",
  };

  const updated = updateSeoReviewPayload(db, "i-payload-test", newPayload);
  assert.equal(updated, true);

  const record = getSeoReviewItem(db, "i-payload-test");
  assert.ok(record);
  assert.equal(record.title, "New Optimized Title");
  assert.equal(record.handle, "new-optimized-handle");
  assert.equal(JSON.parse(record.generatedPayload).productTitle, "New Optimized Title");

  const notFound = updateSeoReviewPayload(db, "unknown-id", newPayload);
  assert.equal(notFound, false);
});

test("12. updateSeoReviewPayload throws on null or undefined payload", () => {
  const db = createMemoryDb();
  assert.throws(() => updateSeoReviewPayload(db, "i-1", null), /Payload cannot be undefined or null/);
  assert.throws(() => updateSeoReviewPayload(db, "i-1", undefined), /Payload cannot be undefined or null/);
});

test("13. CHECK constraint on review_status prevents invalid status via raw SQL", () => {
  const db = createMemoryDb();
  assert.throws(() => {
    db.prepare(`
      INSERT INTO seo_review_items (item_id, store_id, product_id, handle, title, review_status, generated_payload)
      VALUES ('bad-1', 's-1', 'p-1', 'h-1', 't-1', 'invalid_status', '{}')
    `).run();
  });
});

test("14. Review database persists across close and reopen of SQLite file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "seo-review-test-"));
  const dbPath = join(tempDir, "test-seo-review.sqlite3");

  try {
    // Phase 1: create and insert
    const db1 = new DatabaseSync(dbPath);
    initSeoReviewDbSchema(db1);
    upsertSeoReviewItem(db1, makeReviewItem({ itemId: "persist-1", title: "Persistent Title" }));
    db1.close();

    // Phase 2: reopen and verify
    const db2 = new DatabaseSync(dbPath);
    initSeoReviewDbSchema(db2);
    const item = getSeoReviewItem(db2, "persist-1");
    assert.ok(item);
    assert.equal(item.title, "Persistent Title");
    db2.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
