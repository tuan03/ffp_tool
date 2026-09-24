import { useSyncExternalStore } from "react";

import type {
  AmazonCrawlerOutput,
  AmazonCrawlerProduct,
  AmazonCrawlerProgress,
  AmazonCrawlerRunner,
  AmazonCrawlerSettings,
} from "../types";
import { DEFAULT_AMAZON_CRAWLER_SETTINGS } from "../types";
import { firstProductMediaUrl, resolveSelectedProduct } from "./product-selection";
import { notifyUser } from "../../../shared/utils";

export type ResultTab = "overview" | "source" | "final" | "customize" | "json";

export interface AmazonCrawlerSessionState {
  urlText: string;
  settings: AmazonCrawlerSettings;
  isAdvancedOpen: boolean;
  isRunning: boolean;
  activeJobId: string | null;
  progress: AmazonCrawlerProgress | null;
  output: AmazonCrawlerOutput | null;
  liveProducts: AmazonCrawlerOutput["products"];
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
  activeJobId: string | null;
}

const STORAGE_KEY = "ffp_amazon_crawler_session_v1";

const DEFAULT_SESSION_STATE: AmazonCrawlerSessionState = {
  urlText: "",
  settings: DEFAULT_AMAZON_CRAWLER_SETTINGS,
  isAdvancedOpen: false,
  isRunning: false,
  activeJobId: null,
  progress: null,
  output: null,
  liveProducts: [],
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
      activeJobId: typeof parsed.activeJobId === "string" ? parsed.activeJobId : null,
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
      activeJobId: state.activeJobId,
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
  const products = sessionState.output?.products ?? sessionState.liveProducts;
  const product = products.find((candidate) => candidate.id === productId) ?? null;
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
  onProducts?: (products: readonly AmazonCrawlerProduct[]) => void;
}

export async function startCrawlerJob({
  runAmazonCrawler,
  urls,
  settings,
  onProducts,
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
    liveProducts: [],
    progress: initialProgress,
    settings: jobSettings,
  };
  persistSession(sessionState);
  notifyListeners();

  let didAlertCaptcha = false;

  try {
    const crawlerOutput = await runAmazonCrawler({
      input: { ...jobSettings, urls },
      onProgress: (nextProgress) => {
        sessionState = { ...sessionState, progress: nextProgress };
        if (nextProgress.phase === "captcha" && !didAlertCaptcha) {
          didAlertCaptcha = true;
          notifyUser({
            title: "⚠️ Amazon Crawler: Cần giải CAPTCHA!",
            message: "Amazon yêu cầu giải CAPTCHA để tiếp tục cào. Vui lòng mở crawler agent để giải.",
            type: "warning",
            sound: "alert",
            url: "/amazon-crawler",
            tag: "amazon-captcha",
          });
        }
        notifyListeners();
      },
      onProducts: (products) => {
        const firstProduct = products[0] ?? null;
        const hasSelectedProduct = sessionState.selectedProductId
          ? products.some((product) => product.id === sessionState.selectedProductId)
          : false;
        sessionState = {
          ...sessionState,
          liveProducts: [...products],
          selectedProductId: hasSelectedProduct
            ? sessionState.selectedProductId
            : firstProduct?.id ?? null,
          selectedMediaUrl: hasSelectedProduct
            ? sessionState.selectedMediaUrl
            : firstProductMediaUrl(firstProduct),
        };
        notifyListeners();
      },
      onJobCreated: (jobId) => {
        sessionState = { ...sessionState, activeJobId: jobId };
        persistSession(sessionState);
        notifyListeners();
      },
      signal: controller.signal,
    });

    const firstProduct = crawlerOutput.products[0] ?? null;
    sessionState = {
      ...sessionState,
      output: crawlerOutput,
      liveProducts: [...crawlerOutput.products],
      isRunning: false,
      activeJobId: null,
      error: null,
      selectedProductId: firstProduct?.id ?? null,
      selectedMediaUrl: firstProductMediaUrl(firstProduct),
      activeTab: "overview",
      isBatchJsonOpen: false,
    };
    persistSession(sessionState);
    notifyListeners();

    notifyUser({
      title: "⚡ Distributed Crawler: Hoàn tất cào sản phẩm!",
      message: `Đã cào thành công ${crawlerOutput.products.length} sản phẩm từ Amazon. Bạn có thể kiểm tra và chuyển tiếp sang SEO Review.`,
      type: "success",
      sound: "chime",
      url: "/amazon-crawler",
      tag: `crawler-finished-${crawlerOutput.jobId}`,
    });

    return crawlerOutput;
  } catch (caught: unknown) {
    const isAbort = caught instanceof DOMException && caught.name === "AbortError";
    const errorMessage =
      isAbort
        ? null
        : caught instanceof Error
          ? caught.message
          : "Không thể chạy Amazon crawler.";

    sessionState = {
      ...sessionState,
      isRunning: false,
      activeJobId: isAbort
        ? null
        : sessionState.activeJobId,
      error: errorMessage,
    };
    persistSession(sessionState);
    notifyListeners();

    if (!(caught instanceof DOMException && caught.name === "AbortError")) {
      notifyUser({
        title: "❌ Distributed Crawler Thất bại",
        message: errorMessage ?? "Không thể chạy Amazon crawler.",
        type: "error",
        sound: "alert",
        url: "/amazon-crawler",
      });
    }

    return null;
  } finally {
    if (activeController === controller) {
      activeController = null;
    }
  }
}

export function abortCrawlerJob(): void {
  if (activeController) {
    sessionState = {
      ...sessionState,
      progress: sessionState.progress
        ? { ...sessionState.progress, message: "Đang yêu cầu coordinator dừng tất cả crawler agent..." }
        : sessionState.progress,
    };
    notifyListeners();
    activeController.abort();
    activeController = null;
  }
}

export function resetCrawlerOutput(): void {
  sessionState = {
    ...sessionState,
    output: null,
    liveProducts: [],
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

export function resetCrawlerSettings(): void {
  sessionState = {
    ...sessionState,
    settings: { ...DEFAULT_AMAZON_CRAWLER_SETTINGS },
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
