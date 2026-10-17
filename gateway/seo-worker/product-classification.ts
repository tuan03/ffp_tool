import { z } from "zod";
import { SeoWorkerError } from "./protocol";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

export interface ClassificationCatalog {
  readonly collections: readonly { readonly id: string; readonly title: string; readonly description: string }[];
  readonly productTypes: readonly string[];
}

export interface ProductClassification {
  readonly status: "ready" | "needs_review";
  readonly collectionId?: string;
  readonly productType?: string;
  readonly reason: string;
}

// Worker submissions must be repaired before they can count as completed SEO.
// Legacy Review reads retain the tolerant validator below.
export function requireProductClassification(value: unknown, catalog: ClassificationCatalog): ProductClassification {
  if (value == null) throw new SeoWorkerError("CLASSIFICATION_REQUIRED");
  const parsed = z.object({ status: z.enum(["ready", "needs_review"]), collectionId: z.string().optional(),
    productType: z.string().trim().min(1).max(255).optional(), reason: z.string().trim().min(1).max(1000) }).strict().safeParse(value);
  if (!parsed.success) throw new SeoWorkerError("CLASSIFICATION_INVALID");
  if (!catalog.collections.length) throw new SeoWorkerError("CLASSIFICATION_CATALOG_UNAVAILABLE");
  if (parsed.data.status !== "ready") throw new SeoWorkerError("CLASSIFICATION_UNRESOLVED");
  if (!parsed.data.productType) throw new SeoWorkerError("CLASSIFICATION_PRODUCT_TYPE_REQUIRED");
  if (!catalog.collections.some(collection => collection.id === parsed.data.collectionId)) {
    throw new SeoWorkerError("CLASSIFICATION_COLLECTION_INVALID");
  }
  return validateProductClassification(parsed.data, catalog);
}

export function requiresProductClassification(job: GptSeoJob): boolean {
  return job.execution.source === "amazon" && z.object({ crawlerClassificationMode: z.literal("automatic") })
    .safeParse(job.execution.originalSnapshot).success;
}

export function validateProductClassification(value: unknown, catalog: ClassificationCatalog): ProductClassification {
  const parsed = z.object({ status: z.enum(["ready", "needs_review"]), collectionId: z.string().optional(),
    productType: z.string().trim().min(1).max(255).optional(), reason: z.string().trim().min(1).max(1000) }).safeParse(value);
  if (!parsed.success) return { status: "needs_review", reason: "Cần chọn collection và loại sản phẩm." };
  const candidate = parsed.data;
  const name = candidate.productType?.normalize("NFKC").replace(/\s+/g, " ").trim();
  const productType = catalog.productTypes.find(type => type.normalize("NFKC").trim().toLowerCase() === name?.toLowerCase()) ?? name;
  if (candidate.status !== "ready" || !productType || !catalog.collections.some(collection => collection.id === candidate.collectionId)) {
    return { status: "needs_review", productType, reason: "Cần chọn collection hợp lệ và loại sản phẩm trước khi sync." };
  }
  return { ...candidate, status: "ready", productType };
}

export async function validateLiveProductClassification({ client, store, candidate, catalog }: {
  readonly client: Pick<ShopifyGraphqlClient, "query">;
  readonly store: StoreConfig;
  readonly candidate: unknown;
  readonly catalog: ClassificationCatalog;
}): Promise<ProductClassification> {
  const classification = validateProductClassification(candidate, catalog);
  if (classification.status !== "ready") return classification;
  const live = await client.query<{ collection: { id: string; ruleSet: unknown } | null }>(store,
    "query ClassificationBeforeSync($id:ID!){ collection(id:$id){ id ruleSet { appliedDisjunctively } } }", { id: classification.collectionId });
  if (!live.collection || live.collection.id !== classification.collectionId || live.collection.ruleSet !== null) {
    return { status: "needs_review", productType: classification.productType,
      reason: "Collection đã bị xóa hoặc không thể gán trực tiếp. Chọn lại tại Review." };
  }
  return classification;
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
            ? "query ClassificationCollections($after:String){ collections(first:250,after:$after,query:\"collection_type:custom\"){ edges { node { id title description ruleSet { appliedDisjunctively } } } pageInfo { hasNextPage endCursor } } }"
            : "query ClassificationProductTypes($after:String){ productTypes(first:250,after:$after){ edges { node } pageInfo { hasNextPage endCursor } } }";
          const response: Record<string, { edges: { node: unknown }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> = await client.query(store, document, { after: cursor });
          const page = response[kind];
          if (!page || !Array.isArray(page.edges)) throw new Error("CLASSIFICATION_CATALOG_UNAVAILABLE");
          for (const edge of page.edges) {
            if (kind === "productTypes") {
              if (typeof edge.node === "string" && edge.node.trim()) productTypes.add(edge.node.trim());
            } else {
              const node = z.object({ id: z.string(), title: z.string(), description: z.string(), ruleSet: z.unknown() }).parse(edge.node);
              if (node.ruleSet === null) collections.push({ id: node.id, title: node.title, description: node.description.slice(0, 1000) });
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
