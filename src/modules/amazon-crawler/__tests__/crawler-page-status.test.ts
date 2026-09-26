import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { amazonCrawlerMockOutput } from "../mocks/data";
import { AmazonCrawlerPage } from "../ui/AmazonCrawlerPage";
import { clearCrawlerSession, hydrateCrawlerSessionFromJob } from "../ui/crawler-session";

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
      loadAmazonCrawlerClients: async () => [],
      runAmazonCrawler: async () => amazonCrawlerMockOutput,
    }),
  ));

  assert.match(markup, /Pipeline: SEO complete/);
  assert.doesNotMatch(markup, /Pipeline: waiting_review/);
  clearCrawlerSession();
});
