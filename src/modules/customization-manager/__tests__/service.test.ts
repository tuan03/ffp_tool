import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductCustomization } from "../../customization-normalizer";
import {
  cleanOrphanAssets,
  cloneCustomization,
  computeAssetDiff,
  createCustomization,
  createCustomizationManagerRunner,
  createDryRunCustomizationGateway,
  deleteCustomization,
  extractAssetFileIds,
  extractAssetUrls,
  getCustomizationManagerRunner,
  readCustomization,
  updateCustomization,
  validateCustomizationPayloadSize,
} from "../index";
import type { CustomizerTrackedAsset } from "../types";
import { mockCustomizationConfig } from "../mocks/data";

describe("Customization Manager: Service & Helpers", () => {
  it("readCustomization returns exists: false when product has no customizer metafield", async () => {
    const gateway = createDryRunCustomizationGateway();
    const result = await readCustomization(gateway, {
      productId: "gid://shopify/Product/empty-1",
    });

    assert.equal(result.exists, false);
    assert.equal(result.customization, null);
    assert.equal(result.byteSize, 0);
    assert.deepEqual(result.trackedFileIds, []);
  });

  it("createCustomization saves new customizer and readCustomization reads it back", async () => {
    const gateway = createDryRunCustomizationGateway();
    const productId = "gid://shopify/Product/prod-1";

    const createRes = await createCustomization(gateway, {
      productId,
      customization: mockCustomizationConfig,
    });

    assert.equal(createRes.success, true);
    assert.ok(createRes.metafieldId);
    assert.ok(createRes.byteSize > 0);
    assert.ok(createRes.trackedFileIds.includes("gid://shopify/MediaImage/9001"));

    const readRes = await readCustomization(gateway, { productId });
    assert.equal(readRes.exists, true);
    assert.ok(readRes.customization);
    assert.equal(readRes.customization.hasCustomization, true);
    assert.equal(readRes.customization.surfaces?.length, 2);
  });

  it("createCustomization rejects overwrite when allowOverwrite is false", async () => {
    const gateway = createDryRunCustomizationGateway();
    const productId = "gid://shopify/Product/prod-2";

    await createCustomization(gateway, {
      productId,
      customization: mockCustomizationConfig,
    });

    await assert.rejects(
      async () => {
        await createCustomization(gateway, {
          productId,
          customization: mockCustomizationConfig,
          allowOverwrite: false,
        });
      },
      /already exists/,
    );
  });

  it("createCustomization allows overwrite when allowOverwrite is true", async () => {
    const gateway = createDryRunCustomizationGateway();
    const productId = "gid://shopify/Product/prod-3";

    await createCustomization(gateway, {
      productId,
      customization: mockCustomizationConfig,
    });

    const updated = await createCustomization(gateway, {
      productId,
      customization: {
        ...mockCustomizationConfig,
        formUrl: "https://example.com/updated",
      },
      allowOverwrite: true,
    });

    assert.equal(updated.success, true);
    const readRes = await readCustomization(gateway, { productId });
    assert.equal(readRes.customization?.formUrl, "https://example.com/updated");
  });

  it("readCustomization handles corrupted non-JSON metafield gracefully", async () => {
    const gateway = createDryRunCustomizationGateway();
    const productId = "gid://shopify/Product/corrupted-1";

    await gateway.setMetafield({
      ownerId: productId,
      namespace: "custom",
      key: "amazon_customizer",
      value: "INVALID_JSON{{{",
    });

    const readRes = await readCustomization(gateway, { productId });
    assert.equal(readRes.exists, true);
    assert.equal(readRes.customization, null);
    assert.ok(readRes.warnings.length > 0);
    assert.ok(readRes.warnings[0]?.includes("Failed to parse customizer JSON"));
  });

  it("updateCustomization updates config and performs delta asset cleanup", async () => {
    const gateway = createDryRunCustomizationGateway();
    const productId = "gid://shopify/Product/delta-test";

    // Seed original with 2 assets
    const originalAssets: CustomizerTrackedAsset[] = [
      {
        url: "https://cdn.shopify.com/s/files/1/0001/old_file.png",
        fileId: "gid://shopify/MediaImage/old-100",
      },
      {
        url: "https://cdn.shopify.com/s/files/1/0001/keep_file.png",
        fileId: "gid://shopify/MediaImage/keep-200",
      },
    ];

    await createCustomization(gateway, {
      productId,
      customization: {
        ...mockCustomizationConfig,
        assets: originalAssets,
      },
    });

    // Update removing old_file.png and adding new_file.png
    const updatedAssets: CustomizerTrackedAsset[] = [
      {
        url: "https://cdn.shopify.com/s/files/1/0001/keep_file.png",
        fileId: "gid://shopify/MediaImage/keep-200",
      },
      {
        url: "https://cdn.shopify.com/s/files/1/0001/new_file.png",
        fileId: "gid://shopify/MediaImage/new-300",
      },
    ];

    const updateRes = await updateCustomization(gateway, {
      productId,
      autoCleanReplacedAssets: true,
      customization: {
        ...mockCustomizationConfig,
        assets: updatedAssets,
      },
    });

    assert.equal(updateRes.success, true);
    assert.ok(updateRes.assetDiff);
    assert.deepEqual(updateRes.assetDiff.removedUrls, [
      "https://cdn.shopify.com/s/files/1/0001/old_file.png",
    ]);
    assert.deepEqual(updateRes.assetDiff.addedUrls, [
      "https://cdn.shopify.com/s/files/1/0001/new_file.png",
    ]);
    assert.deepEqual(updateRes.deletedFileIds, ["gid://shopify/MediaImage/old-100"]);
  });

  it("deleteCustomization cascade-deletes CDN files when cascadeDeleteFiles is true", async () => {
    const gateway = createDryRunCustomizationGateway();
    const productId = "gid://shopify/Product/cascade-test";

    await createCustomization(gateway, {
      productId,
      customization: mockCustomizationConfig,
    });

    const deleteRes = await deleteCustomization(gateway, {
      productId,
      cascadeDeleteFiles: true,
    });

    assert.equal(deleteRes.success, true);
    assert.ok(deleteRes.deletedFileIds.includes("gid://shopify/MediaImage/9001"));
    assert.ok(deleteRes.deletedFileIds.includes("gid://shopify/MediaImage/9002"));

    const verifyRead = await readCustomization(gateway, { productId });
    assert.equal(verifyRead.exists, false);
  });

  it("cloneCustomization copies config from source to target product", async () => {
    const gateway = createDryRunCustomizationGateway();
    const sourceId = "gid://shopify/Product/source-1";
    const targetId = "gid://shopify/Product/target-1";

    await createCustomization(gateway, {
      productId: sourceId,
      customization: mockCustomizationConfig,
    });

    const cloneRes = await cloneCustomization(gateway, {
      sourceProductId: sourceId,
      targetProductId: targetId,
    });

    assert.equal(cloneRes.success, true);
    const targetRead = await readCustomization(gateway, { productId: targetId });
    assert.equal(targetRead.exists, true);
    assert.equal(targetRead.customization?.surfaces?.length, 2);
  });

  it("cleanOrphanAssets identifies and deletes orphan files when product no longer exists", async () => {
    const baseGateway = createDryRunCustomizationGateway();
    const gateway: typeof baseGateway = {
      ...baseGateway,
      async queryFiles() {
        return {
          files: [
            {
              id: "gid://shopify/MediaImage/orphan-1",
              url: "https://cdn.shopify.com/orphan-1.png",
              tags: ["product:deleted-prod-100"],
            },
            {
              id: "gid://shopify/MediaImage/active-1",
              url: "https://cdn.shopify.com/active-1.png",
              tags: ["product:live-prod-200"],
            },
          ],
        };
      },
      async getProduct(input: { id: string }) {
        if (input.id === "live-prod-200") {
          return { product: { id: "live-prod-200", title: "Live Product" } };
        }
        return { product: null };
      },
    };

    // Test Dry Run
    const dryRunRes = await cleanOrphanAssets(gateway, { dryRun: true });
    assert.equal(dryRunRes.scannedCount, 2);
    assert.equal(dryRunRes.orphanCount, 1);
    assert.deepEqual(dryRunRes.orphanFileIds, ["gid://shopify/MediaImage/orphan-1"]);
    assert.deepEqual(dryRunRes.deletedFileIds, []);

    // Test Apply
    const applyRes = await cleanOrphanAssets(gateway, { dryRun: false });
    assert.equal(applyRes.orphanCount, 1);
    assert.deepEqual(applyRes.deletedFileIds, ["gid://shopify/MediaImage/orphan-1"]);
  });

  it("computeAssetDiff correctly detects added, removed, and retained URLs", () => {
    const oldConfig: ProductCustomization = {
      assets: [
        { url: "https://cdn.shopify.com/1.png" },
        { url: "https://cdn.shopify.com/2.png" },
      ],
    };

    const newConfig: ProductCustomization = {
      assets: [
        { url: "https://cdn.shopify.com/2.png" },
        { url: "https://cdn.shopify.com/3.png" },
      ],
    };

    const diff = computeAssetDiff(oldConfig, newConfig);
    assert.deepEqual(diff.addedUrls, ["https://cdn.shopify.com/3.png"]);
    assert.deepEqual(diff.removedUrls, ["https://cdn.shopify.com/1.png"]);
    assert.deepEqual(diff.retainedUrls, ["https://cdn.shopify.com/2.png"]);
  });

  it("validateCustomizationPayloadSize correctly checks size limits", () => {
    const normal = validateCustomizationPayloadSize(mockCustomizationConfig, {
      maxMetafieldSizeBytes: 128 * 1024,
      autoDeduplicateThresholdBytes: 110 * 1024,
    });
    assert.equal(normal.isSafe, true);
    assert.equal(normal.warning, undefined);

    const hugeConfig: ProductCustomization = {
      ...mockCustomizationConfig,
      hugeField: "x".repeat(130 * 1024),
    };

    const huge = validateCustomizationPayloadSize(hugeConfig, {
      maxMetafieldSizeBytes: 128 * 1024,
    });
    assert.equal(huge.isSafe, false);
    assert.ok(huge.warning?.includes("exceeds Shopify limit"));
  });

  it("getCustomizationManagerRunner returns mock runner when environment is mock", async () => {
    const runner = getCustomizationManagerRunner("mock");
    const readRes = await runner.read({ productId: "gid://shopify/Product/any" });
    assert.equal(readRes.exists, true);
    assert.ok(readRes.customization);
  });

  it("getCustomizationManagerRunner returns real runner when environment is development", async () => {
    const gateway = createDryRunCustomizationGateway();
    const runner = getCustomizationManagerRunner("development", gateway);
    const readRes = await runner.read({ productId: "gid://shopify/Product/non-existent" });
    assert.equal(readRes.exists, false);
  });
});
