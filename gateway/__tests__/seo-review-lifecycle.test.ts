import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initSeoReviewDbSchema, getSeoReviewItem } from "../seo-review-db";
import {
  executeSeoReviewSaveLifecycle,
  SeoValidationError,
  validateGeneratedSeoFields,
  type SeoReviewProgressEvent,
} from "../seo-review-lifecycle";
import { handleAutoSeoRun, type AutoSeoProductPayload, type SeoContentRunner } from "../auto-seo-handler";
import { initAutoSeoDbSchema } from "../auto-seo-db";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initAutoSeoDbSchema(db);
  initSeoReviewDbSchema(db);
  return db;
}

function makeValidSeoOutput() {
  return {
    productTitle: "Premium Organic Cotton T-Shirt",
    productDescription: "High-grade organic cotton t-shirt with modern regular fit.",
    productSeoTitle: "Buy Premium Organic Cotton T-Shirt | Brand Store",
    productSeoDescription: "Shop our premium organic cotton t-shirt. Breathable, durable, and ethically sourced.",
    productHandle: "premium-organic-cotton-t-shirt",
  };
}

test("1. executes exact 6-step lifecycle in sequence when output is valid", async () => {
  const db = createTestDb();
  const stepTracker: string[] = [];
  const persistCalls: unknown[] = [];
  const queueCompletedCalls: string[] = [];
  const progressEvents: SeoReviewProgressEvent[] = [];

  const validOutput = makeValidSeoOutput();

  const result = await executeSeoReviewSaveLifecycle(
    {
      storeId: "store-test-1",
      productId: "gid://shopify/Product/123",
      handle: "original-handle",
      title: "Original Product Title",
      shopifyUpdatedAt: "2026-09-28T09:30:00Z",
      generatedOutput: validOutput,
    },
    {
      db,
      itemId: "custom-item-123",
      onPersistSeoOutput: async (out) => {
        stepTracker.push("step3_persist_output");
        persistCalls.push(out);
      },
      onMarkQueueCompleted: async (queueItemId) => {
        stepTracker.push("step5_queue_completed");
        queueCompletedCalls.push(queueItemId);
      },
      onEmitProgressEvent: async (evt) => {
        stepTracker.push("step6_progress_event");
        progressEvents.push(evt);
      },
    },
  );

  // Assert exact steps logged
  assert.deepEqual(result.stepLog, [
    "generate",
    "validate",
    "persist_seo_output",
    "persist_review_item_sqlite",
    "mark_completed_in_queue",
    "emit_progress_event",
  ]);

  // Assert callbacks called in correct order
  assert.deepEqual(stepTracker, [
    "step3_persist_output",
    "step5_queue_completed",
    "step6_progress_event",
  ]);

  // Assert persistence of review item in SQLite
  const savedItem = getSeoReviewItem(db, "custom-item-123");
  assert.ok(savedItem);
  assert.equal(savedItem.itemId, "custom-item-123");
  assert.equal(savedItem.storeId, "store-test-1");
  assert.equal(savedItem.productId, "gid://shopify/Product/123");
  assert.equal(savedItem.handle, "premium-organic-cotton-t-shirt");
  assert.equal(savedItem.title, "Premium Organic Cotton T-Shirt");
  assert.equal(savedItem.reviewStatus, "pending");
  assert.equal(savedItem.shopifyUpdatedAt, "2026-09-28T09:30:00Z");

  // Assert queue and progress events
  assert.deepEqual(queueCompletedCalls, ["custom-item-123"]);
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0]?.stage, "completed");
  assert.equal(progressEvents[0]?.itemId, "custom-item-123");
  assert.equal(progressEvents[0]?.storeId, "store-test-1");
});

test("2. executes generator function in Step 1 if provided", async () => {
  const db = createTestDb();
  let generatorCalled = false;

  const result = await executeSeoReviewSaveLifecycle(
    {
      storeId: "store-gen",
      productId: "prod-gen-1",
      generate: async () => {
        generatorCalled = true;
        return makeValidSeoOutput();
      },
    },
    { db },
  );

  assert.equal(generatorCalled, true);
  assert.equal(result.success, true);
  assert.equal(result.validatedFields.handle, "premium-organic-cotton-t-shirt");
});

test("3. validation failure halts execution and stops persistence, queue, and progress events", async () => {
  const db = createTestDb();
  let persistCalled = false;
  let queueCalled = false;
  let progressCalled = false;

  const invalidOutput = {
    productTitle: "Only Title Provided",
    // description, seoTitle, seoDescription, handle are missing!
  };

  await assert.rejects(
    async () => {
      await executeSeoReviewSaveLifecycle(
        {
          storeId: "store-fail",
          productId: "prod-fail-1",
          generatedOutput: invalidOutput,
        },
        {
          db,
          onPersistSeoOutput: () => {
            persistCalled = true;
          },
          onMarkQueueCompleted: () => {
            queueCalled = true;
          },
          onEmitProgressEvent: () => {
            progressCalled = true;
          },
        },
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof SeoValidationError);
      assert.equal(err.code, "SEO_VALIDATION_ERROR");
      assert.ok(err.validationErrors.length > 0);
      return true;
    },
  );

  // Assert none of the downstream steps were called
  assert.equal(persistCalled, false);
  assert.equal(queueCalled, false);
  assert.equal(progressCalled, false);

  // Assert nothing written to SQLite
  const item = getSeoReviewItem(db, "store-fail:prod-fail-1");
  assert.equal(item, null);
});

test("4. validates all individual required fields and reports clear errors", () => {
  // Missing title
  assert.throws(
    () => validateGeneratedSeoFields({ ...makeValidSeoOutput(), productTitle: "" }),
    (err: unknown) => err instanceof SeoValidationError && /product title/.test(err.message),
  );

  // Missing description
  assert.throws(
    () => validateGeneratedSeoFields({ ...makeValidSeoOutput(), productDescription: "   " }),
    (err: unknown) => err instanceof SeoValidationError && /product description/.test(err.message),
  );

  // Missing seoTitle
  assert.throws(
    () => validateGeneratedSeoFields({ ...makeValidSeoOutput(), productSeoTitle: "" }),
    (err: unknown) => err instanceof SeoValidationError && /SEO title/.test(err.message),
  );

  // Missing seoDescription
  assert.throws(
    () => validateGeneratedSeoFields({ ...makeValidSeoOutput(), productSeoDescription: "" }),
    (err: unknown) => err instanceof SeoValidationError && /SEO description/.test(err.message),
  );

  // Missing handle (without fallback)
  assert.throws(
    () => validateGeneratedSeoFields({ ...makeValidSeoOutput(), productHandle: "" }),
    (err: unknown) => err instanceof SeoValidationError && /handle/.test(err.message),
  );

  // Non-object output
  assert.throws(
    () => validateGeneratedSeoFields(null),
    (err: unknown) => err instanceof SeoValidationError,
  );
  assert.throws(
    () => validateGeneratedSeoFields("just a string"),
    (err: unknown) => err instanceof SeoValidationError,
  );
});

test("5. database failure in Step 4 halts before queue completion and progress event", async () => {
  const db = createTestDb();
  let persistCalled = false;
  let queueCompletedCalled = false;
  let progressEventCalled = false;

  // Create trigger to abort SQLite write
  db.exec(`
    CREATE TRIGGER fail_seo_review_write BEFORE INSERT ON seo_review_items
    BEGIN
      SELECT RAISE(ABORT, 'Simulated SQLite write failure');
    END;
  `);

  await assert.rejects(
    async () => {
      await executeSeoReviewSaveLifecycle(
        {
          storeId: "store-db-fail",
          productId: "prod-db-fail-1",
          generatedOutput: makeValidSeoOutput(),
        },
        {
          db,
          onPersistSeoOutput: () => {
            persistCalled = true;
          },
          onMarkQueueCompleted: () => {
            queueCompletedCalled = true;
          },
          onEmitProgressEvent: () => {
            progressEventCalled = true;
          },
        },
      );
    },
    /Simulated SQLite write failure/,
  );

  // Step 3 (Persist Output) ran before failure
  assert.equal(persistCalled, true);
  // Step 5 & 6 NEVER ran
  assert.equal(queueCompletedCalled, false);
  assert.equal(progressEventCalled, false);
});

test("6. handleAutoSeoRun persists review items into SQLite when seoOutputs are received", async () => {
  const db = createTestDb();

  const mockProduct: AutoSeoProductPayload = {
    id: "gid://shopify/Product/999",
    title: "Original Denim Jeans",
    handle: "original-denim-jeans",
    updatedAt: "2026-09-28T11:00:00Z",
  };

  const validOutput = makeValidSeoOutput();

  const mockRunner: SeoContentRunner = async () => {
    return {
      success: true,
      processedCount: 1,
      message: "Generated SEO content",
      seoOutputs: [validOutput],
    };
  };

  const runResult = await handleAutoSeoRun(
    {
      workflowId: "wf-lifecycle-integration",
      storeId: "store-jeans",
      shopDomain: "jeans.myshopify.com",
      products: [mockProduct],
    },
    {
      db,
      seoContentRunner: mockRunner,
    },
  );

  assert.equal(runResult.downstreamStatus, "SENT");
  assert.equal(runResult.reviewPersistedCount, 1);

  // Verify review item was persisted into SQLite seo_review_items
  const reviewItem = getSeoReviewItem(db, "store-jeans:gid://shopify/Product/999");
  assert.ok(reviewItem);
  assert.equal(reviewItem.storeId, "store-jeans");
  assert.equal(reviewItem.productId, "gid://shopify/Product/999");
  assert.equal(reviewItem.title, validOutput.productTitle);
  assert.equal(reviewItem.handle, validOutput.productHandle);
  assert.equal(reviewItem.shopifyUpdatedAt, "2026-09-28T11:00:00Z");
  assert.equal(reviewItem.reviewStatus, "pending");
});

test("7. handleAutoSeoRun flags failure when generated seoOutput fails validation", async () => {
  const db = createTestDb();

  const mockProduct: AutoSeoProductPayload = {
    id: "gid://shopify/Product/bad-output",
    title: "Bad Product",
    handle: "bad-product",
  };

  const invalidOutput = {
    productTitle: "", // Empty title -> validation failure
    productDescription: "Some desc",
  };

  const mockRunner: SeoContentRunner = async () => {
    return {
      success: true,
      processedCount: 1,
      seoOutputs: [invalidOutput],
    };
  };

  const runResult = await handleAutoSeoRun(
    {
      workflowId: "wf-invalid-output",
      storeId: "store-bad",
      shopDomain: "bad.myshopify.com",
      products: [mockProduct],
    },
    {
      db,
      seoContentRunner: mockRunner,
    },
  );

  // Validation failure halted downstream and marked as FAILED
  assert.equal(runResult.downstreamStatus, "FAILED");
  assert.equal(runResult.reviewPersistedCount, 0);
  assert.match(runResult.downstreamError ?? "", /SEO validation failed/);

  // No review item stored
  const item = getSeoReviewItem(db, "store-bad:gid://shopify/Product/bad-output");
  assert.equal(item, null);
});
