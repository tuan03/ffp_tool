import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { SeoContentImageInput } from "../../types";
import type { ImageSourceLoaded } from "./image-processing-types";

export interface ImageSourceLoader {
  load(image: SeoContentImageInput): Promise<ImageSourceLoaded>;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB limit
export const DEFAULT_FETCH_TIMEOUT_MS = 15000;
export const MAX_REDIRECT_HOPS = 5;

/**
 * Validates that the URL targets an allowed public http/https address
 * and blocks private/local network ranges (SSRF protection).
 */
export function validateSafeUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid protocol '${parsed.protocol}' for URL: ${rawUrl}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error(`Access to private or local network URL '${rawUrl}' is blocked`);
  }
}

/**
 * In-memory source loader for zero-network testing and deterministic execution.
 */
export class InMemoryImageSourceLoader implements ImageSourceLoader {
  private readonly store: Map<string, Buffer>;

  constructor(fixtures?: Record<string, Buffer>) {
    this.store = new Map();
    if (fixtures) {
      for (const [key, buf] of Object.entries(fixtures)) {
        this.store.set(key, buf);
      }
    }
  }

  set(key: string, buffer: Buffer): void {
    this.store.set(key, buffer);
  }

  async load(image: SeoContentImageInput): Promise<ImageSourceLoaded> {
    const key = image.url || image.localFilePath || "";
    if (this.store.has(key)) {
      return { buffer: this.store.get(key)! };
    }
    if (image.localFilePath && this.store.has(image.localFilePath)) {
      return { buffer: this.store.get(image.localFilePath)! };
    }

    // If image has a data: URI
    if (image.url && image.url.startsWith("data:image/")) {
      const match = image.url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
      if (match) {
        const buf = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
        return { buffer: buf, mimeType: match[1] };
      }
    }

    // Default mock buffer for tests
    return { buffer: Buffer.from("mock-image-bytes") };
  }
}

/**
 * Default source loader supporting local file paths, data URIs, and remote HTTP URLs
 * with bounds and redirect-hop SSRF validation.
 */
export class DefaultImageSourceLoader implements ImageSourceLoader {
  async load(image: SeoContentImageInput): Promise<ImageSourceLoaded> {
    if (!image) {
      throw new Error("Image input is required");
    }

    // 1. localFilePath
    if (image.localFilePath && image.localFilePath.trim()) {
      const resolvedPath = path.resolve(image.localFilePath.trim());
      try {
        const stats = await fs.stat(resolvedPath);
        if (stats.size > MAX_IMAGE_BYTES) {
          throw new Error(
            `Local image exceeds maximum allowed size of 10MB (${stats.size} bytes)`,
          );
        }
        const buffer = await fs.readFile(resolvedPath);
        return { buffer };
      } catch (err) {
        throw new Error(
          `Failed to read local image '${image.localFilePath}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const rawUrl = (image.url || "").trim();
    if (!rawUrl) {
      throw new Error("Image has neither localFilePath nor url");
    }

    // 2. data:image URI
    if (rawUrl.startsWith("data:image/")) {
      const match = rawUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
      if (!match) {
        throw new Error("Invalid data URI format");
      }
      const mimeType = match[1];
      const base64Data = match[2].replace(/\s+/g, "");
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > MAX_IMAGE_BYTES) {
        throw new Error(`Data URI image exceeds maximum allowed size of 10MB`);
      }
      return { buffer, mimeType };
    }

    // 3. Remote HTTP URL with redirect-aware SSRF protection
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      validateSafeUrl(rawUrl);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);

      try {
        let currentUrl = rawUrl;
        let response: Response | undefined;

        for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
          validateSafeUrl(currentUrl);

          response = await fetch(currentUrl, {
            signal: controller.signal,
            redirect: "manual",
          });

          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            if (!location) {
              throw new Error(`Redirect missing location header from ${currentUrl}`);
            }
            // Resolve relative or absolute redirect destination and validate it
            currentUrl = new URL(location, currentUrl).toString();
            continue;
          }
          break;
        }

        if (!response || !response.ok) {
          throw new Error(
            response ? `HTTP error ${response.status} ${response.statusText}` : "No response",
          );
        }

        const rawContentType = response.headers.get("content-type") ?? "";
        const cleanContentType = rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";
        if (
          cleanContentType.startsWith("text/") ||
          cleanContentType.startsWith("application/json") ||
          cleanContentType.startsWith("application/xml") ||
          cleanContentType.startsWith("application/javascript")
        ) {
          throw new Error(`Remote URL returned non-image content-type: ${rawContentType}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
          throw new Error(`Remote image exceeds maximum allowed size of 10MB`);
        }

        return {
          buffer: Buffer.from(arrayBuffer),
          mimeType: cleanContentType || undefined,
        };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(
            `Failed to fetch remote image '${rawUrl}': timed out after ${DEFAULT_FETCH_TIMEOUT_MS}ms`,
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`Unsupported image target: ${rawUrl}`);
  }
}
