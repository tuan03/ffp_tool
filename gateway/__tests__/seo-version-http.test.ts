import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { applySeoVersionMigrations, SeoVersionRepository } from "../seo-versioning";
import type { SeoContentSnapshotInput } from "../seo-versioning";
import { handleSeoAgentHttp } from "../seo-worker/admin-handler";
import type { WorkerDatabase } from "../seo-worker/database";

function snapshot(hash: string, title: string): SeoContentSnapshotInput {
  return { contentHash: hash.repeat(64), title, descriptionHtml: `<p>${title}</p>`, seoTitle: null, seoDescription: "",
    images: [], aeoMetafields: {}, handle: "product", onlineStoreUrl: "https://example.com/products/product",
    observedCanonicalUrl: null, shopifyStatus: "ACTIVE", vendor: null, productType: null, tags: [] };
}

test("version HTTP routes enforce store scope and expose lifecycle, pagination, diff and rollback draft only", async () => {
  const pg = await PGlite.create();
  const database: WorkerDatabase = { transaction: operation => pg.transaction(tx => operation({
    query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }),
  })) };
  let id = 0;
  await applySeoVersionMigrations(database);
  const repository = new SeoVersionRepository(database, "public", () => `id-${++id}`);
  const productGid = "gid://shopify/Product/1";
  await repository.setStoreFlags({ storeId: "store-a", readEnabled: true, writeEnabled: true }, 1);
  const v0 = await repository.ensureBaseline({ storeId: "store-a", shopifyProductGid: productGid, snapshot: snapshot("a", "Old"), observedAt: 2 });
  const v1 = await repository.commitVersion({ storeId: "store-a", shopifyProductGid: productGid, operationId: "op-1",
    expectedVersionId: v0.version.id, expectedContentHash: "a".repeat(64), snapshot: snapshot("b", "New"), source: "AUTO_SEO",
    approvedBy: "reviewer", appliedBy: "publisher", appliedAt: 3 });
  assert.equal(v1.outcome, "COMMITTED");
  let baselineRefreshes = 0;
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, {
    operator: req.headers.authorization === "Basic test" ? "operator" : undefined,
    hasStore: storeId => ["store-a", "store-b"].includes(storeId), repository: async () => { throw new Error("unused"); },
    versioning: { repository: async () => repository, isPublishEnabled: false, now: () => 10,
      observeProduct: async () => { baselineRefreshes++; return { outcome: "UNCHANGED", versionId: v0.version.id, versionNumber: 0, contentHash: "a".repeat(64) }; } },
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/seo-agent/versioning`;
    const auth = { authorization: "Basic test" };
    assert.equal((await fetch(`${base}/lifecycle?storeId=store-a&productGid=${encodeURIComponent(productGid)}`)).status, 401);
    const lifecycleResponse = await fetch(`${base}/lifecycle?storeId=store-a&productGid=${encodeURIComponent(productGid)}`, { headers: auth });
    assert.equal(lifecycleResponse.status, 200);
    const lifecycle = await lifecycleResponse.json() as { current: { currentVersion: { versionNumber: number } }; capabilities: { publish: { reasonCode: string } } };
    assert.equal(lifecycle.current.currentVersion.versionNumber, 1);
    assert.equal(lifecycle.capabilities.publish.reasonCode, "PUBLISH_DISABLED");
    const page = await (await fetch(`${base}/history?storeId=store-a&productGid=${encodeURIComponent(productGid)}&limit=1&offset=0`, { headers: auth })).json() as { entries: { id: string }[]; nextOffset: number };
    assert.equal(page.entries.length, 1); assert.equal(page.nextOffset, 1);
    const diff = await (await fetch(`${base}/diff?storeId=store-a&productGid=${encodeURIComponent(productGid)}&fromVersionId=${v0.version.id}&toVersionId=${v1.version.id}`, { headers: auth })).json() as { fields: { field: string }[] };
    assert.equal(diff.fields[0]?.field, "title");
    assert.equal((await fetch(`${base}/history?storeId=store-b&productGid=${encodeURIComponent(productGid)}`, { headers: auth })).status, 409);
    assert.equal((await fetch(`${base}/history?storeId=store-a&productGid=${encodeURIComponent("gid://shopify/Product/999")}`, { headers: auth })).status, 404);
    const postHeaders = { ...auth, "x-ffp-agent": "1", "content-type": "application/json" };
    assert.equal((await fetch(`${base}/baseline?storeId=store-a`, { method: "POST", headers: postHeaders, body: JSON.stringify({ productGid }) })).status, 202);
    assert.equal(baselineRefreshes, 1);
    const rollback = await fetch(`${base}/rollback-drafts?storeId=store-a`, { method: "POST", headers: postHeaders,
      body: JSON.stringify({ productGid, targetVersionId: v0.version.id, requestId: "13a9eb97-2a47-4f59-8cb0-aa735c80ea20" }) });
    assert.equal(rollback.status, 201);
    assert.equal((await rollback.json() as { status: string }).status, "REQUESTED");
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
});
