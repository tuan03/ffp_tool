import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors";
import {
  mockProduct1Handbag,
  mockProduct3MugWarning,
  mockProduct4Backpack,
} from "../mocks/data";
import { MockProductCrawlerClient } from "../mocks/runner";
import { getProductCrawlerClient } from "../runtime";
import {
  crawlerProductToListItem,
  crawlerProductToSeoInput,
  parseInputLines,
  RealProductCrawlerClient,
  validateCrawlerInput,
} from "../service";
import { DEFAULT_CRAWLER_OPTIONS, type ProductCrawlerJobInput } from "../types";

test("parseInputLines correctly identifies ASINs, Amazon URLs, duplicates, and invalid inputs", () => {
  const rawText = `
    B0GQ33XWW7
    https://www.amazon.com/dp/B08XY12345
    B0GQ33XWW7
    https://amazon.com/gp/product/B09PQ56789/ref=xyz
    https://www.amazon.com/gp/aw/d/B07ZZ99881?ref_=chk_typ_imgToDp
    https://www.amazon.co.jp/dp/B012345678?th=1
    https://a.co/d/B087654321
    not-an-asin
  `;

  const parsed = parseInputLines(rawText);

  assert.equal(parsed.length, 8);

  // 1. Valid ASIN
  assert.equal(parsed[0]?.type, "asin");
  assert.equal(parsed[0]?.value, "B0GQ33XWW7");
  assert.equal(parsed[0]?.extractedAsin, "B0GQ33XWW7");
  assert.equal(parsed[0]?.isValid, true);

  // 2. Valid URL
  assert.equal(parsed[1]?.type, "url");
  assert.equal(parsed[1]?.value, "https://www.amazon.com/dp/B08XY12345");
  assert.equal(parsed[1]?.extractedAsin, "B08XY12345");
  assert.equal(parsed[1]?.isValid, true);

  // 3. Duplicate ASIN
  assert.equal(parsed[2]?.type, "asin");
  assert.equal(parsed[2]?.value, "B0GQ33XWW7");
  assert.equal(parsed[2]?.extractedAsin, "B0GQ33XWW7");
  assert.equal(parsed[2]?.isValid, false);
  assert.ok(parsed[2]?.error?.includes("Trùng lặp"));

  // 4. Valid gp/product URL
  assert.equal(parsed[3]?.type, "url");
  assert.equal(parsed[3]?.value, "https://amazon.com/gp/product/B09PQ56789/ref=xyz");
  assert.equal(parsed[3]?.extractedAsin, "B09PQ56789");
  assert.equal(parsed[3]?.isValid, true);

  // 5. Valid mobile gp/aw/d URL
  assert.equal(parsed[4]?.type, "url");
  assert.equal(parsed[4]?.extractedAsin, "B07ZZ99881");
  assert.equal(parsed[4]?.isValid, true);

  // 6. Valid international amazon.co.jp URL with query param
  assert.equal(parsed[5]?.type, "url");
  assert.equal(parsed[5]?.extractedAsin, "B012345678");
  assert.equal(parsed[5]?.isValid, true);

  // 7. Valid a.co short URL
  assert.equal(parsed[6]?.type, "url");
  assert.equal(parsed[6]?.extractedAsin, "B087654321");
  assert.equal(parsed[6]?.isValid, true);

  // 8. Invalid string
  assert.equal(parsed[7]?.type, "invalid");
  assert.equal(parsed[7]?.isValid, false);
  assert.ok(parsed[7]?.error?.includes("Không đúng định dạng"));
});

test("validateCrawlerInput validates mandatory fields and crawl modes", () => {
  const validExact: ProductCrawlerJobInput = {
    source: "amazon",
    inputs: [{ type: "asin", value: "B0GQ33XWW7" }],
    crawlMode: "exact",
  };
  assert.equal(validateCrawlerInput(validExact).isValid, true);

  const validGroup: ProductCrawlerJobInput = {
    source: "amazon",
    inputs: [{ type: "asin", value: "B0GQ33XWW7" }],
    crawlMode: "group",
  };
  assert.equal(validateCrawlerInput(validGroup).isValid, true);

  // Invalid source
  const invalidSource = {
    ...validExact,
    source: "ebay" as unknown as "amazon",
  };
  const resSource = validateCrawlerInput(invalidSource);
  assert.equal(resSource.isValid, false);
  assert.ok(resSource.errors.some((e) => e.includes("amazon")));

  // Empty inputs
  const emptyInputs = {
    ...validExact,
    inputs: [],
  };
  const resEmpty = validateCrawlerInput(emptyInputs);
  assert.equal(resEmpty.isValid, false);

  // Invalid crawl mode
  const invalidMode = {
    ...validExact,
    crawlMode: "random" as unknown as "exact",
  };
  const resMode = validateCrawlerInput(invalidMode);
  assert.equal(resMode.isValid, false);
});

test("crawlerProductToListItem transforms product into UI list projection accurately", () => {
  // Product 1: Has customization, 0 warnings -> status: success
  const item1 = crawlerProductToListItem(mockProduct1Handbag);
  assert.equal(item1.id, mockProduct1Handbag.id);
  assert.equal(item1.title, mockProduct1Handbag.title);
  assert.equal(item1.asin, "B0GQ33XWW7");
  assert.equal(item1.variantCount, 8);
  assert.equal(item1.hasCustomization, true);
  assert.equal(item1.warningCount, 0);
  assert.equal(item1.status, "success");
  assert.ok(item1.thumbnailUrl);

  // Product 3: Has warning -> status: partial
  const item3 = crawlerProductToListItem(mockProduct3MugWarning);
  assert.equal(item3.hasCustomization, false);
  assert.equal(item3.warningCount, 1);
  assert.equal(item3.status, "partial");

  // Product 4: Standard, no customization -> status: success
  const item4 = crawlerProductToListItem(mockProduct4Backpack);
  assert.equal(item4.hasCustomization, false);
  assert.equal(item4.warningCount, 0);
  assert.equal(item4.status, "success");
});

test("crawlerProductToSeoInput maps CrawlerProduct to SeoContentInput conforming to contract", () => {
  const seoInput = crawlerProductToSeoInput(mockProduct1Handbag);

  assert.equal(seoInput.productId, mockProduct1Handbag.id);
  assert.equal(seoInput.title, mockProduct1Handbag.title);
  assert.equal(seoInput.description, mockProduct1Handbag.description);
  assert.equal(seoInput.sourceUrl, mockProduct1Handbag.canonicalUrl);

  // Only images are included (videos excluded)
  assert.equal(seoInput.images.length, mockProduct1Handbag.media.filter((m) => m.kind === "image").length);
  assert.ok(seoInput.images.every((url) => typeof url === "string" && url.length > 0));

  // Context contains bullet points, details, and customization
  assert.ok(Array.isArray(seoInput.sourceContext.bulletPoints));
  assert.equal(seoInput.sourceContext.bulletPoints?.length, mockProduct1Handbag.bulletPoints?.length);
  assert.equal(seoInput.sourceContext.productDetails?.ASIN, "B0GQ33XWW7");
  assert.ok(seoInput.sourceContext.customization !== null);
  assert.equal(seoInput.sourceContext.customization?.source, "amazon_custom_widget_v2");
});

test("MockProductCrawlerClient simulates complete crawl job lifecycle from queued to completed", async () => {
  const client = new MockProductCrawlerClient();

  const createRes = await client.startJob({
    source: "amazon",
    inputs: [{ type: "asin", value: "B0GQ33XWW7" }],
    crawlMode: "group",
  });

  assert.equal(createRes.ok, true);
  assert.equal(createRes.status, "queued");
  assert.ok(createRes.jobId.startsWith("crawl_job_"));

  // Poll 1: running (step 2)
  const poll1 = await client.getJob(createRes.jobId);
  assert.equal(poll1.status, "running");
  assert.equal(poll1.stepper?.currentStep, 2);
  assert.equal(poll1.stepper?.percent, 30);
  assert.ok(poll1.logs.length > 0);

  // Poll 2: running (step 3)
  const poll2 = await client.getJob(createRes.jobId);
  assert.equal(poll2.status, "running");
  assert.equal(poll2.stepper?.currentStep, 3);
  assert.equal(poll2.stepper?.percent, 60);

  // Poll 3: running (step 4)
  const poll3 = await client.getJob(createRes.jobId);
  assert.equal(poll3.status, "running");
  assert.equal(poll3.stepper?.currentStep, 4);
  assert.equal(poll3.stepper?.percent, 85);

  // Poll 4: finished (completed or partial)
  const poll4 = await client.getJob(createRes.jobId);
  assert.ok(poll4.status === "completed" || poll4.status === "partial");
  assert.equal(poll4.stepper?.currentStep, 5);
  assert.equal(poll4.stepper?.percent, 100);
  assert.ok(poll4.output);
  assert.equal(poll4.output?.jobId, createRes.jobId);
  assert.ok(poll4.output.products.length >= 3);
  assert.ok(poll4.output.statistics.finalVariants > 0);
});

test("MockProductCrawlerClient handles cancelJob correctly", async () => {
  const client = new MockProductCrawlerClient();

  const createRes = await client.startJob({
    source: "amazon",
    inputs: [{ type: "asin", value: "B08XY12345" }],
    crawlMode: "exact",
  });

  const cancelRes = await client.cancelJob(createRes.jobId);
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.status, "cancelled");

  const pollAfterCancel = await client.getJob(createRes.jobId);
  assert.equal(pollAfterCancel.status, "cancelled");
  assert.ok(pollAfterCancel.logs.some((l) => l.includes("cancellation") || l.includes("hủy")));
});

test("MockProductCrawlerClient throws AppError when given empty inputs or unknown jobId", async () => {
  const client = new MockProductCrawlerClient();

  await assert.rejects(
    async () => {
      await client.startJob({
        source: "amazon",
        inputs: [],
        crawlMode: "exact",
      });
    },
    (err: unknown) => {
      return err instanceof AppError && err.code === "PRODUCT_CRAWLER_INVALID_INPUT";
    },
  );

  await assert.rejects(
    async () => {
      await client.getJob("non_existent_job_id");
    },
    (err: unknown) => {
      return err instanceof AppError && err.code === "PRODUCT_CRAWLER_JOB_NOT_FOUND";
    },
  );
});

test("RealProductCrawlerClient handles network errors and HTTP failures with AppError", async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. Test HTTP 500 error on startJob
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Internal server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      });

    const client = new RealProductCrawlerClient("http://fake-backend.local");

    await assert.rejects(
      async () => {
        await client.startJob({
          source: "amazon",
          inputs: [{ type: "asin", value: "B0GQ33XWW7" }],
          crawlMode: "group",
        });
      },
      (err: unknown) => {
        return err instanceof AppError && err.code === "PRODUCT_CRAWLER_API_ERROR";
      },
    );

    // 2. Test Network rejection (e.g. DNS failure)
    globalThis.fetch = async () => {
      throw new Error("Failed to connect to backend daemon");
    };

    await assert.rejects(
      async () => {
        await client.getJob("some_job_123");
      },
      (err: unknown) => {
        return err instanceof AppError && err.code === "PRODUCT_CRAWLER_NETWORK_ERROR";
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getProductCrawlerClient selects appropriate runner based on environment", () => {
  const mockClient = getProductCrawlerClient("mock");
  assert.ok(mockClient instanceof MockProductCrawlerClient);

  const devClient = getProductCrawlerClient("development");
  assert.ok(devClient instanceof RealProductCrawlerClient);

  const prodClient = getProductCrawlerClient("production");
  assert.ok(prodClient instanceof RealProductCrawlerClient);
});

test("DEFAULT_CRAWLER_OPTIONS contains complete default options", () => {
  assert.equal(DEFAULT_CRAWLER_OPTIONS.amazonZip, "10001");
  assert.equal(DEFAULT_CRAWLER_OPTIONS.headless, false);
  assert.equal(DEFAULT_CRAWLER_OPTIONS.productThreads, 3);
  assert.equal(DEFAULT_CRAWLER_OPTIONS.variantThreads, 5);
  assert.equal(DEFAULT_CRAWLER_OPTIONS.maxMatrixVariants, 50);
});

test("MockProductCrawlerClient supports retryJob and generates new job id", async () => {
  const client = new MockProductCrawlerClient();
  const createRes = await client.startJob({
    source: "amazon",
    inputs: [{ type: "asin", value: "B0GQ33XWW7" }],
    crawlMode: "group",
  });

  const retryRes = await client.retryJob(createRes.jobId);
  assert.equal(retryRes.ok, true);
  assert.ok(retryRes.jobId.startsWith("crawl_job_retry_"));
  assert.equal(retryRes.status, "queued");

  // Non-existent job
  await assert.rejects(
    async () => {
      await client.retryJob("invalid_job_id");
    },
    (err: unknown) => {
      return err instanceof AppError && err.code === "PRODUCT_CRAWLER_JOB_NOT_FOUND";
    },
  );
});

test("RealProductCrawlerClient supports retryJob with API call", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, jobId: "retried_job_1", status: "queued" }), {
        status: 200,
      });

    const client = new RealProductCrawlerClient();
    const res = await client.retryJob("orig_123", ["B0GQ33XWW7"]);
    assert.equal(res.ok, true);
    assert.equal(res.jobId, "retried_job_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
