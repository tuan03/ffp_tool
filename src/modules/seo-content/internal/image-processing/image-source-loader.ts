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
 * Checks whether a hostname belongs to a private, loopback, link-local,
 * cloud instance metadata, or local broadcast address.
 */
export function isPrivateOrLocalHost(rawHostname: string): boolean {
  // Strip brackets from IPv6 hostnames, e.g. [::1] -> ::1
  const host = rawHostname.replace(/^\[|\]$/g, "").toLowerCase().trim();

  if (!host) {
    return true;
  }

  // Localhost, local, internal domain names
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }

  // Unspecified and loopback (IPv4 & IPv6)
  if (
    host === "0.0.0.0" ||
    host.startsWith("0.") ||
    host === "::" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }

  // IPv4 Loopback: 127.0.0.0/8
  if (host.startsWith("127.")) {
    return true;
  }

  // IPv4 Private Class A: 10.0.0.0/8
  if (host.startsWith("10.")) {
    return true;
  }

  // IPv4 Link-Local / Cloud Instance Metadata: 169.254.0.0/16
  if (host.startsWith("169.254.")) {
    return true;
  }

  // IPv4 Private Class C: 192.168.0.0/16
  if (host.startsWith("192.168.")) {
    return true;
  }

  // IPv4 Private Class B: 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return true;
  }

  // Carrier-Grade NAT: 100.64.0.0/10
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host)) {
    return true;
  }

  // IPv6 Link-Local: fe80::/10 (fe8*, fe9*, fea*, feb*)
  if (/^fe[89ab]/i.test(host)) {
    return true;
  }

  // IPv6 Unique Local: fc00::/7 (fc*, fd*)
  if (/^f[cd]/i.test(host)) {
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:0:0/96
  if (host.startsWith("::ffff:") || host.startsWith("ffff:")) {
    return true;
  }

  return false;
}

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

  if (isPrivateOrLocalHost(parsed.hostname)) {
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
        const visitedUrls = new Set<string>();

        for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
          if (visitedUrls.has(currentUrl)) {
            throw new Error(`Circular redirect detected at ${currentUrl}`);
          }
          visitedUrls.add(currentUrl);

          validateSafeUrl(currentUrl);

          response = await fetch(currentUrl, {
            signal: controller.signal,
            redirect: "manual",
          });

          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (hop >= MAX_REDIRECT_HOPS) {
              throw new Error(`Exceeded maximum redirect hops of ${MAX_REDIRECT_HOPS}`);
            }
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
