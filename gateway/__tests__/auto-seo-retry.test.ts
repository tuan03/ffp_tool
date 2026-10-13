import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { getAutoSeoSentBackupDisposition } from "../auto-seo-retry";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { createTestEnqueue } from "./seo-v2-fixtures";

test("Auto SEO retries operator-cleared jobs but protects active reviews and Shopify operations", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(db);
    const pending = queue.enqueue(createTestEnqueue());
    queue.clearQueue(pending.storeId);
    const cleared = queue.findLatestSourceJob(pending.storeId, pending.source, pending.sourceIdentity);
    assert.ok(cleared);
    assert.equal(getAutoSeoSentBackupDisposition(cleared, false), "RETRY");
    assert.equal(getAutoSeoSentBackupDisposition(pending, false), "ACTIVE_DUPLICATE");
    assert.equal(getAutoSeoSentBackupDisposition(cleared, true), "ACTIVE_DUPLICATE");
    for (const shopifySyncStatus of ["SYNCING", "UNKNOWN", "FAILED"] as const) {
      assert.equal(getAutoSeoSentBackupDisposition({ ...cleared, shopifySyncStatus }, false), "ACTIVE_DUPLICATE");
    }
    assert.equal(getAutoSeoSentBackupDisposition({ ...cleared, shopifySyncStatus: "SYNCED" }, false), "UNCHANGED");
    assert.equal(getAutoSeoSentBackupDisposition({ ...cleared, cancellationReason: undefined }, false), "UNCHANGED");
    assert.equal(getAutoSeoSentBackupDisposition(null, false), "UNCHANGED");
  } finally { db.close(); }
});
