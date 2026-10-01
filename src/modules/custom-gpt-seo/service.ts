import type { GptSeoEnqueue, GptSeoJob, GptSeoSettings, GptSeoBatch, SeoProvider } from "./types";

export interface GptQueuePage {
  readonly jobs: readonly GptSeoJob[];
  readonly counts: Readonly<Record<string, number>>;
  readonly activeBatch: GptSeoBatch | null;
  readonly activeBatches: readonly GptSeoBatch[];
  readonly nextOffset: number;
}

export interface SeoQueueStore {
  readonly storeId: string;
  readonly shopDomain: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createCustomGptClient(fetcher: typeof fetch = fetch) {
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
    stores: listStores,
    settings: (storeId: string) => request<GptSeoSettings>("settings", storeId),
    configure: (storeId: string, settings: GptSeoSettings) => request<GptSeoSettings>("settings", storeId, settings),
    list: (storeId: string, offset = 0, status?: "REVIEW_READY") => request<GptQueuePage>(`jobs?offset=${offset}${status ? `&status=${status}` : ""}`, storeId),
    job: (storeId: string, jobId: string) => request<GptSeoJob>(`job?jobId=${encodeURIComponent(jobId)}`, storeId),
    enqueue: (input: GptSeoEnqueue) => request<GptSeoJob>("enqueue", input.storeId, input),
    retry: (storeId: string, jobId: string) => request<unknown>("retry", storeId, { jobId }),
    cancelReview: (storeId: string, jobId: string) => request<{ readonly cancelled: boolean }>("cancel", storeId, { jobId }),
    transfer: (storeId: string, jobId: string, provider: SeoProvider) => request<unknown>("transfer", storeId, { jobId, provider }),
    beginSync: (storeId: string, jobId: string) => request<{ token: string }>("begin-sync", storeId, { jobId }),
    finishSync: (storeId: string, jobId: string, token: string, status: "SYNCED" | "UNKNOWN") => request<unknown>("finish-sync", storeId, { jobId, token, status }),
    release: (storeId: string, batchId: string) => request<unknown>("release", storeId, { batchId }),
    reviewState: (storeId: string, jobId: string) => request<Record<string, unknown>>(`review-state?jobId=${encodeURIComponent(jobId)}`, storeId),
    saveReviewState: (storeId: string, jobId: string, state: unknown) => request<unknown>("review-state", storeId, { jobId, state }),
  };
}
export type CustomGptClient = ReturnType<typeof createCustomGptClient>;
