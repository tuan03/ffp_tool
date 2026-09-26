import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductRawJson,
  serializeProductRawJson,
} from "../product-raw-json-helper";
import type { SeoProductUiViewModel } from "../types";

function createTestViewModel(overrides?: Partial<SeoProductUiViewModel>): SeoProductUiViewModel {
  return {
    id: "vm-test-1",
    productId: "gid://shopify/Product/12345",
    asin: "B0TEST001",
    storeId: "store-alpha",
    productTitle: { value: "Organic Cotton Duvet Cover Set", source: "real" },
    productDescription: { value: "<p>Ultra-soft luxury duvet cover.</p>", source: "real" },
    seoTitle: { value: "Organic Cotton Duvet Cover Set | Eco Home", source: "real" },
    seoDescription: { value: "Upgrade your sleep with breathable organic cotton.", source: "real" },
    handle: { value: "organic-cotton-duvet-cover-set", source: "real" },
    images: [
      {
        id: "img-1",
        previewUrl: { value: "https://example.com/img1.jpg", source: "real" },
        alt: { value: "White organic cotton duvet cover on queen bed", source: "real" },
        webpUrl: { value: "https://cdn.example.com/img1.webp", source: "real" },
        webpFilename: { value: "img1.webp", source: "real" },
      },
    ],
    seoStatus: { value: "completed", source: "real" },
    reviewDecision: "pending",
    aeoQuickSummary: {
      value: "This organic cotton duvet cover features 100% certified long-staple cotton with corner ties and zipper closure.",
      source: "real",
    },
    aeoFaq: {
      value: [
        {
          question: "How do I choose the right bedding for year-round use?",
          answer: "Choose breathable long-staple cotton for balanced temperature regulation across seasons.",
        },
      ],
      source: "real",
    },
    aeoJsonLd: {
      value: '{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Duvet"}]}',
      source: "real",
    },
    updatedAt: Date.now(),
    ...overrides,
  };
}

test("buildProductRawJson: formats all fields correctly including isolated aeo_* fields", () => {
  const vm = createTestViewModel();
  const raw = buildProductRawJson(vm);

  assert.equal(raw.productId, "gid://shopify/Product/12345");
  assert.equal(raw.asin, "B0TEST001");
  assert.equal(raw.storeId, "store-alpha");
  assert.equal(raw.reviewStatus, "pending");
  assert.equal(raw.productTitle, "Organic Cotton Duvet Cover Set");
  assert.equal(raw.productDescription, "<p>Ultra-soft luxury duvet cover.</p>");
  assert.equal(raw.productSeoTitle, "Organic Cotton Duvet Cover Set | Eco Home");
  assert.equal(raw.productSeoDescription, "Upgrade your sleep with breathable organic cotton.");
  assert.equal(raw.productHandle, "organic-cotton-duvet-cover-set");

  // Images
  const images = raw.images as readonly Record<string, unknown>[];
  assert.equal(images.length, 1);
  assert.equal(images[0].sourceUrl, "https://example.com/img1.jpg");
  assert.equal(images[0].alt, "White organic cotton duvet cover on queen bed");

  // AEO fields
  assert.equal(
    raw.aeo_quick_summary,
    "This organic cotton duvet cover features 100% certified long-staple cotton with corner ties and zipper closure.",
  );
  assert.deepEqual(raw.aeo_faq, [
    {
      question: "How do I choose the right bedding for year-round use?",
      answer: "Choose breathable long-staple cotton for balanced temperature regulation across seasons.",
    },
  ]);
  assert.equal(
    raw.aeo_json_ld,
    '{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Duvet"}]}',
  );
});

test("buildProductRawJson: includes variants and customization when present", () => {
  const vm = createTestViewModel({
    sourceCrawlProduct: {
      id: "crawl-1",
      parentAsin: "B0TEST001",
      title: "Crawled Product",
      descriptionHtml: "<p>Crawled</p>",
      handle: "crawled-product",
      variants: [
        { id: "var-1", sku: "SKU-QUEEN-WHITE", price: 79.99, options: { Color: "White", Size: "Queen" } },
      ],
      customization: {
        templateId: "custom-duvet-1",
        fields: [{ name: "Monogram", type: "text" }],
      },
    } as unknown as SeoProductUiViewModel["sourceCrawlProduct"],
  });

  const raw = buildProductRawJson(vm);
  assert.ok(Array.isArray(raw.variants));
  assert.equal((raw.variants as readonly Record<string, unknown>[]).length, 1);
  assert.ok(raw.customization);
});

test("buildProductRawJson: provides safe fallbacks when optional fields are empty", () => {
  const vm = createTestViewModel({
    productId: undefined,
    id: "fallback-id-99",
    aeoQuickSummary: undefined,
    aeoFaq: undefined,
    aeoJsonLd: undefined,
  });

  const raw = buildProductRawJson(vm);
  assert.equal(raw.productId, "fallback-id-99");
  assert.equal(raw.aeo_quick_summary, "");
  assert.deepEqual(raw.aeo_faq, []);
  assert.equal(raw.aeo_json_ld, "");
  assert.equal(raw.variants, undefined);
  assert.equal(raw.customization, undefined);
});

test("serializeProductRawJson: returns formatted string matching buildProductRawJson output", () => {
  const vm = createTestViewModel();
  const serialized = serializeProductRawJson(vm);

  assert.equal(typeof serialized, "string");
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed, buildProductRawJson(vm));
  assert.ok(serialized.includes('"aeo_quick_summary"'));
  assert.ok(serialized.includes('"aeo_faq"'));
  assert.ok(serialized.includes('"aeo_json_ld"'));
});
