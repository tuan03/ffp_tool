import type {
  AutoSeoResult,
  BatchDetailData,
  BenchmarkFilters,
  BenchmarkProductItem,
  BenchmarkSummaryKpis,
  ConnectionsSyncData,
  PerformanceFilters,
  ProductSeoDetailData,
  SearchReportFilters,
  SearchReportView,
  SeoPerformanceClient,
} from "./types";

export function createSeoPerformanceClient(fetcher: typeof fetch = fetch): SeoPerformanceClient {
  async function request<T>(
    path: string,
    storeId?: string,
    body?: unknown,
    filters?: Readonly<Record<string, unknown>>,
  ): Promise<T> {
    const query = new URLSearchParams();
    if (storeId) query.set("storeId", storeId);
    for (const [key, value] of Object.entries(filters ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    }
    const queryString = query.toString();
    const fullPath = queryString ? `/api/seo-performance/${path}${path.includes("?") ? "&" : "?"}${queryString}` : `/api/seo-performance/${path}`;
    const response = await fetcher(fullPath, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-FFP-Performance": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Gateway chưa hỗ trợ SEO Performance hoặc phiên đăng nhập đã hết hạn.");
    }
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Không thể tải SEO Performance. Vui lòng thử lại.";
      throw new Error(message);
    }
    return payload as T;
  }

  return {
    report: (storeId: string, filters: SearchReportFilters, view: SearchReportView = {}) =>
      request("report", storeId, { filters, view }),
    stores: async () => {
      const response = await fetcher("/api/shopify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "stores.list", payload: {} }),
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        !payload ||
        typeof payload !== "object" ||
        !("data" in payload) ||
        !payload.data ||
        typeof payload.data !== "object" ||
        !("stores" in payload.data) ||
        !Array.isArray(payload.data.stores)
      ) {
        throw new Error("Không thể tải danh sách cửa hàng.");
      }
      return payload.data.stores.flatMap((store: unknown) =>
        store && typeof store === "object" && "storeId" in store && typeof store.storeId === "string" && "shopDomain" in store && typeof store.shopDomain === "string"
          ? [{ storeId: store.storeId, shopDomain: store.shopDomain }]
          : [],
      );
    },
    overview: (storeId: string, filters?: PerformanceFilters) =>
      request("overview", storeId, undefined, filters as Readonly<Record<string, unknown>> | undefined),
    integrations: (storeId: string) => request("integrations", storeId),
    properties: (storeId: string) => request("properties", storeId),
    connect: (storeId: string, sources = ["gsc", "ga4"]) => request("oauth/start", storeId, { sources }),
    disconnect: (storeId: string) => request("disconnect", storeId, {}),
    map: (storeId: string, property: string, origin: string) =>
      request("mapping", storeId, { property, origin, confirmed: true }),
    mapGa4: (
      storeId: string,
      input: {
        readonly propertyId: string;
        readonly hostnameScope?: string;
        readonly streamId?: string;
        readonly timeZone?: string;
        readonly currencyCode?: string;
      },
    ) => request<{ readonly ok: boolean }>("mapping/ga4", storeId, input),
    start: (storeId: string, kind: "sync" | "gsc_sync" | "ga4_sync" | "crawl") =>
      request("jobs", storeId, { kind }),
    pages: (storeId: string, filters?: PerformanceFilters) =>
      request("pages", storeId, undefined, filters as Readonly<Record<string, unknown>> | undefined),
    queries: (storeId: string, url: string, filters?: PerformanceFilters) =>
      request(`queries?url=${encodeURIComponent(url)}`, storeId, undefined, filters as Readonly<Record<string, unknown>> | undefined),
    recommendations: (storeId: string, offset = 0) =>
      request("recommendations", storeId, undefined, { offset }),
    history: (storeId: string, offset = 0) => request("history", storeId, undefined, { offset }),
    revise: (storeId: string, recommendationId: string) =>
      request("revise", storeId, { recommendationId }),
    dismiss: (storeId: string, recommendationId: string) =>
      request("dismiss", storeId, { recommendationId }),

    benchmark: (storeId: string, filters?: BenchmarkFilters) =>
      request<{ readonly items: readonly BenchmarkProductItem[]; readonly total: number; readonly kpis: BenchmarkSummaryKpis }>(
        "benchmark/products",
        storeId,
        undefined,
        filters as Readonly<Record<string, unknown>> | undefined,
      ),

    productDetail: (storeId: string, productId: string, options?: { readonly windowDays?: 7 | 14 | 28; readonly compareVersionId?: string }) =>
      request<ProductSeoDetailData>("benchmark/product", storeId, undefined, {
        productId,
        ...(options?.windowDays ? { windowDays: options.windowDays } : {}),
        ...(options?.compareVersionId ? { compareVersionId: options.compareVersionId } : {}),
      }),

    batchDetail: (storeId: string, batchId: string) =>
      request<BatchDetailData>("benchmark/batch", storeId, undefined, { batchId }),

    connectionsSync: (storeId: string) =>
      request<ConnectionsSyncData>("connections-sync", storeId),

    backfill: (storeId: string, source: "gsc" | "ga4", days = 28) =>
      request<{ readonly jobId: string }>("backfill", storeId, { source, days }),

    createAutoSeo: (storeId: string, productId: string) =>
      request<AutoSeoResult>("benchmark/auto-seo", storeId, { productId }),
  };
}
