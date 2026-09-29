import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createAmazonReviewsRoutes, getReviewClient } from "../index";

test("Amazon Reviews tab renders in mock mode without Judge.me sync", async () => {
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
  assert.match(markup, /Crawl review/);
  assert.doesNotMatch(markup, /Sync Judge\.me/);
  const created = await client.create("B012345678", 1);
  const job = await client.get(created.jobId);
  assert.equal(job.reviewData.reviewCount, 2);
});
