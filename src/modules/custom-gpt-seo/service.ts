import type { WorkerMetrics, WorkerReviewHistory, AgentAccessPage, AgentRunPage, ClearQueueResult, GptSeoEnqueue, GptSeoJob, GptSeoSettings, GptSeoBatch, SeoProvider, SeoPublishReceipt, SeoProductLifecycleDto, SeoRollbackDraftRequestDto, SeoVersionDiffDto, SeoVersionPageDto } from "./types";
import { readSeoReviewListPage } from "../../shared/seo-review-list";
import type { SeoReviewListQuery } from "../../shared/seo-review-list";

export interface GptQueuePage {
  readonly jobs: readonly GptSeoJob[];
  readonly counts: Readonly<Record<string, number>>;
  readonly activeBatch: GptSeoBatch | null;
  readonly activeBatches: readonly GptSeoBatch[];
  readonly nextOffset: number | null;
}

export interface GptQueueFilters {
  readonly signal?: AbortSignal;
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
  const readCache = new Map<string, { expiresAt: number; payload: unknown }>();
  let cacheRevision = 0;
  async function agentRequest<T>(route: string, storeId: string, body?: unknown): Promise<T> {
    if (body !== undefined) { readCache.clear(); cacheRevision += 1; }
    const response = await fetcher(`/api/seo-agent/${route}${route.includes("?") ? "&" : "?"}storeId=${encodeURIComponent(storeId)}`, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-ffp-agent": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      if (route.startsWith("publish") || route === "revisions" || route.startsWith("versioning/")) {
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
          INVALID_AEO_FIELDS: "AEO chưa đủ summary, FAQ hoặc Schema.org Product và FAQPage hợp lệ. Kiểm tra bản Review trước khi Sync.",
          REVIEW_IMAGE_MAPPING_REQUIRED: "Chưa xác định được ID ảnh Shopify trong Review. Tải lại Review để đối chiếu ảnh; không cần chạy lại SEO.",
          PUBLISH_INPUT_REJECTED: "Gateway đã từ chối lệnh trước khi ghi Shopify. Sau khi sửa lỗi, bấm Sync để thử lại bản đã duyệt.",
          SOURCE_IMAGE_MISSING: "Ảnh trong bản Review không còn trên sản phẩm Shopify. Cần đối chiếu lại ảnh trước khi Sync.",
          VERSION_CONFLICT: "Bản Review đã thay đổi. Tải lại trước khi Sync.",
          SEO_VERSION_READ_DISABLED: "Lịch sử SEO chưa được bật cho store này.",
          SEO_VERSION_WRITE_DISABLED: "Store đang ở chế độ chỉ đọc lịch sử SEO.",
          SEO_PRODUCT_NOT_FOUND: "Sản phẩm chưa có baseline SEO trên store này.",
          SEO_VERSION_NOT_FOUND: "Không tìm thấy phiên bản SEO được yêu cầu.",
          SEO_PRODUCT_DIRTY: "Shopify có thay đổi ngoài FFP. Hãy đối chiếu trước khi tạo rollback.",
          ROLLBACK_TARGET_CURRENT: "Phiên bản đã chọn đang là phiên bản hiện tại.",
        };
        throw new Error(typeof code === "string" && messages[code] ? messages[code] : route === "revisions"
          ? "Chưa tạo được revision. Kiểm tra quyền quản trị, kết nối Shopify và trạng thái job; mở Queue trước khi thử lại."
          : "Chưa xác nhận được tác vụ publish. Tải lại Review để kiểm tra; không ghi lại Shopify.");
      }
      throw new Error(response.status === 401 ? "Đăng nhập bằng tài khoản quản trị để quản lý Agent Access." : "Không thể quản lý worker. Kiểm tra kết nối và thử lại.");
    }
    return await response.json() as T;
  }
  async function request<T>(route: string, storeId: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const cacheKey = `${storeId}:${route}`;
    const ttl = route === "settings" ? 30_000 : route.startsWith("jobs?") ? 5_000 : 0;
    if (body !== undefined) { readCache.clear(); cacheRevision += 1; }
    const startedRevision = cacheRevision;
    signal?.throwIfAborted();
    const cached = body === undefined ? readCache.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.payload) as T;
    const response = await fetcher(`/api/v1/gpt-seo/admin/${route}${route.includes("?") ? "&" : "?"}storeId=${encodeURIComponent(storeId)}`, { method: body === undefined ? "GET" : "POST", signal, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
      throw new Error(error && typeof error === "object" && "message" in error ? String(error.message) : `GPT SEO request failed (${response.status})`);
    }
    if (body === undefined && ttl > 0 && startedRevision === cacheRevision && !signal?.aborted) {
      readCache.set(cacheKey, { expiresAt: Date.now() + ttl, payload });
      if (readCache.size > 30) readCache.delete(readCache.keys().next().value ?? "");
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
    reviewList: async (query: SeoReviewListQuery) => {
      const params = new URLSearchParams({ offset: String(query.offset ?? 0), limit: String(query.limit ?? 50), search: query.search ?? "", ...(query.decision ? { decision: query.decision } : {}) });
      if (query.workspace) params.set("workspace", query.workspace);
      if (query.stage) params.set("stage", query.stage);
      return readSeoReviewListPage(await request<unknown>(`review-list?${params}`, query.storeId, undefined, query.signal), query.storeId);
    },
    reviewDetail: (storeId: string, jobId: string, signal?: AbortSignal) => request<GptReviewPage["reviews"][number]>(`review-detail?jobId=${encodeURIComponent(jobId)}`, storeId, undefined, signal),
    workerReviewHistory: (storeId: string, jobId: string, offset = 0) => agentRequest<WorkerReviewHistory>(`review-history?jobId=${encodeURIComponent(jobId)}&offset=${offset}`, storeId),
    seoVersionLifecycle: (storeId: string, productGid: string) => agentRequest<SeoProductLifecycleDto>(`versioning/lifecycle?productGid=${encodeURIComponent(productGid)}`, storeId),
    seoVersionHistory: (storeId: string, productGid: string, limit = 25, offset = 0) => agentRequest<SeoVersionPageDto>(`versioning/history?productGid=${encodeURIComponent(productGid)}&limit=${limit}&offset=${offset}`, storeId),
    seoVersionDiff: (storeId: string, productGid: string, fromVersionId: string, toVersionId: string) => agentRequest<SeoVersionDiffDto>(`versioning/diff?productGid=${encodeURIComponent(productGid)}&fromVersionId=${encodeURIComponent(fromVersionId)}&toVersionId=${encodeURIComponent(toVersionId)}`, storeId),
    refreshSeoBaseline: (storeId: string, productGid: string) => agentRequest<unknown>("versioning/baseline", storeId, { productGid }),
    requestSeoRollbackDraft: (storeId: string, productGid: string, targetVersionId: string, requestId: string) => agentRequest<SeoRollbackDraftRequestDto>("versioning/rollback-drafts", storeId, { productGid, targetVersionId, requestId }),
    workerMetrics: (storeId: string, hours = 24) => agentRequest<WorkerMetrics>(`metrics?hours=${hours}`, storeId),
    createRevision: (storeId: string, jobId: string, requestId: string, instructions?: string) => agentRequest<{ jobId: string; previousJobId: string }>("revisions", storeId, { jobId, requestId, instructions }),
    reconcilePublish: (storeId: string, jobId: string) => agentRequest<SeoPublishReceipt>("publish-reconcile", storeId, { jobId }),
    publishStatus: (storeId: string, jobId: string) => agentRequest<{ managed: boolean; operation: SeoPublishReceipt | null }>(`publish?jobId=${encodeURIComponent(jobId)}`, storeId),
    publishReview: (storeId: string, jobId: string, reviewUpdatedAt: number, requestId: string) => agentRequest<SeoPublishReceipt>("publish", storeId, { jobId, reviewUpdatedAt, requestId }),
    agentAccess: (storeId: string, offset = 0) => agentRequest<AgentAccessPage>(`tokens?offset=${offset}`, storeId),
    agentRuns: (storeId: string, offset = 0) => agentRequest<AgentRunPage>(`runs?offset=${offset}`, storeId),
    createAgentToken: (storeId: string, workerId: string) => agentRequest<{ token: string; tokenId: string; expiresAt: number }>("tokens", storeId, { workerId }),
    revokeAgentToken: (storeId: string, tokenId: string) => agentRequest<{ revoked: true }>("revoke", storeId, { tokenId }),
    deleteAgentToken: (storeId: string, tokenId: string) => agentRequest<{ deleted: true }>("delete-token", storeId, { tokenId }),
    enableClaims: (storeId: string, allStores = false) => agentRequest<{ enabled: boolean }>("enable-claims", storeId, { allStores }),
    disableClaims: (storeId: string, allStores = false) => agentRequest<{ enabled: boolean }>("disable-claims", storeId, { allStores }),
    stores: listStores,
    settings: (storeId: string) => request<GptSeoSettings>("settings", storeId),
    configure: (storeId: string, settings: GptSeoSettings) => request<GptSeoSettings>("settings", storeId, settings),
    list: (storeId: string, offset = 0, filters: GptQueueFilters = {}) => {
      const statuses = filters.statuses?.length ? `&statuses=${encodeURIComponent(filters.statuses.join(","))}` : "";
      const provider = filters.provider ? `&provider=${encodeURIComponent(filters.provider)}` : "";
      return request<GptQueuePage>(`jobs?offset=${offset}${statuses}${provider}`, storeId, undefined, filters.signal);
    },
    reviews: (storeId: string, offset = 0) => request<GptReviewPage>(`reviews?offset=${offset}`, storeId),
    job: (storeId: string, jobId: string) => request<GptSeoJob>(`job?jobId=${encodeURIComponent(jobId)}`, storeId),
    enqueue: (input: GptSeoEnqueue) => request<GptSeoJob>("enqueue", input.execution.storeId, input),
    retry: (storeId: string, jobId: string) => request<unknown>("retry", storeId, { jobId }),
    requeue: (storeId: string, jobIds: readonly string[], options?: { provider?: SeoProvider; instructions?: string }) =>
      request<{ readonly requeued: number }>("requeue", storeId, { jobIds, ...options }),
    cancelReview: (storeId: string, jobId: string) => request<{ readonly cancelled: boolean }>("cancel", storeId, { jobId }),
    archiveReview: (storeId: string, jobId: string) => request<{ readonly archived: boolean }>("archive", storeId, { jobId }),
    clearQueue: (storeId: string) => request<ClearQueueResult>("clear", storeId, {}),
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
