import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { amazonCrawlerMockAgentRelease, amazonCrawlerMockOutput } from "../mocks/data";
import { AmazonCrawlerPage } from "../ui/AmazonCrawlerPage";
import { clearCrawlerSession, hydrateCrawlerSessionFromJob } from "../ui/crawler-session";
import { getCrawlerClientPresence } from "../ui/client-presence";

test("stale coordinator snapshots show unknown presence instead of a false online or stopped state", () => {
  assert.deepEqual(getCrawlerClientPresence(true, "online", true), { label: "chưa xác minh", tone: "unknown" });
  assert.deepEqual(getCrawlerClientPresence(false, "offline", false), { label: "offline", tone: "offline" });
});

test("crawler page shows SEO complete after restoring a job awaiting review", () => {
  clearCrawlerSession();
  const sourceProduct = amazonCrawlerMockOutput.products[0];
  assert.ok(sourceProduct);
  const product = {
    ...sourceProduct,
    pipeline: {
      status: "waiting_review" as const,
      normalization: { status: "completed" as const, assetsNormalized: 1 },
      seo: { status: "completed" as const },
      shopify: { attempts: 0 },
    },
  };

  hydrateCrawlerSessionFromJob({
    jobId: "job-awaiting-review",
    status: "review_pending",
    products: [product],
    output: { ...amazonCrawlerMockOutput, products: [product] },
  });

  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AmazonCrawlerPage, {
      clearAmazonCrawlerCache: async () => ({ removedFiles: 0, removedBytes: 0 }),
      loadAmazonCrawlerAgentRelease: async () => amazonCrawlerMockAgentRelease,
      loadAmazonCrawlerClients: async () => [],
      runAmazonCrawler: async () => amazonCrawlerMockOutput,
    }),
  ));

  assert.match(markup, /Pipeline: SEO complete/);
  assert.doesNotMatch(markup, /Pipeline: waiting_review/);
  assert.match(markup, />Tải Agent cho Windows</);
  assert.match(markup, /https:\/\/github\.com\/tuan03\/ffp_tool\/releases\/latest/);
  clearCrawlerSession();
});
