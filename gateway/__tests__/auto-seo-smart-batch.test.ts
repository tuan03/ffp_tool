import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initAutoSeoDbSchema } from "../auto-seo-db";
import {
  calculateAutoSeoInputHash,
  normalizeAutoSeoHashInput,
} from "../auto-seo-input-hash";
import type { AutoSeoProductPayload } from "../seo-content";

function createProduct(
  overrides: Partial<AutoSeoProductPayload> = {},
): AutoSeoProductPayload {
  return {
    id: "gid://shopify/Product/100",
    storeId: "capozen",
    title: "  Personalized Family Rug  ",
    handle: " personalized-family-rug ",
    description: "Family rug",
    descriptionHtml: "<p>Family rug</p>",
    status: "ACTIVE",
    vendor: "FFP",
    productType: "Rug",
    tags: ["family", "gift"],
    onlineStoreUrl: "https://example.com/products/personalized-family-rug",
    featuredImage: {
      id: "featured",
      url: "https://cdn.example.com/featured.jpg",
      altText: "Family rug",
      width: 1200,
      height: 1200,
    },
    images: [
      {
        id: "image-2",
        url: "https://cdn.example.com/back.jpg",
        altText: "Back",
        position: 2,
      },
      {
        id: "image-1",
        url: "https://cdn.example.com/front.jpg",
        altText: "Front",
        position: 1,
      },
    ],
    variants: [
      {
        id: "variant-2",
        title: "Large",
        price: "59.00",
        inventoryQuantity: 4,
      },
      {
        id: "variant-1",
        title: "Small",
        price: "39.00",
        inventoryQuantity: 8,
      },
    ],
    seo: {
      title: "Family Rug",
      description: "A personalized family rug.",
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-09-30T00:00:00Z",
    hasMoreImages: false,
    hasMoreVariants: false,
    ...overrides,
  };
}

test("SEO input hash is stable for equivalent tag, image, and variant ordering", () => {
  const original = createProduct();
  const reordered = createProduct({
    tags: [" gift ", "family", "family"],
    images: [...(original.images ?? [])].reverse(),
    variants: [...(original.variants ?? [])].reverse(),
  });

  assert.equal(calculateAutoSeoInputHash(original), calculateAutoSeoInputHash(reordered));
  assert.deepEqual(normalizeAutoSeoHashInput(original), normalizeAutoSeoHashInput(reordered));
});

test("SEO input hash changes when grounded SEO source content changes", () => {
  const original = createProduct();
  const changedProducts: readonly AutoSeoProductPayload[] = [
    createProduct({ title: "Updated family rug" }),
    createProduct({ descriptionHtml: "<p>Updated description</p>" }),
    createProduct({ seo: { title: "Updated SEO", description: "A personalized family rug." } }),
    createProduct({ vendor: "Updated vendor" }),
    createProduct({ images: [{ id: "image-1", url: "https://cdn.example.com/new.jpg" }] }),
    createProduct({ variants: [{ id: "variant-1", title: "Small", price: "49.00" }] }),
  ];

  for (const changed of changedProducts) {
    assert.notEqual(calculateAutoSeoInputHash(original), calculateAutoSeoInputHash(changed));
  }
});

test("SEO input hash ignores volatile timestamps, store metadata, pagination flags, and inventory", () => {
  const original = createProduct();
  const changedVolatileFields = createProduct({
    storeId: "another-store",
    createdAt: "2026-02-02T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    hasMoreImages: true,
    hasMoreVariants: true,
    variants: [
      { id: "variant-2", title: "Large", price: "59.00", inventoryQuantity: 999 },
      { id: "variant-1", title: "Small", price: "39.00", inventoryQuantity: 0 },
    ],
  });

  assert.equal(
    calculateAutoSeoInputHash(original),
    calculateAutoSeoInputHash(changedVolatileFields),
  );
});

test("auto SEO schema creates the SEO input hash column and lookup index idempotently", () => {
  const db = new DatabaseSync(":memory:");

  initAutoSeoDbSchema(db);
  initAutoSeoDbSchema(db);

  const columns = db.prepare("PRAGMA table_info(auto_seo_product_backups)").all();
  const indexes = db.prepare("PRAGMA index_list(auto_seo_product_backups)").all();
  assert.ok(columns.some((column) => column.name === "seo_input_sha256"));
  assert.ok(indexes.some((index) => index.name === "idx_auto_seo_store_product_input"));
  db.close();
});

test("auto SEO schema migrates a legacy backup table without an SEO input hash", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE auto_seo_product_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_id TEXT NOT NULL UNIQUE,
      workflow_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      shop_domain TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_handle TEXT NOT NULL,
      product_title TEXT NOT NULL,
      shopify_updated_at TEXT,
      snapshot_json TEXT NOT NULL,
      snapshot_sha256 TEXT NOT NULL,
      downstream_status TEXT NOT NULL,
      downstream_http_status INTEGER,
      downstream_error TEXT,
      downstream_sent_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  initAutoSeoDbSchema(db);

  const columns = db.prepare("PRAGMA table_info(auto_seo_product_backups)").all();
  assert.ok(columns.some((column) => column.name === "seo_input_sha256"));
  db.close();
});
