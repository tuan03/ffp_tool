import assert from "node:assert/strict";
import test from "node:test";

import { buildClassificationSyncFields, createClassificationCatalogLoader, createTaxonomyCategoryService, requireProductClassification, validateLiveProductClassification, validateProductClassification } from "../seo-worker/product-classification";
import type { StoreConfig } from "../types";

const catalog = { collections: [{ id: "gid://shopify/Collection/1", title: "Cats", description: "Cat designs" }], productTypes: ["Handbag"] };

test("classification accepts one store collection and canonicalizes existing product types", () => {
  const result = validateProductClassification({ status: "ready", collectionId: catalog.collections[0].id, productType: " handbag  ", reason: "Visible cat handbag" }, catalog);
  assert.equal(result.status, "ready");
  assert.equal(result.productType, "Handbag");
});

test("classification permits new types but rejects absent or cross-store collections", () => {
  assert.equal(validateProductClassification({ status: "ready", collectionId: catalog.collections[0].id, productType: "Wallet", reason: "Visible wallet" }, catalog).productType, "Wallet");
  assert.equal(validateProductClassification({ status: "ready", collectionId: "gid://shopify/Collection/99", productType: "Wallet", reason: "Wrong store" }, catalog).status, "needs_review");
  assert.equal(validateProductClassification(undefined, catalog).status, "needs_review");
});

test("catalog reads all pages and includes safe tag collections without store-specific rules", async () => {
  const calls: string[] = [];
  const loader = createClassificationCatalogLoader({ query: async <T>(store: StoreConfig, document: string, variables?: Record<string, unknown>): Promise<T> => {
    const kind = document.includes("ClassificationCollections") ? "collections" : "productTypes";
    assert.doesNotMatch(document, /collection_type:custom/);
    calls.push(`${store.storeId}:${kind}:${variables?.after ?? "first"}`);
    const second = Boolean(variables?.after);
    const response = kind === "collections" ? { collections: {
      edges: [{ node: { id: `gid://shopify/Collection/${store.storeId}-${second ? 2 : 1}`, title: "Cats", description: "Cats", ruleSet: null } },
        { node: { id: `smart-${second}`, title: "Water garden", description: "", ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: "water-garden" }] } } }],
      pageInfo: { hasNextPage: !second, endCursor: "second" },
    } } : { productTypes: { edges: [{ node: second ? "Wallet" : "Handbag" }], pageInfo: { hasNextPage: !second, endCursor: "second" } } };
    return response as T;
  } }, id => ({ storeId: id, shopDomain: `${id}.myshopify.com` } as StoreConfig));
  const [first, concurrent] = await Promise.all([loader("one"), loader("one")]);
  assert.deepEqual(first, concurrent);
  assert.equal(first.collections.length, 4);
  assert.deepEqual(first.collections[1].assignment, { mode: "tags", tags: ["water-garden"] });
  assert.deepEqual(first.productTypes, ["Handbag", "Wallet"]);
  assert.equal(calls.length, 4);
  await loader("one");
  assert.equal(calls.length, 4);
  const second = await loader("two");
  assert.equal(calls.length, 8);
  assert.notEqual(second.collections[0].id, first.collections[0].id);
});

test("catalog failures are not cached as an empty successful catalog", async () => {
  let calls = 0;
  const loader = createClassificationCatalogLoader({ query: async () => { calls += 1; throw new Error("offline"); } },
    id => ({ storeId: id, shopDomain: `${id}.myshopify.com` } as StoreConfig));
  await assert.rejects(loader("one"), /offline/);
  await assert.rejects(loader("one"), /offline/);
  assert.equal(calls, 2);
});

test("live pre-write check rejects deleted or newly automated collections despite a cached selection", async () => {
  const id = catalog.collections[0].id;
  for (const collection of [null, { id, ruleSet: {} }, { id: "wrong-store", ruleSet: null }, { id, ruleSet: null }]) {
    const result = await validateLiveProductClassification({ catalog,
      candidate: { status: "ready", collectionId: id, productType: "Handbag", reason: "Viewed image" },
      store: { storeId: "one", shopDomain: "one.myshopify.com" } as StoreConfig,
      client: { query: async <T>(store: StoreConfig, _document: string, variables?: Record<string, unknown>): Promise<T> => {
        assert.equal(store.storeId, "one"); assert.equal(variables?.id, id);
        return { collection } as T;
      } },
    });
    assert.equal(result.status, collection?.id === id && collection.ruleSet === null ? "ready" : "needs_review");
  }
});

test("safe tag collection uses fresh Shopify rules and ignores stale model tag values", async () => {
  const id = catalog.collections[0].id;
  const result = await validateLiveProductClassification({ catalog,
    candidate: { status: "ready", collectionId: id, productType: "Rug", reason: "Viewed aquatic theme", collectionTags: ["stale"] },
    store: { storeId: "two", shopDomain: "two.myshopify.com" } as StoreConfig,
    client: { query: async <T>(): Promise<T> => ({ collection: { id, ruleSet: { appliedDisjunctively: false,
      rules: [{ column: "TAG", relation: "EQUALS", condition: "aquatic-design" }, { column: "TAG", relation: "EQUALS", condition: "floor-coverings" }] } } }) as T },
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.collectionTags, ["aquatic-design", "floor-coverings"]);
});

test("complex rules are blocked instead of changing price or inventing membership", async () => {
  for (const ruleSet of [
    { appliedDisjunctively: false, rules: [{ column: "VARIANT_PRICE", relation: "GREATER_THAN", condition: "100" }] },
    { appliedDisjunctively: true, rules: [{ column: "TAG", relation: "EQUALS", condition: "a" }, { column: "TAG", relation: "EQUALS", condition: "b" }] },
    { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "NOT_EQUALS", condition: "a" }] },
  ]) {
    const result = await validateLiveProductClassification({ catalog,
      candidate: { status: "ready", collectionId: catalog.collections[0].id, productType: "Rug", reason: "Viewed image" },
      store: { storeId: "two", shopDomain: "two.myshopify.com" } as StoreConfig,
      client: { query: async <T>(): Promise<T> => ({ collection: { id: catalog.collections[0].id, ruleSet } }) as T },
    });
    assert.equal(result.status, "needs_review");
    assert.equal(result.collectionTags, undefined);
  }
});

test("automatic classification requires image evidence and comparison, not just an available ID", () => {
  const twoCollections = { ...catalog, collections: [...catalog.collections, { id: "other", title: "Seasonal", description: "Seasonal theme" }] };
  const candidate = { status: "ready", collectionId: catalog.collections[0].id, productType: "Handbag", reason: "Visible cat",
    seoTagProfile: { product: "Handbag", theme: "Cat", audience: "Cat Lovers", occasion: "Birthday", isPersonalized: false } };
  const options = { imageIds: ["image-1"] };
  assert.throws(() => requireProductClassification(candidate, twoCollections, options), /EVIDENCE_REQUIRED/);
  const evidence = { imageIds: ["image-1"], visualTheme: "Cat portrait", collectionTheme: "Cat designs", alternatives: [{ collectionId: "other", whyNotChosen: "No seasonal motifs visible" }] };
  assert.equal(requireProductClassification({ ...candidate, evidence }, twoCollections, options).status, "ready");
  assert.throws(() => requireProductClassification({ ...candidate, evidence: { ...evidence, imageIds: ["invented"] } }, twoCollections, options), /EVIDENCE_REQUIRED/);
  assert.throws(() => requireProductClassification({ ...candidate, evidence: { ...evidence, alternatives: [] } }, twoCollections, options), /EVIDENCE_REQUIRED/);
});

test("sync projection preserves base tags and never directly joins a tag-based collection", () => {
  const classification = { status: "ready" as const, collectionId: "smart", productType: "Rug", reason: "Matched", collectionTags: ["aquatic", "floor"],
    derivedSeoTags: ["seo:product:rug", "seo:theme:ocean", "seo:audience:adults", "seo:occasion:housewarming", "personalized"] };
  assert.deepEqual(buildClassificationSyncFields({ classification, collectionIds: ["smart"], tags: ["customizer", "aquatic"] }),
    { collectionsToJoin: [], tags: ["customizer", "aquatic", "floor", "seo:product:rug", "seo:theme:ocean", "seo:audience:adults", "seo:occasion:housewarming", "personalized"],
      category: undefined });
  assert.deepEqual(buildClassificationSyncFields({ collectionIds: ["legacy"], tags: ["customizer"] }),
    { collectionsToJoin: ["legacy"], tags: ["customizer"], category: undefined });
  assert.throws(() => buildClassificationSyncFields({ classification: { status: "needs_review", reason: "No match" }, collectionIds: [], tags: [] }), /CLASSIFICATION_UNRESOLVED/);
});

test("non-Jeminise classification requires a live leaf taxonomy category and derives four SEO layers", () => {
  const candidate = {
    status: "ready", collectionId: catalog.collections[0].id, productType: "Rug",
    taxonomyCategoryId: "gid://shopify/TaxonomyCategory/hg-3-2", reason: "Viewed cat rug",
    seoTagProfile: { product: "Area Rug", theme: "Cat Portrait", audience: "Cat Lovers", occasion: "Housewarming", isPersonalized: true },
    evidence: { imageIds: ["front"], visualTheme: "Cat portrait", collectionTheme: "Cat designs", alternatives: [] },
  };
  const resolved = requireProductClassification(candidate, catalog, {
    imageIds: ["front"], requireProductType: true, requireTaxonomyCategory: true,
    taxonomyCategory: { id: candidate.taxonomyCategoryId, name: "Rugs", fullName: "Home & Garden > Decor > Rugs", isLeaf: true },
    customizerAuditStatus: "verified_custom",
  });
  assert.equal(resolved.taxonomyCategoryId, candidate.taxonomyCategoryId);
  assert.deepEqual(resolved.derivedSeoTags, [
    "seo:product:area-rug", "seo:theme:cat-portrait", "seo:audience:cat-lovers", "seo:occasion:housewarming", "personalized",
  ]);
  assert.throws(() => requireProductClassification({ ...candidate, taxonomyCategoryId: "invented" }, catalog, {
    imageIds: ["front"], requireProductType: true, requireTaxonomyCategory: true,
    taxonomyCategory: { id: candidate.taxonomyCategoryId, name: "Rugs", fullName: "Home & Garden > Decor > Rugs", isLeaf: true },
    customizerAuditStatus: "verified_custom",
  }), /CLASSIFICATION_TAXONOMY_INVALID/);
  assert.throws(() => requireProductClassification(candidate, catalog, {
    imageIds: ["front"], requireProductType: true, requireTaxonomyCategory: true,
    taxonomyCategory: { id: candidate.taxonomyCategoryId, name: "Decor", fullName: "Home & Garden > Decor", isLeaf: false },
    customizerAuditStatus: "verified_custom",
  }), /CLASSIFICATION_TAXONOMY_INVALID/);
});

test("personalized SEO tag must agree with the customizer audit", () => {
  const candidate = { status: "ready", collectionId: catalog.collections[0].id, productType: "Handbag", reason: "Viewed handbag",
    seoTagProfile: { product: "Handbag", theme: "Floral", audience: "Women", occasion: "Birthday", isPersonalized: true } };
  assert.throws(() => requireProductClassification(candidate, catalog), /CLASSIFICATION_PERSONALIZATION_CONFLICT/);
  assert.throws(() => requireProductClassification(candidate, catalog, { customizerAuditStatus: "verified_static" }), /CLASSIFICATION_PERSONALIZATION_CONFLICT/);
  assert.throws(() => requireProductClassification({ ...candidate, seoTagProfile: { ...candidate.seoTagProfile, isPersonalized: false } }, catalog,
    { customizerAuditStatus: "verified_custom" }), /CLASSIFICATION_PERSONALIZATION_CONFLICT/);
});

test("taxonomy service searches leaf candidates and resolves an exact category ID", async () => {
  const documents: string[] = [];
  const service = createTaxonomyCategoryService({ query: async <T>(_store: StoreConfig, document: string, variables?: Record<string, unknown>): Promise<T> => {
    documents.push(document);
    if (document.includes("SearchTaxonomyCategories")) {
      assert.deepEqual(variables, { search: "area rug", first: 20 });
      return { taxonomy: { categories: { nodes: [
        { id: "parent", name: "Decor", fullName: "Home & Garden > Decor", isLeaf: false },
        { id: "leaf", name: "Rugs", fullName: "Home & Garden > Decor > Rugs", isLeaf: true },
      ] } } } as T;
    }
    assert.deepEqual(variables, { id: "leaf" });
    return { node: { id: "leaf", name: "Rugs", fullName: "Home & Garden > Decor > Rugs", isLeaf: true } } as T;
  } }, id => ({ storeId: id, shopDomain: `${id}.myshopify.com` } as StoreConfig));
  assert.deepEqual(await service.search("one", " area rug "), [
    { id: "leaf", name: "Rugs", fullName: "Home & Garden > Decor > Rugs", isLeaf: true },
  ]);
  assert.equal((await service.resolve("one", "leaf"))?.id, "leaf");
  assert.equal(documents.length, 2);
});
