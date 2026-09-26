import assert from "node:assert/strict";
import test from "node:test";

import { amazonCrawlerMockOutput } from "../mocks/data";
import { clearCrawlerCacheAndOutput } from "../ui/cache-clear";
import {
  clearCrawlerSession,
  getCrawlerSessionState,
  startCrawlerJob,
} from "../ui/crawler-session";

async function loadCrawlerOutput(): Promise<void> {
  await startCrawlerJob({
    runAmazonCrawler: async () => ({ ...amazonCrawlerMockOutput }),
    urls: ["B00MOCK001"],
  });
}

test("successful cache clear also removes the displayed crawler output", async () => {
  clearCrawlerSession();
  await loadCrawlerOutput();

  const result = await clearCrawlerCacheAndOutput(async () => ({
    removedFiles: 3,
    removedBytes: 2048,
  }));

  assert.deepEqual(result, { removedFiles: 3, removedBytes: 2048 });
  const state = getCrawlerSessionState();
  assert.equal(state.output, null);
  assert.deepEqual(state.liveProducts, []);
  assert.equal(state.progress, null);
  assert.equal(state.selectedProductId, null);
});

test("failed cache clear preserves the displayed crawler output", async () => {
  clearCrawlerSession();
  await loadCrawlerOutput();

  await assert.rejects(
    clearCrawlerCacheAndOutput(async () => {
      throw new Error("cache unavailable");
    }),
    /cache unavailable/,
  );

  assert.ok(getCrawlerSessionState().output);
});
