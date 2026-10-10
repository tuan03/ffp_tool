import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getInitialSampleViewModels } from "../seo-content-ui-adapter";
import { canStartReviewSync, isReviewSynced } from "../review-actions";
import { prepareReviewSync } from "../prepare-review-sync";
import { ReviewProductActions } from "../components/ReviewProductActions";
import { ReviewStatusBadge } from "../components/ReviewStatusBadge";
import { stabilizeReviewCatalogItems } from "../review-catalog";
import type { SeoReviewListItem } from "../../../shared/seo-review-list";

test("pending Review exposes Sync directly and never exposes a manual approval button", () => {
  const product = getInitialSampleViewModels()[0];
  assert.ok(product);
  const pending = { ...product, reviewDecision: "pending" as const, shopifySyncStatus: "idle" as const };
  assert.equal(canStartReviewSync(pending), true);
  const html = renderToStaticMarkup(createElement(ReviewProductActions, { product: pending,
    onEdit: () => undefined, onApprove: () => assert.fail("no manual approval"), onSync: () => undefined }));
  assert.match(html, /Sync Shopify/);
  assert.doesNotMatch(html, />Duyệt</);
  for (const locked of [{ ...pending, reviewArchivedAt: 10 }, { ...pending, shopifySyncStatus: "synced" as const },
    { ...pending, isSyncing: true }, { ...pending, reviewDecision: "rejected" as const },
    { ...pending, reviewActions: { canEdit: false, canDecide: false, canSync: false, canRetry: false, canArchive: false, canRevise: false, canReconcile: false } }]) {
    assert.equal(canStartReviewSync(locked), false);
  }
});

test("Sync persists approval internally before publish and stops if persistence fails", async () => {
  const product = getInitialSampleViewModels()[0];
  assert.ok(product);
  const pending = { ...product, id: "gpt-test", storeId: "demo", gptJobId: "test", reviewDecision: "pending" as const,
    shopifySyncStatus: "idle" as const, backendPublishRequired: true };
  const writes: string[] = [];
  const prepared = await prepareReviewSync(pending, { storeId: "demo", now: () => 100,
    gpt: { saveReviewState: async (storeId, jobId, state) => {
      writes.push(`${storeId}:${jobId}`); assert.equal(state.reviewDecision, "approved"); assert.equal(state.isSyncing, false);
    } } });
  assert.deepEqual(writes, ["demo:test"]);
  assert.equal(prepared.reviewDecision, "approved");
  assert.equal(prepared.updatedAt, 100);
  assert.equal(pending.reviewDecision, "pending");
  await assert.rejects(prepareReviewSync(pending, { storeId: "other" }), /store/i);
  await assert.rejects(prepareReviewSync(pending, { storeId: "demo", gpt: { saveReviewState: async () => { throw new Error("save failed"); } } }), /save failed/);
});

test("synced tab excludes archived unsynced reviews and syncing has a prominent spinner", () => {
  const product = getInitialSampleViewModels()[0]; assert.ok(product);
  assert.equal(isReviewSynced({ ...product, reviewArchivedAt: 10, shopifySyncStatus: "idle" }), false);
  assert.equal(isReviewSynced({ ...product, reviewArchivedAt: 10, shopifySyncStatus: "synced" }), true);
  const html = renderToStaticMarkup(createElement(ReviewStatusBadge, { product: { ...product, isSyncing: true, reviewLifecycleStage: "pending" } }));
  assert.match(html, /animate-spin/);
  assert.match(html, /bg-blue/);
  assert.match(html, /Đang sync/);
});

test("crawler direct Sync uses the current review version and stops on a stale-version rejection", async () => {
  const sample = getInitialSampleViewModels()[0]; assert.ok(sample);
  const pending = { ...sample, storeId: "demo", reviewDecision: "pending" as const, shopifySyncStatus: "idle" as const,
    coordinatorReview: { itemId: "crawler-1", jobId: "crawl-1", version: 7,
      target: { collectionIds: [], priceAddition: 0, discountPercent: 0 } } };
  let attempts = 0;
  await assert.rejects(prepareReviewSync(pending, { storeId: "demo", crawler: { decide: async (id, version, decision) => {
    attempts += 1;
    assert.equal(id, "crawler-1"); assert.equal(version, 7); assert.equal(decision, "approved");
    throw new Error("stale version");
  } } }), /stale version/);
  assert.equal(attempts, 1);
  assert.equal(pending.reviewDecision, "pending");
});

test("background refresh keeps page order and retains clicked cards when sync moves them out of work", () => {
  const row = (id: string): SeoReviewListItem => ({ id, recordId: id, storeId: "demo", source: "gpt", title: id,
    handle: id, thumbnailUrl: "", updatedAt: 1, decision: "pending", syncStatus: "idle" });
  const current = [row("a"), row("b"), row("c")];
  const refreshed = [{ ...row("b"), syncStatus: "syncing" as const, updatedAt: 2 }, row("c"), row("a")];
  assert.deepEqual(stabilizeReviewCatalogItems(current, refreshed, new Set()).map(item => item.id), ["a", "b", "c"]);
  const finished = stabilizeReviewCatalogItems(current, [row("c"), row("a"), row("d")], new Set(["b"]));
  assert.deepEqual(finished.map(item => item.id), ["a", "b", "c", "d"]);
  assert.deepEqual(stabilizeReviewCatalogItems(current, [row("c"), row("a")], new Set()).map(item => item.id), ["a", "c"]);
});
