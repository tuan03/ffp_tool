import assert from "node:assert/strict";
import type http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import test from "node:test";

import { initSeoReviewDbSchema, upsertSeoReviewItem, type SeoReviewItemRecord } from "../seo-review-db";
import { handleSeoReviewHttpRequest } from "../seo-review-handler";

function createMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSeoReviewDbSchema(db);
  return db;
}

function makeSampleItem(overrides?: Partial<SeoReviewItemRecord>): SeoReviewItemRecord {
  return {
    itemId: "store-1:prod-1",
    storeId: "store-1",
    productId: "prod-1",
    handle: "test-product-1",
    title: "Test Product 1",
    reviewStatus: "pending",
    generatedPayload: JSON.stringify({
      productTitle: "SEO Title 1",
      productDescription: "SEO Desc 1",
      productSeoTitle: "Meta Title 1",
      productSeoDescription: "Meta Desc 1",
      productHandle: "test-product-1",
    }),
    shopifyUpdatedAt: "2026-09-28T10:00:00.000Z",
    ...overrides,
  };
}

function createMockReqRes(options: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  getResult: () => { status: number; body: Record<string, unknown> };
} {
  const bodyString =
    options.body === undefined
      ? ""
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  const req = Readable.from(
    bodyString ? [Buffer.from(bodyString)] : [],
  ) as unknown as http.IncomingMessage;
  req.method = options.method;
  req.url = options.url || "/api/seo-review/items";
  req.headers = options.headers || { "content-type": "application/json" };

  let statusCode = 200;
  let responseData = "";
  const headersObj: Record<string, string> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(key: string, val: string) {
      headersObj[key.toLowerCase()] = val;
    },
    end(chunk?: unknown) {
      if (chunk) {
        responseData += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
      }
    },
    destroy() {},
  } as unknown as http.ServerResponse;

  return {
    req,
    res,
    getResult: () => {
      let parsedBody: Record<string, unknown> = {};
      try {
        parsedBody = JSON.parse(responseData);
      } catch {
        parsedBody = { raw: responseData };
      }
      return { status: statusCode, body: parsedBody };
    },
  };
}

test("1. GET /api/seo-review/items returns items list and total count", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "i-1", productId: "p-1" }));
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "i-2", productId: "p-2" }));

  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items",
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.total, 2);
  assert.ok(Array.isArray(result.body.items));
  assert.equal((result.body.items as unknown[]).length, 2);
});

test("2. GET /api/seo-review/items filters by storeId, status, and supports pagination", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(
    db,
    makeSampleItem({ itemId: "i-1", storeId: "store-A", productId: "p-1", reviewStatus: "pending" }),
  );
  upsertSeoReviewItem(
    db,
    makeSampleItem({ itemId: "i-2", storeId: "store-A", productId: "p-2", reviewStatus: "approved" }),
  );
  upsertSeoReviewItem(
    db,
    makeSampleItem({ itemId: "i-3", storeId: "store-B", productId: "p-3", reviewStatus: "pending" }),
  );

  // Filter by storeId=store-A and status=approved
  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items?storeId=store-A&status=approved&limit=10&offset=0",
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.total, 1);
  const items = result.body.items as SeoReviewItemRecord[];
  assert.equal(items.length, 1);
  assert.equal(items[0]?.itemId, "i-2");
  assert.equal(items[0]?.reviewStatus, "approved");
});

test("3. GET /api/seo-review/items/:itemId returns item when found", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "store-1:prod-100", title: "Target Product" }));

  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items/store-1%3Aprod-100",
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  const item = result.body.item as SeoReviewItemRecord;
  assert.equal(item.itemId, "store-1:prod-100");
  assert.equal(item.title, "Target Product");
});

test("4. GET /api/seo-review/items/:itemId returns 404 when item is not found", async () => {
  const db = createMemoryDb();

  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items/non-existent-id",
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 404);
  assert.equal(result.body.success, false);
  const error = result.body.error as { code: string; message: string };
  assert.equal(error.code, "SEO_REVIEW_ITEM_NOT_FOUND");
});

test("5. POST /api/seo-review/items/:itemId/status updates review status to approved with notes", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "store-1:prod-status", reviewStatus: "pending" }));

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/seo-review/items/store-1%3Aprod-status/status",
    body: { status: "approved", notes: "Approved by reviewer" },
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.itemId, "store-1:prod-status");
  assert.equal(result.body.status, "approved");

  // Verify in DB directly
  const { req: getReq, res: getRes, getResult: getItemResult } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items/store-1%3Aprod-status",
  });
  await handleSeoReviewHttpRequest(getReq, getRes, { db });
  const itemRes = getItemResult();
  const item = itemRes.body.item as SeoReviewItemRecord;
  assert.equal(item.reviewStatus, "approved");
  assert.equal(item.notes, "Approved by reviewer");
});

test("6. POST /api/seo-review/items/:itemId/status rejects invalid status with 400", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "store-1:prod-inv" }));

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/seo-review/items/store-1%3Aprod-inv/status",
    body: { status: "not_a_valid_status" },
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  const error = result.body.error as { code: string; message: string };
  assert.equal(error.code, "SEO_REVIEW_INVALID_INPUT");
});

test("7. POST /api/seo-review/items/:itemId/status returns 404 for unknown itemId", async () => {
  const db = createMemoryDb();

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/seo-review/items/unknown-item/status",
    body: { status: "approved" },
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 404);
  assert.equal(result.body.success, false);
  const error = result.body.error as { code: string; message: string };
  assert.equal(error.code, "SEO_REVIEW_ITEM_NOT_FOUND");
});

test("8. POST /api/seo-review/items/:itemId/update updates generated payload and title/handle", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(
    db,
    makeSampleItem({ itemId: "store-1:prod-update", title: "Old Title", handle: "old-handle" }),
  );

  const updatedPayload = {
    productTitle: "Manually Revised Title",
    productHandle: "manually-revised-handle",
    productDescription: "Revised description text",
    productSeoTitle: "Revised Meta Title",
    productSeoDescription: "Revised Meta Description",
  };

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/seo-review/items/store-1%3Aprod-update/update",
    body: { payload: updatedPayload },
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.itemId, "store-1:prod-update");

  // Verify in DB directly
  const { req: getReq, res: getRes, getResult: getItemResult } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items/store-1%3Aprod-update",
  });
  await handleSeoReviewHttpRequest(getReq, getRes, { db });
  const itemRes = getItemResult();
  const item = itemRes.body.item as SeoReviewItemRecord;
  assert.equal(item.title, "Manually Revised Title");
  assert.equal(item.handle, "manually-revised-handle");
});

test("9. POST /api/seo-review/items/:itemId/update returns 400 for empty payload", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "store-1:prod-empty" }));

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/seo-review/items/store-1%3Aprod-empty/update",
    body: {},
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  const error = result.body.error as { code: string; message: string };
  assert.equal(error.code, "SEO_REVIEW_INVALID_INPUT");
});

test("10. POST /api/seo-review/items/:itemId/update returns 404 for unknown itemId", async () => {
  const db = createMemoryDb();

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/seo-review/items/missing-item/update",
    body: { payload: { productTitle: "New Title" } },
  });

  await handleSeoReviewHttpRequest(req, res, { db });
  const result = getResult();

  assert.equal(result.status, 404);
  assert.equal(result.body.success, false);
  const error = result.body.error as { code: string; message: string };
  assert.equal(error.code, "SEO_REVIEW_ITEM_NOT_FOUND");
});

test("11. returns 401 when authToken is required and missing or invalid", async () => {
  const db = createMemoryDb();

  // Missing token
  const { req: reqNoAuth, res: resNoAuth, getResult: getResultNoAuth } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items",
  });
  await handleSeoReviewHttpRequest(reqNoAuth, resNoAuth, { db, authToken: "secret-token" });
  const res1 = getResultNoAuth();
  assert.equal(res1.status, 401);
  assert.equal((res1.body.error as { code: string }).code, "SEO_REVIEW_AUTH_FAILED");

  // Invalid token
  const { req: reqBadAuth, res: resBadAuth, getResult: getResultBadAuth } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items",
    headers: { "x-gateway-key": "wrong-token" },
  });
  await handleSeoReviewHttpRequest(reqBadAuth, resBadAuth, { db, authToken: "secret-token" });
  const res2 = getResultBadAuth();
  assert.equal(res2.status, 401);

  // Valid token
  const { req: reqGoodAuth, res: resGoodAuth, getResult: getResultGoodAuth } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items",
    headers: { "x-gateway-key": "secret-token" },
  });
  await handleSeoReviewHttpRequest(reqGoodAuth, resGoodAuth, { db, authToken: "secret-token" });
  const res3 = getResultGoodAuth();
  assert.equal(res3.status, 200);
});

test("12. returns 405 for unsupported HTTP methods on routes", async () => {
  const db = createMemoryDb();

  // POST /api/seo-review/items is not allowed
  const { req: req1, res: res1, getResult: getRes1 } = createMockReqRes({
    method: "POST",
    url: "/api/seo-review/items",
  });
  await handleSeoReviewHttpRequest(req1, res1, { db });
  assert.equal(getRes1().status, 405);

  // GET /api/seo-review/items/:id/status is not allowed
  const { req: req2, res: res2, getResult: getRes2 } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items/item-1/status",
  });
  await handleSeoReviewHttpRequest(req2, res2, { db });
  assert.equal(getRes2().status, 405);

  // GET /api/seo-review/items/:id/update is not allowed
  const { req: req3, res: res3, getResult: getRes3 } = createMockReqRes({
    method: "GET",
    url: "/api/seo-review/items/item-1/update",
  });
  await handleSeoReviewHttpRequest(req3, res3, { db });
  assert.equal(getRes3().status, 405);
});

test("13. DELETE /api/seo-review/items/:itemId removes only the review item", async () => {
  const db = createMemoryDb();
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "store-1:delete-me", productId: "delete-me" }));
  upsertSeoReviewItem(db, makeSampleItem({ itemId: "store-1:keep-me", productId: "keep-me" }));

  const { req, res, getResult } = createMockReqRes({
    method: "DELETE",
    url: "/api/seo-review/items/store-1%3Adelete-me",
  });
  await handleSeoReviewHttpRequest(req, res, { db });

  assert.deepEqual(getResult(), {
    status: 200,
    body: { success: true, itemId: "store-1:delete-me" },
  });

  const remaining = db.prepare("SELECT item_id, deleted_at FROM seo_review_items ORDER BY item_id").all() as Array<{
    item_id: string;
    deleted_at: string | null;
  }>;
  assert.equal(remaining.length, 2);
  assert.ok(remaining.find((item) => item.item_id === "store-1:delete-me")?.deleted_at);
  assert.equal(remaining.find((item) => item.item_id === "store-1:keep-me")?.deleted_at, null);
});

test("14. DELETE /api/seo-review/items/:itemId returns 404 when the item is absent", async () => {
  const db = createMemoryDb();
  const { req, res, getResult } = createMockReqRes({
    method: "DELETE",
    url: "/api/seo-review/items/missing-item",
  });

  await handleSeoReviewHttpRequest(req, res, { db });

  assert.equal(getResult().status, 404);
  assert.equal((getResult().body.error as { code: string }).code, "SEO_REVIEW_ITEM_NOT_FOUND");
});
