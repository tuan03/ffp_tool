import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors/app-error";
import type { ModuleApiRunner } from "../../module-api";
import {
  applyApprovedProductUpdates,
  type ApplyApprovedProductUpdatesInput,
} from "../auto-seo-approved-product-update";

function createMockRunner(handler?: (input: any) => Promise<any>) {
  const calls: any[] = [];
  const runner: ModuleApiRunner = (async (input: any) => {
    calls.push(input);
    if (handler) {
      return handler(input);
    }
    if (input.operation === "products.update") {
      return {
        success: true,
        storeId: input.storeId,
        operation: "products.update",
        data: {
          product: {
            id: input.payload.id,
            title: "Updated Title",
            handle: "updated-title",
            status: "ACTIVE",
            tags: [],
            variants: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
          },
        },
      };
    }
    if (input.operation === "products.bulkUpdate") {
      const prods = input.payload.products as Array<{ id: string }>;
      return {
        success: true,
        storeId: input.storeId,
        operation: "products.bulkUpdate",
        data: {
          updatedProductIds: prods.map((p) => p.id),
          count: prods.length,
          successCount: prods.length,
          failedCount: 0,
          items: prods.map((p) => ({ id: p.id, ok: true })),
        },
      };
    }
    throw new Error(`Unexpected operation in mock runner: ${input.operation}`);
  }) as unknown as ModuleApiRunner;

  return { runner, calls };
}

test("1. one product -> calls products.update exactly once", async () => {
  const { runner, calls } = createMockRunner();

  const input: ApplyApprovedProductUpdatesInput = {
    workflowId: "wf-1",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/1",
        patch: { title: "New Title" },
      },
    ],
  };

  const res = await applyApprovedProductUpdates(runner, input);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "products.update");
  assert.equal(res.requestedCount, 1);
  assert.equal(res.successCount, 1);
  assert.equal(res.failedCount, 0);
});

test("2. two or more products -> calls products.bulkUpdate exactly once", async () => {
  const { runner, calls } = createMockRunner();

  const input: ApplyApprovedProductUpdatesInput = {
    workflowId: "wf-bulk",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/1",
        patch: { title: "New Title 1" },
      },
      {
        productId: "gid://shopify/Product/2",
        patch: { title: "New Title 2" },
      },
    ],
  };

  const res = await applyApprovedProductUpdates(runner, input);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "products.bulkUpdate");
  assert.equal(res.requestedCount, 2);
  assert.equal(res.successCount, 2);
  assert.equal(res.failedCount, 0);
});

test("3. single path uses: mode = 'apply'", async () => {
  const { runner, calls } = createMockRunner();

  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-mode-single",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/1",
        patch: { title: "New Title" },
      },
    ],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "apply");
});

test("4. bulk path uses: mode = 'apply'", async () => {
  const { runner, calls } = createMockRunner();

  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-mode-bulk",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/1",
        patch: { title: "Title 1" },
      },
      {
        productId: "gid://shopify/Product/2",
        patch: { title: "Title 2" },
      },
    ],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "apply");
});

test("5. exact productId forwarded", async () => {
  const { runner, calls } = createMockRunner();

  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-id",
    storeId: "store-xyz",
    products: [
      {
        productId: "gid://shopify/Product/999888",
        patch: { title: "Exact Forward" },
      },
    ],
  });

  assert.equal(calls[0].payload.id, "gid://shopify/Product/999888");
});

test("6. exact patch forwarded", async () => {
  const { runner, calls } = createMockRunner();

  const patch = {
    title: "Updated Brand T-Shirt",
    vendor: "CHILLGEN",
    tags: ["fashion", "cotton"],
    seo: { title: "SEO Title" },
  };

  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-patch",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/123",
        patch,
      },
    ],
  });

  assert.deepEqual(calls[0].payload.product, {
    title: "Updated Brand T-Shirt",
    vendor: "CHILLGEN",
    tags: ["fashion", "cotton"],
    seo: { title: "SEO Title" },
  });
});

test("7. omitted fields remain omitted", async () => {
  const { runner, calls } = createMockRunner();

  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-omitted",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/1",
        patch: {
          seo: {
            title: "New title",
          },
        },
      },
    ],
  });

  const payloadProduct = calls[0].payload.product;

  assert.equal(payloadProduct.seo?.title, "New title");
  assert.equal("title" in payloadProduct, false);
  assert.equal("handle" in payloadProduct, false);
  assert.equal("descriptionHtml" in payloadProduct, false);
  assert.equal("description" in payloadProduct, false);
  assert.equal("tags" in payloadProduct, false);
  assert.equal("images" in payloadProduct, false);
  assert.equal("featuredImage" in payloadProduct, false);
  assert.equal("variants" in payloadProduct, false);
  assert.equal("description" in payloadProduct.seo, false);
});

test("8. explicit empty values remain explicit", async () => {
  const { runner, calls } = createMockRunner();

  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-explicit-empty",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/1",
        patch: {
          tags: [],
          seo: {
            description: "",
          },
        },
      },
    ],
  });

  const payloadProduct = calls[0].payload.product;
  assert.deepEqual(payloadProduct.tags, []);
  assert.equal(payloadProduct.seo?.description, "");
});

test("9. empty product list -> rejected before ModuleApiRunner call", async () => {
  const { runner, calls } = createMockRunner();

  await assert.rejects(
    async () => {
      await applyApprovedProductUpdates(runner, {
        workflowId: "wf-empty",
        storeId: "store-1",
        products: [],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_APPROVED_UPDATE_EMPTY");
      return true;
    },
  );

  assert.equal(calls.length, 0);
});

test("10. duplicate productId -> rejected before ModuleApiRunner call", async () => {
  const { runner, calls } = createMockRunner();

  await assert.rejects(
    async () => {
      await applyApprovedProductUpdates(runner, {
        workflowId: "wf-dupe",
        storeId: "store-1",
        products: [
          { productId: "gid://shopify/Product/1", patch: { title: "Title 1" } },
          { productId: "gid://shopify/Product/1", patch: { title: "Title 2" } },
        ],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_APPROVED_UPDATE_DUPLICATE_PRODUCT");
      return true;
    },
  );

  assert.equal(calls.length, 0);
});

test("11. empty patch -> rejected before ModuleApiRunner call", async () => {
  const { runner, calls } = createMockRunner();

  // Test with {}
  await assert.rejects(
    async () => {
      await applyApprovedProductUpdates(runner, {
        workflowId: "wf-empty-patch-1",
        storeId: "store-1",
        products: [
          { productId: "gid://shopify/Product/1", patch: {} },
        ],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_APPROVED_UPDATE_EMPTY_PATCH");
      return true;
    },
  );

  // Test with { seo: {} }
  await assert.rejects(
    async () => {
      await applyApprovedProductUpdates(runner, {
        workflowId: "wf-empty-patch-2",
        storeId: "store-1",
        products: [
          { productId: "gid://shopify/Product/1", patch: { seo: {} } },
        ],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_APPROVED_UPDATE_EMPTY_PATCH");
      return true;
    },
  );

  assert.equal(calls.length, 0);
});

test("12. single result normalized correctly", async () => {
  const { runner } = createMockRunner();

  const res = await applyApprovedProductUpdates(runner, {
    workflowId: "wf-norm-single",
    storeId: "store-1",
    products: [
      {
        productId: "gid://shopify/Product/100",
        patch: { title: "Updated Title" },
      },
    ],
  });

  assert.deepEqual(res, {
    workflowId: "wf-norm-single",
    requestedCount: 1,
    successCount: 1,
    failedCount: 0,
    items: [
      {
        productId: "gid://shopify/Product/100",
        ok: true,
      },
    ],
  });
});

test("13. bulk result normalized correctly", async () => {
  const { runner } = createMockRunner();

  const res = await applyApprovedProductUpdates(runner, {
    workflowId: "wf-norm-bulk",
    storeId: "store-1",
    products: [
      { productId: "gid://shopify/Product/1", patch: { title: "Title 1" } },
      { productId: "gid://shopify/Product/2", patch: { title: "Title 2" } },
    ],
  });

  assert.deepEqual(res, {
    workflowId: "wf-norm-bulk",
    requestedCount: 2,
    successCount: 2,
    failedCount: 0,
    items: [
      { productId: "gid://shopify/Product/1", ok: true },
      { productId: "gid://shopify/Product/2", ok: true },
    ],
  });
});

test("14. partial bulk failure: successCount / failedCount correct", async () => {
  const { runner } = createMockRunner(async () => {
    return {
      success: true,
      storeId: "store-1",
      operation: "products.bulkUpdate",
      data: {
        updatedProductIds: ["gid://shopify/Product/1", "gid://shopify/Product/3"],
        count: 3,
        successCount: 2,
        failedCount: 1,
        items: [
          { id: "gid://shopify/Product/1", ok: true },
          {
            id: "gid://shopify/Product/2",
            ok: false,
            error: "Handle already taken",
            errorCode: "SHOPIFY_USER_ERROR",
          },
          { id: "gid://shopify/Product/3", ok: true },
        ],
      },
    };
  });

  const res = await applyApprovedProductUpdates(runner, {
    workflowId: "wf-partial",
    storeId: "store-1",
    products: [
      { productId: "gid://shopify/Product/1", patch: { title: "Title 1" } },
      { productId: "gid://shopify/Product/2", patch: { handle: "bad-handle" } },
      { productId: "gid://shopify/Product/3", patch: { title: "Title 3" } },
    ],
  });

  assert.equal(res.requestedCount, 3);
  assert.equal(res.successCount, 2);
  assert.equal(res.failedCount, 1);
  assert.equal(res.items.length, 3);

  assert.equal(res.items[0].productId, "gid://shopify/Product/1");
  assert.equal(res.items[0].ok, true);

  assert.equal(res.items[1].productId, "gid://shopify/Product/2");
  assert.equal(res.items[1].ok, false);
  assert.equal(res.items[1].error, "Handle already taken");
  assert.equal(res.items[1].errorCode, "SHOPIFY_USER_ERROR");

  assert.equal(res.items[2].productId, "gid://shopify/Product/3");
  assert.equal(res.items[2].ok, true);
});

test("15. reconciliationRequired from existing API is preserved", async () => {
  const { runner } = createMockRunner(async () => {
    return {
      success: true,
      storeId: "store-1",
      operation: "products.bulkUpdate",
      data: {
        updatedProductIds: ["gid://shopify/Product/1"],
        count: 2,
        successCount: 1,
        failedCount: 1,
        reconciliationRequired: true,
        items: [
          { id: "gid://shopify/Product/1", ok: true },
          {
            id: "gid://shopify/Product/fail-timeout",
            ok: false,
            error: "Write timeout",
            errorCode: "SHOPIFY_UNKNOWN_WRITE_STATE",
            reconciliationRequired: true,
          },
        ],
      },
    };
  });

  const res = await applyApprovedProductUpdates(runner, {
    workflowId: "wf-reconciliation",
    storeId: "store-1",
    products: [
      { productId: "gid://shopify/Product/1", patch: { title: "Title 1" } },
      { productId: "gid://shopify/Product/fail-timeout", patch: { title: "Timeout" } },
    ],
  });

  assert.equal(res.items[1].reconciliationRequired, true);
  assert.equal(res.items[1].errorCode, "SHOPIFY_UNKNOWN_WRITE_STATE");
});

test("16. verify no direct fetch('/api/shopify') or Shopify HTTP transport was added", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("Direct fetch should not be called by applyApprovedProductUpdates");
  }) as typeof fetch;

  try {
    const { runner } = createMockRunner();

    await applyApprovedProductUpdates(runner, {
      workflowId: "wf-no-fetch",
      storeId: "store-1",
      products: [
        { productId: "gid://shopify/Product/1", patch: { title: "No Fetch" } },
      ],
    });

    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("17. deterministic requestId derived from workflowId and productId", async () => {
  const { runner, calls } = createMockRunner();

  // Single product requestId
  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-retry-123",
    storeId: "store-1",
    products: [
      { productId: "gid://shopify/Product/456", patch: { title: "T1" } },
    ],
  });

  assert.equal(calls[0].requestId, "auto-seo-approved:wf-retry-123:gid://shopify/Product/456");

  // Bulk products requestId
  await applyApprovedProductUpdates(runner, {
    workflowId: "wf-retry-123",
    storeId: "store-1",
    products: [
      { productId: "gid://shopify/Product/1", patch: { title: "T1" } },
      { productId: "gid://shopify/Product/2", patch: { title: "T2" } },
    ],
  });

  assert.equal(calls[1].requestId, "auto-seo-approved:wf-retry-123:bulk");
});

test("18. missing workflowId or storeId rejected before runner call", async () => {
  const { runner, calls } = createMockRunner();

  await assert.rejects(
    async () => {
      await applyApprovedProductUpdates(runner, {
        workflowId: "",
        storeId: "store-1",
        products: [{ productId: "p1", patch: { title: "T" } }],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_APPROVED_UPDATE_INVALID_INPUT");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await applyApprovedProductUpdates(runner, {
        workflowId: "wf-1",
        storeId: "",
        products: [{ productId: "p1", patch: { title: "T" } }],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_APPROVED_UPDATE_INVALID_INPUT");
      return true;
    },
  );

  assert.equal(calls.length, 0);
});
