import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SeoContentImageInput } from "../../types";

export type SupportedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB maximum image payload size
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 15000; // 15 seconds HTTP fetch timeout

export interface GeminiInlineDataPart {
  readonly type: "inline";
  readonly inlineData: {
    readonly data: string;
    readonly mimeType: SupportedImageMimeType;
  };
}

export interface GeminiFileDataPart {
  readonly type: "fileUri";
  readonly fileData: {
    readonly fileUri: string;
    readonly mimeType: SupportedImageMimeType;
  };
}

export type GeminiImagePart = GeminiInlineDataPart | GeminiFileDataPart;

export class InvalidImagePayloadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "InvalidImagePayloadError";
  }
}

const EXTENSION_MIME_MAP: Readonly<Record<string, SupportedImageMimeType>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function detectMimeTypeFromFilename(filenameOrUrl: string): SupportedImageMimeType | undefined {
  const clean = filenameOrUrl.split(/[?#]/)[0] ?? "";
  const ext = path.extname(clean).toLowerCase();
  return EXTENSION_MIME_MAP[ext];
}

/**
 * Prepares an image payload for Gemini multimodal input.
 * Priority:
 * 1. localFilePath -> check path, size limit (10MB), read binary from disk, encode base64 inlineData
 * 2. gs:// URI -> fileData with fileUri (requires recognizable image extension)
 * 3. data:image/ URI -> extract base64 inlineData (enforces 10MB decoded limit)
 * 4. http(s):// URL -> fetch with timeout -> validate Content-Type & size -> inlineData
 */
export async function prepareProductImagePayload(
  image: SeoContentImageInput,
  options?: { readonly fetchTimeoutMs?: number },
): Promise<GeminiImagePart> {
  if (!image) {
    throw new InvalidImagePayloadError("Image input is required");
  }

  // Priority 1: localFilePath
  if (image.localFilePath && image.localFilePath.trim()) {
    const rawPath = image.localFilePath.trim();
    const resolvedPath = path.resolve(rawPath);
    const mimeType = detectMimeTypeFromFilename(resolvedPath);
    if (!mimeType) {
      throw new InvalidImagePayloadError(
        `Unsupported image format for local file: ${rawPath}. Allowed: JPEG, PNG, WebP`,
      );
    }

    try {
      const stats = await fs.stat(resolvedPath);
      if (stats.size > MAX_IMAGE_BYTES) {
        throw new InvalidImagePayloadError(
          `Local image file '${rawPath}' (${stats.size} bytes) exceeds maximum allowed size of 10MB`,
        );
      }

      const buffer = await fs.readFile(resolvedPath);
      const base64 = buffer.toString("base64");
      return {
        type: "inline",
        inlineData: {
          data: base64,
          mimeType,
        },
      };
    } catch (err) {
      if (err instanceof InvalidImagePayloadError) throw err;
      throw new InvalidImagePayloadError(
        `Failed to read local image file '${rawPath}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  const rawUrl = image.url ? image.url.trim() : "";
  if (!rawUrl) {
    throw new InvalidImagePayloadError("Image has neither localFilePath nor url");
  }

  // Priority 2: gs:// Google Cloud Storage URI
  if (rawUrl.startsWith("gs://")) {
    const mimeType = detectMimeTypeFromFilename(rawUrl);
    if (!mimeType) {
      throw new InvalidImagePayloadError(
        `Cannot determine MIME type for gs:// URI '${rawUrl}'. URI must end with .jpg, .jpeg, .png, or .webp`,
      );
    }
    return {
      type: "fileUri",
      fileData: {
        fileUri: rawUrl,
        mimeType,
      },
    };
  }

  // Priority 3: data:image base64 URI
  if (rawUrl.startsWith("data:image/")) {
    const match = rawUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
    if (!match) {
      throw new InvalidImagePayloadError("Invalid data URI format for image");
    }
    const rawMime = match[1].split(";")[0]?.trim().toLowerCase() ?? "";
    const mimeType: SupportedImageMimeType | undefined =
      rawMime === "image/jpeg" || rawMime === "image/jpg"
        ? "image/jpeg"
        : rawMime === "image/png"
          ? "image/png"
          : rawMime === "image/webp"
            ? "image/webp"
            : undefined;

    if (!mimeType) {
      throw new InvalidImagePayloadError(`Unsupported data URI mime type: ${rawMime}`);
    }

    const base64Data = match[2].replace(/\s+/g, "");
    const decodedBuffer = Buffer.from(base64Data, "base64");
    if (decodedBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new InvalidImagePayloadError(
        `Data URI image exceeds maximum allowed size of 10MB (${decodedBuffer.byteLength} bytes)`,
      );
    }

    return {
      type: "inline",
      inlineData: {
        data: base64Data,
        mimeType,
      },
    };
  }

  // Priority 4: http(s) URL -> server fetch with timeout, Content-Type validation, and size limit
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    if (typeof fetch === "function") {
      const timeoutMs = options?.fetchTimeoutMs ?? DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(rawUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status} ${response.statusText}`);
        }

        const rawContentType = response.headers.get("content-type") ?? "";
        const cleanContentType = rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";

        // Explicit non-image Content-Type must be rejected
        if (
          cleanContentType.startsWith("text/") ||
          cleanContentType.startsWith("application/json") ||
          cleanContentType.startsWith("application/xml") ||
          cleanContentType.startsWith("application/javascript")
        ) {
          throw new InvalidImagePayloadError(
            `Remote URL '${rawUrl}' returned non-image content-type '${rawContentType}'`,
          );
        }

        let detectedMime: SupportedImageMimeType | undefined;
        if (cleanContentType === "image/jpeg" || cleanContentType === "image/jpg") {
          detectedMime = "image/jpeg";
        } else if (cleanContentType === "image/png") {
          detectedMime = "image/png";
        } else if (cleanContentType === "image/webp") {
          detectedMime = "image/webp";
        } else {
          // Fallback to extension detection only if content-type was generic binary or missing
          detectedMime = detectMimeTypeFromFilename(rawUrl);
        }

        if (!detectedMime) {
          throw new InvalidImagePayloadError(
            `Unsupported content-type '${rawContentType}' for URL: ${rawUrl}`,
          );
        }

        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
          throw new InvalidImagePayloadError(
            `Remote image at '${rawUrl}' exceeds maximum allowed size of 10MB`,
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
          throw new InvalidImagePayloadError(
            `Remote image at '${rawUrl}' (${arrayBuffer.byteLength} bytes) exceeds maximum allowed size of 10MB`,
          );
        }

        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return {
          type: "inline",
          inlineData: {
            data: base64,
            mimeType: detectedMime,
          },
        };
      } catch (err) {
        if (err instanceof InvalidImagePayloadError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new InvalidImagePayloadError(
            `Failed to fetch remote image URL '${rawUrl}': timed out after ${timeoutMs}ms`,
            err,
          );
        }
        throw new InvalidImagePayloadError(
          `Failed to fetch remote image URL '${rawUrl}': ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      } finally {
        clearTimeout(timer);
      }
    }

    const mimeType = detectMimeTypeFromFilename(rawUrl);
    if (mimeType) {
      return {
        type: "fileUri",
        fileData: {
          fileUri: rawUrl,
          mimeType,
        },
      };
    }

    throw new InvalidImagePayloadError(
      `Cannot determine MIME type for image URL '${rawUrl}' without recognizable extension`,
    );
  }

  throw new InvalidImagePayloadError(`Unsupported image target: ${rawUrl}`);
}
