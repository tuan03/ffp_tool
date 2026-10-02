import { useSyncExternalStore } from "react";
import type {
  AutoSeoOutput,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
} from "../types";
import type { AutoSeoBatchSize, AutoSeoEligibilityFilter } from "./smart-batch";

export interface AutoSeoSessionState {
  selectedStoreId?: string;
  products: readonly ShopifyProductForAutoSeoUi[];
  selectedProductIds: readonly string[];
  searchQuery: string;
  statusFilter: ShopifyStatusFilter;
  output: AutoSeoOutput | null;
  lastHydratedProducts: readonly ShopifyProductForAutoSeoUi[];
  hasLoadedInitially: boolean;
  batchSize: AutoSeoBatchSize;
  eligibilityFilter: AutoSeoEligibilityFilter;
}

interface PersistedAutoSeoSession {
  selectedStoreId?: string;
  products: readonly ShopifyProductForAutoSeoUi[];
  selectedProductIds: readonly string[];
  searchQuery: string;
  statusFilter: ShopifyStatusFilter;
  output: AutoSeoOutput | null;
  hasLoadedInitially: boolean;
  batchSize?: AutoSeoBatchSize;
  eligibilityFilter?: AutoSeoEligibilityFilter;
}

const STORAGE_KEY = "ffp_auto_seo_session_v1";

export const DEFAULT_AUTO_SEO_SESSION_STATE: AutoSeoSessionState = {
  selectedStoreId: undefined,
  products: [],
  selectedProductIds: [],
  searchQuery: "",
  statusFilter: "all",
  output: null,
  lastHydratedProducts: [],
  hasLoadedInitially: false,
  batchSize: 50,
  eligibilityFilter: "needs_seo",
};

const VALID_BATCH_SIZES: readonly AutoSeoBatchSize[] = [10, 20, 50, 100];

export function parseAutoSeoSessionState(value: unknown): AutoSeoSessionState {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_AUTO_SEO_SESSION_STATE };
  }
  const parsed = value as Partial<PersistedAutoSeoSession>;
  const selectedStoreId =
    typeof parsed.selectedStoreId === "string" && parsed.selectedStoreId.trim() !== ""
      ? parsed.selectedStoreId.trim()
      : undefined;
  const products = Array.isArray(parsed.products) ? parsed.products : [];
  const selectedProductIds = Array.isArray(parsed.selectedProductIds)
    ? parsed.selectedProductIds.filter((id): id is string => typeof id === "string")
    : [];
  const searchQuery = typeof parsed.searchQuery === "string" ? parsed.searchQuery : "";
  const validFilters: readonly ShopifyStatusFilter[] = ["all", "ACTIVE", "DRAFT", "ARCHIVED"];
  const statusFilter = parsed.statusFilter && validFilters.includes(parsed.statusFilter)
    ? parsed.statusFilter
    : "all";
  const output = parsed.output && typeof parsed.output === "object" ? parsed.output : null;
  const hasLoadedInitially = Boolean(parsed.hasLoadedInitially && products.length > 0);
  const batchSize = VALID_BATCH_SIZES.includes(parsed.batchSize as AutoSeoBatchSize)
    ? parsed.batchSize as AutoSeoBatchSize
    : 50;
  const validEligibilityFilters: readonly AutoSeoEligibilityFilter[] = [
    "all",
    "needs_seo",
    "active",
    "current",
  ];
  const eligibilityFilter =
    parsed.eligibilityFilter && validEligibilityFilters.includes(parsed.eligibilityFilter as AutoSeoEligibilityFilter)
      ? (parsed.eligibilityFilter as AutoSeoEligibilityFilter)
      : "needs_seo";

  return {
    ...DEFAULT_AUTO_SEO_SESSION_STATE,
    selectedStoreId,
    products,
    selectedProductIds,
    searchQuery,
    statusFilter,
    output,
    hasLoadedInitially,
    batchSize,
    eligibilityFilter,
  };
}

function readPersistedSession(): AutoSeoSessionState {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return { ...DEFAULT_AUTO_SEO_SESSION_STATE };
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTO_SEO_SESSION_STATE };

    return parseAutoSeoSessionState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUTO_SEO_SESSION_STATE };
  }
}

function persistSession(state: AutoSeoSessionState): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    const dataToSave: PersistedAutoSeoSession = {
      selectedStoreId: state.selectedStoreId,
      products: state.products,
      selectedProductIds: state.selectedProductIds,
      searchQuery: state.searchQuery,
      statusFilter: state.statusFilter,
      output: state.output,
      hasLoadedInitially: state.hasLoadedInitially,
      batchSize: state.batchSize,
      eligibilityFilter: state.eligibilityFilter,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch {
    // Gracefully handle storage quota or private browsing limits
  }
}

let sessionState: AutoSeoSessionState = readPersistedSession();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getAutoSeoSessionState(): AutoSeoSessionState {
  return sessionState;
}

export function subscribeAutoSeoSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAutoSeoSession(): AutoSeoSessionState {
  return useSyncExternalStore(
    subscribeAutoSeoSession,
    getAutoSeoSessionState,
    getAutoSeoSessionState,
  );
}

export function updateAutoSeoSession(
  updater:
    | Partial<AutoSeoSessionState>
    | ((prev: AutoSeoSessionState) => Partial<AutoSeoSessionState>),
): void {
  const patch = typeof updater === "function" ? updater(sessionState) : updater;
  sessionState = { ...sessionState, ...patch };
  persistSession(sessionState);
  notifyListeners();
}

export function setAutoSeoSelectedStoreId(selectedStoreId?: string): void {
  updateAutoSeoSession({ selectedStoreId });
}

export function setAutoSeoProducts(products: readonly ShopifyProductForAutoSeoUi[]): void {
  updateAutoSeoSession({ products, hasLoadedInitially: true });
}

export function setAutoSeoSelectedProductIds(selectedProductIds: readonly string[]): void {
  updateAutoSeoSession({ selectedProductIds });
}

export function setAutoSeoSearchQuery(searchQuery: string): void {
  updateAutoSeoSession({ searchQuery });
}

export function setAutoSeoStatusFilter(statusFilter: ShopifyStatusFilter): void {
  updateAutoSeoSession({ statusFilter });
}

export function setAutoSeoBatchSize(batchSize: AutoSeoBatchSize): void {
  updateAutoSeoSession({ batchSize });
}

export function setAutoSeoEligibilityFilter(eligibilityFilter: AutoSeoEligibilityFilter): void {
  updateAutoSeoSession({ eligibilityFilter });
}

export function setAutoSeoOutput(output: AutoSeoOutput | null): void {
  updateAutoSeoSession({ output });
}

export function setAutoSeoLastHydratedProducts(
  lastHydratedProducts: readonly ShopifyProductForAutoSeoUi[],
): void {
  updateAutoSeoSession({ lastHydratedProducts });
}

export function clearAutoSeoSession(): void {
  sessionState = { ...DEFAULT_AUTO_SEO_SESSION_STATE };
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  notifyListeners();
}
