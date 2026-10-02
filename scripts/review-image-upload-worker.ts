import path from "node:path";

interface UploadWorkerOptions {
  readonly coordinatorUrl: string;
  readonly gatewayUrl: string;
  readonly pipelineToken: string;
  readonly gatewayToken: string;
  readonly outputRoot: string;
  readonly fetcher?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function runReviewImageUploadTick(options: UploadWorkerOptions): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const post = async (url: string, body: unknown, token: string, header: string): Promise<unknown> => {
    const response = await fetcher(url, {
      method: "POST", headers: { "Content-Type": "application/json", [header]: token },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("Review image upload transport failed");
    return response.json();
  };
  const base = `${options.coordinatorUrl}/api/v1/internal/review-images/uploads`;
  const claim = await post(`${base}/claim`, {}, options.pipelineToken, "X-Pipeline-Key");
  if (!isRecord(claim) || claim.upload === null) return;
  const upload = claim.upload;
  if (!isRecord(upload) || typeof upload.jobId !== "string" || !/^[a-f0-9]{32}$/.test(upload.jobId)
    || typeof upload.attemptId !== "string" || !/^[a-f0-9]{32}$/.test(upload.attemptId)
    || typeof upload.storeId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(upload.storeId)
    || typeof upload.outputName !== "string" || !new RegExp(`^${upload.jobId}\\.(png|jpe?g|webp)$`).test(upload.outputName)) {
    throw new Error("Invalid review image upload claim");
  }
  let result: { fileId: string; shopifyCdnUrl: string; fileStatus: string } | null = null;
  try {
    const response = await post(options.gatewayUrl, {
      storeId: upload.storeId, operation: "files.create", mode: "apply",
      requestId: `review-image:${upload.storeId}:${upload.jobId}`,
      payload: { originalSource: path.resolve(options.outputRoot, upload.outputName),
        filename: `review-${upload.outputName}`, alt: "Customer review photo", contentType: "IMAGE" },
    }, options.gatewayToken, "x-gateway-key");
    if (isRecord(response) && response.success === true && isRecord(response.data)
      && typeof response.data.fileId === "string" && typeof response.data.shopifyCdnUrl === "string"
      && typeof response.data.fileStatus === "string") {
      result = { fileId: response.data.fileId, shopifyCdnUrl: response.data.shopifyCdnUrl, fileStatus: response.data.fileStatus };
    }
  } catch {
    // The remote write may have succeeded: never send it again automatically.
  }
  // Retry acknowledgement only, never the Shopify operation.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await post(`${base}/${upload.jobId}/finish`, { attemptId: upload.attemptId, result }, options.pipelineToken, "X-Pipeline-Key");
      return;
    } catch {
      if (attempt === 2) throw new Error("Review upload needs reconciliation; automatic write replay is disabled");
    }
  }
}

export function startReviewImageUploadWorker(options: UploadWorkerOptions): AbortController {
  const controller = new AbortController();
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        await runReviewImageUploadTick(options);
      } catch {
        console.warn("[Review image worker] Queue unavailable or upload needs reconciliation; no write was replayed.");
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  })();
  return controller;
}
