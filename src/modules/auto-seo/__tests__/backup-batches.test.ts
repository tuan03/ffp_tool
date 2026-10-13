import assert from "node:assert/strict";
import test from "node:test";

import { runAutoSeoBackupBatches } from "..";
import type { AutoSeoBackupRequest, AutoSeoBackupBatchProgress, ShopifyProductForAutoSeoUi } from "../types";

function product(id: string, description = "Fixture"): ShopifyProductForAutoSeoUi {
  return { id, title: id, handle: id, descriptionHtml: description, status: "ACTIVE", images: [], tags: [] };
}

test("492 products hydrate and back up in sequential batches rather than one large request", async () => {
  const ids = Array.from({ length: 492 }, (_, index) => `product-${index}`);
  const requests: AutoSeoBackupRequest[] = [];
  let hydrated = 0;
  const result = await runAutoSeoBackupBatches({ workflowId: "workflow", storeId: "store-a", shopDomain: "store-a.myshopify.com", productIds: ids,
    client: {
      async hydrateSelectedProductsFresh(selected, concurrency, storeId) {
        assert.equal(storeId, "store-a"); assert.equal(concurrency, 5); assert.ok(selected.length <= 50);
        hydrated += selected.length; return selected.map(id => product(id, "x".repeat(19000)));
      },
      async runAutoSeoBackup(request) {
        assert.equal(hydrated, requests.reduce((count, prior) => count + prior.products.length, 0) + request.products.length);
        assert.ok(new TextEncoder().encode(JSON.stringify(request)).length <= 2 * 1024 * 1024);
        requests.push(request);
        return { workflowId: request.workflowId, backedUpCount: request.products.length, backupIds: request.products.map(p => p.id),
          downstreamStatus: "SENT", seoProvider: "codex_mcp", acceptedProductIds: request.products.map(p => p.id), acceptedCount: request.products.length, skippedCount: 0 };
      },
    },
  });
  assert.equal(requests.length, 10);
  assert.equal(new Set(requests.map(request => request.workflowId)).size, 10);
  assert.equal(result.backupResult.acceptedCount, 492);
});

test("UTF-8 payload sizing splits heavy products below the byte limit", async () => {
  const sizes: number[] = [];
  await runAutoSeoBackupBatches({ workflowId: "unicode", storeId: "store-a", shopDomain: "store-a.myshopify.com", productIds: ["one", "two", "three"],
    client: {
      async hydrateSelectedProductsFresh(ids) { return ids.map(id => product(id, "漢".repeat(300000))); },
      async runAutoSeoBackup(request) {
        sizes.push(new TextEncoder().encode(JSON.stringify(request)).length);
        return { workflowId: request.workflowId, backedUpCount: request.products.length, backupIds: [], downstreamStatus: "SENT" };
      },
    },
  });
  assert.equal(sizes.length, 2);
  assert.ok(sizes.every(size => size <= 2 * 1024 * 1024));
});

test("a later failed handoff preserves completed batches and reports partial progress without retrying", async () => {
  const progress: AutoSeoBackupBatchProgress[] = [];
  const completed: string[] = [];
  let calls = 0;
  await assert.rejects(runAutoSeoBackupBatches({ workflowId: "partial", storeId: "store-a", shopDomain: "store-a.myshopify.com", productIds: Array.from({ length: 60 }, (_, i) => `${i}`),
    onProgress: value => progress.push(value), onCompletedProductIds: ids => completed.push(...ids),
    client: {
      async hydrateSelectedProductsFresh(ids) { return ids.map(id => product(id)); },
      async runAutoSeoBackup(request) {
        calls++;
        return { workflowId: request.workflowId, backedUpCount: request.products.length, backupIds: [], downstreamStatus: calls === 1 ? "SENT" : "FAILED", downstreamError: "Fixture failure" };
      },
    },
  }), /Fixture failure/);
  assert.equal(calls, 2);
  assert.equal(completed.length, 50);
  assert.equal(progress.at(-1)?.handedOver, 50);
  assert.equal(progress.at(-1)?.backedUp, 60);
  assert.equal(progress.at(-1)?.phase, "failed");
});

test("an individually oversized product fails before any backup write", async () => {
  let calls = 0;
  await assert.rejects(runAutoSeoBackupBatches({ workflowId: "oversize", storeId: "store-a", shopDomain: "store-a.myshopify.com", productIds: ["large"],
    client: { async hydrateSelectedProductsFresh() { return [product("large", "x".repeat(2 * 1024 * 1024))]; },
      async runAutoSeoBackup() { calls++; throw new Error("Must not write"); } },
  }), /large/);
  assert.equal(calls, 0);
});

test("skipped products are confirmed once and counted separately from handed-over products", async () => {
  const completed: string[] = [];
  const result = await runAutoSeoBackupBatches({
    workflowId: "mixed", storeId: "store-a", shopDomain: "store-a.myshopify.com", productIds: ["new", "existing"],
    onCompletedProductIds: ids => completed.push(...ids),
    client: {
      async hydrateSelectedProductsFresh(ids) { return ids.map(id => product(id)); },
      async runAutoSeoBackup(request) {
        return { workflowId: request.workflowId, backedUpCount: 1, backupIds: ["backup-new"], downstreamStatus: "SENT",
          acceptedProductIds: ["new"], acceptedCount: 1, skippedCount: 1,
          skippedProducts: [{ productId: "existing", reason: "UNCHANGED" }] };
      },
    },
  });
  assert.deepEqual(completed, ["new", "existing"]);
  assert.equal(result.backupResult.acceptedCount, 1);
  assert.equal(result.backupResult.skippedCount, 1);
  assert.deepEqual(result.acceptedProducts.map(value => value.id), ["new"]);
});

test("a lost response stops further batches without confirming the uncertain batch", async () => {
  const completed: string[] = [];
  let calls = 0;
  await assert.rejects(runAutoSeoBackupBatches({
    workflowId: "transport", storeId: "store-a", shopDomain: "store-a.myshopify.com",
    productIds: Array.from({ length: 110 }, (_, index) => `product-${index}`),
    onCompletedProductIds: ids => completed.push(...ids),
    client: {
      async hydrateSelectedProductsFresh(ids) { return ids.map(id => product(id)); },
      async runAutoSeoBackup(request) {
        calls++;
        if (calls === 2) throw new TypeError("Connection reset");
        return { workflowId: request.workflowId, backedUpCount: request.products.length, backupIds: [], downstreamStatus: "SENT" };
      },
    },
  }), /Đã bàn giao 50\/110/);
  assert.equal(calls, 2);
  assert.equal(completed.length, 50);
});

test("batch progress separates unchanged products from existing Queue or Review jobs", async () => {
  let progress: AutoSeoBackupBatchProgress | undefined;
  await runAutoSeoBackupBatches({
    workflowId: "counts", storeId: "store-a", shopDomain: "store-a.myshopify.com", productIds: ["same", "queued"],
    onProgress: value => { progress = value; },
    client: {
      async hydrateSelectedProductsFresh(ids) { return ids.map(id => product(id)); },
      async runAutoSeoBackup(request) { return { workflowId: request.workflowId, backedUpCount: 0, backupIds: [],
        downstreamStatus: "SENT", acceptedProductIds: [], skippedCount: 2,
        skippedProducts: [{ productId: "same", reason: "UNCHANGED" }, { productId: "queued", reason: "ACTIVE_DUPLICATE" }] }; },
    },
  });
  assert.equal(progress?.alreadyQueued, 1);
  assert.equal(progress?.unchanged, 1);
  assert.equal(progress?.handedOver, 0);
});
