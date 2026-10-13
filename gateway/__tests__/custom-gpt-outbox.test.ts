import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { recoverAutoSeoHandoffs } from "../custom-gpt-seo/auto-seo-outbox";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import type { AutoSeoPostgresBackup } from "../auto-seo-postgres-repository";
import { fromAutoSeoProduct } from "../../src/modules/seo-content";
import { createTestStoreProfile } from "./seo-v2-fixtures";

function pendingBackup(): AutoSeoPostgresBackup {
  return {
    id: "1", backupId: randomUUID(), workflowId: "workflow", storeId: "jeminise",
    shopDomain: "b6-theme-test.myshopify.com", productId: "gid://shopify/Product/123",
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
    queue.configure("jeminise", { provider: "gemini", batchSize: 10, language: "vi-VN" });
    const backup = pendingBackup();
    let status = "NOT_SENT";
    const repository = {
      async findPendingBackups() { return status === "NOT_SENT" ? [backup] : []; },
      async acknowledgePendingHandoff(backupId: string) {
        assert.equal(backupId, backup.backupId);
        assert.equal(queue.list("jeminise").length, 1);
        status = "SENT";
      },
      async failPendingHandoff() { assert.fail("handoff should succeed"); },
    };
    await recoverAutoSeoHandoffs(repository, queue);
    assert.equal(status, "SENT");
    assert.equal(queue.list("jeminise")[0]?.settings.provider, "custom_gpt");
    assert.equal(queue.list("jeminise")[0]?.settings.language, "en-US");
    assert.equal(queue.list("jeminise")[0]?.execution.productId, "123");
    await recoverAutoSeoHandoffs(repository, queue);
    assert.equal(queue.list("jeminise").length, 1);
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
    assert.equal(queue.list("jeminise").length, 0);
  } finally { queueDb.close(); }
});

test("outbox recovery reuses the direct Auto SEO job for the same source revision", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(db);
    const updatedAt = "2026-10-01T00:00:00Z";
    const product = { id: "gid://shopify/Product/123", title: "Fixture", handle: "fixture", updatedAt,
      images: [{ id: "front", url: "https://example.com/front.jpg" }] };
    const profile = createTestStoreProfile();
    const settings = queue.configure("jeminise", { provider: "codex_mcp", batchSize: 5 });
    const direct = queue.enqueue({ input: fromAutoSeoProduct(product, profile.niche, profile), execution: {
      storeId: "jeminise", productId: "123", source: "auto_seo", sourceIdentity: "123", sourceRevision: updatedAt,
      shopifyUpdatedAt: updatedAt, providerId: "codex_mcp", pipelineVersion: "seo-content-input-v2", originalSnapshot: product,
    }, settings });
    await recoverAutoSeoHandoffs({
      async findPendingBackups() { return [{ ...pendingBackup(), snapshotJson: JSON.stringify(product), shopifyUpdatedAt: updatedAt, gptSettingsJson: JSON.stringify(settings) }]; },
      async acknowledgePendingHandoff() {},
      async failPendingHandoff() { assert.fail("must reuse direct handoff"); },
    }, queue, () => profile);
    assert.deepEqual(queue.list("jeminise").map(job => job.id), [direct.id]);
  } finally { db.close(); }
});

test("backup outbox preserves a Codex MCP provider snapshot", async () => {
  const queueDb = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(queueDb);
    const settings = queue.configure("jeminise", { provider: "codex_mcp", batchSize: 5, language: "en-US" });
    const backup = {
      ...pendingBackup(),
      productId: "gid://shopify/Product/456",
      snapshotJson: JSON.stringify({ id: "gid://shopify/Product/456", title: "Visual decor", handle: "visual-decor", images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }] }),
      gptSettingsJson: JSON.stringify(settings),
    };
    let acknowledgedId = "";
    queue.configure("jeminise", { provider: "gemini", batchSize: 5 });

    await recoverAutoSeoHandoffs({
      async findPendingBackups() { return [backup]; },
      async acknowledgePendingHandoff(backupId) { acknowledgedId = backupId; },
      async failPendingHandoff() { assert.fail("handoff should succeed"); },
    }, queue);

    const queuedJob = queue.list("jeminise")[0];
    assert.equal(acknowledgedId, backup.backupId);
    assert.equal(queuedJob?.settings.provider, "codex_mcp");
    assert.equal(queue.claim("jeminise", "codex-auto-seo", "codex_mcp", "codex_mcp:default").jobs[0]?.id, queuedJob?.id);
  } finally {
    queueDb.close();
  }
});
