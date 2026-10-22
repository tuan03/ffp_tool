import type { ReviewImageJob, ReviewImageScope, ReviewImageShopifyFile } from "./types";

export type ReviewProductBatchStatus =
  | "ready"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "uploading"
  | "uploaded";

export interface PersistedReviewProductImage {
  readonly id: string;
  readonly name: string;
  readonly dataUrl: string;
  readonly dimensions?: string;
  readonly status: ReviewProductBatchStatus;
  readonly job?: ReviewImageJob;
  readonly resultDataUrl?: string;
  readonly shopifyFile?: ReviewImageShopifyFile;
  readonly error?: string;
  readonly conversationSessionId?: string;
}

export interface ReviewImagePersistedSettings {
  readonly selectedStoreId: string;
  readonly gatewayToken: string;
  readonly scopes: Readonly<Record<string, ReviewImageScope>>;
  readonly promptDrafts: Readonly<Record<string, string>>;
  readonly previewTemplateNames: Readonly<Record<string, string>>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SETTINGS_STORAGE_KEY = "ffp_review_image_settings_v1";
const DB_NAME = "ffp_review_image_db_v1";
const DB_VERSION = 1;
const STORE_PRODUCTS_OBJECT_STORE = "store_products";

const memoryStoreProducts = new Map<string, readonly PersistedReviewProductImage[]>();

const VALID_SCOPES = new Set<ReviewImageScope>(["main", "set", "single"]);
const VALID_BATCH_STATUSES = new Set<ReviewProductBatchStatus>([
  "ready",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "uploading",
  "uploaded",
]);

function getDefaultStorage(): KeyValueStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      result[key] = item;
    }
  }
  return result;
}

function parseScopeRecord(value: unknown): Readonly<Record<string, ReviewImageScope>> {
  if (!isRecord(value)) return {};
  const result: Record<string, ReviewImageScope> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && VALID_SCOPES.has(item as ReviewImageScope)) {
      result[key] = item as ReviewImageScope;
    }
  }
  return result;
}

export function readReviewImageSettings(
  storage: KeyValueStorage | null = getDefaultStorage(),
): ReviewImagePersistedSettings {
  const empty: ReviewImagePersistedSettings = {
    selectedStoreId: "",
    gatewayToken: "",
    scopes: {},
    promptDrafts: {},
    previewTemplateNames: {},
  };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return empty;
    return {
      selectedStoreId: typeof parsed.selectedStoreId === "string" ? parsed.selectedStoreId : "",
      gatewayToken: typeof parsed.gatewayToken === "string" ? parsed.gatewayToken : "",
      scopes: parseScopeRecord(parsed.scopes),
      promptDrafts: parseStringRecord(parsed.promptDrafts),
      previewTemplateNames: parseStringRecord(parsed.previewTemplateNames),
    };
  } catch {
    return empty;
  }
}

export function writeReviewImageSettings(
  settings: ReviewImagePersistedSettings,
  storage: KeyValueStorage | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or private-browsing errors.
  }
}

export function normalizeRestoredProductImage(
  raw: unknown,
): PersistedReviewProductImage | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.dataUrl !== "string" ||
    !raw.dataUrl
  ) {
    return null;
  }

  const rawStatus =
    typeof raw.status === "string" && VALID_BATCH_STATUSES.has(raw.status as ReviewProductBatchStatus)
      ? (raw.status as ReviewProductBatchStatus)
      : "ready";

  const job =
    isRecord(raw.job) && typeof raw.job.job_id === "string"
      ? (raw.job as unknown as ReviewImageJob)
      : undefined;

  const shopifyFile =
    isRecord(raw.shopifyFile) &&
    typeof raw.shopifyFile.fileId === "string" &&
    typeof raw.shopifyFile.shopifyCdnUrl === "string" &&
    typeof raw.shopifyFile.fileStatus === "string"
      ? (raw.shopifyFile as unknown as ReviewImageShopifyFile)
      : undefined;

  let status: ReviewProductBatchStatus = rawStatus;
  if (rawStatus === "uploading") {
    status = shopifyFile ? "uploaded" : "completed";
  } else if ((rawStatus === "queued" || rawStatus === "running") && !job?.job_id) {
    status = "ready";
  }

  return {
    id: raw.id,
    name: raw.name,
    dataUrl: raw.dataUrl,
    ...(typeof raw.dimensions === "string" ? { dimensions: raw.dimensions } : {}),
    status,
    ...(job ? { job } : {}),
    ...(typeof raw.resultDataUrl === "string" && raw.resultDataUrl ? { resultDataUrl: raw.resultDataUrl } : {}),
    ...(shopifyFile ? { shopifyFile } : {}),
    ...(typeof raw.error === "string" && raw.error ? { error: raw.error } : {}),
    ...(typeof raw.conversationSessionId === "string" && raw.conversationSessionId
      ? { conversationSessionId: raw.conversationSessionId }
      : {}),
  };
}

function openProductsDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_PRODUCTS_OBJECT_STORE)) {
          db.createObjectStore(STORE_PRODUCTS_OBJECT_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadStoreProducts(
  storeId: string,
): Promise<readonly PersistedReviewProductImage[]> {
  if (!storeId) return [];
  const db = await openProductsDatabase();
  if (!db) {
    return memoryStoreProducts.get(storeId) ?? [];
  }
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_PRODUCTS_OBJECT_STORE, "readonly");
      const store = transaction.objectStore(STORE_PRODUCTS_OBJECT_STORE);
      const request = store.get(storeId);
      request.onsuccess = () => {
        const rawList = Array.isArray(request.result) ? request.result : [];
        const normalized = rawList
          .map((item) => normalizeRestoredProductImage(item))
          .filter((item): item is PersistedReviewProductImage => item !== null);
        memoryStoreProducts.set(storeId, normalized);
        resolve(normalized);
      };
      request.onerror = () => {
        resolve(memoryStoreProducts.get(storeId) ?? []);
      };
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
      transaction.onabort = () => db.close();
    } catch {
      db.close();
      resolve(memoryStoreProducts.get(storeId) ?? []);
    }
  });
}

export async function saveStoreProducts(
  storeId: string,
  products: readonly PersistedReviewProductImage[],
): Promise<void> {
  if (!storeId) return;
  const copy = products.map((item) => ({ ...item }));
  memoryStoreProducts.set(storeId, copy);
  const db = await openProductsDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_PRODUCTS_OBJECT_STORE, "readwrite");
      const store = transaction.objectStore(STORE_PRODUCTS_OBJECT_STORE);
      if (copy.length === 0) {
        store.delete(storeId);
      } else {
        store.put(copy, storeId);
      }
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export function clearMemoryStoreProducts(): void {
  memoryStoreProducts.clear();
}
