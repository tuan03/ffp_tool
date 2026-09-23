import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";

import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";
import { executeFilesStageBinary } from "./files-write";
import type { CreateMediaInputItem } from "./products-write";

/**
 * Checks whether a given media URL or path points to a local or private resource
 * that external Shopify cloud workers cannot reach over the public internet.
 */
export function isLocalOrPrivateUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== "string") return false;
  const trimmed = urlStr.trim();
  if (!trimmed) return false;

  // Relative paths, file paths, Windows drives, data URLs
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("file:") ||
    trimmed.startsWith("data:") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  ) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return true;
    }

    const hostname = url.hostname.toLowerCase();
    // Localhost and loopback addresses
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".test")
    ) {
      return true;
    }

    // IPv4 private ranges (RFC 1918) & link-local
    if (hostname.startsWith("10.")) return true;
    if (hostname.startsWith("127.")) return true;
    if (hostname.startsWith("169.254.")) return true;
    if (hostname.startsWith("192.168.")) return true;

    // 172.16.0.0/12: 172.16.x.x - 172.31.x.x
    const m172 = /^172\.(\d{1,3})\./.exec(hostname);
    if (m172) {
      const secondOctet = parseInt(m172[1] ?? "", 10);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }

    // 100.64.0.0/10: Carrier-Grade NAT
    const m100 = /^100\.(\d{1,3})\./.exec(hostname);
    if (m100) {
      const secondOctet = parseInt(m100[1] ?? "", 10);
      if (secondOctet >= 64 && secondOctet <= 127) return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Maps common image file extensions to standard MIME types supported by Shopify staged uploads.
 */
function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
    default:
      return "image/jpeg";
  }
}

/**
 * Searches candidate root directories for an asset file matching jobId or fileName.
 */
function findFileRecursively(dir: string, targetName: string, maxDepth = 4): string | undefined {
  if (maxDepth < 0 || !fs.existsSync(dir)) return undefined;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === targetName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const sub = findFileRecursively(fullPath, targetName, maxDepth - 1);
        if (sub) return sub;
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return undefined;
}

export interface ResolvedLocalImage {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly filename: string;
}

/**
 * Resolves local image binary bytes from an HTTP URL, data URI, or local file system path.
 */
export async function resolveLocalImageBytes(urlOrPath: string): Promise<ResolvedLocalImage> {
  const trimmed = urlOrPath.trim();

  // 1. Data URI
  if (trimmed.startsWith("data:")) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(trimmed);
    if (!match) {
      throw new GatewayError("Invalid data URI format", "SHOPIFY_USER_ERROR", 400);
    }
    const rawMime = match[1]?.trim() || "image/png";
    const contentType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
    const isBase64 = Boolean(match[2]);
    const rawData = match[3] ?? "";
    const buffer = isBase64 ? Buffer.from(rawData, "base64") : Buffer.from(decodeURIComponent(rawData), "utf-8");
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    return {
      buffer,
      contentType,
      filename: `staged-image-${Date.now()}.${ext}`,
    };
  }

  // 2. Direct file on disk
  if (fs.existsSync(trimmed)) {
    const stats = await fs.promises.stat(trimmed);
    if (stats.isFile()) {
      const buffer = await fs.promises.readFile(trimmed);
      const filename = path.basename(trimmed);
      const contentType = guessMimeType(filename);
      return { buffer, contentType, filename };
    }
  }

  // 3. HTTP URL or relative API path
  const candidates: string[] = [];
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    candidates.push(trimmed);
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.includes("/api/pinterest-pod/")) {
        candidates.push(`http://127.0.0.1:8768${parsed.pathname}${parsed.search}`);
        candidates.push(`http://localhost:8768${parsed.pathname}${parsed.search}`);
      }
    } catch {
      // ignore
    }
  } else if (trimmed.startsWith("/")) {
    candidates.push(`http://127.0.0.1:8768${trimmed}`);
    candidates.push(`http://localhost:8768${trimmed}`);
    candidates.push(`http://127.0.0.1:5173${trimmed}`);
  }

  for (const targetUrl of candidates) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        let contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "";
        if (contentType === "image/jpg") contentType = "image/jpeg";
        let filename = "image.jpg";
        try {
          const u = new URL(targetUrl);
          const name = path.basename(u.pathname);
          if (name && name.includes(".")) filename = decodeURIComponent(name);
        } catch {
          // ignore
        }
        if (!contentType || contentType === "application/octet-stream") {
          contentType = guessMimeType(filename);
        }
        return { buffer, contentType, filename };
      }
    } catch {
      // Continue to next candidate
    }
  }

  // 4. File system fallback for Pinterest POD output assets
  const assetMatch = /\/api\/pinterest-pod\/assets\/([^/]+)\/(.+)$/.exec(trimmed);
  if (assetMatch) {
    const rawFileName = decodeURIComponent(assetMatch[2] ?? "");
    const fileName = path.basename(rawFileName);

    const candidateRoots = [
      path.resolve(process.cwd(), "src/modules/pinterest-pod/server/data/pinterest_pod/output"),
      path.resolve(process.cwd(), "src/modules/pinterest-pod/server/output"),
      path.resolve(process.cwd(), "output"),
      path.resolve(process.cwd(), ".local-data"),
    ];

    for (const rootDir of candidateRoots) {
      const foundPath = findFileRecursively(rootDir, fileName);
      if (foundPath && fs.existsSync(foundPath)) {
        const buffer = await fs.promises.readFile(foundPath);
        const contentType = guessMimeType(fileName);
        return { buffer, contentType, filename: fileName };
      }
    }
  }

  throw new GatewayError(
    `Unable to resolve local image binary from '${trimmed}'. Ensure the Pinterest POD server or local asset is accessible.`,
    "SHOPIFY_USER_ERROR",
    400,
  );
}

/**
 * Stages a single local or private image onto Shopify's Google Cloud Storage staging bucket
 * via the official `stagedUploadsCreate` GraphQL mutation.
 * Returns the public GCS `resourceUrl` that Shopify cloud servers can ingest.
 */
export async function stageLocalMedia(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  originalSource: string,
  options?: { readonly alt?: string; readonly requestId?: string; readonly resource?: "IMAGE" | "FILE" },
): Promise<string> {
  if (!isLocalOrPrivateUrl(originalSource)) {
    return originalSource;
  }

  const { buffer, contentType, filename } = await resolveLocalImageBytes(originalSource);
  const contentBase64 = buffer.toString("base64");

  const stageResult = await executeFilesStageBinary(
    store,
    client,
    {
      filename,
      mimeType: contentType,
      contentBase64,
      resource: options?.resource ?? (buffer.length > 20 * 1024 * 1024 ? "FILE" : "IMAGE"),
    },
    "apply",
    options?.requestId,
  );

  return stageResult.resourceUrl;
}

export interface EnsureMediaResult {
  readonly mediaList: readonly CreateMediaInputItem[];
  readonly urlMap: ReadonlyMap<string, string>;
}

/**
 * Ensures all media items in a product media list have publicly accessible URLs.
 * Any local or private URLs are automatically staged to Shopify's Google Cloud Storage.
 */
export async function ensureMediaPubliclyAccessible(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  mediaList: readonly CreateMediaInputItem[],
  options?: { readonly requestId?: string },
): Promise<EnsureMediaResult> {
  if (!Array.isArray(mediaList) || mediaList.length === 0) {
    return { mediaList: [], urlMap: new Map() };
  }

  const urlMap = new Map<string, string>();
  const stagedPromiseCache = new Map<string, Promise<string>>();

  const updatedMediaList = await Promise.all(
    mediaList.map(async (item) => {
      const rawUrl = item.originalSource;
      if (!isLocalOrPrivateUrl(rawUrl)) {
        urlMap.set(rawUrl, rawUrl);
        return item;
      }

      let stagePromise = stagedPromiseCache.get(rawUrl);
      if (!stagePromise) {
        stagePromise = stageLocalMedia(store, client, rawUrl, {
          alt: item.alt,
          requestId: options?.requestId,
        });
        stagedPromiseCache.set(rawUrl, stagePromise);
      }

      const stagedUrl = await stagePromise;
      urlMap.set(rawUrl, stagedUrl);
      return {
        ...item,
        originalSource: stagedUrl,
      };
    }),
  );

  return { mediaList: updatedMediaList, urlMap };
}
