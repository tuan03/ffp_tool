import { useSyncExternalStore } from "react";
import type {
  AutoSeoOutput,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
} from "../types";

export interface AutoSeoSessionState {
  products: readonly ShopifyProductForAutoSeoUi[];
  selectedProductIds: readonly string[];
  searchQuery: string;
  statusFilter: ShopifyStatusFilter;
  output: AutoSeoOutput | null;
  lastHydratedProducts: readonly ShopifyProductForAutoSeoUi[];
  hasLoadedInitially: boolean;
}

interface PersistedAutoSeoSession {
  products: readonly ShopifyProductForAutoSeoUi[];
  selectedProductIds: readonly string[];
  searchQuery: string;
  statusFilter: ShopifyStatusFilter;
  output: AutoSeoOutput | null;
  hasLoadedInitially: boolean;
}

const STORAGE_KEY = "ffp_auto_seo_session_v1";

export const DEFAULT_AUTO_SEO_SESSION_STATE: AutoSeoSessionState = {
  products: [],
  selectedProductIds: [],
  searchQuery: "",
  statusFilter: "all",
  output: null,
  lastHydratedProducts: [],
  hasLoadedInitially: false,
};

function readPersistedSession(): AutoSeoSessionState {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return { ...DEFAULT_AUTO_SEO_SESSION_STATE };
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTO_SEO_SESSION_STATE };

    const parsed = JSON.parse(raw) as Partial<PersistedAutoSeoSession>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_AUTO_SEO_SESSION_STATE };

    const products = Array.isArray(parsed.products) ? parsed.products : [];
    const selectedProductIds = Array.isArray(parsed.selectedProductIds)
      ? (parsed.selectedProductIds.filter((id) => typeof id === "string") as string[])
      : [];
    const searchQuery = typeof parsed.searchQuery === "string" ? parsed.searchQuery : "";
    const validFilters: readonly ShopifyStatusFilter[] = ["all", "ACTIVE", "DRAFT", "ARCHIVED"];
    const statusFilter = parsed.statusFilter && validFilters.includes(parsed.statusFilter)
      ? parsed.statusFilter
      : "all";
    const output = parsed.output && typeof parsed.output === "object" ? parsed.output : null;
    const hasLoadedInitially = Boolean(parsed.hasLoadedInitially && products.length > 0);

    return {
      ...DEFAULT_AUTO_SEO_SESSION_STATE,
      products,
      selectedProductIds,
      searchQuery,
      statusFilter,
      output,
      hasLoadedInitially,
    };
  } catch {
    return { ...DEFAULT_AUTO_SEO_SESSION_STATE };
  }
}

function persistSession(state: AutoSeoSessionState): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    const dataToSave: PersistedAutoSeoSession = {
      products: state.products,
      selectedProductIds: state.selectedProductIds,
      searchQuery: state.searchQuery,
      statusFilter: state.statusFilter,
      output: state.output,
      hasLoadedInitially: state.hasLoadedInitially,
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
