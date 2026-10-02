import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanOrphanAssets,
  cloneCustomization,
  createCustomization,
  DEFAULT_CONFIG,
  deleteCustomization,
  readCustomization,
  updateCustomization,
} from "../service";
import type { ProductCustomization } from "../../customization-normalizer";
import {
  createCustomizationGatewayAdapter,
  createModuleApiRunner,
  DEFAULT_GATEWAY_URL,
} from "../../module-api";

const TEST_CUSTOMIZATION: ProductCustomization = {
  hasCustomization: true,
  product: {
    id: "gid://shopify/Product/1001",
    title: "Personalized Canvas Tote",
  },
  surfaces: [
    {
      name: "Front View",
      surfaceId: "surf_front",
      previewUrl: "https://cdn.shopify.com/s/files/tote-front.png",
      placements: [{ name: "Text Box", placementId: "pl_text_1", allowedTypes: ["text"] }],
    },
  ],
  optionGroups: [
    {
      id: "group_color",
      label: "Bag Color",
      options: [
        { id: "c_black", label: "Midnight Black", isAvailable: true },
        { id: "c_natural", label: "Natural Canvas", isAvailable: true },
      ],
    },
  ],
  textInputs: [
    {
      id: "inp_monogram",
      label: "Your Initials",
      maxLength: 3,
    },
  ],
};

function createMockNginxGatewayFetch() {
  const recordedRequests: { url: string; body: any }[] = [];
  const metafieldsStore = new Map<string, string>();
  const shopifyFiles = [
    {
      id: "gid://shopify/File/f1",
      url: "https://cdn.shopify.com/f1.png",
      altText: "product:gid://shopify/Product/1001",
      tags: ["product:gid://shopify/Product/1001"],
    },
    {
      id: "gid://shopify/File/f2_orphan",
      url: "https://cdn.shopify.com/f2.png",
      altText: "product:gid://shopify/Product/deleted-999",
      tags: ["product:gid://shopify/Product/deleted-999"],
    },
  ];

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const bodyText = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(bodyText);
    recordedRequests.push({ url, body });

    const op = body.operation;
    const payload = body.payload ?? {};

    if (op === "metafields.get") {
      const storageKey = `${payload.ownerId}:${payload.namespace ?? "custom"}:${payload.key ?? "amazon_customizer"}`;
      const val = metafieldsStore.get(storageKey) ?? null;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: val ? "gid://shopify/Metafield/meta-123" : undefined,
            value: val,
            namespace: payload.namespace ?? "custom",
            key: payload.key ?? "amazon_customizer",
            type: "json",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (op === "metafields.set") {
      const storageKey = `${payload.ownerId}:${payload.namespace ?? "custom"}:${payload.key ?? "amazon_customizer"}`;
      metafieldsStore.set(storageKey, payload.value);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            success: true,
            metafieldId: "gid://shopify/Metafield/meta-created",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (op === "metafields.delete") {
      const storageKey = `${payload.ownerId}:${payload.namespace ?? "custom"}:${payload.key ?? "amazon_customizer"}`;
      metafieldsStore.delete(storageKey);
      return new Response(
        JSON.stringify({
          success: true,
          data: { success: true },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (op === "files.delete") {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            deletedFileIds: payload.fileIds ?? [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (op === "files.list") {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            files: shopifyFiles,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (op === "products.get") {
      const isDeleted = payload.id.includes("deleted");
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            product: isDeleted ? null : { id: payload.id, title: "Active Product" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SHOPIFY_USER_ERROR", message: `Unsupported op: ${op}` },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  };

  return { mockFetch, recordedRequests, metafieldsStore };
}

test("Integration: reads and creates customization through same-origin Gateway path /api/shopify", async () => {
  const { mockFetch, recordedRequests } = createMockNginxGatewayFetch();
  const runner = createModuleApiRunner({ gatewayUrl: DEFAULT_GATEWAY_URL }, { fetch: mockFetch });
  const gateway = createCustomizationGatewayAdapter("capozen", { runner });

  // 1. Initial read should find nothing
  const initialRead = await readCustomization(gateway, {
    productId: "gid://shopify/Product/1001",
  });
  assert.equal(initialRead.exists, false);
  assert.equal(initialRead.customization, null);

  // Verify same-origin relative path was called
  assert.ok(recordedRequests.length > 0);
  assert.equal(recordedRequests[0].url, "/api/shopify");
  assert.equal(recordedRequests[0].body.operation, "metafields.get");
  assert.equal(recordedRequests[0].body.storeId, "capozen");

  // 2. Create customization
  const createRes = await createCustomization(gateway, {
    productId: "gid://shopify/Product/1001",
    customization: TEST_CUSTOMIZATION,
  });
  assert.equal(createRes.success, true);
  assert.equal(createRes.metafieldId, "gid://shopify/Metafield/meta-created");
  assert.ok(createRes.byteSize > 0);

  // Verify write went through same-origin Gateway
  const writeReq = recordedRequests.find((r) => r.body.operation === "metafields.set");
  assert.ok(writeReq);
  assert.equal(writeReq.url, "/api/shopify");
  assert.equal(writeReq.body.storeId, "capozen");

  // 3. Read back after creation
  const readAfter = await readCustomization(gateway, {
    productId: "gid://shopify/Product/1001",
  });
  assert.equal(readAfter.exists, true);
  assert.equal(
    (readAfter.customization?.product as { title?: string } | undefined)?.title,
    "Personalized Canvas Tote",
  );
  assert.equal(readAfter.customization?.surfaces?.length, 1);
});

test("Integration: updates customization and cascades deleted asset files via Gateway", async () => {
  const { mockFetch, recordedRequests } = createMockNginxGatewayFetch();
  const runner = createModuleApiRunner({ gatewayUrl: DEFAULT_GATEWAY_URL }, { fetch: mockFetch });
  const gateway = createCustomizationGatewayAdapter("capozen", { runner });

  // Pre-seed customization
  await createCustomization(gateway, {
    productId: "gid://shopify/Product/1001",
    customization: TEST_CUSTOMIZATION,
  });

  // Update with known previous file id to clean
  const updateRes = await updateCustomization(gateway, {
    productId: "gid://shopify/Product/1001",
    customization: {
      ...TEST_CUSTOMIZATION,
      product: { id: "gid://shopify/Product/1001", title: "Updated Canvas Tote" },
    },
    autoCleanReplacedAssets: true,
    knownPreviousFileIds: ["gid://shopify/File/old-asset-1"],
  });

  assert.equal(updateRes.success, true);

  // Verify files.delete was called for the replaced asset
  const fileDelReq = recordedRequests.find((r) => r.body.operation === "files.delete");
  assert.ok(fileDelReq);
  assert.deepEqual(fileDelReq.body.payload.fileIds, ["gid://shopify/File/old-asset-1"]);
});

test("Integration: cloneCustomization safely clones from source to target product and respects allowOverwrite", async () => {
  const { mockFetch } = createMockNginxGatewayFetch();
  const runner = createModuleApiRunner({ gatewayUrl: DEFAULT_GATEWAY_URL }, { fetch: mockFetch });
  const gateway = createCustomizationGatewayAdapter("capozen", { runner });

  // Create source
  await createCustomization(gateway, {
    productId: "gid://shopify/Product/source-1",
    customization: TEST_CUSTOMIZATION,
  });

  // Clone to target
  const cloneRes = await cloneCustomization(gateway, {
    sourceProductId: "gid://shopify/Product/source-1",
    targetProductId: "gid://shopify/Product/target-2",
  });
  assert.equal(cloneRes.success, true);
  assert.equal(cloneRes.targetProductId, "gid://shopify/Product/target-2");

  // Read target to verify
  const targetRead = await readCustomization(gateway, {
    productId: "gid://shopify/Product/target-2",
  });
  assert.equal(targetRead.exists, true);
  assert.equal(
    (targetRead.customization?.product as { title?: string } | undefined)?.title,
    "Personalized Canvas Tote",
  );

  // Second clone without allowOverwrite must throw
  await assert.rejects(
    async () => {
      await cloneCustomization(gateway, {
        sourceProductId: "gid://shopify/Product/source-1",
        targetProductId: "gid://shopify/Product/target-2",
        allowOverwrite: false,
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes("Customization already exists"));
      return true;
    },
  );

  // Second clone with allowOverwrite: true succeeds
  const overwriteClone = await cloneCustomization(gateway, {
    sourceProductId: "gid://shopify/Product/source-1",
    targetProductId: "gid://shopify/Product/target-2",
    allowOverwrite: true,
  });
  assert.equal(overwriteClone.success, true);
});

test("Integration: cleanOrphanAssets detects orphan file tagged with deleted product and purges it", async () => {
  const { mockFetch, recordedRequests } = createMockNginxGatewayFetch();
  const runner = createModuleApiRunner({ gatewayUrl: DEFAULT_GATEWAY_URL }, { fetch: mockFetch });
  const gateway = createCustomizationGatewayAdapter("capozen", { runner });

  const cleanRes = await cleanOrphanAssets(gateway, { dryRun: false });

  assert.equal(cleanRes.scannedCount, 2);
  assert.equal(cleanRes.orphanCount, 1);
  assert.deepEqual(cleanRes.orphanFileIds, ["gid://shopify/File/f2_orphan"]);
  assert.deepEqual(cleanRes.deletedFileIds, ["gid://shopify/File/f2_orphan"]);

  // Verify files.delete was issued through Gateway
  const purgeReq = recordedRequests.find(
    (r) => r.body.operation === "files.delete" && r.body.payload?.fileIds?.includes("gid://shopify/File/f2_orphan"),
  );
  assert.ok(purgeReq);
});

test("Integration: deleteCustomization purges metafield through Gateway", async () => {
  const { mockFetch, metafieldsStore } = createMockNginxGatewayFetch();
  const runner = createModuleApiRunner({ gatewayUrl: DEFAULT_GATEWAY_URL }, { fetch: mockFetch });
  const gateway = createCustomizationGatewayAdapter("capozen", { runner });

  // Create
  await createCustomization(gateway, {
    productId: "gid://shopify/Product/to-delete",
    customization: TEST_CUSTOMIZATION,
  });

  const delRes = await deleteCustomization(gateway, {
    productId: "gid://shopify/Product/to-delete",
  });
  assert.equal(delRes.success, true);

  // Metafields store is now empty
  const storageKey = "gid://shopify/Product/to-delete:custom:amazon_customizer";
  assert.equal(metafieldsStore.has(storageKey), false);
});
