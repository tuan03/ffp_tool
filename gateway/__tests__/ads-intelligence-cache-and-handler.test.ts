import "./ads-test-sources";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AdsIntelligenceCache } from "../ads-intelligence/cache";
import { handleAdsIntelligenceHttpRequest } from "../ads-intelligence/http-handler";

test("AdsIntelligenceCache: sets and gets items within TTL", () => {
  const cache = new AdsIntelligenceCache(1000); // 1s TTL
  cache.set("test:key", { value: 42 });

  const hit = cache.get<{ value: number }>("test:key");
  assert.ok(hit !== null);
  assert.equal(hit.data.value, 42);
  assert.equal(typeof hit.cachedAt, "string");
  assert.equal(typeof hit.expiresAt, "string");

  const stats = cache.getStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 0);
  assert.equal(stats.keysCount, 1);
});

test("AdsIntelligenceCache: returns null when key does not exist or expired", async () => {
  const cache = new AdsIntelligenceCache(20); // 20ms TTL
  cache.set("short:lived", "quick");

  await new Promise((r) => setTimeout(r, 35));

  const missed = cache.get<string>("short:lived");
  assert.equal(missed, null);

  const stats = cache.getStats();
  assert.equal(stats.misses, 1);
});

test("AdsIntelligenceCache: invalidates by prefix or all", () => {
  const cache = new AdsIntelligenceCache(60_000);
  cache.set("store1:summary", "sum1");
  cache.set("store1:hierarchy", "hier1");
  cache.set("store2:summary", "sum2");

  const removed = cache.invalidate("store1:");
  assert.equal(removed, 2);
  assert.equal(cache.get("store1:summary"), null);
  assert.notEqual(cache.get("store2:summary"), null);

  cache.invalidate();
  assert.equal(cache.get("store2:summary"), null);
});

test("handleAdsIntelligenceHttpRequest: ignores non-ads routes", async () => {
  const req = { url: "/api/shopify" } as http.IncomingMessage;
  const res = {} as http.ServerResponse;

  const handled = await handleAdsIntelligenceHttpRequest(req, res);
  assert.equal(handled, false);
});
