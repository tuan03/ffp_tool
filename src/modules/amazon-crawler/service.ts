import type {
  AmazonCrawlerInput,
  AmazonCrawlerCacheClearer,
  AmazonCrawlerJobSnapshot,
  AmazonCrawlerOutput,
  AmazonCrawlerRunOptions,
  AmazonCrawlerRunner,
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
  if (!isRecord(value) || typeof value.jobId !== "string") {
    throw new AmazonCrawlerServiceError("Engine returned an invalid job response.", "INVALID_ENGINE_RESPONSE");
  }
  return { jobId: value.jobId };
}

function readSnapshot(value: unknown): AmazonCrawlerJobSnapshot {
  if (!isRecord(value) || typeof value.jobId !== "string" || typeof value.status !== "string") {
    throw new AmazonCrawlerServiceError("Engine returned an invalid job snapshot.", "INVALID_ENGINE_RESPONSE");
  }
  return value as unknown as AmazonCrawlerJobSnapshot;
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

  return async ({ input, onProgress, signal }: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput> => {
    let jobId: string | null = null;
    let cancellationRequested = false;

    const cancelJob = (): void => {
      if (jobId === null || cancellationRequested) return;
      cancellationRequested = true;
      void fetchImplementation(`${baseUrl}/api/amazon-crawler/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancelJob, { once: true });

    try {
      if (signal?.aborted) throw new DOMException("The crawler job was cancelled.", "AbortError");
      let createResponse: Response;
      try {
        createResponse = await fetchImplementation(`${baseUrl}/api/amazon-crawler/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal,
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new AmazonCrawlerServiceError(
          "Không kết nối được Amazon crawler engine. Hãy chạy npm run dev:engine.",
          "ENGINE_OFFLINE",
        );
      }

      const created = readJobCreated(await readJson(createResponse));
      jobId = created.jobId;

      for (;;) {
        if (signal?.aborted) {
          cancelJob();
          throw new DOMException("The crawler job was cancelled.", "AbortError");
        }
        const response = await fetchImplementation(
          `${baseUrl}/api/amazon-crawler/jobs/${encodeURIComponent(jobId)}`,
          { signal },
        );
        const snapshot = readSnapshot(await readJson(response));
        onProgress?.(snapshot.progress);

        if (snapshot.result !== null) return snapshot.result;
        if (snapshot.status === "failed") {
          throw new AmazonCrawlerServiceError(snapshot.error ?? "Amazon crawler job failed.", "JOB_FAILED");
        }
        if (snapshot.status === "cancelled") {
          throw new DOMException("The crawler job was cancelled.", "AbortError");
        }
        await wait(pollIntervalMs, signal);
      }
    } finally {
      signal?.removeEventListener("abort", cancelJob);
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
      response = await fetchImplementation(`${baseUrl}/api/amazon-crawler/cache`, { method: "DELETE" });
    } catch {
      throw new AmazonCrawlerServiceError(
        "Không kết nối được Amazon crawler engine. Hãy chạy npm run dev:engine.",
        "ENGINE_OFFLINE",
      );
    }
    return readCacheClearResult(await readJson(response));
  };
}
