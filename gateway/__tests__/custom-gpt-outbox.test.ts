import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initAutoSeoDbSchema } from "../auto-seo-db";
import { executeAutoSeoBackup } from "../auto-seo-handler";
import { recoverAutoSeoHandoffs } from "../custom-gpt-seo/auto-seo-outbox";
import { CustomGptQueue } from "../custom-gpt-seo/queue";

test("backup outbox recovers a crash before enqueue and preserves provider snapshot", () => {
  const backupDb = new DatabaseSync(":memory:");
  const queueDb = new DatabaseSync(":memory:");
  try {
    initAutoSeoDbSchema(backupDb);
    const queue = new CustomGptQueue(queueDb);
    const settings = queue.configure("capozen", { provider: "custom_gpt", batchSize: 5, language: "en-US" });
    executeAutoSeoBackup(backupDb, { workflowId: "workflow", storeId: "capozen", shopDomain: "example.myshopify.com", products: [{ id: "gid://shopify/Product/123", title: "Cotton rug", handle: "cotton-rug", description: "Cotton", images: [{ id: "front", url: "https://example.com/image.jpg" }] }] });
    backupDb.prepare("UPDATE auto_seo_product_backups SET gpt_settings_json=?").run(JSON.stringify(settings));
    queue.configure("capozen", { provider: "gemini", batchSize: 10, language: "vi-VN" });
    recoverAutoSeoHandoffs(backupDb, queue);
    assert.equal(queue.list("capozen").length, 1);
    assert.equal(queue.list("capozen")[0]?.settings.provider, "custom_gpt");
    assert.equal(queue.list("capozen")[0]?.settings.language, "en-US");
    assert.equal(queue.list("capozen")[0]?.input.productId, "123");
    assert.equal(backupDb.prepare("SELECT downstream_status FROM auto_seo_product_backups").get()?.downstream_status, "SENT");
    backupDb.exec("UPDATE auto_seo_product_backups SET downstream_status='NOT_SENT'");
    recoverAutoSeoHandoffs(backupDb, queue);
    assert.equal(queue.list("capozen").length, 1);
  } finally { backupDb.close(); queueDb.close(); }
});

test("backup outbox preserves a Codex MCP provider snapshot", () => {
  const backupDb = new DatabaseSync(":memory:");
  const queueDb = new DatabaseSync(":memory:");
  try {
    initAutoSeoDbSchema(backupDb);
    const queue = new CustomGptQueue(queueDb);
    const settings = queue.configure("capozen", { provider: "codex_mcp", batchSize: 5, language: "en-US" });
    executeAutoSeoBackup(backupDb, {
      workflowId: "codex-workflow",
      storeId: "capozen",
      shopDomain: "example.myshopify.com",
      products: [{ id: "gid://shopify/Product/456", title: "Visual decor", handle: "visual-decor", images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }] }],
    });
    backupDb.prepare("UPDATE auto_seo_product_backups SET gpt_settings_json=?").run(JSON.stringify(settings));
    queue.configure("capozen", { provider: "gemini", batchSize: 5 });

    recoverAutoSeoHandoffs(backupDb, queue);

    const queuedJob = queue.list("capozen")[0];
    assert.equal(queuedJob?.settings.provider, "codex_mcp");
    assert.equal(queue.claim("capozen", "codex-auto-seo", "codex_mcp", "codex_mcp:default").jobs[0]?.id, queuedJob?.id);
  } finally {
    backupDb.close();
    queueDb.close();
  }
});
