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
  getDisplayValue,
  getInitialSampleViewModels,
} from "../seo-content-ui-adapter";

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

test("adaptPinterestPodItemToViewModel: successfully adapts completed PinterestPodSeoItemResult with provenance and sourcePinterestItem", () => {
  const successPodItem: PinterestPodSeoItemResult = {
    designId: "design_pod_456",
    productType: "blanket",
    sourceItem: {
      designId: "design_pod_456",
      sourceCandidateId: "cand_456",
      productType: "blanket",
      originalPinTitle: "Cozy Aesthetic Cloud Fleece Blanket",
      trendKeywords: ["cloud aesthetic", "cozy home", "pastel bedroom"],
      cutoutProduct: {
        transparentUrl: "https://example.com/cloud-blanket.png",
        whiteBgUrl: "https://example.com/cloud-blanket-whitebg.jpg",
      },
      composedMockups: [
        {
          referenceImageId: "ref_bedroom",
          mockupUrl: "https://example.com/bedroom-mockup.jpg",
          detectedSceneType: "bedroom",
          detectedSceneDescription: "aesthetic cozy bedroom setting",
        },
      ],
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
      images: [
        {
          url: "https://example.com/cloud-blanket-whitebg.jpg",
          alt: "Cozy Aesthetic Cloud Fleece Blanket - White Background Product View",
        },
        {
          url: "https://example.com/bedroom-mockup.jpg",
          alt: "Cozy Aesthetic Cloud Fleece Blanket in bedroom setting (Mockup 1)",
        },
      ],
    },
    seoOutput: {
      productTitle: "Cozy Aesthetic Cloud Fleece Blanket | Premium Ultra-Soft Throw",
      productDescription: "<p>Wrap yourself in ethereal warmth with this ultra-soft cloud fleece blanket.</p>",
      productSeoTitle: "Cozy Cloud Fleece Blanket - Ultra-Soft Aesthetic Throw",
      productSeoDescription: "Shop the viral cloud aesthetic fleece blanket today. Super plush, high-res print, machine washable.",
      productHandle: "cozy-aesthetic-cloud-fleece-blanket",
      images: [
        {
          sourceUrl: "https://example.com/cloud-blanket-whitebg.jpg",
          alt: "Cozy Cloud Fleece Blanket featured white background",
          webp: {
            filename: "cozy-cloud-blanket-1.webp",
            url: "https://cdn.example.com/cozy-cloud-blanket-1.webp",
          },
        },
        {
          sourceUrl: "https://example.com/bedroom-mockup.jpg",
          alt: "Cozy Cloud Fleece Blanket on modern bed",
          webp: {
            filename: "cozy-cloud-blanket-2.webp",
            url: "https://cdn.example.com/cozy-cloud-blanket-2.webp",
          },
        },
      ],
    },
    success: true,
  };

  const vm = adaptPinterestPodItemToViewModel(successPodItem);
  assert.equal(vm.id, "design_pod_456");
  assert.equal(vm.productId, "design_pod_456");
  assert.equal(vm.sourceNiche, "cloud aesthetic");
  assert.equal(vm.productTitle.value, "Cozy Aesthetic Cloud Fleece Blanket | Premium Ultra-Soft Throw");
  assert.equal(vm.productTitle.source, "real");
  assert.equal(vm.seoStatus.value, "completed");
  assert.equal(vm.seoStatus.source, "real");
  assert.equal(vm.images.length, 2);
  assert.equal(vm.images[0].previewUrl.value, "https://example.com/cloud-blanket-whitebg.jpg");
  assert.equal(vm.sourcePinterestItem?.designId, "design_pod_456");
  assert.equal(vm.sourcePinterestItem?.productType, "blanket");
});

test("adaptPinterestPodItemToViewModel: handles failed PinterestPodSeoItemResult and records rejectionReason", () => {
  const failedPodItem: PinterestPodSeoItemResult = {
    designId: "design_pod_err",
    productType: "rug",
    sourceItem: {
      designId: "design_pod_err",
      sourceCandidateId: "cand_err",
      productType: "rug",
      originalPinTitle: "Broken Rug Item",
      trendKeywords: ["rug"],
      cutoutProduct: {
        transparentUrl: "",
        whiteBgUrl: "",
      },
      composedMockups: [],
      printMaster: {
        rgbUrl: "",
        cmykUrl: "",
        widthPx: 0,
        heightPx: 0,
        dpi: 300,
      },
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

  const vm = adaptPinterestPodItemToViewModel(failedPodItem);
  assert.equal(vm.id, "design_pod_err");
  assert.equal(vm.productId, "design_pod_err");
  assert.equal(vm.seoStatus.value, "failed");
  assert.equal(vm.rejectionReason, "AI model rate limit exceeded");
  assert.equal(vm.sourcePinterestItem?.designId, "design_pod_err");
});

