import type {
  AmazonCrawlerInput,
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientSummary,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerJobSnapshot,
  AmazonCrawlerOutput,
  AmazonCrawlerProgress,
  AmazonCrawlerRunOptions,
  AmazonCrawlerRunner,
  AmazonCrawlerSyncRetrier,
  ImageProcessingProfile,
  ImageProcessingProfileManager,
} from "./types";

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
  const isTerminal = ["completed", "partial", "cancelled"].includes(status);
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

  return async ({ input, onProgress, onProducts, signal }: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput> => {
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

      for (;;) {
        if (signal?.aborted) {
          throw new DOMException("The crawler job was cancelled.", "AbortError");
        }
        const response = await fetchImplementation(
          `${baseUrl}/api/v1/crawl-jobs/${encodeURIComponent(jobId)}`,
          { signal },
        );
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

        if (snapshot.status === "completed" || snapshot.status === "partial") {
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
      if (snapshot.status === "completed" || snapshot.status === "partial") {
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
      return readClients(await readJson(response));
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
