import assert from "node:assert/strict";
import test from "node:test";

import { getSeoReviewActions, getSeoReviewStage } from "../../../shared/seo-review-list";

test("published reviews are history, not pending work, and cannot be edited or republished", () => {
  const review = { decision: "approved" as const, syncStatus: "synced" as const, hasPublish: true };
  assert.equal(getSeoReviewStage(review), "history");
  assert.deepEqual(getSeoReviewActions(review), {
    canEdit: false, canDecide: false, canSync: false, canArchive: true,
    canRetry: false, canReconcile: false, canRevise: true,
  });
});

test("archiving preserves history but prevents approval and sync; unresolved writes cannot be archived", () => {
  const review = { decision: "approved" as const, syncStatus: "idle" as const, archivedAt: 12 };
  assert.equal(getSeoReviewStage(review), "history");
  assert.equal(getSeoReviewActions(review).canSync, false);
  assert.equal(getSeoReviewActions(review).canDecide, false);
  assert.equal(getSeoReviewActions({ decision: "approved", syncStatus: "syncing" }).canArchive, false);
  assert.equal(getSeoReviewActions({ decision: "approved", syncStatus: "failed", isUnresolved: true }).canArchive, false);
  assert.equal(getSeoReviewStage({ decision: "approved", syncStatus: "failed", isUnresolved: true }), "failed");
});

test("failed immutable publishes require reassessment instead of generic retry", () => {
  const actions = getSeoReviewActions({ decision: "approved", syncStatus: "failed", hasPublish: true });
  assert.equal(actions.canRetry, false);
  assert.equal(actions.canSync, false);
  assert.equal(actions.canRevise, true);
  assert.equal(getSeoReviewStage({ decision: "approved", syncStatus: "failed" }), "failed");
  assert.equal(getSeoReviewStage({ decision: "approved", syncStatus: "idle" }), "ready");
});
