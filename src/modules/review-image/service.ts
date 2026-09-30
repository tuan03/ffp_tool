import type { CreateReviewImageInput, DeleteReviewTemplatesResult, ReviewImageClient, ReviewImageJob, ReviewImageShopifyFile, ReviewImageTemplate } from "./types";

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

function parseTemplate(value: unknown): ReviewImageTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Record<string, unknown>).name !== "string") {
    throw new Error("Bridge không trả về ảnh template hợp lệ.");
  }
  return { name: (value as Record<string, string>).name };
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
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
    async listTemplates(storeId) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/templates?storeId=${encodeURIComponent(storeId)}`, { headers: headers() }));
      if (!Array.isArray(payload.templates)) throw new Error("Bridge không trả về danh sách template hợp lệ.");
      return payload.templates.map(parseTemplate);
    },
    async uploadTemplate(input) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/templates`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      }));
      return parseTemplate(payload.template);
    },
    async deleteTemplates(storeId, names) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/templates/batch`, {
        method: "DELETE",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ storeId, names }),
      }));
      const failures = Array.isArray(payload.failures) ? payload.failures.flatMap((failure) => {
        if (!failure || typeof failure !== "object" || Array.isArray(failure)) return [];
        const record = failure as Record<string, unknown>;
        return typeof record.name === "string" && typeof record.message === "string"
          ? [{ name: record.name, message: record.message }]
          : [];
      }) : [];
      return { deleted: readStringArray(payload.deleted), failures } satisfies DeleteReviewTemplatesResult;
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
    async cancel(jobId) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", headers: headers() }));
      return parseJob(payload);
    },
    async approve(jobId) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/approve`, { method: "POST", headers: headers() }));
      return parseJob(payload);
    },
    template(storeId, name) { return binary(`${API_BASE}/templates/${encodeURIComponent(name)}?storeId=${encodeURIComponent(storeId)}`); },
    image(jobId) { return binary(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/image`); },
    download(jobId) { return binary(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/download`); },
    async uploadToShopify(jobId, storeId) {
      const payload = await parseResponse(await fetcher(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/shopify`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ storeId }),
      }));
      if (typeof payload.fileId !== "string" || typeof payload.shopifyCdnUrl !== "string" || typeof payload.fileStatus !== "string") {
        throw new Error("Gateway không trả về Shopify file hợp lệ.");
      }
      return payload as unknown as ReviewImageShopifyFile;
    },
  };
}

export async function encodeImageFile(file: File): Promise<string> {
  if (!SUPPORTED_MIME_TYPES.has(file.type)) {
    throw new Error("Ảnh phải là PNG, JPEG hoặc WebP.");
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Ảnh phải khác rỗng và không quá 5 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return `data:${file.type};base64,${btoa(binary)}`;
}

export const encodeProductFile = encodeImageFile;
