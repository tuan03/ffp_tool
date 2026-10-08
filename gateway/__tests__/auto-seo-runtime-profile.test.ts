import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { initAutoSeoDbSchema } from "../auto-seo-db";
import { handleAutoSeoHttpRequest, handleAutoSeoRun } from "../auto-seo-handler";
import { recoverAutoSeoHandoffs } from "../custom-gpt-seo/auto-seo-outbox";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { runSeoContent } from "../seo-content";
import { AutoSeoStoreProfileError, requireAutoSeoStoreProfile } from "../seo-content/store-profile";
import type { AutoSeoPostgresBackup } from "../auto-seo-postgres-repository";
import type { StoreConfig } from "../types";

const runtimeStore: StoreConfig = {
  storeId: "new-handbag-store", shopDomain: "new-handbag-store.myshopify.com",
  seoProfileId: "preaureum-handbags", apiVersion: "2026-07",
  auth: { type: "static", staticToken: "test-only-not-a-real-token" },
};
const sourceProduct = {
  id: "gid://shopify/Product/123", handle: "visual-bag", title: "Visual bag",
  images: [{ id: "front", url: "https://example.com/front.png" }],
};
const query = { storeId: runtimeStore.storeId, shopDomain: runtimeStore.shopDomain };
const resolveProfile = (input: typeof query) => requireAutoSeoStoreProfile(input, [runtimeStore]);

test("Auto SEO binds a runtime policy to an arbitrary execution store", () => {
  const profile = resolveProfile(query);
  assert.equal(profile.profileId, "preaureum-handbags");
  assert.equal(profile.storeId, runtimeStore.storeId);
  assert.equal(profile.niche, "Personalized Handbags & Wallets");
});

test("Auto SEO rejects missing or invalid explicit profiles with an actionable error", () => {
  for (const seoProfileId of [undefined, "unknown-profile"]) {
    assert.throws(() => requireAutoSeoStoreProfile(query, [{ ...runtimeStore, seoProfileId }]),
      (error: unknown) => error instanceof AutoSeoStoreProfileError &&
        error.code === "STORE_PROFILE_REQUIRED" && /SEO profile/.test(error.message));
  }
});

test("Auto SEO checks the registered Shopify domain before resolving a policy", () => {
  assert.throws(() => resolveProfile({ ...query, shopDomain: "another-store.myshopify.com" }),
    (error: unknown) => error instanceof AutoSeoStoreProfileError && error.code === "STORE_DOMAIN_MISMATCH");
});

test("Auto SEO retains historical domain-based profiles without a runtime mapping", () => {
  const profile = requireAutoSeoStoreProfile({ storeId: "legacy-development", shopDomain: "leatherbag-3anqqbf8.myshopify.com" }, []);
  assert.equal(profile.storeId, "legacy-development");
  assert.equal(profile.profileId, "preaureum-handbags");
});

test("Auto SEO reloads registered policy changes without restarting the Gateway", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ffp-auto-seo-profile-"));
  const path = join(directory, "stores.json");
  const previousPath = process.env.GATEWAY_STORES_FILE;
  process.env.GATEWAY_STORES_FILE = path;
  try {
    writeFileSync(path, JSON.stringify([{ ...runtimeStore, seoProfileId: undefined }]));
    assert.throws(() => requireAutoSeoStoreProfile(query), AutoSeoStoreProfileError);
    writeFileSync(path, JSON.stringify([runtimeStore]));
    const result = await runSeoContent({ workflowId: "runtime-config-reload", ...query, products: [sourceProduct] }, {
      runner: async input => {
        assert.equal(input.storeProfile.storeId, runtimeStore.storeId);
        assert.equal(input.storeProfile.profileId, "preaureum-handbags");
        return { productTitle: "Visual bag", productDescription: "<p>Visual bag</p>",
          productSeoTitle: "Visual bag", productSeoDescription: "Visual bag", images: [] };
      },
    });
    assert.equal(result.success, true);
  } finally {
    if (previousPath === undefined) delete process.env.GATEWAY_STORES_FILE;
    else process.env.GATEWAY_STORES_FILE = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Auto SEO returns an actionable 409 before persisting a missing-profile backup", async () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  const server = createServer((request, response) => {
    void handleAutoSeoHttpRequest(request, response, {
      db, storeProfileResolver: identity => requireAutoSeoStoreProfile(identity, []),
      seoContentRunner: async () => { assert.fail("generation must not start"); },
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auto-seo/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId: "http-profile-validation", ...query, products: [sourceProduct] }),
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.error.code, "STORE_PROFILE_REQUIRED");
    assert.match(payload.error.message, /Sửa store/);
    assert.equal(db.prepare("SELECT count(*) AS count FROM auto_seo_product_backups").get()?.count, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
});

test("Auto SEO validates a profile before creating backup rows or invoking generation", async () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  let generationCalls = 0;
  try {
    await assert.rejects(handleAutoSeoRun({ workflowId: "missing-profile", ...query, products: [sourceProduct] }, {
      db, storeProfileResolver: input => requireAutoSeoStoreProfile(input, []),
      seoContentRunner: async () => { generationCalls++; return { success: true, processedCount: 1 }; },
    }), AutoSeoStoreProfileError);
    assert.equal(db.prepare("SELECT count(*) AS count FROM auto_seo_product_backups").get()?.count, 0);
    assert.equal(generationCalls, 0);
  } finally { db.close(); }
});

test("Auto SEO snapshots the resolved policy for the backed-up handoff", async () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  try {
    const result = await handleAutoSeoRun({ workflowId: "runtime-profile", ...query, products: [sourceProduct] }, {
      db, storeProfileResolver: resolveProfile,
      seoContentRunner: async (_input, options) => {
        assert.equal(db.prepare("SELECT count(*) AS count FROM auto_seo_product_backups").get()?.count, 1);
        assert.equal(options?.storeProfile?.storeId, runtimeStore.storeId);
        assert.equal(options?.storeProfile?.profileId, "preaureum-handbags");
        return { success: true, processedCount: 1 };
      },
    });
    assert.equal(result.downstreamStatus, "SENT");
  } finally { db.close(); }
});

test("Auto SEO generation uses the resolved policy without confusing policy and execution stores", async () => {
  const result = await runSeoContent({ workflowId: "policy-generation", ...query, products: [sourceProduct] }, {
    storeProfile: resolveProfile(query),
    runner: async input => {
      assert.equal(input.storeProfile.storeId, runtimeStore.storeId);
      assert.equal(input.storeProfile.profileId, "preaureum-handbags");
      return { productTitle: "Visual bag", productDescription: "<p>Visual bag</p>",
        productSeoTitle: "Visual bag", productSeoDescription: "Visual bag", images: [] };
    },
  });
  assert.equal(result.success, true);
});

test("Auto SEO refuses a resolved profile belonging to another execution store", async () => {
  await assert.rejects(runSeoContent({ workflowId: "wrong-policy-store", ...query, products: [sourceProduct] }, {
    storeProfile: { ...resolveProfile(query), storeId: "another-store" },
    runner: async () => { throw new Error("generation must not start"); },
  }), /execution store/);
});

function backup(): AutoSeoPostgresBackup {
  return { id: "1", backupId: "backup-runtime-profile", workflowId: "runtime-profile", ...query,
    productId: sourceProduct.id, productHandle: sourceProduct.handle, productTitle: sourceProduct.title,
    shopifyUpdatedAt: null, snapshotJson: JSON.stringify(sourceProduct), snapshotSha256: "a".repeat(64),
    gptSettingsJson: JSON.stringify({ provider: "codex_mcp", batchSize: 5, language: "en-US" }),
    downstreamStatus: "NOT_SENT", downstreamHttpStatus: null, downstreamError: null,
    downstreamSentAt: null, createdAt: "2026-01-01T00:00:00.000Z" };
}

test("Auto SEO recovery honors runtime policy and ACKs only after queue acceptance", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  let acked = false;
  try {
    await recoverAutoSeoHandoffs({
      async findPendingBackups() { return [backup()]; },
      async acknowledgePendingHandoff() {
        const job = queue.list(runtimeStore.storeId)[0];
        assert.equal(job?.input.storeProfile.storeId, runtimeStore.storeId);
        assert.equal(job?.input.storeProfile.profileId, "preaureum-handbags");
        assert.equal(job?.settings.provider, "codex_mcp");
        acked = true;
      },
      async failPendingHandoff() { assert.fail("recovery must succeed"); },
    }, queue, resolveProfile);
    assert.equal(acked, true);
  } finally { db.close(); }
});

test("Auto SEO recovery does not acknowledge an unconfigured profile or enqueue it", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  let failure = "";
  try {
    await recoverAutoSeoHandoffs({
      async findPendingBackups() { return [backup()]; },
      async acknowledgePendingHandoff() { assert.fail("must not acknowledge"); },
      async failPendingHandoff(_id, error) { failure = error; },
    }, queue, input => requireAutoSeoStoreProfile(input, []));
    assert.match(failure, /SEO profile/);
    assert.equal(queue.list(runtimeStore.storeId).length, 0);
  } finally { db.close(); }
});
