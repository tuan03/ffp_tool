export const DEFAULT_SEO_QUEUE_STORE_ID = "capozen";

function normalizeStoreId(storeId: string): string {
  return storeId.trim().toLowerCase();
}

export function buildSeoQueueUrl(storeId: string): string {
  const normalizedStoreId = normalizeStoreId(storeId);
  if (!normalizedStoreId) throw new Error("storeId is required to open SEO Queue");
  return `/gpt-seo?storeId=${encodeURIComponent(normalizedStoreId)}`;
}

export function resolveSeoQueueStoreId(searchParams: URLSearchParams, persistedStoreId?: string): string {
  return normalizeStoreId(searchParams.get("storeId") ?? "")
    || normalizeStoreId(persistedStoreId ?? "")
    || DEFAULT_SEO_QUEUE_STORE_ID;
}
