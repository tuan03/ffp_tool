import type { AdsIntelligenceClient } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/ads-intelligence/${path}`, {
      ...init,
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("Không kết nối được nguồn dữ liệu. Kiểm tra backend và cấu hình của store.");
  }
  if (!response.ok) {
    let code = "ADS_SOURCE_UNAVAILABLE";
    try {
      const payload: unknown = await response.json();
      if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "object" && payload.error !== null && "code" in payload.error && typeof payload.error.code === "string" && /^[A-Z0-9_]+$/.test(payload.error.code)) code = payload.error.code;
    } catch { /* A proxy may return a non-JSON error. */ }
    const messages: Readonly<Record<string, string>> = {
      ADS_PROFILE_NOT_CONFIGURED: "Store đã có Shopify trong Gateway; chưa cấu hình riêng Meta/GA4 cho Ads Intelligence.",
      ADS_STORE_MAPPING_MISMATCH: "Domain trong Ads profile khác kết nối Gateway. Cần xác minh mapping Meta/GA4 cho shop đang chọn.",
      ADS_STORE_NOT_REGISTERED: "Store không còn trong Gateway. Hãy tải lại danh sách cửa hàng.",
      ADS_GATEWAY_NOT_CONFIGURED: "Gateway chưa khởi tạo kết nối Ads Intelligence.",
      SHOPIFY_HISTORY_ACCESS_REQUIRED: "Ứng dụng Shopify chưa có read_all_orders để đọc đủ lịch sử. Không dùng tổng thiếu dữ liệu.",
      SHOPIFY_AUTH_FAILED: "Gateway không xác thực được Shopify. Kiểm tra kết nối của store tại Gateway.",
      SHOPIFY_PERMISSION_DENIED: "Ứng dụng Shopify chưa có quyền đọc dữ liệu cần thiết.",
      ADS_SOURCE_UNAVAILABLE: "Nguồn chưa được cấu hình hoặc chưa đọc được dữ liệu. Shopify vẫn được tải riêng từ Gateway.",
      META_NOT_CONFIGURED: "Chưa cấu hình token Meta hoặc tài khoản cho store.",
      META_NO_INSIGHTS_FOR_PERIOD: "Meta không trả dữ liệu trong kỳ báo cáo; không thay bằng số mẫu.",
      META_WEBSITE_CONVERSIONS_UNRESOLVED: "Chưa xác minh được số chuyển đổi website của Meta.",
      SHOPIFY_STORE_TOKEN_NOT_CONFIGURED: "Thiếu SHOPIFY_ACCESS_TOKEN_<STORE> trong môi trường backend.",
      GA4_SHARED_PROPERTY_SCOPE_UNVERIFIED: "GA4 property đang dùng cho nhiều store. Cần xác nhận property hoặc bộ lọc riêng trước khi đối soát.",
      GA4_PROPERTY_NOT_CONFIGURED: "Chưa cấu hình GA4 property cho store.",
      COMPETITOR_NOT_CONFIGURED: "Chưa cấu hình nguồn đối thủ thật. Không hiển thị quảng cáo mẫu.",
      COMPETITOR_WATCHLIST_NOT_CONFIGURED: "Chưa cấu hình danh sách đối thủ cho store.",
      COMPETITOR_SOURCE_UNAVAILABLE: "Chưa lấy được quảng cáo từ nhà cung cấp. Kiểm tra API key và quyền truy cập.",
      ADS_CURRENCY_MISMATCH: "Các nguồn khác tiền tệ; chưa thể đối soát.",
    };
    const message = messages[code] ?? (code.endsWith("_CODE_190") ? "Meta từ chối token. Kiểm tra thời hạn và quyền truy cập." : "Kiểm tra cấu hình và quyền truy cập của store.");
    throw new Error(`${message} (${code}, HTTP ${response.status})`);
  }
  return response.json() as Promise<T>;
}

function jsonRequest(method: string, payload: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

export function createAdsIntelligenceClient(): AdsIntelligenceClient {
  const storeQuery = (storeId = "chillgen") => `storeId=${encodeURIComponent(storeId)}`;
  return {
    dataMode: "live",
    getStores: () => request("stores"),
    getShopifySummary: storeId => request(`shopify?${storeQuery(storeId)}`),
    getStoreSummary: store => request(`summary?${storeQuery(store)}`),
    getCampaignHierarchy: store => request(`campaigns?${storeQuery(store)}`),
    getDataHealth: store => request(`health?${storeQuery(store)}`),
    async getCompetitorAds(store) {
      const report = await this.getCompetitorIntelligence?.(store);
      return (report?.ads ?? []).map(ad => ({ pageName: ad.pageName, archiveId: ad.archiveAdId, caption: ad.copy, headline: ad.headline ?? "", cta: ad.cta ?? "", mediaType: ad.mediaType, thumbnailUrl: ad.thumbnailUrl ?? "", inspectionLevel: "THUMBNAIL_ONLY", firstSeen: ad.startDate ?? "", status: ad.status }));
    },
    getReconciliationReport: store => request(`reconciliation?${storeQuery(store)}`),
    getDecisionCards: store => request(`decisions?${storeQuery(store)}`),
    getAiStrategicReport: (store, refresh = false) => request(`ai-analyze?${storeQuery(store)}&refresh=${refresh}`, { method: "POST" }),
    syncNow: store => request(`sync?${storeQuery(store)}`, { method: "POST" }),
    getCompetitorIntelligence(store, refresh = false, filters) {
      const params = new URLSearchParams({ storeId: store ?? "chillgen", refresh: String(refresh) });
      for (const [key, value] of Object.entries(filters ?? {})) {
        if (value && value !== "ALL") params.set(key, value);
      }
      return request(`competitors?${params}`);
    },
    getBriefs: store => request(`briefs?${storeQuery(store)}`),
    generateBrief: (storeId, payload) => request("briefs/generate", jsonRequest("POST", { storeId, ...payload })),
    async getBriefMarkdown(briefId) {
      const response = await fetch(`/api/ads-intelligence/briefs/${encodeURIComponent(briefId)}/markdown`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("Không tải được brief.");
      return response.text();
    },
    updateBriefStatus: (briefId, status, notes) => request(`briefs/${encodeURIComponent(briefId)}/status`, jsonRequest("PUT", { status, notes })),
    getExperiments: store => request(`experiments?${storeQuery(store)}`),
    createExperiment: (storeId, payload) => request("experiments", jsonRequest("POST", { storeId, ...payload })),
    updateExperimentOutcome: (id, payload) => request(`experiments/${encodeURIComponent(id)}/outcome`, jsonRequest("PUT", payload)),
    async proposeGuardedWrite() {
      throw new Error("Thực thi quảng cáo chưa khả dụng. Hãy xác minh và thao tác trực tiếp trong Meta Ads Manager.");
    },
    async executeGuardedWrite() {
      throw new Error("Chưa có kết nối thực thi Meta được xác minh; không có quảng cáo nào được thay đổi.");
    },
  };
}
