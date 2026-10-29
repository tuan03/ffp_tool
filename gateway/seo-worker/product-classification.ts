import { z } from "zod";
import { SeoWorkerError } from "./protocol";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

export interface ClassificationCatalog {
  readonly collections: readonly { readonly id: string; readonly title: string; readonly description: string; readonly assignment?: CollectionAssignment }[];
  readonly productTypes: readonly string[];
}

export interface TaxonomyCategoryCandidate {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly isLeaf: boolean;
}

export interface SeoTagProfile {
  readonly product: string;
  readonly theme: string;
  readonly audience: string;
  readonly occasion: string;
  readonly isPersonalized: boolean;
}

type CollectionAssignment = { readonly mode: "manual" } | { readonly mode: "tags"; readonly tags: readonly string[] }
  | { readonly mode: "unsupported"; readonly reason: string };

// Derive writes from Shopify rules, never from model-generated tags or category names.
function collectionAssignment(ruleSet: unknown): CollectionAssignment {
  if (ruleSet === null) return { mode: "manual" };
  const parsed = z.object({ appliedDisjunctively: z.boolean(), rules: z.array(z.object({
    column: z.literal("TAG"), relation: z.literal("EQUALS"), condition: z.string().trim().min(1).max(255),
  })).min(1).max(250) }).safeParse(ruleSet);
  if (!parsed.success || parsed.data.rules.some(rule => rule.condition.includes(","))
      || (parsed.data.appliedDisjunctively && parsed.data.rules.length > 1)) {
    return { mode: "unsupported", reason: "Collection rules cannot be safely fulfilled by adding exact tags only. Operator configuration is required." };
  }
  return { mode: "tags", tags: [...new Set(parsed.data.rules.map(rule => rule.condition))] };
}

export interface ProductClassification {
  readonly status: "ready" | "needs_review";
  readonly collectionId?: string;
  readonly productType?: string;
  readonly taxonomyCategoryId?: string;
  readonly reason: string;
  readonly seoTagProfile?: SeoTagProfile;
  /** Server-derived from the structured four-layer profile; never accepted from the model. */
  readonly derivedSeoTags?: readonly string[];
  /** Server-derived from current Shopify rules; never accepted from the model. */
  readonly collectionTags?: readonly string[];
  readonly evidence?: {
    readonly imageIds: readonly string[];
    readonly visualTheme: string;
    readonly collectionTheme: string;
    readonly alternatives: readonly { readonly collectionId: string; readonly whyNotChosen: string }[];
  };
}

const seoTagProfile = z.object({
  product: z.string().trim().min(1).max(80), theme: z.string().trim().min(1).max(80),
  audience: z.string().trim().min(1).max(80), occasion: z.string().trim().min(1).max(80),
  isPersonalized: z.boolean(),
}).strict();

function seoTagSlug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
}

function deriveSeoTags(profile: SeoTagProfile): readonly string[] {
  const layers = [["product", profile.product], ["theme", profile.theme], ["audience", profile.audience], ["occasion", profile.occasion]] as const;
  const tags = layers.map(([layer, value]) => {
    const slug = seoTagSlug(value);
    if (!slug) throw new SeoWorkerError("CLASSIFICATION_SEO_TAGS_INVALID");
    return `seo:${layer}:${slug}`;
  });
  return profile.isPersonalized ? [...tags, "personalized"] : tags;
}

const classificationEvidence = z.object({
  imageIds: z.array(z.string().min(1)).min(1), visualTheme: z.string().trim().min(1).max(1000),
  collectionTheme: z.string().trim().min(1).max(1000),
  alternatives: z.array(z.object({ collectionId: z.string().min(1), whyNotChosen: z.string().trim().min(1).max(1000) }).strict()).max(3),
}).strict();

export function buildClassificationSyncFields(input: {
  readonly classification?: ProductClassification;
  readonly collectionIds: readonly string[];
  readonly tags: readonly string[];
}): { readonly collectionsToJoin: string[]; readonly tags: string[]; readonly category?: string } {
  if (input.classification && input.classification.status !== "ready") throw new SeoWorkerError("CLASSIFICATION_UNRESOLVED");
  return {
    collectionsToJoin: input.classification?.collectionTags ? [] : [...input.collectionIds],
    tags: [...new Set([...input.tags, ...(input.classification?.collectionTags ?? []), ...(input.classification?.derivedSeoTags ?? [])])],
    category: input.classification?.taxonomyCategoryId,
  };
}

// Worker submissions must be repaired before they can count as completed SEO.
// Legacy Review reads retain the tolerant validator below.
export function requireProductClassification(value: unknown, catalog: ClassificationCatalog, options: {
  readonly imageIds?: readonly string[];
  readonly requireProductType?: boolean;
  readonly fixedProductType?: string;
  readonly requireTaxonomyCategory?: boolean;
  readonly taxonomyCategory?: TaxonomyCategoryCandidate | null;
  readonly customizerAuditStatus?: "verified_static" | "verified_custom" | "error";
} = {}): ProductClassification {
  if (value == null) throw new SeoWorkerError("CLASSIFICATION_REQUIRED");
  const parsed = z.object({ status: z.enum(["ready", "needs_review"]), collectionId: z.string().optional(),
    productType: z.string().trim().min(1).max(255).optional(), taxonomyCategoryId: z.string().trim().min(1).max(255).optional(),
    reason: z.string().trim().min(1).max(1000), seoTagProfile, evidence: classificationEvidence.optional() }).strict().safeParse(value);
  if (!parsed.success) throw new SeoWorkerError("CLASSIFICATION_INVALID");
  if (!catalog.collections.length) throw new SeoWorkerError("CLASSIFICATION_CATALOG_UNAVAILABLE");
  if (parsed.data.status !== "ready") throw new SeoWorkerError("CLASSIFICATION_UNRESOLVED");
  if (options.fixedProductType && parsed.data.productType && parsed.data.productType.toLowerCase() !== options.fixedProductType.toLowerCase()) {
    throw new SeoWorkerError("CLASSIFICATION_PRODUCT_TYPE_FIXED");
  }
  if (options.requireProductType !== false && !parsed.data.productType && !options.fixedProductType) {
    throw new SeoWorkerError("CLASSIFICATION_PRODUCT_TYPE_REQUIRED");
  }
  if (options.requireTaxonomyCategory) {
    if (!parsed.data.taxonomyCategoryId || !options.taxonomyCategory || !options.taxonomyCategory.isLeaf
        || parsed.data.taxonomyCategoryId !== options.taxonomyCategory.id) {
      throw new SeoWorkerError("CLASSIFICATION_TAXONOMY_INVALID");
    }
  }
  if ((options.customizerAuditStatus === "verified_custom" && !parsed.data.seoTagProfile.isPersonalized)
      || (options.customizerAuditStatus !== "verified_custom" && parsed.data.seoTagProfile.isPersonalized)) {
    throw new SeoWorkerError("CLASSIFICATION_PERSONALIZATION_CONFLICT");
  }
  const selected = catalog.collections.find(collection => collection.id === parsed.data.collectionId);
  if (!selected) {
    throw new SeoWorkerError("CLASSIFICATION_COLLECTION_INVALID");
  }
  if (selected.assignment?.mode === "unsupported") throw new SeoWorkerError("CLASSIFICATION_RULES_UNSUPPORTED");
  if (options.imageIds) {
    const evidence = parsed.data.evidence;
    if (!evidence || evidence.imageIds.some(id => !options.imageIds?.includes(id))
        || (catalog.collections.length > 1 && evidence.alternatives.length === 0)
        || evidence.alternatives.some(alternative => alternative.collectionId === selected.id
          || !catalog.collections.some(collection => collection.id === alternative.collectionId))) {
      throw new SeoWorkerError("CLASSIFICATION_EVIDENCE_REQUIRED");
    }
  }
  const validated = validateProductClassification({ ...parsed.data,
    ...(options.fixedProductType ? { productType: options.fixedProductType } : {}) }, catalog);
  return { ...validated, derivedSeoTags: deriveSeoTags(parsed.data.seoTagProfile) };
}

export function requiresProductClassification(job: GptSeoJob): boolean {
  return job.execution.source === "amazon" && z.object({ crawlerClassificationMode: z.literal("automatic") })
    .safeParse(job.execution.originalSnapshot).success;
}

export function validateProductClassification(value: unknown, catalog: ClassificationCatalog): ProductClassification {
  const parsed = z.object({ status: z.enum(["ready", "needs_review"]), collectionId: z.string().optional(),
    productType: z.string().trim().min(1).max(255).optional(), taxonomyCategoryId: z.string().trim().min(1).max(255).optional(),
    reason: z.string().trim().min(1).max(1000), seoTagProfile: seoTagProfile.optional(),
    derivedSeoTags: z.array(z.string()).optional(), evidence: classificationEvidence.optional() }).safeParse(value);
  if (!parsed.success) return { status: "needs_review", reason: "Cần chọn collection và loại sản phẩm." };
  const candidate = parsed.data;
  const name = candidate.productType?.normalize("NFKC").replace(/\s+/g, " ").trim();
  const productType = catalog.productTypes.find(type => type.normalize("NFKC").trim().toLowerCase() === name?.toLowerCase()) ?? name;
  const selected = catalog.collections.find(collection => collection.id === candidate.collectionId);
  if (candidate.status !== "ready" || !productType || !selected) {
    return { status: "needs_review", productType, reason: "Cần chọn collection hợp lệ và loại sản phẩm trước khi sync." };
  }
  if (selected.assignment?.mode === "unsupported") return { status: "needs_review", productType, reason: selected.assignment.reason };
  return { ...candidate, status: "ready", productType,
    ...(selected.assignment?.mode === "tags" ? { collectionTags: selected.assignment.tags } : {}) };
}

const taxonomyCategorySchema = z.object({ id: z.string().min(1), name: z.string().min(1), fullName: z.string().min(1), isLeaf: z.boolean() });

export function createTaxonomyCategoryService(client: Pick<ShopifyGraphqlClient, "query">,
  resolveStore: (storeId: string) => StoreConfig | undefined): {
    readonly search: (storeId: string, search: string) => Promise<readonly TaxonomyCategoryCandidate[]>;
    readonly resolve: (storeId: string, categoryId: string) => Promise<TaxonomyCategoryCandidate | null>;
  } {
  function storeFor(storeId: string): StoreConfig {
    const store = resolveStore(storeId);
    if (!store) throw new Error("CLASSIFICATION_STORE_REQUIRED");
    return store;
  }
  return {
    async search(storeId, search) {
      const cleanSearch = search.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (!cleanSearch || cleanSearch.length > 120) throw new SeoWorkerError("CLASSIFICATION_TAXONOMY_QUERY_INVALID");
      const response = await client.query<{ taxonomy: { categories: { nodes: unknown[] } } }>(storeFor(storeId),
        "query SearchTaxonomyCategories($search:String!,$first:Int!){ taxonomy { categories(first:$first,search:$search){ nodes { id name fullName isLeaf } } } }",
        { search: cleanSearch, first: 20 });
      return response.taxonomy.categories.nodes.map(node => taxonomyCategorySchema.parse(node)).filter(category => category.isLeaf);
    },
    async resolve(storeId, categoryId) {
      const response = await client.query<{ node: unknown }>(storeFor(storeId),
        "query ReadTaxonomyCategory($id:ID!){ node(id:$id){ ... on TaxonomyCategory { id name fullName isLeaf } } }", { id: categoryId });
      const parsed = taxonomyCategorySchema.safeParse(response.node);
      return parsed.success ? parsed.data : null;
    },
  };
}

export async function validateLiveProductClassification({ client, store, candidate, catalog, taxonomyCategory }: {
  readonly client: Pick<ShopifyGraphqlClient, "query">;
  readonly store: StoreConfig;
  readonly candidate: unknown;
  readonly catalog: ClassificationCatalog;
  readonly taxonomyCategory?: TaxonomyCategoryCandidate | null;
}): Promise<ProductClassification> {
  const classification = validateProductClassification(candidate, catalog);
  if (classification.status !== "ready") return classification;
  if (classification.taxonomyCategoryId && (!taxonomyCategory || !taxonomyCategory.isLeaf
      || taxonomyCategory.id !== classification.taxonomyCategoryId)) {
    return { status: "needs_review", productType: classification.productType,
      reason: "Shopify Taxonomy Category đã đổi hoặc không còn là category lá. Chọn lại trước khi sync." };
  }
  const live = await client.query<{ collection: { id: string; ruleSet: unknown } | null }>(store,
    "query ClassificationBeforeSync($id:ID!){ collection(id:$id){ id ruleSet { appliedDisjunctively rules { column relation condition } } } }", { id: classification.collectionId });
  if (!live.collection || live.collection.id !== classification.collectionId) {
    return { status: "needs_review", productType: classification.productType,
      reason: "Collection đã bị xóa hoặc không thể gán trực tiếp. Chọn lại tại Review." };
  }
  const assignment = collectionAssignment(live.collection.ruleSet);
  if (assignment.mode === "unsupported") return { status: "needs_review", productType: classification.productType, reason: assignment.reason };
  const { collectionTags: _previousTags, ...validated } = classification;
  return { ...validated, ...(assignment.mode === "tags" ? { collectionTags: assignment.tags } : {}) };
}

// Cache only complete catalogs, scoped to the connection, with concurrent reads coalesced.
export function createClassificationCatalogLoader(client: Pick<ShopifyGraphqlClient, "query">,
  resolveStore: (storeId: string) => StoreConfig | undefined): (storeId: string) => Promise<ClassificationCatalog> {
  const cache = new Map<string, { expiresAt: number; pending: Promise<ClassificationCatalog> }>();
  return async storeId => {
    const store = resolveStore(storeId);
    if (!store) throw new Error("CLASSIFICATION_STORE_REQUIRED");
    const key = `${store.storeId}:${store.shopDomain}`;
    const existing = cache.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.pending;
    const pending = (async () => {
      const collections: ClassificationCatalog["collections"][number][] = [];
      const productTypes = new Set<string>(store.productTypes ?? []);
      for (const kind of ["collections", "productTypes"] as const) {
        let cursor: string | null = null;
        const seen = new Set<string>();
        do {
          const document = kind === "collections"
            ? "query ClassificationCollections($after:String){ collections(first:250,after:$after){ edges { node { id title description ruleSet { appliedDisjunctively rules { column relation condition } } } } pageInfo { hasNextPage endCursor } } }"
            : "query ClassificationProductTypes($after:String){ productTypes(first:250,after:$after){ edges { node } pageInfo { hasNextPage endCursor } } }";
          const response: Record<string, { edges: { node: unknown }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> = await client.query(store, document, { after: cursor });
          const page = response[kind];
          if (!page || !Array.isArray(page.edges)) throw new Error("CLASSIFICATION_CATALOG_UNAVAILABLE");
          for (const edge of page.edges) {
            if (kind === "productTypes") {
              if (typeof edge.node === "string" && edge.node.trim()) productTypes.add(edge.node.trim());
            } else {
              const node = z.object({ id: z.string(), title: z.string(), description: z.string(), ruleSet: z.unknown() }).parse(edge.node);
              collections.push({ id: node.id, title: node.title, description: node.description.slice(0, 1000), assignment: collectionAssignment(node.ruleSet) });
            }
          }
          cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
          if (page.pageInfo.hasNextPage && (!cursor || seen.has(cursor))) throw new Error("CLASSIFICATION_CATALOG_PAGINATION_FAILED");
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      return { collections, productTypes: [...productTypes] };
    })();
    cache.set(key, { expiresAt: Date.now() + 60_000, pending });
    try { return await pending; } catch (error) { cache.delete(key); throw error; }
  };
}
