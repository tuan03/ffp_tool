export const ACTIVE_STORE_STORAGE_KEY = "ffp_active_store_id";
export const LEGACY_REVIEW_STORE_STORAGE_KEY = "ffp_seo_review_selected_store";
export const ACTIVE_STORE_CHANGED_EVENT = "ffp-active-store-changed";

interface StoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeActiveStoreId(storeId: string | null | undefined): string {
  return storeId?.trim().toLowerCase() ?? "";
}

export function readActiveStoreId(storage?: Pick<StoreStorage, "getItem">): string {
  if (!storage) return "";
  return normalizeActiveStoreId(
    storage.getItem(ACTIVE_STORE_STORAGE_KEY)
      ?? storage.getItem(LEGACY_REVIEW_STORE_STORAGE_KEY),
  );
}

export function persistActiveStoreId(
  storeId: string,
  storage?: Pick<StoreStorage, "setItem">,
): string {
  const normalizedStoreId = normalizeActiveStoreId(storeId);
  if (!normalizedStoreId || !storage) return normalizedStoreId;
  storage.setItem(ACTIVE_STORE_STORAGE_KEY, normalizedStoreId);
  storage.setItem(LEGACY_REVIEW_STORE_STORAGE_KEY, normalizedStoreId);
  return normalizedStoreId;
}

export function buildStoreAwarePath(pathname: string, storeId: string): string {
  const normalizedStoreId = normalizeActiveStoreId(storeId);
  return normalizedStoreId
    ? `${pathname}?storeId=${encodeURIComponent(normalizedStoreId)}`
    : pathname;
}

export function persistBrowserActiveStoreId(storeId: string): string {
  const normalizedStoreId = normalizeActiveStoreId(storeId);
  if (!normalizedStoreId || typeof window === "undefined") return normalizedStoreId;
  try {
    persistActiveStoreId(normalizedStoreId, window.localStorage);
  } catch {
    // The URL remains the fallback when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_STORE_CHANGED_EVENT, { detail: normalizedStoreId }));
  return normalizedStoreId;
}
