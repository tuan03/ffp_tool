import assert from "node:assert/strict";
import test from "node:test";

import { createSeoPerformanceClient } from "../service";
import { createMockSeoPerformanceClient } from "../mocks/runner";
import { handleAutoSeoEnqueue, MEMORY_ACTIVE_AUTO_SEO_JOBS } from "../../../../gateway/seo-performance/benchmark-handler";
import type { PerformanceService } from "../../../../gateway/seo-performance/service";

test("Auto-SEO client sends POST request to benchmark/auto-seo with storeId and productId", async () => {
  let requestedUrl = "";
  let requestInit: RequestInit | undefined;

  const client = createSeoPerformanceClient(async (url, init) => {
    requestedUrl = String(url);
    requestInit = init;
    return new Response(
      JSON.stringify({
        jobId: "test-job-uuid-123",
        isExisting: false,
        message: "Đã tạo yêu cầu Auto-SEO thành công.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const result = await client.createAutoSeo("jeminise", "prod_02");

  assert.match(requestedUrl, /\/api\/seo-performance\/benchmark\/auto-seo\?storeId=jeminise/);
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("X-FFP-Performance"), "1");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { productId: "prod_02" });
  assert.equal(result.jobId, "test-job-uuid-123");
  assert.equal(result.isExisting, false);
});

test("Auto-SEO mock runner creates job and prevents duplicates on second call (deduplication)", async () => {
  const mockClient = createMockSeoPerformanceClient();

  // First call: should create a new job
  const first = await mockClient.createAutoSeo("store_test", "prod_02");
  assert.ok(first.jobId.startsWith("job-auto-seo-"));
  assert.equal(first.isExisting, false);
  assert.match(first.message ?? "", /thành công/);

  // Second call: duplicate detection should return the same jobId and isExisting: true
  const second = await mockClient.createAutoSeo("store_test", "prod_02");
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.isExisting, true);
  assert.match(second.message ?? "", /đã có yêu cầu Auto-SEO/);
});

test("Auto-SEO mock runner hydrates benchmark products to reflect active queue state", async () => {
  const mockClient = createMockSeoPerformanceClient();

  // Before enqueue: prod_02 should have enabled action
  const before = await mockClient.benchmark("jeminise");
  const prodBefore = before.items.find(p => p.productId === "prod_02");
  assert.ok(prodBefore);
  assert.equal(prodBefore.action.type, "AUTO_SEO");
  assert.equal(prodBefore.action.enabled, true);
  assert.equal(prodBefore.action.label, "Tạo Auto-SEO");

  // Enqueue Auto-SEO for prod_02
  await mockClient.createAutoSeo("jeminise", "prod_02");

  // After enqueue: benchmark query should hydrate prod_02 as active (disabled button with explanation)
  const after = await mockClient.benchmark("jeminise");
  const prodAfter = after.items.find(p => p.productId === "prod_02");
  assert.ok(prodAfter);
  assert.equal(prodAfter.action.type, "AUTO_SEO");
  assert.equal(prodAfter.action.enabled, false);
  assert.equal(prodAfter.action.label, "Đang Auto-SEO");
  assert.match(prodAfter.action.disabledReason ?? "", /đang được xử lý trong hàng đợi/);
});

test("Gateway handleAutoSeoEnqueue checks gpt_jobs deduplication and handles duplicate requests safely", async () => {
  MEMORY_ACTIVE_AUTO_SEO_JOBS.clear();

  // Mock DB to simulate gpt_jobs table with active jobs
  const insertedJobs: Array<{ id: string; store_id: string; payload: string }> = [];

  const fakeService = {
    ready: async () => {},
    repository: {
      pool: {
        query: async (sql: string, params: unknown[] = []) => {
          // If query checks for active gpt_jobs
          if (sql.includes("SELECT id, status FROM gpt_jobs")) {
            const cleanId = String(params[1]);
            const existing = insertedJobs.find(
              j => j.store_id === params[0] && j.payload.includes(`"sourceIdentity":"${cleanId}"`),
            );
            if (existing) {
              return { rows: [{ id: existing.id, status: "PENDING" }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }
          // If query inserts new job
          if (sql.includes("INSERT INTO gpt_jobs")) {
            insertedJobs.push({
              id: String(params[0]),
              store_id: String(params[1]),
              payload: String(params[3]),
            });
            return { rows: [], rowCount: 1 };
          }
          // Default: empty
          return { rows: [], rowCount: 0 };
        },
      },
    },
  } as unknown as PerformanceService;

  // 1. First enqueue call: should insert job with source: "auto_seo"
  const firstRes = await handleAutoSeoEnqueue(fakeService, "store_gw", "gid://shopify/Product/999");
  assert.equal(firstRes.isExisting, false);
  assert.ok(firstRes.jobId);
  assert.equal(insertedJobs.length, 1);
  assert.ok(insertedJobs[0].payload.includes(`"source":"auto_seo"`));
  assert.ok(insertedJobs[0].payload.includes(`"sourceIdentity":"999"`));

  // 2. Second enqueue call for the same product: should detect existing job in gpt_jobs
  const secondRes = await handleAutoSeoEnqueue(fakeService, "store_gw", "999");
  assert.equal(secondRes.isExisting, true);
  assert.equal(secondRes.jobId, firstRes.jobId);
  // Ensure NO second row was inserted (deduplication)
  assert.equal(insertedJobs.length, 1);
});
