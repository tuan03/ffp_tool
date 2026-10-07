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

test("AdsIntelligenceCache: returns stale data when allowStale=true within grace period", async () => {
  const cache = new AdsIntelligenceCache(20, 100); // 20ms TTL, 100ms grace
  cache.set("swr:test", "stale_value");

  await new Promise((r) => setTimeout(r, 35)); // past 20ms TTL, but within 120ms total stale window

  const freshOnly = cache.get<string>("swr:test", false);
  assert.equal(freshOnly, null);

  const staleEntry = cache.get<string>("swr:test", true);
  assert.ok(staleEntry !== null);
  assert.equal(staleEntry.data, "stale_value");
  assert.equal(staleEntry.isStale, true);

  await new Promise((r) => setTimeout(r, 100)); // past 120ms total stale window

  const expiredEntry = cache.get<string>("swr:test", true);
  assert.equal(expiredEntry, null);
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

test("AdsIntelligenceCache: coalesces multiple concurrent in-flight requests into a single execution", async () => {
  const cache = new AdsIntelligenceCache(60_000);
  let underlyingExecutionCount = 0;

  const executeSlowTask = async (id: number): Promise<{ storeId: string; counter: number }> => {
    underlyingExecutionCount++;
    await new Promise((r) => setTimeout(r, 40));
    return { storeId: "store-a", counter: id };
  };

  const key = "store-a:summary";

  // Simulate 5 simultaneous callers arriving at the exact same moment
  const caller1 = (async () => {
    const inFlight = cache.getInFlight<{ storeId: string; counter: number }>(key);
    if (inFlight) return inFlight;
    return cache.trackInFlight(key, executeSlowTask(101));
  })();

  const caller2 = (async () => {
    // slightly after caller1 triggers trackInFlight
    await new Promise((r) => setTimeout(r, 5));
    const inFlight = cache.getInFlight<{ storeId: string; counter: number }>(key);
    if (inFlight) return inFlight;
    return cache.trackInFlight(key, executeSlowTask(102));
  })();

  const caller3 = (async () => {
    await new Promise((r) => setTimeout(r, 10));
    const inFlight = cache.getInFlight<{ storeId: string; counter: number }>(key);
    if (inFlight) return inFlight;
    return cache.trackInFlight(key, executeSlowTask(103));
  })();

  const [res1, res2, res3] = await Promise.all([caller1, caller2, caller3]);

  // All 3 callers must get the exact result of the single task
  assert.deepEqual(res1, { storeId: "store-a", counter: 101 });
  assert.deepEqual(res2, { storeId: "store-a", counter: 101 });
  assert.deepEqual(res3, { storeId: "store-a", counter: 101 });

  // Underlying task must only have run once!
  assert.equal(underlyingExecutionCount, 1);

  // Stats must record coalesced requests
  const stats = cache.getStats();
  assert.equal(stats.coalesced, 2);
  assert.equal(stats.inFlightCount, 0);
});

test("AdsIntelligenceCache: cleans up in-flight promise even if task rejects", async () => {
  const cache = new AdsIntelligenceCache(60_000);
  let failed = false;

  const failingTask = async () => {
    await new Promise((r) => setTimeout(r, 20));
    throw new Error("GRAPH_API_TIMEOUT");
  };

  const key = "store-err:data";
  try {
    await cache.trackInFlight(key, failingTask());
  } catch (err: any) {
    failed = true;
    assert.equal(err.message, "GRAPH_API_TIMEOUT");
  }

  assert.ok(failed);
  assert.equal(cache.getInFlight(key), null);
  assert.equal(cache.getStats().inFlightCount, 0);
});

test("handleAdsIntelligenceHttpRequest: handles /api/ads-intelligence/overview bundle endpoint", async () => {
  const req = {
    url: "/api/ads-intelligence/overview?storeId=chillgen",
    method: "GET",
    headers: {},
  } as unknown as http.IncomingMessage;

  let statusCode = 0;
  const headers: Record<string, string> = {};
  let body = "";

  const res = {
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(data: string) {
      body = data;
    },
  } as unknown as http.ServerResponse;

  const handled = await handleAdsIntelligenceHttpRequest(req, res);
  assert.equal(handled, true);
  assert.equal(statusCode, 200);
  assert.ok(headers["x-ads-coalesced"] !== undefined);

  const parsed = JSON.parse(body);
  assert.ok(parsed.summary !== undefined);
  assert.ok(parsed.health !== undefined);
  assert.ok(parsed.reconciliation !== undefined);
  assert.ok(parsed.cacheStats !== undefined);
});

