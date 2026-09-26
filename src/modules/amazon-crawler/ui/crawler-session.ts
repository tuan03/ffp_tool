import { useSyncExternalStore } from "react";

import type {
  AmazonCrawlerHydratedJob,
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
  lastJobId: string | null;
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
  liveProducts?: AmazonCrawlerOutput["products"];
  progress?: AmazonCrawlerProgress | null;
  lastJobId?: string | null;
  activeTab: ResultTab;
  selectedProductId: string | null;
  selectedMediaUrl: string | null;
  isBatchJsonOpen: boolean;
  activeJobId: string | null;
}

const STORAGE_KEY = "ffp_amazon_crawler_session_v1";

function useCurrentAmazonZip(settings: AmazonCrawlerSettings): AmazonCrawlerSettings {
  return settings.amazonZip === "10001" ? { ...settings, amazonZip: "90001" } : settings;
}

const DEFAULT_SESSION_STATE: AmazonCrawlerSessionState = {
  urlText: "",
  settings: DEFAULT_AMAZON_CRAWLER_SETTINGS,
  isAdvancedOpen: false,
  isRunning: false,
  activeJobId: null,
  progress: null,
  output: null,
  liveProducts: [],
  lastJobId: null,
  error: null,
  activeTab: "overview",
  selectedProductId: null,
  selectedMediaUrl: null,
  isBatchJsonOpen: false,
};

function readPersistedSession(): AmazonCrawlerSessionState {
  if (typeof window === "undefined") {
    return { ...DEFAULT_SESSION_STATE };
  }

  try {
    const raw =
      (window.localStorage && window.localStorage.getItem(STORAGE_KEY)) ||
      (window.sessionStorage && window.sessionStorage.getItem(STORAGE_KEY));
    if (!raw) return { ...DEFAULT_SESSION_STATE };

    const parsed = JSON.parse(raw) as Partial<PersistedCrawlerSession>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SESSION_STATE };

    const settings = useCurrentAmazonZip({
      ...DEFAULT_AMAZON_CRAWLER_SETTINGS,
      ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}),
    });

    const output = (parsed.output && typeof parsed.output === "object" && Array.isArray((parsed.output as AmazonCrawlerOutput).products))
      ? (parsed.output as AmazonCrawlerOutput)
      : null;

    const liveProducts = Array.isArray(parsed.liveProducts) && parsed.liveProducts.length > 0
      ? (parsed.liveProducts as AmazonCrawlerOutput["products"])
      : (output?.products ? [...output.products] : []);

    const allProducts = (output?.products && output.products.length > 0) ? output.products : liveProducts;
    const selectedProduct = resolveSelectedProduct(allProducts, parsed.selectedProductId ?? null);

    const validTabs: readonly ResultTab[] = ["overview", "source", "final", "customize", "json"];
    const activeTab = parsed.activeTab && validTabs.includes(parsed.activeTab) ? parsed.activeTab : "overview";

    const lastJobId = typeof parsed.lastJobId === "string" && parsed.lastJobId.trim()
      ? parsed.lastJobId.trim()
      : (output?.jobId ?? null);

    return {
      ...DEFAULT_SESSION_STATE,
      urlText: typeof parsed.urlText === "string" ? parsed.urlText : "",
      settings,
      isAdvancedOpen: typeof parsed.isAdvancedOpen === "boolean" ? parsed.isAdvancedOpen : false,
      output,
      liveProducts,
      lastJobId,
      progress: parsed.progress ?? null,
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
  if (typeof window === "undefined") return;

  const dataToSave: PersistedCrawlerSession = {
    urlText: state.urlText,
    settings: state.settings,
    isAdvancedOpen: state.isAdvancedOpen,
    output: state.output,
    liveProducts: state.liveProducts,
    progress: state.progress,
    lastJobId: state.lastJobId ?? state.output?.jobId ?? null,
    activeTab: state.activeTab,
    selectedProductId: state.selectedProductId,
    selectedMediaUrl: state.selectedMediaUrl,
    isBatchJsonOpen: state.isBatchJsonOpen,
    activeJobId: state.activeJobId,
  };

  const json = JSON.stringify(dataToSave);

  try {
    window.localStorage?.setItem(STORAGE_KEY, json);
  } catch {
    // If quota exceeded in localStorage, save compact version (keep first 40 products)
    try {
      const compact: PersistedCrawlerSession = {
        ...dataToSave,
        output: dataToSave.output
          ? { ...dataToSave.output, products: dataToSave.output.products.slice(0, 40) }
          : null,
        liveProducts: (dataToSave.liveProducts ?? []).slice(0, 40),
      };
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // If still quota exceeded, keep minimal metadata with lastJobId so coordinator can rehydrate
      try {
        const minimal: PersistedCrawlerSession = {
          ...dataToSave,
          output: null,
          liveProducts: [],
        };
        window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(minimal));
      } catch {
        // Ignore
      }
    }
  }

  try {
    window.sessionStorage?.setItem(STORAGE_KEY, json);
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

  const jobSettings = useCurrentAmazonZip(settings ?? sessionState.settings);
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
        persistSession(sessionState);
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
      lastJobId: crawlerOutput.jobId,
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
  if (typeof window !== "undefined") {
    try {
      window.localStorage?.removeItem(STORAGE_KEY);
      window.sessionStorage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  notifyListeners();
}

export function hydrateCrawlerSessionFromJob(hydrated: AmazonCrawlerHydratedJob): void {
  const outputProducts = hydrated.output?.products ?? [];
  const products = hydrated.products.length >= outputProducts.length && hydrated.products.length > 0
    ? hydrated.products
    : outputProducts;
  const firstProduct = products[0] ?? null;
  const hasSelected = sessionState.selectedProductId
    ? products.some((product) => product.id === sessionState.selectedProductId)
    : false;

  const now = new Date().toISOString();
  const fallbackStatus: AmazonCrawlerOutput["status"] =
    hydrated.status === "completed" || hydrated.status === "partial" || hydrated.status === "cancelled" || hydrated.status === "review_pending"
      ? hydrated.status
      : "completed";

  const resolvedOutput: AmazonCrawlerOutput | null = hydrated.output
    ? { ...hydrated.output, products }
    : (products.length > 0 ? {
    version: "1.0",
    jobId: hydrated.jobId,
    status: fallbackStatus,
    startedAt: now,
    completedAt: now,
    settings: hydrated.settings ?? sessionState.settings,
    statistics: {
      requestedInputs: products.length,
      acceptedInputs: products.length,
      rejectedInputs: 0,
      products: products.length,
      sourceVariants: products.reduce((count, product) => count + (product.sourceVariants?.length || 0), 0),
      finalVariants: products.reduce((count, product) => count + (product.variants?.length || 0), 0),
      durationMs: 0,
    },
    products,
    errors: [],
    warnings: [],
    exportFilename: null,
  } : null);

  const isActive = ["queued", "running", "waiting_captcha", "cancelling"].includes(hydrated.status);
  sessionState = {
    ...sessionState,
    lastJobId: hydrated.jobId,
    activeJobId: isActive ? hydrated.jobId : null,
    isRunning: isActive,
    progress: hydrated.progress ?? sessionState.progress,
    output: resolvedOutput,
    liveProducts: [...products],
    selectedProductId: hasSelected ? sessionState.selectedProductId : firstProduct?.id ?? null,
    selectedMediaUrl: hasSelected ? sessionState.selectedMediaUrl : firstProductMediaUrl(firstProduct),
    error: null,
    settings: hydrated.settings ? { ...sessionState.settings, ...hydrated.settings } : sessionState.settings,
  };
  persistSession(sessionState);
  notifyListeners();
}
