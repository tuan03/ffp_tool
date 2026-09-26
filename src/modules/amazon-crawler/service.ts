import type {
  AmazonAsinChecker,
  AmazonAsinPreflightResult,
  AmazonCrawlerInput,
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientSummary,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerHydratedJob,
  AmazonCrawlerJobLoader,
  AmazonCrawlerJobSnapshot,
  AmazonCrawlerJobController,
  AmazonCrawlerJobSummary,
  AmazonCrawlerOutput,
  AmazonCrawlerProduct,
  AmazonCrawlerProgress,
  AmazonCrawlerReviewClient,
  AmazonCrawlerReviewDecision,
  AmazonCrawlerReviewEditPatch,
  AmazonCrawlerReviewItem,
  AmazonCrawlerRunOptions,
  AmazonCrawlerRunner,
  AmazonCrawlerSettings,
  AmazonCrawlerStatistics,
  AmazonCrawlerSyncRetrier,
  ImageProcessingProfile,
  ImageProcessingProfileManager,
} from "./types";
import { DEFAULT_AMAZON_CRAWLER_SETTINGS } from "./types";

interface JobCreatedResponse {
  jobId: string;
}
function readCacheClearResult(value: unknown): { removedFiles: number; removedBytes: number } {
  if (!isRecord(value) || typeof value.removedFiles !== "number" || typeof value.removedBytes !== "number") {
    throw new AmazonCrawlerServiceError("Engine returned an invalid cache response.", "INVALID_ENGINE_RESPONSE");
  }
  return { removedFiles: value.removedFiles, removedBytes: value.removedBytes };
}

interface AmazonCrawlerClientOptions {
  engineUrl: string;
  fetchImplementation?: typeof fetch;
  pollIntervalMs?: number;
}

export class AmazonCrawlerServiceError extends Error {
  public readonly code: string;
  public readonly status: number | null;

  public constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "AmazonCrawlerServiceError";
    this.code = code;
    this.status = status;
  }
}

export function createAmazonAsinChecker(fetchImplementation: typeof fetch = fetch): AmazonAsinChecker {
  return async (storeId, asins): Promise<AmazonAsinPreflightResult> => {
    const response = await fetchImplementation("/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        operation: "products.preflightAmazonAsins",
        mode: "apply",
        requestId: `amazon-asin-preflight-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        payload: { asins },
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body) || body.success !== true || !isRecord(body.data)) {
      const error = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string"
        ? body.error.message
        : "Không kiểm tra được ASIN trên Shopify.";
      throw new AmazonCrawlerServiceError(error, "SHOPIFY_ASIN_PREFLIGHT_FAILED", response.status);
    }
    const preflight = body.data;
    if (typeof preflight.ready !== "boolean" || !Array.isArray(preflight.matches) ||
      preflight.matches.some((match: unknown) => !isRecord(match) || typeof match.asin !== "string" ||
        typeof match.productId !== "string" || typeof match.title !== "string" || typeof match.adminUrl !== "string")) {
      throw new AmazonCrawlerServiceError("Shopify trả về kết quả kiểm tra ASIN không hợp lệ.", "INVALID_ENGINE_RESPONSE");
    }
    return preflight as unknown as AmazonAsinPreflightResult;
  };
}

function normalizeEngineUrl(engineUrl: string): string {
  return engineUrl.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJobCreated(value: unknown): JobCreatedResponse {
  if (!isRecord(value) || (typeof value.id !== "string" && typeof value.jobId !== "string")) {
    throw new AmazonCrawlerServiceError("Engine returned an invalid job response.", "INVALID_ENGINE_RESPONSE");
  }
  return { jobId: typeof value.id === "string" ? value.id : value.jobId as string };
}

interface CoordinatorSnapshot {
  id: string;
  status: AmazonCrawlerJobSnapshot["status"];
  progress: AmazonCrawlerProgress;
}

function readSnapshot(value: unknown): CoordinatorSnapshot {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string" || !isRecord(value.progress)) {
    throw new AmazonCrawlerServiceError("Engine returned an invalid job snapshot.", "INVALID_ENGINE_RESPONSE");
  }
  const completed = value.progress.completed;
  const total = value.progress.total;
  if (typeof completed !== "number" || typeof total !== "number") {
    throw new AmazonCrawlerServiceError("Engine returned invalid job progress.", "INVALID_ENGINE_RESPONSE");
  }
  const status = value.status as CoordinatorSnapshot["status"];
  const isTerminal = ["review_pending", "completed", "partial", "cancelled"].includes(status);
  return {
    id: value.id,
    status,
    progress: {
      phase: typeof value.progress.phase === "string" ? value.progress.phase as AmazonCrawlerProgress["phase"] : (isTerminal ? "export" : "product"),
      completed,
      total,
      message: typeof value.progress.message === "string"
        ? value.progress.message
        : (isTerminal ? `Đã xử lý ${completed}/${total} link.` : `Đang xử lý ${completed}/${total} link trên các client.`),
      items: Array.isArray(value.progress.items) ? value.progress.items as AmazonCrawlerProgress["items"] : undefined,
      browserPool: isRecord(value.progress.browserPool) ? value.progress.browserPool as unknown as AmazonCrawlerProgress["browserPool"] : undefined,
    },
  };
}

function readJobSnapshot(value: unknown): AmazonCrawlerJobSnapshot {
  const core = readSnapshot(value);
  if (!isRecord(value)) {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid job snapshot.", "INVALID_ENGINE_RESPONSE");
  }
  const cancellation = isRecord(value.cancellation) ? value.cancellation : {};
  const pendingAgents = Array.isArray(cancellation.pendingAgents)
    ? cancellation.pendingAgents.flatMap((pendingAgent) => {
        if (!isRecord(pendingAgent) || typeof pendingAgent.clientId !== "string") return [];
        return [{
          clientId: pendingAgent.clientId,
          displayName: typeof pendingAgent.displayName === "string" ? pendingAgent.displayName : pendingAgent.clientId,
          status: typeof pendingAgent.status === "string"
            ? pendingAgent.status as AmazonCrawlerClientSummary["status"]
            : "offline" as const,
          taskCount: typeof pendingAgent.taskCount === "number" ? pendingAgent.taskCount : 0,
          receivedTaskCount: typeof pendingAgent.receivedTaskCount === "number" ? pendingAgent.receivedTaskCount : 0,
          hasReceived: pendingAgent.hasReceived === true,
        }];
      })
    : [];
  const pendingPipeline = Array.isArray(cancellation.pendingPipeline)
    ? cancellation.pendingPipeline.flatMap((pendingItem) => {
        if (!isRecord(pendingItem) || typeof pendingItem.itemId !== "string" || typeof pendingItem.sourceKey !== "string") return [];
        return [{
          itemId: pendingItem.itemId,
          sourceKey: pendingItem.sourceKey,
          phase: typeof pendingItem.phase === "string"
            ? pendingItem.phase as AmazonCrawlerJobSnapshot["cancellation"]["pendingPipeline"][number]["phase"]
            : "pipeline" as const,
          workerId: typeof pendingItem.workerId === "string" ? pendingItem.workerId : null,
          receivedAt: typeof pendingItem.receivedAt === "string" ? pendingItem.receivedAt : null,
        }];
      })
    : [];
  const pendingCleanupAgents = Array.isArray(cancellation.pendingCleanupAgents)
    ? cancellation.pendingCleanupAgents.flatMap((pendingCleanup) => {
        if (!isRecord(pendingCleanup) || typeof pendingCleanup.clientId !== "string") return [];
        return [{
          clientId: pendingCleanup.clientId,
          displayName: typeof pendingCleanup.displayName === "string"
            ? pendingCleanup.displayName
            : pendingCleanup.clientId,
          status: typeof pendingCleanup.status === "string" ? pendingCleanup.status : "pending",
          error: typeof pendingCleanup.error === "string" ? pendingCleanup.error : null,
        }];
      })
    : [];
  return {
    jobId: core.id,
    status: core.status,
    progress: core.progress,
    result: null,
    error: null,
    inputs: Array.isArray(value.inputs) ? value.inputs.filter((input): input is string => typeof input === "string") : [],
    settings: isRecord(value.settings)
      ? { ...DEFAULT_AMAZON_CRAWLER_SETTINGS, ...value.settings } as AmazonCrawlerJobSnapshot["settings"]
      : DEFAULT_AMAZON_CRAWLER_SETTINGS,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
    replacementOfJobId: typeof value.replacementOfJobId === "string" ? value.replacementOfJobId : null,
    cancellation: {
      id: typeof cancellation.id === "string" ? cancellation.id : null,
      requestedAt: typeof cancellation.requestedAt === "string" ? cancellation.requestedAt : null,
      pendingAgents,
      pendingPipeline,
      pendingPipelineItems: typeof cancellation.pendingPipelineItems === "number" ? cancellation.pendingPipelineItems : 0,
      pendingCleanupAgents,
      cacheGeneration: typeof cancellation.cacheGeneration === "number" ? cancellation.cacheGeneration : null,
      isExecutionConfirmed: cancellation.isExecutionConfirmed === true,
    },
  };
}

const AVAILABLE_CLIENT_STATUSES = new Set(["online", "busy", "waiting_captcha"]);

function readClients(value: unknown): AmazonCrawlerClientSummary[] {
  if (!Array.isArray(value)) throw new AmazonCrawlerServiceError("Coordinator returned an invalid client list.", "INVALID_ENGINE_RESPONSE");
  return value.map((client) => {
    if (!isRecord(client) || typeof client.id !== "string" || typeof client.displayName !== "string" || typeof client.status !== "string") {
      throw new AmazonCrawlerServiceError("Coordinator returned an invalid client record.", "INVALID_ENGINE_RESPONSE");
    }
    return {
      id: client.id,
      displayName: client.displayName,
      status: client.status as AmazonCrawlerClientSummary["status"],
      isConnected: client.isConnected === true,
      maxConcurrentInputs: typeof client.maxConcurrentInputs === "number" ? client.maxConcurrentInputs : 0,
      activeTasks: typeof client.activeTasks === "number" ? client.activeTasks : 0,
      leasedTasks: typeof client.leasedTasks === "number" ? client.leasedTasks : 0,
      availableSlots: typeof client.availableSlots === "number" ? client.availableSlots : 0,
      lastSeenAt: typeof client.lastSeenAt === "string" ? client.lastSeenAt : null,
    };
  });
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === "string" ? body.detail : response.statusText;
    throw new AmazonCrawlerServiceError(detail || "Amazon crawler engine request failed.", "ENGINE_REQUEST_FAILED", response.status);
  }
  return body;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The crawler job was cancelled.", "AbortError"));
      return;
    }
    const timeoutId = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        reject(new DOMException("The crawler job was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export function createAmazonCrawlerRunner({
  engineUrl,
  fetchImplementation = fetch,
  pollIntervalMs = 700,
}: AmazonCrawlerClientOptions): AmazonCrawlerRunner {
  const baseUrl = normalizeEngineUrl(engineUrl);

  return async ({ input, onProgress, onProducts, onJobCreated, signal }: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput> => {
    let jobId: string | null = null;
    let cancellationPromise: Promise<void> | null = null;

    const cancelJob = (): Promise<void> => {
      if (jobId === null) return Promise.resolve();
      if (cancellationPromise) return cancellationPromise;
      cancellationPromise = (async () => {
        const response = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/cancel`,
          { method: "POST" },
        );
        if (response.status === 404) return;
        await readJson(response);
      })();
      return cancellationPromise;
    };
    const handleAbort = (): void => {
      void cancelJob();
    };
    signal?.addEventListener("abort", handleAbort, { once: true });

    try {
      if (signal?.aborted) throw new DOMException("The crawler job was cancelled.", "AbortError");
      const clientsResponse = await fetchImplementation(`${baseUrl}/api/v1/clients`, { signal }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new AmazonCrawlerServiceError("Không kết nối được coordinator. Hãy chạy npm run dev.", "COORDINATOR_OFFLINE");
      });
      const clients = readClients(await readJson(clientsResponse));
      if (!clients.some((client) => client.isConnected && AVAILABLE_CLIENT_STATUSES.has(client.status))) {
        throw new AmazonCrawlerServiceError("Chưa có máy crawler nào đang online. Hãy mở FFP Amazon Crawler Agent.", "NO_CLIENT_AVAILABLE");
      }
      let createResponse: Response;
      try {
        createResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new AmazonCrawlerServiceError(
          "Không kết nối được coordinator. Hãy chạy npm run dev.",
          "COORDINATOR_OFFLINE",
        );
      }

      const created = readJobCreated(await readJson(createResponse));
      jobId = created.jobId;
      onJobCreated?.(jobId);

      for (;;) {
        if (signal?.aborted) {
          throw new DOMException("The crawler job was cancelled.", "AbortError");
        }
        const response = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}`,
          { signal },
        );
        if (response.status === 404) {
          throw new DOMException("The crawler job was stopped and removed.", "AbortError");
        }
        const snapshot = readSnapshot(await readJson(response));
        onProgress?.(snapshot.progress);
        if (onProducts) {
          const productsResponse = await fetchImplementation(
            `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/products`,
            { signal },
          );
          const productsPayload = await readJson(productsResponse);
          if (isRecord(productsPayload) && Array.isArray(productsPayload.products)) {
            onProducts(productsPayload.products as AmazonCrawlerOutput["products"]);
          }
        }

        if (snapshot.status === "review_pending" || snapshot.status === "completed" || snapshot.status === "partial") {
          const resultResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/results`, { signal });
          return await readJson(resultResponse) as AmazonCrawlerOutput;
        }
        if (snapshot.status === "cancelled") {
          throw new DOMException("The crawler job was cancelled.", "AbortError");
        }
        await wait(pollIntervalMs, signal);
      }
    } catch (caught: unknown) {
      if (signal?.aborted && jobId !== null) {
        try {
          await cancelJob();
        } catch {
          throw new AmazonCrawlerServiceError(
            "Không thể xác nhận coordinator đã dừng các crawler agent. Vui lòng thử Stop lại hoặc kiểm tra kết nối server.",
            "CANCEL_CONFIRMATION_FAILED",
          );
        }
      }
      throw caught;
    } finally {
      signal?.removeEventListener("abort", handleAbort);
    }
  };
}

export function createAmazonCrawlerJobController({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerJobController {
  const baseUrl = normalizeEngineUrl(engineUrl);
  const jobUrl = (jobId: string): string => `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}`;
  return {
    async list(limit = 50) {
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs?limit=${Math.max(1, Math.min(500, limit))}`));
      if (!Array.isArray(payload)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid job list.", "INVALID_ENGINE_RESPONSE");
      }
      return payload.map(readJobSnapshot);
    },
    async get(jobId) {
      const snapshot = readJobSnapshot(await readJson(await fetchImplementation(jobUrl(jobId))));
      if (snapshot.status === "review_pending" || snapshot.status === "completed" || snapshot.status === "partial") {
        const result = await readJson(await fetchImplementation(`${jobUrl(jobId)}/results`));
        return { ...snapshot, result: result as AmazonCrawlerOutput };
      }
      return snapshot;
    },
    async cancel(jobId, options) {
      const query = options?.force ? "?force=true" : "";
      const response = await fetchImplementation(`${jobUrl(jobId)}/cancel${query}`, { method: "POST" });
      return readJobSnapshot(await readJson(response));
    },
    async replace(jobId, input) {
      const response = await fetchImplementation(`${jobUrl(jobId)}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          externalRequestId: `replace-${jobId}-${globalThis.crypto.randomUUID()}`,
        }),
      });
      const payload = await readJson(response);
      if (!isRecord(payload) || !isRecord(payload.replacementJob)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid replacement job.", "INVALID_ENGINE_RESPONSE");
      }
      return readJobSnapshot(payload.replacementJob);
    },
    async delete(jobId) {
      await readJson(await fetchImplementation(jobUrl(jobId), { method: "DELETE" }));
    },
  };
}

export function createAmazonCrawlerSyncRetrier({
  engineUrl,
  fetchImplementation = fetch,
  pollIntervalMs = 700,
}: AmazonCrawlerClientOptions): AmazonCrawlerSyncRetrier {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return async (jobId, options = {}) => {
    const response = await fetchImplementation(
      `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/retry-failed-syncs`,
      { method: "POST", signal: options.signal },
    );
    const payload = await readJson(response);
    if (!isRecord(payload) || typeof payload.retried !== "number") {
      throw new AmazonCrawlerServiceError("Coordinator returned an invalid retry response.", "INVALID_ENGINE_RESPONSE");
    }
    if (payload.retried === 0) return { retried: 0 };

    for (;;) {
      const snapshotResponse = await fetchImplementation(
        `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}`,
        { signal: options.signal },
      );
      const snapshot = readSnapshot(await readJson(snapshotResponse));
      options.onProgress?.(snapshot.progress);
      if (options.onProducts) {
        const productsResponse = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/products`,
          { signal: options.signal },
        );
        const productsPayload = await readJson(productsResponse);
        if (isRecord(productsPayload) && Array.isArray(productsPayload.products)) {
          options.onProducts(productsPayload.products as AmazonCrawlerOutput["products"]);
        }
      }
      if (snapshot.status === "review_pending" || snapshot.status === "completed" || snapshot.status === "partial") {
        const resultResponse = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}/results`,
          { signal: options.signal },
        );
        return {
          retried: payload.retried,
          output: await readJson(resultResponse) as AmazonCrawlerOutput,
        };
      }
      if (snapshot.status === "cancelled") {
        throw new DOMException("The crawler job was cancelled.", "AbortError");
      }
      await wait(pollIntervalMs, options.signal);
    }
  };
}

export function serializeAmazonCrawlerInput(input: AmazonCrawlerInput): string {
  return JSON.stringify(input);
}

export function createAmazonCrawlerCacheClearer({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerCacheClearer {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return async () => {
    let response: Response;
    try {
      response = await fetchImplementation(`${baseUrl}/api/v1/clients/cache`, { method: "DELETE" });
    } catch {
      throw new AmazonCrawlerServiceError(
        "Không kết nối được coordinator. Hãy chạy npm run dev.",
        "COORDINATOR_OFFLINE",
      );
    }
    return readCacheClearResult(await readJson(response));
  };
}

export function createAmazonCrawlerClientsLoader({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerClientsLoader {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return async () => {
    try {
      const response = await fetchImplementation(`${baseUrl}/api/v1/clients`);
      return readClients(await readJson(response)).filter(
        (client) => client.isConnected && client.status !== "offline",
      );
    } catch (error: unknown) {
      if (error instanceof AmazonCrawlerServiceError) throw error;
      throw new AmazonCrawlerServiceError("Không kết nối được coordinator. Hãy chạy npm run dev.", "COORDINATOR_OFFLINE");
    }
  };
}

function readImageProfile(value: unknown, baseUrl?: string): ImageProcessingProfile {
  if (!isRecord(value) || typeof value.slug !== "string" || typeof value.name !== "string") {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid image profile.", "INVALID_ENGINE_RESPONSE");
  }
  const profile = value as unknown as ImageProcessingProfile;
  if (!profile.hasLogo || !baseUrl) return profile;
  return {
    ...profile,
    logoUrl: `${baseUrl}/api/v1/image-profiles/${encodeURIComponent(profile.slug)}/logo?revision=${encodeURIComponent(profile.revision)}`,
  };
}

export function createImageProcessingProfileManager({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): ImageProcessingProfileManager {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return {
    async list() {
      const payload = await readJson(await fetchImplementation(`${baseUrl}/api/v1/image-profiles`));
      if (!isRecord(payload) || !Array.isArray(payload.profiles)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid image profile list.", "INVALID_ENGINE_RESPONSE");
      }
      return payload.profiles.map((profile) => readImageProfile(profile, baseUrl));
    },
    async save(slug, profile) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      return readImageProfile(await readJson(response), baseUrl);
    },
    async delete(slug) {
      await readJson(await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      }));
    },
    async uploadLogo(slug, dataUrl) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      return readImageProfile(await readJson(response), baseUrl);
    },
    async preview(slug, profile, dataUrl) {
      const response = await fetchImplementation(`${baseUrl}/api/v1/image-profiles/${encodeURIComponent(slug)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, dataUrl }),
      });
      const payload = await readJson(response);
      if (!isRecord(payload) || typeof payload.dataUrl !== "string") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid image preview.", "INVALID_ENGINE_RESPONSE");
      }
      return payload.dataUrl;
    },
  };
}

function readReviewItem(value: unknown): AmazonCrawlerReviewItem {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.jobId !== "string" ||
    typeof value.sourceKey !== "string" ||
    typeof value.storeId !== "string" ||
    !["pending", "approved", "rejected"].includes(String(value.decision)) ||
    !["idle", "queued", "syncing", "synced", "failed"].includes(String(value.syncStatus)) ||
    typeof value.version !== "number" ||
    !isRecord(value.target) ||
    !isRecord(value.product)
  ) {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid review item.", "INVALID_ENGINE_RESPONSE");
  }
  return value as unknown as AmazonCrawlerReviewItem;
}

function readReviewItems(value: unknown): readonly AmazonCrawlerReviewItem[] {
  const items = isRecord(value) ? value.items : value;
  if (!Array.isArray(items)) {
    throw new AmazonCrawlerServiceError("Coordinator returned an invalid review list.", "INVALID_ENGINE_RESPONSE");
  }
  return items.map(readReviewItem);
}

export function createAmazonCrawlerReviewClient({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerReviewClient {
  const baseUrl = normalizeEngineUrl(engineUrl);
  const reviewUrl = `${baseUrl}/api/v1/product-reviews`;

  const sendJson = async (url: string, method: string, body?: object): Promise<unknown> => {
    return readJson(await fetchImplementation(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }));
  };

  return {
    async list() {
      return readReviewItems(await readJson(await fetchImplementation(reviewUrl)));
    },
    subscribe(onItems) {
      let isClosed = false;
      let isPolling = false;
      const poll = async (): Promise<void> => {
        if (isClosed || isPolling) return;
        isPolling = true;
        try {
          const items = readReviewItems(await readJson(await fetchImplementation(reviewUrl)));
          if (!isClosed) onItems(items);
        } catch {
          // Keep the last snapshot while the next poll or SSE reconnects.
        } finally {
          isPolling = false;
        }
      };
      void poll();
      const pollTimer = setInterval(() => void poll(), 2_000);
      if (typeof EventSource === "undefined") {
        return () => {
          isClosed = true;
          clearInterval(pollTimer);
        };
      }
      const source = new EventSource(`${reviewUrl}/events`);
      source.addEventListener("review_snapshot", (event) => {
        try {
          const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
          if (!isClosed) onItems(readReviewItems(parsed));
        } catch {
          // Ignore malformed events; the initial request remains authoritative.
        }
      });
      source.onerror = () => {
        void poll();
      };
      return () => {
        isClosed = true;
        source.close();
        clearInterval(pollTimer);
      };
    },
    async update(itemId: string, expectedVersion: number, patch: AmazonCrawlerReviewEditPatch) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}`, "PATCH", {
        expectedVersion,
        patch,
      }));
    },
    async decide(
      itemId: string,
      expectedVersion: number,
      decision: AmazonCrawlerReviewDecision,
      reason?: string,
    ) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/decision`, "POST", {
        expectedVersion,
        decision,
        reason,
      }));
    },
    async sync(itemId: string) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/sync`, "POST"));
    },
    async syncAllApproved() {
      const value = await sendJson(`${reviewUrl}/sync-approved`, "POST");
      if (!isRecord(value) || typeof value.queued !== "number" || !Array.isArray(value.itemIds)) {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid batch sync response.", "INVALID_ENGINE_RESPONSE");
      }
      return { queued: value.queued, itemIds: value.itemIds.map(String) };
    },
    async markSynced(itemId: string, info?: { productId?: string; productHandle?: string; adminUrl?: string }) {
      return readReviewItem(await sendJson(`${reviewUrl}/${encodeURIComponent(itemId)}/synced`, "POST", info ?? {}));
    },
    async deleteAll() {
      const value = await sendJson(reviewUrl, "DELETE");
      if (!isRecord(value) || typeof value.deleted !== "number" || typeof value.skipped !== "number") {
        throw new AmazonCrawlerServiceError("Coordinator returned an invalid review delete response.", "INVALID_ENGINE_RESPONSE");
      }
      return { deleted: value.deleted, skipped: value.skipped };
    },
    imageUrl(fileToken: string) {
      return `${reviewUrl}/images/${encodeURIComponent(fileToken)}`;
    },
  };
}

export function createAmazonCrawlerJobLoader({
  engineUrl,
  fetchImplementation = fetch,
}: AmazonCrawlerClientOptions): AmazonCrawlerJobLoader {
  const baseUrl = normalizeEngineUrl(engineUrl);
  return {
    async loadJob(jobId?: string): Promise<AmazonCrawlerHydratedJob | null> {
      try {
        let targetJobId = jobId;
        let jobSnapshot: CoordinatorSnapshot | null = null;
        let jobSettings: AmazonCrawlerSettings | undefined = undefined;

        if (!targetJobId) {
          const recentResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs?limit=5`);
          const recentJobs = await readJson(recentResponse);
          if (Array.isArray(recentJobs) && recentJobs.length > 0) {
            const candidate = recentJobs.find((j: unknown) => isRecord(j) && typeof j.id === "string") as Record<string, unknown> | undefined;
            if (candidate) {
              targetJobId = candidate.id as string;
              if (candidate.settings && isRecord(candidate.settings)) {
                jobSettings = candidate.settings as unknown as AmazonCrawlerSettings;
              }
            }
          }
        }

        if (!targetJobId) return null;

        const snapshotResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(targetJobId)}`);
        if (!snapshotResponse.ok) return null;
        const snapshotRaw = await readJson(snapshotResponse);
        if (!isRecord(snapshotRaw)) return null;
        jobSnapshot = readSnapshot(snapshotRaw);
        if (snapshotRaw.settings && isRecord(snapshotRaw.settings)) {
          jobSettings = snapshotRaw.settings as unknown as AmazonCrawlerSettings;
        }

        let products: AmazonCrawlerProduct[] = [];
        try {
          const productsResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(targetJobId)}/products`);
          if (productsResponse.ok) {
            const productsPayload = await readJson(productsResponse);
            if (isRecord(productsPayload) && Array.isArray(productsPayload.products)) {
              products = productsPayload.products as AmazonCrawlerProduct[];
            }
          }
        } catch {
          // ignore product fetch failure
        }

        let output: AmazonCrawlerOutput | null = null;
        if (jobSnapshot.status === "review_pending" || jobSnapshot.status === "completed" || jobSnapshot.status === "partial") {
          try {
            const resultsResponse = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(targetJobId)}/results`);
            if (resultsResponse.ok) {
              output = await readJson(resultsResponse) as AmazonCrawlerOutput;
              if (output && Array.isArray(output.products) && output.products.length > products.length) {
                products = output.products;
              }
            }
          } catch {
            // ignore results failure
          }
        }

        if (!output && products.length > 0) {
          const stats: AmazonCrawlerStatistics = {
            requestedInputs: products.length,
            acceptedInputs: products.length,
            rejectedInputs: 0,
            products: products.length,
            sourceVariants: products.reduce((count, product) => count + (product.sourceVariants?.length || 0), 0),
            finalVariants: products.reduce((count, product) => count + (product.variants?.length || 0), 0),
            durationMs: 0,
          };
          output = {
            version: "1.0",
            jobId: targetJobId,
            status: (jobSnapshot.status === "review_pending" || jobSnapshot.status === "completed" || jobSnapshot.status === "partial" || jobSnapshot.status === "cancelled")
              ? jobSnapshot.status
              : "completed",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            settings: jobSettings ?? DEFAULT_AMAZON_CRAWLER_SETTINGS,
            statistics: stats,
            products,
            errors: [],
            warnings: [],
            exportFilename: null,
          };
        }

        return {
          jobId: targetJobId,
          status: jobSnapshot.status,
          progress: jobSnapshot.progress,
          products,
          output,
          settings: jobSettings,
        };
      } catch (error: unknown) {
        if (error instanceof AmazonCrawlerServiceError) throw error;
        return null;
      }
    },

    async listRecentJobs(limit: number = 10): Promise<AmazonCrawlerJobSummary[]> {
      try {
        const response = await fetchImplementation(`${baseUrl}/api/v1/crawl-jobs?limit=${limit}`);
        const payload = await readJson(response);
        if (!Array.isArray(payload)) return [];
        return payload.map((job: unknown) => {
          const jobRecord = isRecord(job) ? job : {};
          return {
            id: String(jobRecord.id || ""),
            status: (jobRecord.status as AmazonCrawlerJobSummary["status"]) || "queued",
            createdAt: String(jobRecord.createdAt || ""),
            startedAt: jobRecord.startedAt ? String(jobRecord.startedAt) : null,
            completedAt: jobRecord.completedAt ? String(jobRecord.completedAt) : null,
            acceptedInputs: typeof jobRecord.acceptedInputs === "number" ? jobRecord.acceptedInputs : 0,
            productCounts: isRecord(jobRecord.productCounts) ? (jobRecord.productCounts as Record<string, number>) : undefined,
            progress: isRecord(jobRecord.progress) ? (jobRecord.progress as unknown as AmazonCrawlerProgress) : undefined,
          };
        });
      } catch {
        return [];
      }
    },
  };
}
