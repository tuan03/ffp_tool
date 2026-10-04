import type { WorkerReviewHistory, AgentAccessPage, AgentRunPage, GptSeoEnqueue, GptSeoJob, GptSeoSettings, GptSeoBatch, SeoProvider, SeoPublishReceipt } from "./types";

export interface GptQueuePage {
  readonly jobs: readonly GptSeoJob[];
  readonly counts: Readonly<Record<string, number>>;
  readonly activeBatch: GptSeoBatch | null;
  readonly activeBatches: readonly GptSeoBatch[];
  readonly nextOffset: number | null;
}

export interface GptQueueFilters {
  readonly statuses?: readonly GptSeoJob["status"][];
  readonly provider?: SeoProvider;
}

export interface GptReviewPage {
  readonly reviews: readonly {
    readonly job: GptSeoJob;
    readonly state: Readonly<Record<string, unknown>>;
  }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly nextOffset: number | null;
}

export interface SeoQueueStore {
  readonly storeId: string;
  readonly shopDomain: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createCustomGptClient(fetcher: typeof fetch = fetch) {
  async function agentRequest<T>(route: string, storeId: string, body?: unknown): Promise<T> {
    const response = await fetcher(`/api/seo-agent/${route}${route.includes("?") ? "&" : "?"}storeId=${encodeURIComponent(storeId)}`, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-ffp-agent": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      if (route.startsWith("publish") || route === "revisions") {
        const payload: unknown = await response.json().catch(() => null);
        const code = isRecord(payload) && isRecord(payload.error) ? payload.error.code : undefined;
        const messages: Record<string, string> = {
          PUBLISH_UNRESOLVED: "Lần Sync trước chưa xác định kết quả. Đối chiếu Shopify trước khi tạo revision.",
          REVISION_ALREADY_EXISTS: "Bản Review này đã có revision mới. Mở SEO Queue để tiếp tục.",
          REVISION_PROVIDER_UNSUPPORTED: "Luồng revision Worker hiện chỉ hỗ trợ Codex MCP; không tự đổi AI xử lý.",
          REVIEW_SUPERSEDED: "Bản Review đã có revision mới; không thể đồng bộ bản cũ.",
          REVISION_NOT_READY: "Job đang xử lý; chưa thể tạo revision mới.",
          PUBLISH_DISABLED: "Backend publish chưa được bật. Không chuyển sang ghi từ trình duyệt.",
          SOURCE_REASSESSMENT_REQUIRED: "Nguồn hoặc bản duyệt cần được đánh giá lại; không thể gửi lại bản cũ.",
          STALE_SOURCE: "Nguồn Shopify đã thay đổi. Cần tạo revision mới để đánh giá lại.",
          OPERATOR_REQUIRED: "Đăng nhập bằng tài khoản quản trị để Sync Shopify.",
          APPROVED_REVIEW_REQUIRED: "Cần lưu và duyệt bản Review hợp lệ trước khi Sync.",
          VERSION_CONFLICT: "Bản Review đã thay đổi. Tải lại trước khi Sync.",
        };
        throw new Error(typeof code === "string" && messages[code] ? messages[code] : route === "revisions"
          ? "Chưa tạo được revision. Kiểm tra quyền quản trị, kết nối Shopify và trạng thái job; mở Queue trước khi thử lại."
          : "Chưa xác nhận được tác vụ publish. Tải lại Review để kiểm tra; không ghi lại Shopify.");
      }
      throw new Error(response.status === 401 ? "Đăng nhập bằng tài khoản quản trị để quản lý Agent Access." : "Không thể quản lý worker. Kiểm tra kết nối và thử lại.");
    }
    return await response.json() as T;
  }
  async function request<T>(route: string, storeId: string, body?: unknown): Promise<T> {
    const response = await fetcher(`/api/v1/gpt-seo/admin/${route}${route.includes("?") ? "&" : "?"}storeId=${encodeURIComponent(storeId)}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
      throw new Error(error && typeof error === "object" && "message" in error ? String(error.message) : `GPT SEO request failed (${response.status})`);
    }
    return payload as T;
  }

  async function listStores(): Promise<readonly SeoQueueStore[]> {
    const response = await fetcher("/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "stores.list", payload: {} }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || payload.success !== true) {
      throw new Error(`Store list request failed (${response.status})`);
    }
    const responseData = payload.data;
    if (!isRecord(responseData) || !Array.isArray(responseData.stores)) {
      throw new Error("Store list returned an invalid response");
    }
    return responseData.stores.flatMap((store): readonly SeoQueueStore[] => {
      if (!isRecord(store) || typeof store.storeId !== "string" || typeof store.shopDomain !== "string") return [];
      const storeId = store.storeId.trim();
      const shopDomain = store.shopDomain.trim();
      return storeId && shopDomain ? [{ storeId, shopDomain }] : [];
    });
  }

  return {
    workerReviewHistory: (storeId: string, jobId: string, offset = 0) => agentRequest<WorkerReviewHistory>(`review-history?jobId=${encodeURIComponent(jobId)}&offset=${offset}`, storeId),
    createRevision: (storeId: string, jobId: string, requestId: string, instructions?: string) => agentRequest<{ jobId: string; previousJobId: string }>("revisions", storeId, { jobId, requestId, instructions }),
    reconcilePublish: (storeId: string, jobId: string) => agentRequest<SeoPublishReceipt>("publish-reconcile", storeId, { jobId }),
    publishStatus: (storeId: string, jobId: string) => agentRequest<{ managed: boolean; operation: SeoPublishReceipt | null }>(`publish?jobId=${encodeURIComponent(jobId)}`, storeId),
    publishReview: (storeId: string, jobId: string, reviewUpdatedAt: number, requestId: string) => agentRequest<SeoPublishReceipt>("publish", storeId, { jobId, reviewUpdatedAt, requestId }),
    agentAccess: (storeId: string, offset = 0) => agentRequest<AgentAccessPage>(`tokens?offset=${offset}`, storeId),
    agentRuns: (storeId: string, offset = 0) => agentRequest<AgentRunPage>(`runs?offset=${offset}`, storeId),
    createAgentToken: (storeId: string, workerId: string) => agentRequest<{ token: string; tokenId: string; expiresAt: number }>("tokens", storeId, { workerId }),
    revokeAgentToken: (storeId: string, tokenId: string) => agentRequest<{ revoked: true }>("revoke", storeId, { tokenId }),
    stores: listStores,
    settings: (storeId: string) => request<GptSeoSettings>("settings", storeId),
    configure: (storeId: string, settings: GptSeoSettings) => request<GptSeoSettings>("settings", storeId, settings),
    list: (storeId: string, offset = 0, filters: GptQueueFilters = {}) => {
      const statuses = filters.statuses?.length ? `&statuses=${encodeURIComponent(filters.statuses.join(","))}` : "";
      const provider = filters.provider ? `&provider=${encodeURIComponent(filters.provider)}` : "";
      return request<GptQueuePage>(`jobs?offset=${offset}${statuses}${provider}`, storeId);
    },
    reviews: (storeId: string, offset = 0) => request<GptReviewPage>(`reviews?offset=${offset}`, storeId),
    job: (storeId: string, jobId: string) => request<GptSeoJob>(`job?jobId=${encodeURIComponent(jobId)}`, storeId),
    enqueue: (input: GptSeoEnqueue) => request<GptSeoJob>("enqueue", input.storeId, input),
    retry: (storeId: string, jobId: string) => request<unknown>("retry", storeId, { jobId }),
    requeue: (storeId: string, jobIds: readonly string[], options?: { provider?: SeoProvider; instructions?: string }) =>
      request<{ readonly requeued: number }>("requeue", storeId, { jobIds, ...options }),
    cancelReview: (storeId: string, jobId: string) => request<{ readonly cancelled: boolean }>("cancel", storeId, { jobId }),
    transfer: (storeId: string, jobId: string, provider: SeoProvider) => request<unknown>("transfer", storeId, { jobId, provider }),
    beginSync: (storeId: string, jobId: string) => request<{ token: string }>("begin-sync", storeId, { jobId }),
    finishSync: (storeId: string, jobId: string, token: string, status: "SYNCED" | "UNKNOWN") => request<unknown>("finish-sync", storeId, { jobId, token, status }),
    release: (storeId: string, batchId: string) => request<unknown>("release", storeId, { batchId }),
    reviewState: (storeId: string, jobId: string) => request<Record<string, unknown>>(`review-state?jobId=${encodeURIComponent(jobId)}`, storeId),
    saveReviewState: (storeId: string, jobId: string, state: unknown) => request<unknown>("review-state", storeId, { jobId, state }),
    saveReviewStates: (storeId: string, reviews: readonly { readonly jobId: string; readonly state: unknown }[]) =>
      request<{ readonly saved: number }>("review-states", storeId, { reviews }),
  };
}
export type CustomGptClient = ReturnType<typeof createCustomGptClient>;
