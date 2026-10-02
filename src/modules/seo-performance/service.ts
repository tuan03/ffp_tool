import type { PerformanceFilters, SeoPerformanceClient } from "./types";

export function createSeoPerformanceClient(fetcher: typeof fetch = fetch): SeoPerformanceClient {
  async function request<T>(path: string, storeId?: string, body?: unknown, filters?: PerformanceFilters): Promise<T> {
    const query = new URLSearchParams();
    if (storeId) query.set("storeId", storeId);
    for (const [key, value] of Object.entries(filters ?? {})) if (value !== undefined && value !== "") query.set(key, String(value));
    const response = await fetcher(`/api/seo-performance/${path}${path.includes("?") ? "&" : "?"}${query}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-FFP-Performance": "1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Gateway chưa hỗ trợ SEO Performance hoặc phiên đăng nhập đã hết hạn.");
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Không thể tải SEO Performance. Vui lòng thử lại.";
      throw new Error(message);
    }
    return payload as T;
  }
  return {
    stores: async () => {
      const response = await fetcher("/api/shopify", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "stores.list", payload: {} }) });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || !("data" in payload) || !payload.data || typeof payload.data !== "object" || !("stores" in payload.data) || !Array.isArray(payload.data.stores)) throw new Error("Không thể tải danh sách cửa hàng.");
      return payload.data.stores.flatMap((store: unknown) => store && typeof store === "object" && "storeId" in store && typeof store.storeId === "string" && "shopDomain" in store && typeof store.shopDomain === "string" ? [{ storeId: store.storeId, shopDomain: store.shopDomain }] : []);
    },
    overview: (storeId, filters) => request("overview", storeId, undefined, filters),
    properties: () => request("properties"), connect: () => request("oauth/start", undefined, {}), disconnect: () => request("disconnect", undefined, {}),
    map: (storeId, property, origin) => request("mapping", storeId, { property, origin, confirmed: true }),
    start: (storeId, kind) => request("jobs", storeId, { kind }),
    pages: (storeId, filters) => request("pages", storeId, undefined, filters),
    queries: (storeId, url, filters) => request(`queries?url=${encodeURIComponent(url)}`, storeId, undefined, filters),
    recommendations: (storeId, offset = 0) => request("recommendations", storeId, undefined, { offset }),
    history: (storeId, offset = 0) => request("history", storeId, undefined, { offset }),
    revise: (storeId, recommendationId) => request("revise", storeId, { recommendationId }),
    dismiss: (storeId, recommendationId) => request("dismiss", storeId, { recommendationId }),
  };
}
