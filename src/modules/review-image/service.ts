import type { CreateReviewImageInput, ReviewImageClient, ReviewImageJob } from "./types";

const API_BASE = "/api/review-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Bridge trả về phản hồi không hợp lệ.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Bridge trả về phản hồi không hợp lệ.");
  }
  const record = payload as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof record.message === "string" ? record.message : record.detail;
    throw new Error(typeof message === "string" ? message : "Không thể xử lý ảnh review.");
  }
  return record;
}

function parseJob(payload: Record<string, unknown>): ReviewImageJob {
  const job = payload.job;
  if (!job || typeof job !== "object" || Array.isArray(job) || typeof (job as Record<string, unknown>).job_id !== "string") {
    throw new Error("Bridge không trả về job ảnh hợp lệ.");
  }
  return job as ReviewImageJob;
}

export function createReviewImageClient(fetcher: Fetcher = fetch): ReviewImageClient {
  let gatewayToken = "";
  const headers = (extra?: HeadersInit): Headers => {
    const result = new Headers(extra);
    if (gatewayToken) result.set("x-gateway-key", gatewayToken);
    return result;
  };
  const binary = async (url: string): Promise<Blob> => {
    const response = await fetcher(url, { headers: headers() });
    if (!response.ok) {
      try { await parseResponse(response); } catch (error) { throw error; }
      throw new Error("Không tải được ảnh review.");
    }
    return response.blob();
  };
  return {
    setGatewayToken(token) { gatewayToken = token.trim(); },
    async health() {
      const payload = await parseResponse(await fetcher(`${API_BASE}/health`, { headers: headers() }));
      return { templates: typeof payload.templates === "number" ? payload.templates : 0 };
    },
    async create(input) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/jobs`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      }));
      return parseJob(payload);
    },
    async job(jobId) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, { headers: headers() }));
      return parseJob(payload);
    },
    async approve(jobId) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/approve`, { method: "POST", headers: headers() }));
      return parseJob(payload);
    },
    template(name) { return binary(`${API_BASE}/templates/${encodeURIComponent(name)}`); },
    image(jobId) { return binary(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/image`); },
    download(jobId) { return binary(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/download`); },
  };
}

export async function encodeProductFile(file: File): Promise<string> {
  if (!SUPPORTED_MIME_TYPES.has(file.type)) {
    throw new Error("Ảnh sản phẩm phải là PNG, JPEG hoặc WebP.");
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Ảnh sản phẩm phải khác rỗng và không quá 5 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return `data:${file.type};base64,${btoa(binary)}`;
}
