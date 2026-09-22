import { useSyncExternalStore } from "react";

import type {
  AmazonCrawlerOutput,
  AmazonCrawlerProgress,
  AmazonCrawlerRunner,
  AmazonCrawlerSettings,
} from "../types";
import { DEFAULT_AMAZON_CRAWLER_SETTINGS } from "../types";
import { firstProductMediaUrl, resolveSelectedProduct } from "./product-selection";

export type ResultTab = "overview" | "source" | "final" | "customize" | "json";

export interface AmazonCrawlerSessionState {
  urlText: string;
  settings: AmazonCrawlerSettings;
  isAdvancedOpen: boolean;
  isRunning: boolean;
  progress: AmazonCrawlerProgress | null;
  output: AmazonCrawlerOutput | null;
  error: string | null;
  activeTab: ResultTab;
  selectedProductId: string | null;
  selectedMediaUrl: string | null;
  isBatchJsonOpen: boolean;
}

interface PersistedCrawlerSession {
  urlText: string;
  settings: AmazonCrawlerSettings;
  isAdvancedOpen: boolean;
  output: AmazonCrawlerOutput | null;
  activeTab: ResultTab;
  selectedProductId: string | null;
  selectedMediaUrl: string | null;
  isBatchJsonOpen: boolean;
}

const STORAGE_KEY = "ffp_amazon_crawler_session_v1";

const DEFAULT_SESSION_STATE: AmazonCrawlerSessionState = {
  urlText: "",
  settings: DEFAULT_AMAZON_CRAWLER_SETTINGS,
  isAdvancedOpen: false,
  isRunning: false,
  progress: null,
  output: null,
  error: null,
  activeTab: "overview",
  selectedProductId: null,
  selectedMediaUrl: null,
  isBatchJsonOpen: false,
};

function readPersistedSession(): AmazonCrawlerSessionState {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return { ...DEFAULT_SESSION_STATE };
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SESSION_STATE };

    const parsed = JSON.parse(raw) as Partial<PersistedCrawlerSession>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SESSION_STATE };

    const settings: AmazonCrawlerSettings = {
      ...DEFAULT_AMAZON_CRAWLER_SETTINGS,
      ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}),
    };

    const output = (parsed.output && typeof parsed.output === "object" && Array.isArray((parsed.output as AmazonCrawlerOutput).products))
      ? (parsed.output as AmazonCrawlerOutput)
      : null;

    const selectedProduct = resolveSelectedProduct(output?.products ?? [], parsed.selectedProductId ?? null);

    const validTabs: readonly ResultTab[] = ["overview", "source", "final", "customize", "json"];
    const activeTab = parsed.activeTab && validTabs.includes(parsed.activeTab) ? parsed.activeTab : "overview";

    return {
      ...DEFAULT_SESSION_STATE,
      urlText: typeof parsed.urlText === "string" ? parsed.urlText : "",
      settings,
      isAdvancedOpen: typeof parsed.isAdvancedOpen === "boolean" ? parsed.isAdvancedOpen : false,
      output,
      activeTab,
      selectedProductId: selectedProduct?.id ?? null,
      selectedMediaUrl: parsed.selectedMediaUrl ?? firstProductMediaUrl(selectedProduct),
      isBatchJsonOpen: typeof parsed.isBatchJsonOpen === "boolean" ? parsed.isBatchJsonOpen : false,
    };
  } catch {
    return { ...DEFAULT_SESSION_STATE };
  }
}

function persistSession(state: AmazonCrawlerSessionState): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    const dataToSave: PersistedCrawlerSession = {
      urlText: state.urlText,
      settings: state.settings,
      isAdvancedOpen: state.isAdvancedOpen,
      output: state.output,
      activeTab: state.activeTab,
      selectedProductId: state.selectedProductId,
      selectedMediaUrl: state.selectedMediaUrl,
      isBatchJsonOpen: state.isBatchJsonOpen,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch {
    // Gracefully handle storage quota or privacy restrictions
  }
}

let sessionState: AmazonCrawlerSessionState = readPersistedSession();
let activeController: AbortController | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getCrawlerSessionState(): AmazonCrawlerSessionState {
  return sessionState;
}

export function subscribeCrawlerSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAmazonCrawlerSession(): AmazonCrawlerSessionState {
  return useSyncExternalStore(
    subscribeCrawlerSession,
    getCrawlerSessionState,
    getCrawlerSessionState,
  );
}

export function updateCrawlerSession(
  updater:
    | Partial<AmazonCrawlerSessionState>
    | ((prev: AmazonCrawlerSessionState) => Partial<AmazonCrawlerSessionState>),
): void {
  const patch = typeof updater === "function" ? updater(sessionState) : updater;
  sessionState = { ...sessionState, ...patch };
  persistSession(sessionState);
  notifyListeners();
}

export function setCrawlerUrlText(urlText: string): void {
  updateCrawlerSession({ urlText });
}

export function updateCrawlerSetting<K extends keyof AmazonCrawlerSettings>(
  key: K,
  value: AmazonCrawlerSettings[K],
): void {
  updateCrawlerSession((prev) => ({
    settings: { ...prev.settings, [key]: value },
  }));
}

export function setCrawlerActiveTab(activeTab: ResultTab): void {
  updateCrawlerSession({ activeTab });
}

export function selectCrawlerProduct(productId: string): void {
  const product = sessionState.output?.products.find((candidate) => candidate.id === productId) ?? null;
  updateCrawlerSession({
    selectedProductId: productId,
    selectedMediaUrl: firstProductMediaUrl(product),
    activeTab: "overview",
  });
}

export function setCrawlerSelectedMediaUrl(url: string | null): void {
  updateCrawlerSession({ selectedMediaUrl: url });
}

export function toggleCrawlerAdvancedOpen(): void {
  updateCrawlerSession((prev) => ({ isAdvancedOpen: !prev.isAdvancedOpen }));
}

export function toggleCrawlerBatchJsonOpen(): void {
  updateCrawlerSession((prev) => ({ isBatchJsonOpen: !prev.isBatchJsonOpen }));
}

export interface StartCrawlerJobOptions {
  runAmazonCrawler: AmazonCrawlerRunner;
  urls: readonly string[];
  settings?: AmazonCrawlerSettings;
}

export async function startCrawlerJob({
  runAmazonCrawler,
  urls,
  settings,
}: StartCrawlerJobOptions): Promise<AmazonCrawlerOutput | null> {
  if (urls.length === 0 || sessionState.isRunning) return null;

  const jobSettings = settings ?? sessionState.settings;
  const controller = new AbortController();
  activeController = controller;

  const initialProgress: AmazonCrawlerProgress = {
    phase: "queued",
    completed: 0,
    total: urls.length,
    message: "Đang tạo job...",
    items: urls.map((source) => ({
      source,
      asin: source,
      phase: "queued",
      status: "queued",
      message: "Đang chờ xử lý.",
      variantCompleted: 0,
      variantTotal: 0,
      activeVariants: [],
    })),
  };

  sessionState = {
    ...sessionState,
    isRunning: true,
    error: null,
    output: null,
    progress: initialProgress,
    settings: jobSettings,
  };
  persistSession(sessionState);
  notifyListeners();

  try {
    const crawlerOutput = await runAmazonCrawler({
      input: { ...jobSettings, urls },
      onProgress: (nextProgress) => {
        sessionState = { ...sessionState, progress: nextProgress };
        notifyListeners();
      },
      signal: controller.signal,
    });

    const firstProduct = crawlerOutput.products[0] ?? null;
    sessionState = {
      ...sessionState,
      output: crawlerOutput,
      isRunning: false,
      error: null,
      selectedProductId: firstProduct?.id ?? null,
      selectedMediaUrl: firstProductMediaUrl(firstProduct),
      activeTab: "overview",
      isBatchJsonOpen: false,
    };
    persistSession(sessionState);
    notifyListeners();
    return crawlerOutput;
  } catch (caught: unknown) {
    const errorMessage =
      caught instanceof DOMException && caught.name === "AbortError"
        ? "Job đã được dừng an toàn."
        : caught instanceof Error
          ? caught.message
          : "Không thể chạy Amazon crawler.";

    sessionState = {
      ...sessionState,
      isRunning: false,
      error: errorMessage,
    };
    persistSession(sessionState);
    notifyListeners();
    return null;
  } finally {
    if (activeController === controller) {
      activeController = null;
    }
  }
}

export function abortCrawlerJob(): void {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

export function resetCrawlerOutput(): void {
  sessionState = {
    ...sessionState,
    output: null,
    progress: null,
    error: null,
    selectedProductId: null,
    selectedMediaUrl: null,
    activeTab: "overview",
    isBatchJsonOpen: false,
  };
  persistSession(sessionState);
  notifyListeners();
}

export function clearCrawlerSession(): void {
  abortCrawlerJob();
  sessionState = { ...DEFAULT_SESSION_STATE };
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  notifyListeners();
}
