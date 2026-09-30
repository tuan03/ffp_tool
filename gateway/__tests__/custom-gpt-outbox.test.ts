import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { recoverAutoSeoHandoffs } from "../custom-gpt-seo/auto-seo-outbox";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import type { AutoSeoPostgresBackup } from "../auto-seo-postgres-repository";

function pendingBackup(): AutoSeoPostgresBackup {
  return {
    id: "1", backupId: randomUUID(), workflowId: "workflow", storeId: "capozen",
    shopDomain: "example.myshopify.com", productId: "gid://shopify/Product/123",
    productHandle: "cotton-rug", productTitle: "Cotton rug", shopifyUpdatedAt: null,
    snapshotJson: JSON.stringify({ id: "gid://shopify/Product/123", title: "Cotton rug", handle: "cotton-rug", description: "Cotton", images: [{ id: "front", url: "https://example.com/image.jpg" }] }),
    snapshotSha256: "a".repeat(64), gptSettingsJson: JSON.stringify({ provider: "custom_gpt", batchSize: 5, language: "en-US" }),
    downstreamStatus: "NOT_SENT", downstreamHttpStatus: null, downstreamError: null,
    downstreamSentAt: null, createdAt: "2026-09-30T00:00:00.000Z",
  };
}

test("backup outbox enqueues from repository before acknowledging and preserves settings", async () => {
  const queueDb = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(queueDb);
    queue.configure("capozen", { provider: "gemini", batchSize: 10, language: "vi-VN" });
    const backup = pendingBackup();
    let status = "NOT_SENT";
    const repository = {
      async findPendingBackups() { return status === "NOT_SENT" ? [backup] : []; },
      async acknowledgePendingHandoff(backupId: string) {
        assert.equal(backupId, backup.backupId);
        assert.equal(queue.list("capozen").length, 1);
        status = "SENT";
      },
      async failPendingHandoff() { assert.fail("handoff should succeed"); },
    };
    await recoverAutoSeoHandoffs(repository, queue);
    assert.equal(status, "SENT");
    assert.equal(queue.list("capozen")[0]?.settings.provider, "custom_gpt");
    assert.equal(queue.list("capozen")[0]?.settings.language, "en-US");
    assert.equal(queue.list("capozen")[0]?.input.productId, "123");
    await recoverAutoSeoHandoffs(repository, queue);
    assert.equal(queue.list("capozen").length, 1);
  } finally { queueDb.close(); }
});

test("failed handoff marks backup failed", async () => {
  const queueDb = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(queueDb);
    const backup = { ...pendingBackup(), snapshotJson: "{" };
    let failedId = "";
    await recoverAutoSeoHandoffs({
      async findPendingBackups() { return [backup]; },
      async acknowledgePendingHandoff() { assert.fail("should not acknowledge"); },
      async failPendingHandoff(backupId) { failedId = backupId; },
    }, queue);
    assert.equal(failedId, backup.backupId);
    assert.equal(queue.list("capozen").length, 0);
  } finally { queueDb.close(); }
});
