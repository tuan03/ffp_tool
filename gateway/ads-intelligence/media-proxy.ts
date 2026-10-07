/**
 * FFP Ads Intelligence — Streaming Media Proxy with On-Demand Disk Caching
 *
 * Solves:
 * 1. Meta CDN Anti-Hotlinking (403 Forbidden on external referers) by fetching server-to-server without Referer.
 * 2. Meta Signed URLs Expiration (2h-24h TTL) by caching videos/images permanently to disk on first access.
 * 3. Smooth video playback by supporting HTTP 206 Partial Content (Range requests) from local disk.
 * 4. SSRF protection by rejecting local/private IP ranges.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, promises as fs } from "node:fs";
import type http from "node:http";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { isLocalOrPrivateUrl } from "../operations/staged-uploads";

const MEDIA_CACHE_DIR = resolve(process.cwd(), ".runtime/ads-intelligence/media-cache");
const MAX_MEDIA_SIZE_BYTES = 120 * 1024 * 1024; // 120 MB limit per media file
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Active in-flight downloads to prevent duplicate concurrent downloads of the same media
const inFlightDownloads = new Map<string, Promise<boolean>>();

function getMimeType(filePathOrExt: string): string {
  const ext = extname(filePathOrExt).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function getExtFromMimeType(mime: string): string {
  const clean = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (clean) {
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".bin";
  }
}

export function computeMediaHash(targetUrl: string): string {
  const clean = targetUrl.replace(/&amp;/g, "&");
  return createHash("sha256").update(clean).digest("hex").slice(0, 32);
}

function ensureCacheDir(): void {
  if (!existsSync(MEDIA_CACHE_DIR)) {
    mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
  }
}

interface CacheMetadata {
  readonly originalUrl: string;
  readonly contentType: string;
  readonly ext?: string;
  readonly size: number;
  readonly cachedAt: string;
}

async function findCachedFile(hash: string): Promise<{ filePath: string; meta: CacheMetadata } | null> {
  ensureCacheDir();
  const metaPath = join(MEDIA_CACHE_DIR, `${hash}.meta.json`);
  if (!existsSync(metaPath)) return null;

  try {
    const metaRaw = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaRaw) as CacheMetadata;
    const ext = meta.ext || getExtFromMimeType(meta.contentType);
    let filePath = join(MEDIA_CACHE_DIR, `${hash}${ext}`);
    if (!existsSync(filePath)) {
      for (const altExt of [".mp4", ".jpg", ".png", ".webp", ".webm", ".bin"]) {
        const altPath = join(MEDIA_CACHE_DIR, `${hash}${altExt}`);
        if (existsSync(altPath)) {
          filePath = altPath;
          break;
        }
      }
    }
    if (existsSync(filePath)) {
      const stat = await fs.stat(filePath);
      if (stat.size > 0) {
        return { filePath, meta: { ...meta, size: stat.size } };
      }
    }
  } catch {
    // metadata or file corrupt, return null to re-fetch
  }
  return null;
}

async function downloadAndCacheMedia(targetUrl: string, hash: string): Promise<boolean> {
  const existing = inFlightDownloads.get(hash);
  if (existing) {
    return existing;
  }

  const downloadPromise = (async (): Promise<boolean> => {
    ensureCacheDir();
    try {
      const cleanUrl = targetUrl.replace(/&amp;/g, "&");
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Encoding": "identity",
      };

      if (cleanUrl.includes("fbcdn.net") || cleanUrl.includes("facebook.com") || cleanUrl.includes("fbsbx.com")) {
        headers["Referer"] = "https://www.facebook.com/";
      } else if (cleanUrl.includes("cdninstagram.com") || cleanUrl.includes("instagram.com")) {
        headers["Referer"] = "https://www.instagram.com/";
      }

      const response = await fetch(cleanUrl, {
        headers,
        redirect: "follow",
      });

      if (!response.ok || !response.body) {
        console.warn(`[MediaProxy] Upstream returned status ${response.status} for ${cleanUrl}`);
        return false;
      }

      const rawContentType = response.headers.get("content-type") || "application/octet-stream";
      let effectiveContentType = rawContentType;
      let ext = getExtFromMimeType(rawContentType);
      if (ext === ".bin") {
        try {
          const parsed = new URL(cleanUrl);
          const pathExt = extname(parsed.pathname).toLowerCase();
          if (pathExt && [".mp4", ".webm", ".mov", ".jpg", ".jpeg", ".png", ".webp"].includes(pathExt)) {
            ext = pathExt === ".jpeg" ? ".jpg" : pathExt;
            effectiveContentType = getMimeType(ext);
          }
        } catch {
          // ignore url parse error
        }
      }

      const tmpPath = join(MEDIA_CACHE_DIR, `${hash}.tmp-${Date.now()}`);
      const finalPath = join(MEDIA_CACHE_DIR, `${hash}${ext}`);
      const metaPath = join(MEDIA_CACHE_DIR, `${hash}.meta.json`);

      const fileWriteStream = createWriteStream(tmpPath);
      const nodeStream = Readable.fromWeb(response.body as unknown as WebReadableStream);

      let downloadedBytes = 0;
      await new Promise<void>((resolvePromise, rejectPromise) => {
        nodeStream.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes > MAX_MEDIA_SIZE_BYTES) {
            nodeStream.destroy(new Error("Media file exceeds maximum allowed size"));
          }
        });
        nodeStream.pipe(fileWriteStream);
        fileWriteStream.on("finish", resolvePromise);
        fileWriteStream.on("error", rejectPromise);
        nodeStream.on("error", rejectPromise);
      });

      await fs.rename(tmpPath, finalPath);

      const meta: CacheMetadata = {
        originalUrl: targetUrl,
        contentType: effectiveContentType,
        ext,
        size: downloadedBytes,
        cachedAt: new Date().toISOString(),
      };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
      void pruneMediaCache().catch(() => {});
      return true;
    } catch (err) {
      console.warn(`[MediaProxy] Failed to download and cache ${targetUrl}:`, err);
      return false;
    } finally {
      inFlightDownloads.delete(hash);
    }
  })();

  inFlightDownloads.set(hash, downloadPromise);
  return downloadPromise;
}

const MAX_CACHE_DISK_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB limit
const MAX_CACHE_FILES = 300; // max 300 media files

let isPruning = false;
/**
 * Automatically purges oldest cached media files when disk usage exceeds quota.
 */
export async function pruneMediaCache(
  maxSizeBytes = MAX_CACHE_DISK_BYTES,
  maxFiles = MAX_CACHE_FILES
): Promise<{ deletedFiles: number; freedBytes: number }> {
  if (isPruning) return { deletedFiles: 0, freedBytes: 0 };
  isPruning = true;
  try {
    ensureCacheDir();
    const fileNames = await fs.readdir(MEDIA_CACHE_DIR);
    const mediaFiles: { name: string; fullPath: string; size: number; mtimeMs: number }[] = [];
    let totalDiskBytes = 0;

    for (const name of fileNames) {
      if (name.endsWith(".meta.json") || name.includes(".tmp")) continue;
      const fullPath = join(MEDIA_CACHE_DIR, name);
      try {
        const st = await fs.stat(fullPath);
        mediaFiles.push({ name, fullPath, size: st.size, mtimeMs: st.mtimeMs });
        totalDiskBytes += st.size;
      } catch {
        // ignore unreadable/transient file
      }
    }

    if (totalDiskBytes <= maxSizeBytes && mediaFiles.length <= maxFiles) {
      return { deletedFiles: 0, freedBytes: 0 };
    }

    // Sort by modification time ascending (oldest first)
    mediaFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);

    let deletedFiles = 0;
    let freedBytes = 0;

    for (const file of mediaFiles) {
      if (totalDiskBytes <= maxSizeBytes * 0.8 && mediaFiles.length - deletedFiles <= maxFiles * 0.8) {
        break;
      }
      try {
        await fs.unlink(file.fullPath);
        deletedFiles++;
        freedBytes += file.size;
        totalDiskBytes -= file.size;

        const baseHash = file.name.split(".")[0];
        if (baseHash) {
          const metaPath = join(MEDIA_CACHE_DIR, `${baseHash}.meta.json`);
          await fs.unlink(metaPath).catch(() => {});
        }
      } catch {
        // ignore
      }
    }

    return { deletedFiles, freedBytes };
  } finally {
    isPruning = false;
  }
}

/**
 * Handles incoming `/api/ads-intelligence/media-proxy` HTTP requests
 */
export async function handleMediaProxy(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const reqUrl = new URL(req.url || "/", "http://localhost");
  if (reqUrl.pathname !== "/api/ads-intelligence/media-proxy") {
    return false;
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");
    res.end();
    return true;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET, HEAD, and OPTIONS are supported" } }));
    return true;
  }

  const rawTargetUrl = reqUrl.searchParams.get("url");
  if (!rawTargetUrl) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code: "URL_REQUIRED", message: "Missing ?url= query parameter" } }));
    return true;
  }

  const targetUrl = rawTargetUrl.replace(/&amp;/g, "&");

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code: "INVALID_URL", message: "Malformed target URL" } }));
    return true;
  }

  if (!ALLOWED_PROTOCOLS.has(parsedTarget.protocol)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code: "INVALID_PROTOCOL", message: "Only HTTP and HTTPS URLs are allowed" } }));
    return true;
  }

  // SSRF Protection: Block loopback, RFC1918 private IPs, AWS/GCP metadata endpoints
  if (isLocalOrPrivateUrl(targetUrl)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code: "SSRF_PROTECTED", message: "Local or private network targets are prohibited" } }));
    return true;
  }

  const hash = computeMediaHash(targetUrl);
  const etag = `"${hash}"`;

  // 1. Check if media is already in disk cache
  let cached = await findCachedFile(hash);
  const wasCached = Boolean(cached);

  // Fast-path HTTP 304 Not Modified:
  // If already cached and client sends matching If-None-Match, return 304 immediately with 0 bytes transferred
  const ifNoneMatch = req.headers["if-none-match"];
  if (cached && ifNoneMatch) {
    const isMatched = ifNoneMatch === etag || ifNoneMatch === hash || ifNoneMatch === `W/${etag}`;
    if (isMatched) {
      res.statusCode = 304;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("ETag", etag);
      res.setHeader("X-Cache", "HIT");
      res.end();
      return true;
    }
  }

  // 2. If not cached, trigger on-demand download & cache
  if (!cached) {
    const success = await downloadAndCacheMedia(targetUrl, hash);
    if (!success) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: {
            code: "UPSTREAM_MEDIA_UNAVAILABLE",
            message: "Unable to retrieve media from upstream CDN (link may be expired or inaccessible).",
          },
        })
      );
      return true;
    }
    cached = await findCachedFile(hash);
  }

  if (!cached) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code: "CACHE_READ_FAILED", message: "Failed to read cached media file" } }));
    return true;
  }

  const { filePath, meta } = cached;
  const totalSize = meta.size;
  const contentType = meta.contentType || getMimeType(filePath);

  // Set shared caching & CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", etag);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Cache", wasCached ? "HIT" : "MISS");

  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", totalSize);
    res.end();
    return true;
  }

  // 3. Handle Range Requests (HTTP 206 Partial Content for smooth video scrubbing)
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const startStr = match[1];
      const endStr = match[2];

      let start = startStr ? parseInt(startStr, 10) : 0;
      let end = endStr ? parseInt(endStr, 10) : totalSize - 1;

      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= totalSize) end = totalSize - 1;

      if (start > end || start >= totalSize) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${totalSize}`);
        res.end();
        return true;
      }

      const chunkSize = end - start + 1;
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Content-Type", contentType);

      const stream = createReadStream(filePath, { start, end });
      stream.on("error", () => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
      stream.pipe(res);
      return true;
    }
  }

  // 4. Full Content Serving (HTTP 200)
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", totalSize);

  const fullStream = createReadStream(filePath);
  fullStream.on("error", () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  fullStream.pipe(res);
  return true;
}

/**
 * Background prefetcher for competitor ads media.
 * Automatically downloads and caches media files in the background so they are ready before the user clicks.
 */
export function prefetchCompetitorMedia(urls: readonly string[]): void {
  for (const rawUrl of urls) {
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) continue;
    const url = rawUrl.replace(/&amp;/g, "&");
    if (isLocalOrPrivateUrl(url)) continue;
    const hash = computeMediaHash(url);
    void findCachedFile(hash).then((cached) => {
      if (!cached) {
        void downloadAndCacheMedia(url, hash);
      }
    });
  }
}
