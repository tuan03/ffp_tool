import assert from "node:assert/strict";
import test from "node:test";

import { createAmazonCrawlerJobController, getAmazonCrawlerJobController } from "..";

const defaults = { profileSlug: "jeminise", imageProfileSlug: "logo-a", applyJeminisePreset: true } as const;

test("store crawl settings use the operator vendor route and validate store identity", async () => {
  const requests: string[] = [];
  const controller = createAmazonCrawlerJobController({ engineUrl: "http://localhost:8766", fetchImplementation: async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    if (init?.body) assert.deepEqual(JSON.parse(String(init.body)), { vendor: "Brand A", ...defaults });
    return Response.json({ storeId: "store-a", vendor: "Brand A", defaults, updatedAt: "revision-1" });
  } });
  assert.ok(controller.storeCrawlSettings);
  assert.deepEqual((await controller.storeCrawlSettings.get("store-a")).defaults, defaults);
  await controller.storeCrawlSettings.save("store-a", { vendor: "Brand A", ...defaults });
  await assert.rejects(controller.storeCrawlSettings.get("store-b"));
  assert.equal(requests[1], "PUT http://localhost:8766/api/v1/store-vendors/store-a/crawl-settings");
});

test("mock defaults start unconfigured, persist per store, and return detached values", async () => {
  const controller = getAmazonCrawlerJobController("mock", "");
  assert.ok(controller.storeCrawlSettings);
  assert.equal((await controller.storeCrawlSettings.get("store-a")).defaults, null);
  const saved = await controller.storeCrawlSettings.save("store-a", { vendor: "Brand A", ...defaults });
  assert.ok(saved.defaults);
  saved.defaults.imageProfileSlug = "changed-by-caller";
  assert.equal((await controller.storeCrawlSettings.get("store-a")).defaults?.imageProfileSlug, "logo-a");
  assert.equal((await controller.storeCrawlSettings.get("store-b")).defaults, null);
  assert.equal((await controller.storeVendors?.get("store-a"))?.vendor, "Brand A");
});

test("client rejects invalid configured responses instead of silently choosing defaults", async () => {
  for (const malformed of [
    { ...defaults, profileSlug: "unknown" },
    { ...defaults, imageProfileSlug: "" },
    { ...defaults, applyJeminisePreset: "false" },
    { ...defaults, profileSlug: "default" },
  ]) {
    const controller = createAmazonCrawlerJobController({ engineUrl: "http://localhost:8766", fetchImplementation: async () =>
      Response.json({ storeId: "store-a", vendor: "Brand A", defaults: malformed, updatedAt: "revision-1" }) });
    assert.ok(controller.storeCrawlSettings);
    await assert.rejects(controller.storeCrawlSettings.get("store-a"), /Cấu hình store không hợp lệ/);
  }
});
