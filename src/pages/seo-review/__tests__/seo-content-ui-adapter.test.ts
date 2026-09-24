import assert from "node:assert/strict";
import test from "node:test";

import type {
  AutoSeoItemResult,
  CustomizationSeoItemResult,
  PinterestPodSeoItemResult,
  SeoContentOutput,
} from "../../../modules/seo-content";
import {
  adaptAutoSeoItemToViewModel,
  adaptCustomizationItemToViewModel,
  adaptPinterestPodItemToViewModel,
  adaptSeoOutputToViewModel,
  adaptViewModelToApprovedUpdate,
  adaptViewModelToRollbackUpdate,
  adaptViewModelsToApprovedUpdates,
  adaptViewModelsToRollbackUpdates,
  getDisplayValue,
  getInitialSampleViewModels,
} from "../seo-content-ui-adapter";
import { hasWritableChanges } from "../../../modules/orchestrator";
import type { SeoProductUiViewModel } from "../types";

test("getDisplayValue: preserves valid real values and tags with source 'real'", () => {
  const str = getDisplayValue("Gothic Area Rug", "Fallback Title");
  assert.equal(str.value, "Gothic Area Rug");
  assert.equal(str.source, "real");

  const arr = getDisplayValue(["tag1", "tag2"], ["fallback"]);
  assert.deepEqual(arr.value, ["tag1", "tag2"]);
  assert.equal(arr.source, "real");
});

test("getDisplayValue: detects null, undefined, empty string/array and tags with source 'mock'", () => {
  const fromNull = getDisplayValue<string>(null, "Fallback Title");
  assert.equal(fromNull.value, "Fallback Title");
  assert.equal(fromNull.source, "mock");

  const fromUndefined = getDisplayValue<string>(undefined, "Fallback Title");
  assert.equal(fromUndefined.value, "Fallback Title");
  assert.equal(fromUndefined.source, "mock");

  const fromEmptyStr = getDisplayValue("   ", "Fallback Title");
  assert.equal(fromEmptyStr.value, "Fallback Title");
  assert.equal(fromEmptyStr.source, "mock");

  const fromEmptyArr = getDisplayValue([], ["item-1"]);
  assert.deepEqual(fromEmptyArr.value, ["item-1"]);
  assert.equal(fromEmptyArr.source, "mock");
});

test("adaptSeoOutputToViewModel: complete SeoContentOutput produces all 'real' core fields", () => {
  const fullOutput: SeoContentOutput = {
    productTitle: "Authentic Vintage Cat Rug",
    productDescription: "<p>Deep pile cozy rug</p>",
    productSeoTitle: "Vintage Cat Rug | Best Living Room Mat",
    productSeoDescription: "Shop authentic vintage cat rug for cozy living spaces.",
    productHandle: "vintage-cat-rug",
    images: [
      {
        sourceUrl: "https://example.com/cat.jpg",
        alt: "Vintage cat rug in living room",
        webp: {
          filename: "vintage-cat-rug-1.webp",
          url: "https://cdn.example.com/vintage-cat-rug-1.webp",
        },
      },
    ],
  };

  const vm = adaptSeoOutputToViewModel(fullOutput, {
    productId: "gid://shopify/Product/1",
    asin: "B09CATRUG1",
    isStatusReal: true,
  });

  assert.equal(vm.productTitle.value, "Authentic Vintage Cat Rug");
  assert.equal(vm.productTitle.source, "real");

  assert.equal(vm.productDescription.value, "<p>Deep pile cozy rug</p>");
  assert.equal(vm.productDescription.source, "real");

  assert.equal(vm.seoTitle.value, "Vintage Cat Rug | Best Living Room Mat");
  assert.equal(vm.seoTitle.source, "real");

  assert.equal(vm.seoDescription.value, "Shop authentic vintage cat rug for cozy living spaces.");
  assert.equal(vm.seoDescription.source, "real");

  assert.equal(vm.handle.value, "vintage-cat-rug");
  assert.equal(vm.handle.source, "real");

  assert.equal(vm.images.length, 1);
  assert.equal(vm.images[0].previewUrl.value, "https://example.com/cat.jpg");
  assert.equal(vm.images[0].previewUrl.source, "real");
  assert.equal(vm.images[0].alt.value, "Vintage cat rug in living room");
  assert.equal(vm.images[0].alt.source, "real");
  assert.equal(vm.images[0].webpUrl.value, "https://cdn.example.com/vintage-cat-rug-1.webp");
  assert.equal(vm.images[0].webpUrl.source, "real");

  assert.equal(vm.seoStatus.value, "completed");
  assert.equal(vm.seoStatus.source, "real");
  assert.equal(vm.reviewDecision, "pending");
});

test("adaptSeoOutputToViewModel: partial output tags missing fields as 'mock' without breaking structure", () => {
  const partialOutput: Partial<SeoContentOutput> = {
    productTitle: "Partial Spooky Pillow",
    productHandle: "spooky-pillow",
    // productSeoTitle, productSeoDescription, productDescription omitted
  };

  const vm = adaptSeoOutputToViewModel(partialOutput, {
    asin: "B08PARTIAL",
  });

  assert.equal(vm.productTitle.value, "Partial Spooky Pillow");
  assert.equal(vm.productTitle.source, "real");

  // Missing fields should be marked as mock
  assert.equal(vm.seoDescription.source, "mock");
  assert.ok(vm.seoDescription.value.length > 0);

  assert.equal(vm.productDescription.source, "mock");
  assert.match(vm.productDescription.value, /SEO Content module/);

  assert.equal(vm.handle.value, "spooky-pillow");
  assert.equal(vm.handle.source, "real");
});

test("adaptCustomizationItemToViewModel: adapts batch item results for success and failure", () => {
  const successItem: CustomizationSeoItemResult = {
    productId: "prod-123",
    asin: "B09ASIN01",
    sourceProduct: {
      id: "prod-123",
      title: "Custom Mug",
      categories: ["Kitchen"],
    },
    seoInput: {
      title: "Custom Mug",
      description: "Coffee mug",
      niche: "Kitchen",
      handle: "custom-mug",
      images: [],
    },
    seoOutput: {
      productTitle: "Personalized Ceramic Coffee Mug",
      productDescription: "<p>Durable white ceramic</p>",
      productSeoTitle: "Personalized Coffee Mug | Custom Gift",
      productSeoDescription: "Shop personalized ceramic coffee mug.",
      productHandle: "personalized-coffee-mug",
      images: [],
    },
    success: true,
  };

  const successVm = adaptCustomizationItemToViewModel(successItem);
  assert.equal(successVm.productId, "prod-123");
  assert.equal(successVm.asin, "B09ASIN01");
  assert.equal(successVm.seoStatus.value, "completed");
  assert.equal(successVm.productTitle.value, "Personalized Ceramic Coffee Mug");
  assert.equal(successVm.productTitle.source, "real");

  const failedItem: CustomizationSeoItemResult = {
    productId: "prod-999",
    asin: "B09FAIL01",
    sourceProduct: {
      id: "prod-999",
      title: "Broken Item",
    },
    seoInput: {
      title: "Broken Item",
      description: "",
      niche: "",
      handle: "",
      images: [],
    },
    success: false,
    error: "External API rate limit reached",
  };

  const failedVm = adaptCustomizationItemToViewModel(failedItem);
  assert.equal(failedVm.productId, "prod-999");
  assert.equal(failedVm.seoStatus.value, "failed");
  assert.equal(failedVm.rejectionReason, "External API rate limit reached");
});

test("getInitialSampleViewModels: returns diverse sample items for immediate UI preview", () => {
  const samples = getInitialSampleViewModels();
  assert.ok(samples.length >= 4);

  const statuses = samples.map((s) => s.seoStatus.value);
  assert.ok(statuses.includes("completed"));
  assert.ok(statuses.includes("processing"));
  assert.ok(statuses.includes("failed"));

  // Check that at least one item has mock fields flagged
  const hasMockItem = samples.some((s) => s.productDescription.source === "mock" || s.seoDescription.source === "mock");
  assert.ok(hasMockItem);
});

test("adaptAutoSeoItemToViewModel: successfully adapts AutoSeoItemResult to SeoProductUiViewModel", () => {
  const successItem: AutoSeoItemResult = {
    productId: "gid://shopify/Product/123456",
    handle: "gothic-wall-art",
    sourceProduct: {
      id: "gid://shopify/Product/123456",
      title: "Gothic Wall Art Print",
      handle: "gothic-wall-art",
      productType: "Home Décor",
      tags: ["Wall Art", "Gothic"],
      images: [
        {
          id: "img-1",
          url: "https://example.com/art.jpg",
          altText: "Gothic wall art preview",
        },
      ],
    },
    seoInput: {
      title: "Gothic Wall Art Print",
      description: "Beautiful gothic canvas",
      niche: "Home Décor",
      handle: "gothic-wall-art",
      images: [],
    },
    seoOutput: {
      productTitle: "Enchanted Gothic Wall Art Canvas Print",
      productDescription: "<p>Premium gothic wall decor</p>",
      productSeoTitle: "Gothic Wall Art Canvas | Dark Fantasy Decor",
      productSeoDescription: "Shop high-quality gothic wall art canvas prints online.",
      productHandle: "enchanted-gothic-wall-art",
      images: [
        {
          sourceUrl: "https://example.com/art.jpg",
          alt: "Enchanted Gothic Wall Art Canvas Print",
          webp: {
            url: "https://cdn.example.com/art.webp",
            filename: "art.webp",
          },
        },
      ],
    },
    success: true,
  };

  const vm = adaptAutoSeoItemToViewModel(successItem);
  assert.equal(vm.productId, "gid://shopify/Product/123456");
  assert.equal(vm.productTitle.value, "Enchanted Gothic Wall Art Canvas Print");
  assert.equal(vm.productTitle.source, "real");
  assert.equal(vm.seoStatus.value, "completed");
  assert.equal(vm.seoStatus.source, "real");
  assert.equal(vm.sourceNiche, "Wall Art");
  assert.equal(vm.handle.value, "enchanted-gothic-wall-art");
  assert.equal(vm.images.length, 1);
  assert.equal(vm.images[0].previewUrl.value, "https://example.com/art.jpg");
  assert.equal(vm.images[0].webpUrl.value, "https://cdn.example.com/art.webp");
});

test("adaptAutoSeoItemToViewModel: handles failed AutoSeoItemResult and records rejectionReason", () => {
  const failedItem: AutoSeoItemResult = {
    productId: "gid://shopify/Product/999999",
    handle: "failed-product",
    sourceProduct: {
      id: "gid://shopify/Product/999999",
      title: "Failed Product",
      handle: "failed-product",
    },
    seoInput: {
      title: "Failed Product",
      description: "",
      niche: "General",
      handle: "failed-product",
      images: [],
    },
    success: false,
    error: "SEO Content Generation timed out after 30s",
  };

  const vm = adaptAutoSeoItemToViewModel(failedItem);
  assert.equal(vm.productId, "gid://shopify/Product/999999");
  assert.equal(vm.seoStatus.value, "failed");
  assert.equal(vm.rejectionReason, "SEO Content Generation timed out after 30s");
});

test("adaptAutoSeoItemToViewModel: preserves storeId from sourceProduct, item, or fallback", () => {
  const itemWithSourceStore: AutoSeoItemResult = {
    productId: "gid://shopify/Product/111",
    handle: "p1-handle",
    sourceProduct: {
      id: "gid://shopify/Product/111",
      title: "Store 1 Product",
      storeId: "store-alpha",
    },
    seoInput: { title: "P1", description: "", niche: "", handle: "p1-handle", images: [] },
    success: true,
  };
  const vm1 = adaptAutoSeoItemToViewModel(itemWithSourceStore);
  assert.equal(vm1.storeId, "store-alpha");

  const itemWithItemStore: AutoSeoItemResult = {
    productId: "gid://shopify/Product/222",
    handle: "p2-handle",
    storeId: "store-beta",
    sourceProduct: {
      id: "gid://shopify/Product/222",
      title: "Store 2 Product",
    },
    seoInput: { title: "P2", description: "", niche: "", handle: "p2-handle", images: [] },
    success: true,
  };
  const vm2 = adaptAutoSeoItemToViewModel(itemWithItemStore);
  assert.equal(vm2.storeId, "store-beta");

  const itemWithoutStore: AutoSeoItemResult = {
    productId: "gid://shopify/Product/333",
    handle: "p3-handle",
    sourceProduct: {
      id: "gid://shopify/Product/333",
      title: "Fallback Product",
    },
    seoInput: { title: "P3", description: "", niche: "", handle: "p3-handle", images: [] },
    success: true,
  };
  const vm3 = adaptAutoSeoItemToViewModel(itemWithoutStore, "store-fallback");
  assert.equal(vm3.storeId, "store-fallback");
});

test("adaptCustomizationItemToViewModel: preserves storeId from fallbackStoreId", () => {
  const item: CustomizationSeoItemResult = {
    productId: "gid://shopify/Product/444",
    sourceProduct: {
      id: "gid://shopify/Product/444",
      title: "Customization Product",
    },
    seoInput: { title: "CP", description: "", niche: "", handle: "", images: [] },
    success: true,
  };

  const vm = adaptCustomizationItemToViewModel(item, "store-gamma");
  assert.equal(vm.storeId, "store-gamma");
});

test("adaptViewModelToApprovedUpdate: correctly extracts patch with title, descriptionHtml, handle, and seo", () => {
  const sample = getInitialSampleViewModels()[0];
  const update = adaptViewModelToApprovedUpdate(sample);

  assert.equal(update.productId, sample.productId);
  assert.equal(update.patch.title, sample.productTitle.value);
  assert.equal(update.patch.descriptionHtml, sample.productDescription.value);
  assert.equal(update.patch.handle, sample.handle.value);
  assert.equal(update.patch.seo?.title, sample.seoTitle.value);
  assert.equal(update.patch.seo?.description, sample.seoDescription.value);
});

test("adaptViewModelToApprovedUpdate: handles omitted/whitespace fields cleanly without creating empty sub-objects", () => {
  const sparseVm: SeoProductUiViewModel = {
    id: "sparse-1",
    productId: "gid://shopify/Product/555",
    productTitle: { value: "Sparse Title", source: "real" },
    productDescription: { value: "   ", source: "mock" },
    seoTitle: { value: "Sparse SEO Title", source: "real" },
    seoDescription: { value: "", source: "mock" },
    handle: { value: "sparse-handle", source: "real" },
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "pending",
    updatedAt: Date.now(),
    images: [],
  };

  const update = adaptViewModelToApprovedUpdate(sparseVm);
  assert.equal(update.productId, "gid://shopify/Product/555");
  assert.equal(update.patch.title, "Sparse Title");
  assert.equal(update.patch.handle, "sparse-handle");
  assert.equal(update.patch.descriptionHtml, undefined);
  assert.equal(update.patch.seo?.title, "Sparse SEO Title");
  assert.equal(update.patch.seo?.description, undefined);
});

test("adaptViewModelsToApprovedUpdates: maps array of view models to ApprovedProductUpdate array", () => {
  const samples = getInitialSampleViewModels().slice(0, 2);
  const updates = adaptViewModelsToApprovedUpdates(samples);

  assert.equal(updates.length, 2);
  assert.equal(updates[0].productId, samples[0].productId);
  assert.equal(updates[1].productId, samples[1].productId);
  assert.equal(updates[0].patch.title, samples[0].productTitle.value);
  assert.equal(updates[1].patch.title, samples[1].productTitle.value);
});

test("adaptCustomizationItemToViewModel: extracts storeId and productId from sourceProduct.pipeline.shopify", () => {
  const item: CustomizationSeoItemResult = {
    asin: "B09CRAWLER1",
    sourceProduct: {
      id: "crawl-101",
      title: "Crawled Custom Product",
      pipeline: {
        shopify: {
          storeId: "store-crawler-live",
          productId: "gid://shopify/Product/888999",
        },
      },
    },
    seoInput: { title: "CCP", description: "", niche: "", handle: "", images: [] },
    success: true,
  };

  const vm = adaptCustomizationItemToViewModel(item, "store-fallback-ignored");
  assert.equal(vm.storeId, "store-crawler-live");
  assert.equal(vm.productId, "gid://shopify/Product/888999");
  assert.equal(vm.id, "gid://shopify/Product/888999");
});

test("hasWritableChanges: accurately detects writable patches vs empty patches", () => {
  assert.equal(hasWritableChanges({ title: "Valid Title" }), true);
  assert.equal(hasWritableChanges({ descriptionHtml: "<p>Valid</p>" }), true);
  assert.equal(hasWritableChanges({ handle: "valid-handle" }), true);
  assert.equal(hasWritableChanges({ seo: { title: "SEO Title" } }), true);
  assert.equal(hasWritableChanges({ seo: { description: "SEO Desc" } }), true);

  // Empty / undefined patches
  assert.equal(hasWritableChanges({}), false);
  assert.equal(hasWritableChanges(null), false);
  assert.equal(hasWritableChanges(undefined), false);
  assert.equal(hasWritableChanges({ seo: {} }), false);
  assert.equal(hasWritableChanges({ seo: { title: undefined, description: undefined } }), false);
  assert.equal(hasWritableChanges({ title: undefined, handle: undefined }), false);
});

test("adaptViewModelToApprovedUpdate: empty view model produces patch that hasWritableChanges flags as false", () => {
  const emptyVm: SeoProductUiViewModel = {
    id: "empty-prod-1",
    productId: "gid://shopify/Product/000",
    productTitle: { value: "   ", source: "mock" },
    productDescription: { value: "", source: "mock" },
    seoTitle: { value: "", source: "mock" },
    seoDescription: { value: "  ", source: "mock" },
    handle: { value: "   ", source: "mock" },
    seoStatus: { value: "failed", source: "real" },
    reviewDecision: "pending",
    updatedAt: Date.now(),
    images: [],
  };

  const update = adaptViewModelToApprovedUpdate(emptyVm);
  assert.equal(hasWritableChanges(update.patch), false);
});

test("adaptViewModelToRollbackUpdate: generates correct patch from originalBackup", () => {
  const sampleVm: SeoProductUiViewModel = {
    id: "prod-rollback-1",
    productId: "gid://shopify/Product/12345",
    productTitle: { value: "Optimized Title", source: "real" },
    productDescription: { value: "<p>Optimized Description</p>", source: "real" },
    seoTitle: { value: "Optimized SEO Title", source: "real" },
    seoDescription: { value: "Optimized SEO Desc", source: "real" },
    handle: { value: "optimized-handle", source: "real" },
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "approved",
    updatedAt: Date.now(),
    images: [],
    originalBackup: {
      productTitle: "Original Raw Title From Shopify",
      productDescription: "<p>Original Raw Description</p>",
      handle: "original-handle",
      seoTitle: "Original Meta Title",
      seoDescription: "Original Meta Description",
      backedUpAt: 1700000000000,
    },
  };

  const rollback = adaptViewModelToRollbackUpdate(sampleVm);
  assert.ok(rollback);
  assert.equal(rollback.productId, "gid://shopify/Product/12345");
  assert.equal(rollback.patch.title, "Original Raw Title From Shopify");
  assert.equal(rollback.patch.descriptionHtml, "<p>Original Raw Description</p>");
  assert.equal(rollback.patch.handle, "original-handle");
  assert.deepEqual(rollback.patch.seo, {
    title: "Original Meta Title",
    description: "Original Meta Description",
  });
  assert.equal(hasWritableChanges(rollback.patch), true);
});

test("adaptViewModelToRollbackUpdate: returns null if originalBackup is missing or id is empty", () => {
  const noBackupVm: SeoProductUiViewModel = {
    id: "prod-no-backup",
    productId: "gid://shopify/Product/999",
    productTitle: { value: "Title", source: "real" },
    productDescription: { value: "Desc", source: "real" },
    seoTitle: { value: "SEO Title", source: "real" },
    seoDescription: { value: "SEO Desc", source: "real" },
    handle: { value: "handle", source: "real" },
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "approved",
    updatedAt: Date.now(),
    images: [],
  };

  assert.equal(adaptViewModelToRollbackUpdate(noBackupVm), null);

  const noIdVm: SeoProductUiViewModel = {
    ...noBackupVm,
    id: "   ",
    productId: " ",
    originalBackup: {
      productTitle: "Backup Title",
      productDescription: "Backup Desc",
      backedUpAt: Date.now(),
    },
  };
  assert.equal(adaptViewModelToRollbackUpdate(noIdVm), null);
});

test("adaptViewModelsToRollbackUpdates: filters out items without backup and maps valid ones", () => {
  const vmWithBackup: SeoProductUiViewModel = {
    id: "prod-has-backup",
    productId: "gid://shopify/Product/111",
    productTitle: { value: "Opt Title", source: "real" },
    productDescription: { value: "Opt Desc", source: "real" },
    seoTitle: { value: "Opt SEO Title", source: "real" },
    seoDescription: { value: "Opt SEO Desc", source: "real" },
    handle: { value: "opt-handle", source: "real" },
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "approved",
    updatedAt: Date.now(),
    images: [],
    originalBackup: {
      productTitle: "Original Title 111",
      productDescription: "Original Desc 111",
      backedUpAt: 1700000000000,
    },
  };

  const vmWithoutBackup: SeoProductUiViewModel = {
    id: "prod-without-backup",
    productId: "gid://shopify/Product/222",
    productTitle: { value: "Title 2", source: "real" },
    productDescription: { value: "Desc 2", source: "real" },
    seoTitle: { value: "SEO Title 2", source: "real" },
    seoDescription: { value: "SEO Desc 2", source: "real" },
    handle: { value: "handle-2", source: "real" },
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "approved",
    updatedAt: Date.now(),
    images: [],
  };

  const results = adaptViewModelsToRollbackUpdates([vmWithBackup, vmWithoutBackup]);
  assert.equal(results.length, 1);
  assert.equal(results[0].productId, "gid://shopify/Product/111");
  assert.equal(results[0].patch.title, "Original Title 111");
});

test("adaptAutoSeoItemToViewModel: preserves original product data in originalBackup", () => {
  const autoSeoItem: AutoSeoItemResult = {
    productId: "gid://shopify/Product/45678",
    handle: "store-original-t-shirt",
    sourceProduct: {
      productId: "gid://shopify/Product/45678",
      title: "Store Original T-Shirt",
      descriptionHtml: "<p>Original 100% cotton tee</p>",
      handle: "store-original-t-shirt",
      seoTitle: "Store Meta Title",
      seoDescription: "Store Meta Description",
      tags: ["clothing", "tee"],
    },
    seoInput: {
      title: "Store Original T-Shirt",
      description: "Original 100% cotton tee",
      niche: "Apparel",
      handle: "store-original-t-shirt",
      images: [],
    },
    seoOutput: {
      productTitle: "Optimized Vintage Graphic T-Shirt",
      productDescription: "<p>Ultra-soft vintage apparel</p>",
      productSeoTitle: "Vintage Graphic T-Shirt | Retro Style",
      productSeoDescription: "Shop comfortable graphic tee online.",
      productHandle: "optimized-vintage-graphic-t-shirt",
      images: [],
    },
    success: true,
  };

  const vm = adaptAutoSeoItemToViewModel(autoSeoItem, "store-apparel-1");
  const backup = vm.originalBackup;
  assert.ok(backup);
  if (!backup) {
    assert.fail("backup must be defined");
  }
  assert.equal(backup.productTitle, "Store Original T-Shirt");
  assert.equal(backup.productDescription, "<p>Original 100% cotton tee</p>");
  assert.equal(backup.handle, "store-original-t-shirt");
  assert.equal(backup.seoTitle, "Store Meta Title");
  assert.equal(backup.seoDescription, "Store Meta Description");
  assert.ok((backup.backedUpAt ?? 0) > 0);
});

test("getInitialSampleViewModels: sample models have realistic originalBackup populated", () => {
  const samples = getInitialSampleViewModels();
  assert.ok(samples.length > 0);
  for (const sample of samples) {
    const backup = sample.originalBackup;
    assert.ok(backup, `Sample ${sample.id} must have originalBackup`);
    if (!backup) {
      assert.fail("backup must be defined");
    }
    assert.ok(backup.productTitle.length > 0);
    assert.ok(backup.productDescription.length > 0);
  }
});

test("adaptViewModelToRollbackUpdate: resets SEO title to product title and clears SEO description when original had no custom SEO", () => {
  const vmWithoutCustomSeo: SeoProductUiViewModel = {
    id: "prod-no-custom-seo",
    productId: "gid://shopify/Product/555",
    productTitle: { value: "AI Optimized Title", source: "real" },
    productDescription: { value: "<p>AI Optimized Desc</p>", source: "real" },
    seoTitle: { value: "AI SEO Title", source: "real" },
    seoDescription: { value: "AI SEO Desc", source: "real" },
    handle: { value: "ai-handle", source: "real" },
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "approved",
    updatedAt: Date.now(),
    images: [],
    originalBackup: {
      productTitle: "Original Plain Title",
      productDescription: "<p>Original Plain Desc</p>",
      handle: "original-plain-title",
      // seoTitle & seoDescription omitted / undefined
      backedUpAt: Date.now(),
    },
  };

  const rollback = adaptViewModelToRollbackUpdate(vmWithoutCustomSeo);
  assert.ok(rollback);
  assert.equal(rollback.patch.title, "Original Plain Title");
  assert.deepEqual(rollback.patch.seo, {
    title: "Original Plain Title",
    description: "",
  });
  assert.equal(hasWritableChanges(rollback.patch), true);
});

test("adaptViewModelToRollbackUpdate: preserves empty productDescription as empty string in patch", () => {
  const vmWithEmptyDesc: SeoProductUiViewModel = {
    id: "prod-empty-desc",
    productId: "gid://shopify/Product/666",
    productTitle: { value: "AI Optimized Title", source: "real" },
    productDescription: { value: "<p>AI Optimized Long Description</p>", source: "real" },
    seoTitle: { value: "AI SEO Title", source: "real" },
    seoDescription: { value: "AI SEO Desc", source: "real" },
    handle: { value: "ai-handle", source: "real" },
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "approved",
    updatedAt: Date.now(),
    images: [],
    originalBackup: {
      productTitle: "Product With No Description",
      productDescription: "",
      handle: "product-no-desc",
      backedUpAt: Date.now(),
    },
  };

  const rollback = adaptViewModelToRollbackUpdate(vmWithEmptyDesc);
  assert.ok(rollback);
  assert.equal(rollback.patch.descriptionHtml, "");
  assert.equal(hasWritableChanges(rollback.patch), true);
});

test("adaptAutoSeoItemToViewModel: preserves empty description cleanly without corrupting with title", () => {
  const emptyDescItem: AutoSeoItemResult = {
    productId: "gid://shopify/Product/777",
    handle: "empty-desc-tee",
    sourceProduct: {
      productId: "gid://shopify/Product/777",
      title: "Clean Minimalist Tee",
      descriptionHtml: "",
      handle: "clean-minimalist-tee",
    },
    seoInput: {
      title: "Clean Minimalist Tee",
      description: "",
      handle: "empty-desc-tee",
      niche: "Apparel",
      images: [],
    },
    seoOutput: {
      productTitle: "Optimized Clean Minimalist Tee",
      productDescription: "<p>Generated 500 words description</p>",
      productSeoTitle: "Optimized Clean Minimalist Tee",
      productSeoDescription: "Shop the cleanest tee online.",
      productHandle: "optimized-clean-minimalist-tee",
      images: [],
    },
    success: true,
  };

  const vm = adaptAutoSeoItemToViewModel(emptyDescItem);
  assert.ok(vm.originalBackup);
  assert.equal(vm.originalBackup.productDescription, "");
  assert.equal(vm.originalBackup.productTitle, "Clean Minimalist Tee");
});

test("adaptAutoSeoItemToViewModel: extracts sourceSeoTitle and sourceSeoDescription if present", () => {
  const itemWithSourceSeo: AutoSeoItemResult = {
    productId: "gid://shopify/Product/888",
    handle: "hat-vintage",
    sourceProduct: {
      productId: "gid://shopify/Product/888",
      title: "Vintage Hat",
      descriptionHtml: "<p>Cool hat</p>",
      handle: "hat-vintage",
      sourceSeoTitle: "Source SEO Title",
      sourceSeoDescription: "Source SEO Desc",
    },
    seoInput: {
      title: "Vintage Hat",
      description: "Cool hat",
      handle: "hat-vintage",
      niche: "Accessories",
      images: [],
    },
    success: true,
  };

  const vm = adaptAutoSeoItemToViewModel(itemWithSourceSeo);
  assert.ok(vm.originalBackup);
  assert.equal(vm.originalBackup.seoTitle, "Source SEO Title");
  assert.equal(vm.originalBackup.seoDescription, "Source SEO Desc");
});

test("adaptPinterestPodItemToViewModel: preserves completed POD output and source provenance", () => {
  const item: PinterestPodSeoItemResult = {
    designId: "design_pod_456",
    productType: "blanket",
    sourceItem: {
      designId: "design_pod_456",
      sourceCandidateId: "cand_456",
      productType: "blanket",
      originalPinTitle: "Cozy Aesthetic Cloud Fleece Blanket",
      trendKeywords: ["cloud aesthetic", "cozy home"],
      cutoutProduct: {
        transparentUrl: "https://example.com/cloud-blanket.png",
        whiteBgUrl: "https://example.com/cloud-blanket-whitebg.jpg",
      },
      composedMockups: [],
      printMaster: {
        rgbUrl: "https://example.com/cloud-blanket-4k.png",
        cmykUrl: "https://example.com/cloud-blanket-300dpi.tiff",
        widthPx: 6000,
        heightPx: 8000,
        dpi: 300,
      },
    },
    seoInput: {
      title: "Cozy Aesthetic Cloud Fleece Blanket",
      description: "Rich description with scene details",
      niche: "cloud aesthetic",
      handle: "cozy-aesthetic-cloud-fleece-blanket",
      images: [],
    },
    seoOutput: {
      productTitle: "Cozy Aesthetic Cloud Fleece Blanket | Premium Ultra-Soft Throw",
      productDescription: "<p>Wrap yourself in ethereal warmth.</p>",
      productSeoTitle: "Cozy Cloud Fleece Blanket",
      productSeoDescription: "Shop the cloud aesthetic fleece blanket today.",
      productHandle: "cozy-aesthetic-cloud-fleece-blanket",
      images: [],
    },
    success: true,
  };

  const viewModel = adaptPinterestPodItemToViewModel(item);
  assert.equal(viewModel.id, "design_pod_456");
  assert.equal(viewModel.productTitle.value, item.seoOutput?.productTitle);
  assert.equal(viewModel.seoStatus.value, "completed");
  assert.equal(viewModel.sourcePinterestItem?.designId, "design_pod_456");
});

test("adaptPinterestPodItemToViewModel: records a failed POD handoff", () => {
  const item: PinterestPodSeoItemResult = {
    designId: "design_pod_err",
    productType: "rug",
    sourceItem: {
      designId: "design_pod_err",
      sourceCandidateId: "cand_err",
      productType: "rug",
      originalPinTitle: "Broken Rug Item",
      trendKeywords: ["rug"],
      cutoutProduct: { transparentUrl: "", whiteBgUrl: "" },
      composedMockups: [],
      printMaster: { rgbUrl: "", cmykUrl: "", widthPx: 0, heightPx: 0, dpi: 300 },
    },
    seoInput: {
      title: "Broken Rug Item",
      description: "",
      niche: "rug",
      handle: "broken-rug-item",
      images: [],
    },
    success: false,
    error: "AI model rate limit exceeded",
  };

  const viewModel = adaptPinterestPodItemToViewModel(item);
  assert.equal(viewModel.seoStatus.value, "failed");
  assert.equal(viewModel.rejectionReason, "AI model rate limit exceeded");
  assert.equal(viewModel.sourcePinterestItem?.designId, "design_pod_err");
});

