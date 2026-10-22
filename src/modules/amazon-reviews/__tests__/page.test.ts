import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createAmazonReviewsRoutes, getReviewClient } from "../index";

test("Amazon Reviews tab loads product context without crawling reviews", async () => {
  const client = getReviewClient("mock", "http://127.0.0.1:8766");
  const routes = createAmazonReviewsRoutes(client, {
    listStores: async () => ["mock-store"],
    findProducts: async () => ({ products: [] }),
  });
  assert.equal(routes[0]?.path, "amazon-reviews");
  const element = routes[0]?.element;
  assert.ok(element);
  const markup = renderToStaticMarkup(element);
  assert.match(markup, /Amazon Reviews/);
  assert.match(markup, /Lấy ngữ cảnh/);
  assert.match(markup, /Xóa kết quả/);
  assert.doesNotMatch(markup, /Crawl review|Số trang tối đa/);
  assert.doesNotMatch(markup, /Sync Judge\.me/);
  const created = await client.create("B012345678");
  const job = await client.get(created.jobId);
  assert.equal(job.reviewData.context?.title, "Autumn Deer Rug");
  assert.deepEqual(job.reviewData.reviews, []);
  assert.equal(job.reviewData.reviewCount, 0);
  assert.equal(job.reviewData.pagesFetched, 0);
  assert.equal(job.reviewData.stopReason, "context_ready");
});

test("mock clear removes context and samples and allows a fresh job", async () => {
  const client = getReviewClient("mock", "http://127.0.0.1:8766");
  const created = await client.create("B012345678");
  const job = await client.get(created.jobId);
  assert.ok(job.reviewData.context);
  await client.generate({ contextJobId: job.jobId, storeId: "mock-store", count: 1, requestId: "request-1" });
  await client.clear(job.jobId);
  await client.clear(job.jobId);
  await assert.rejects(client.get(job.jobId), /not found/i);
  const fresh = await client.create("B012345678");
  const freshJob = await client.get(fresh.jobId);
  assert.ok(freshJob.reviewData.context);
  assert.deepEqual(freshJob.samples, []);
});

test("mock context jobs return fresh data and reset generated samples", async () => {
  const client = getReviewClient("mock", "http://127.0.0.1:8766");
  const created = await client.create("B012345678");
  const job = await client.get(created.jobId);
  assert.ok(job.reviewData.context);
  await client.generate({ contextJobId: job.jobId, storeId: "mock-store", count: 1, requestId: "request-1" });
  assert.equal((await client.get(job.jobId)).samples.length, 1);
  assert.equal(job.samples.length, 0);
  await client.create("B012345678");
  assert.deepEqual((await client.get(job.jobId)).samples, []);
});

test("mock AI reviews include three, four and five stars across batches", async () => {
  const client = getReviewClient("mock", "http://127.0.0.1:8766");
  const created = await client.create("B012345678");
  const job = await client.get(created.jobId);
  assert.ok(job.reviewData.context);
  const input = { contextJobId: job.jobId, storeId: "mock-store" };
  await client.generate({ ...input, count: 2, requestId: "request-1" });
  await client.generate({ ...input, count: 1, requestId: "request-2" });
  assert.deepEqual((await client.get(job.jobId)).samples.map((review) => review.rating), [5, 4, 3]);
});
