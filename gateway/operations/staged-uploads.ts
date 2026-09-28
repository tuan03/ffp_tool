import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import net from "node:net";
import { Buffer } from "node:buffer";

import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";
import { executeFilesStageBinary } from "./files-write";
import type { CreateMediaInputItem } from "./products-write";

/**
 * Checks whether an IP address belongs to private, loopback, link-local,
 * multicast, carrier-grade NAT, or reserved network ranges.
 */
function isPrivateIpv4Octets(a: number, b: number, c: number, d: number): boolean {
  // 0.0.0.0/8 (Broadcast/source)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private RFC 1918)
  if (a === 10) return true;
  // 100.64.0.0/10 (Carrier-Grade NAT RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-Local & Cloud Metadata RFC 3927)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.88.99.0/24 (6to4 Relay)
  if (a === 192 && b === 88 && c === 99) return true;
  // 192.168.0.0/16 (Private RFC 1918)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (Benchmarking RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (Multicast RFC 5771)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved / Broadcast RFC 1112)
  if (a >= 240) return true;
  // 255.255.255.255 (Broadcast)
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

/**
 * Parses an IPv6 string (including compressed '::', IPv4-mapped, and IPv4-compatible syntax)
 * into an array of 8 16-bit numeric hextets [0..65535], or null if invalid IPv6 syntax.
 */
export function parseIpv6Hextets(ipStr: string): number[] | null {
  let ip = ipStr.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const lastColon = ip.lastIndexOf(":");
  if (lastColon === -1) return null;
  const potentialIpv4 = ip.slice(lastColon + 1);
  let ipv4Hextets: [number, number] | null = null;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(potentialIpv4)) {
    const octets = potentialIpv4.split(".").map(Number);
    if (octets.some((o) => o < 0 || o > 255)) return null;
    const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = octets;
    ipv4Hextets = [(o0 << 8) | o1, (o2 << 8) | o3];
    ip = ip.slice(0, lastColon);
    if (ip.endsWith(":")) ip += ":";
  }
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  let left: number[] = [];
  let right: number[] = [];
  if (parts[0]) {
    left = parts[0].split(":").filter(Boolean).map((h) => parseInt(h, 16));
    if (left.some((h) => isNaN(h) || h < 0 || h > 0xffff)) return null;
  }
  if (parts.length === 2 && parts[1]) {
    right = parts[1].split(":").filter(Boolean).map((h) => parseInt(h, 16));
    if (right.some((h) => isNaN(h) || h < 0 || h > 0xffff)) return null;
  }
  const total = left.length + right.length + (ipv4Hextets ? 2 : 0);
  if (parts.length === 1) {
    if (total !== 8) return null;
    const res = [...left];
    if (ipv4Hextets) res.push(...ipv4Hextets);
    return res;
  }
  if (total > 7) return null;
  const zeros = new Array(8 - total).fill(0);
  const res = [...left, ...zeros, ...right];
  if (ipv4Hextets) res.push(...ipv4Hextets);
  return res;
}

/**
 * Checks whether an IP address belongs to private, loopback, link-local,
 * multicast, carrier-grade NAT, or reserved network ranges.
 * Fully covers IPv4 dotted quad, IPv6, IPv4-mapped IPv6 (::ffff:x.x.x.x),
 * IPv4-compatible IPv6 (::x.x.x.x or ::hex), NAT64 (64:ff9b::), and 6to4 (2002::).
 */
export function isPrivateIp(rawIp: string): boolean {
  if (!rawIp || typeof rawIp !== "string") return false;
  let cleanIp = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4 check
  if (net.isIPv4(cleanIp) || /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanIp)) {
    const octets = cleanIp.split(".").map((o) => parseInt(o, 10));
    const [a, b, c, d] = octets;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return true;
    if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) return true;
    return isPrivateIpv4Octets(a, b, c, d);
  }

  // IPv6 check
  const h = parseIpv6Hextets(cleanIp);
  if (h) {
    // :: (unspecified)
    if (h.every((x) => x === 0)) return true;
    // ::1 (loopback, e.g. ::1, ::0001, 0000:...:0001)
    if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true;
    // ::ffff:0:0/96 (IPv4-mapped, e.g. ::ffff:127.0.0.1 or 0:0:0:0:0:ffff:127.0.0.1)
    if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
      return isPrivateIpv4Octets((h[6]! >> 8) & 0xff, h[6]! & 0xff, (h[7]! >> 8) & 0xff, h[7]! & 0xff);
    }
    // ::/96 (IPv4-compatible deprecated RFC 4291, e.g. ::127.0.0.1, ::7f00:1)
    if (h.slice(0, 6).every((x) => x === 0)) {
      return isPrivateIpv4Octets((h[6]! >> 8) & 0xff, h[6]! & 0xff, (h[7]! >> 8) & 0xff, h[7]! & 0xff);
    }
    // 64:ff9b::/96 (NAT64 RFC 6052)
    if (h[0] === 0x0064 && h[1] === 0xff9b) {
      return isPrivateIpv4Octets((h[6]! >> 8) & 0xff, h[6]! & 0xff, (h[7]! >> 8) & 0xff, h[7]! & 0xff);
    }
    // 2002::/16 (6to4 RFC 3056)
    if (h[0] === 0x2002) {
      return isPrivateIpv4Octets((h[1]! >> 8) & 0xff, h[1]! & 0xff, (h[2]! >> 8) & 0xff, h[2]! & 0xff);
    }
    // fe80::/10 (Link-local unicast: fe80:... to febf:...)
    if ((h[0]! & 0xffc0) === 0xfe80) return true;
    // fc00::/7 (Unique local address / ULA: fc00:... or fd00:..., including AWS EC2 fd00:ec2::254)
    if ((h[0]! & 0xfe00) === 0xfc00) return true;
    // ff00::/8 (Multicast)
    if ((h[0]! & 0xff00) === 0xff00) return true;
    // 2001:db8::/32 (Documentation)
    if (h[0] === 0x2001 && h[1] === 0x0db8) return true;
    // 100::/64 (Discard prefix RFC 6666)
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;

    return false;
  }

  return false;
}

/**
 * Validates that an outbound HTTP/HTTPS URL does not target loopback, private networks,
 * link-local/cloud metadata services, or forbidden hostnames (SSRF prevention).
 */
export async function validateSafeFetchUrl(urlStr: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new GatewayError(`Invalid URL format: '${urlStr}'`, "SHOPIFY_INVALID_INPUT", 400);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new GatewayError(`Disallowed URL protocol: '${parsed.protocol}'`, "SHOPIFY_SECURITY_ERROR", 403);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new GatewayError("Missing URL hostname", "SHOPIFY_INVALID_INPUT", 400);
  }

  // Disallow local/private hostnames and cloud metadata services
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname === "metadata" ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data"
  ) {
    throw new GatewayError(`SSRF detected: forbidden hostname '${parsed.hostname}'`, "SHOPIFY_SECURITY_ERROR", 403);
  }

  // Check if IP literal (handles IPv4 and IPv6)
  if (net.isIP(hostname) !== 0 || parseIpv6Hextets(hostname) !== null) {
    if (isPrivateIp(hostname)) {
      throw new GatewayError(
        `SSRF detected: target IP '${hostname}' is private or reserved`,
        "SHOPIFY_SECURITY_ERROR",
        403,
      );
    }
  } else {
    // Resolve DNS and check all resolved IP addresses
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        throw new GatewayError(`DNS resolution returned no addresses for '${hostname}'`, "SHOPIFY_NETWORK_ERROR", 502);
      }
      for (const record of records) {
        if (isPrivateIp(record.address)) {
          throw new GatewayError(
            `SSRF detected: hostname '${hostname}' resolves to private/reserved IP '${record.address}'`,
            "SHOPIFY_SECURITY_ERROR",
            403,
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof GatewayError) {
        throw err;
      }
      throw new GatewayError(
        `DNS resolution failed for '${hostname}': ${(err as Error)?.message || "unknown"}`,
        "SHOPIFY_NETWORK_ERROR",
        502,
      );
    }
  }

  return parsed;
}

/**
 * Returns the list of permitted upload roots for local file reads.
 */
export function getAllowedUploadRoots(): string[] {
  const roots: string[] = [
    path.resolve(process.cwd(), "src/modules/pinterest-pod/server/data/pinterest_pod/output"),
    path.resolve(process.cwd(), ".local-data"),
  ];

  if (process.env.ALLOWED_UPLOAD_ROOT && process.env.ALLOWED_UPLOAD_ROOT.trim() !== "") {
    const customRoots = process.env.ALLOWED_UPLOAD_ROOT.split(path.delimiter)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => path.resolve(r));
    roots.push(...customRoots);
  }

  return roots;
}

function isInsideDirectory(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Verifies that a local file path exists and is strictly inside an allowed upload root,
 * defeating directory traversal (../) and symlink escaping. Returns the canonical real path.
 */
export function assertPathInAllowedRoots(filePath: string): string {
  if (!filePath || typeof filePath !== "string") {
    throw new GatewayError("Invalid file path", "SHOPIFY_INVALID_INPUT", 400);
  }

  let cleanPath = filePath.trim();
  if (cleanPath.startsWith("file://")) {
    try {
      cleanPath = new URL(cleanPath).pathname;
    } catch {
      throw new GatewayError("Invalid file:// URI format", "SHOPIFY_INVALID_INPUT", 400);
    }
  }

  const resolvedTarget = path.resolve(cleanPath);
  const allowedRoots = getAllowedUploadRoots();

  const checkInside = (target: string): boolean => {
    return allowedRoots.some((root) => {
      if (isInsideDirectory(root, target)) return true;
      try {
        if (fs.existsSync(root)) {
          const canonicalRoot = fs.realpathSync(root);
          if (isInsideDirectory(canonicalRoot, target)) return true;
        }
      } catch {
        // ignore
      }
      return false;
    });
  };

  // 1. Lexical path containment check
  if (!checkInside(resolvedTarget)) {
    throw new GatewayError(
      `Access denied: path '${filePath}' is outside allowed upload roots`,
      "SHOPIFY_SECURITY_ERROR",
      403,
    );
  }

  // 2. Existence check
  if (!fs.existsSync(resolvedTarget)) {
    throw new GatewayError(`File not found: '${filePath}'`, "SHOPIFY_USER_ERROR", 404);
  }

  // 3. Resolve symlinks to canonical path
  let realTarget: string;
  try {
    realTarget = fs.realpathSync(resolvedTarget);
  } catch (err: unknown) {
    throw new GatewayError(
      `Inaccessible file path '${filePath}': ${(err as Error)?.message || "unknown"}`,
      "SHOPIFY_USER_ERROR",
      400,
    );
  }

  // 4. Canonical real path containment check (defeats symlink escapes)
  if (!checkInside(realTarget)) {
    throw new GatewayError(
      `Access denied: real path '${realTarget}' is outside allowed upload roots`,
      "SHOPIFY_SECURITY_ERROR",
      403,
    );
  }

  return realTarget;
}

/**
 * Safely fetches a public image URL, validating every redirect hop against private networks.
 */
export async function fetchSafePublicUrl(
  urlStr: string,
  options?: { readonly maxRedirects?: number; readonly timeoutMs?: number },
): Promise<ResolvedLocalImage> {
  const maxRedirects = options?.maxRedirects ?? 5;
  const timeoutMs = options?.timeoutMs ?? 8_000;

  let currentUrl = urlStr;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const validatedUrl = await validateSafeFetchUrl(currentUrl);

    let res: Response;
    try {
      res = await fetch(validatedUrl.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      if (err instanceof GatewayError) throw err;
      throw new GatewayError(
        `Failed to fetch public image from '${validatedUrl.toString()}': ${(err as Error)?.message || "network error"}`,
        "SHOPIFY_NETWORK_ERROR",
        502,
      );
    }

    // Handle HTTP redirects (301, 302, 303, 307, 308)
    if ((res.status >= 301 && res.status <= 303) || res.status === 307 || res.status === 308) {
      const location = res.headers.get("location");
      if (!location) {
        throw new GatewayError("Redirect response missing Location header", "SHOPIFY_NETWORK_ERROR", 502);
      }
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new GatewayError("Too many redirects while fetching image", "SHOPIFY_NETWORK_ERROR", 502);
      }
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new GatewayError(
        `Failed to fetch public image from '${validatedUrl.toString()}': HTTP ${res.status} ${res.statusText}`,
        "SHOPIFY_NETWORK_ERROR",
        502,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "";
    if (contentType === "image/jpg") contentType = "image/jpeg";
    let filename = "image.jpg";
    try {
      const name = path.basename(validatedUrl.pathname);
      if (name && name.includes(".")) {
        filename = decodeURIComponent(name);
      }
    } catch {
      // ignore
    }
    if (!contentType || contentType === "application/octet-stream") {
      contentType = guessMimeType(filename);
    }

    return { buffer, contentType, filename };
  }

  throw new GatewayError("Exceeded maximum redirects", "SHOPIFY_NETWORK_ERROR", 502);
}

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

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".test") ||
      hostname === "metadata" ||
      hostname === "metadata.google.internal" ||
      hostname === "instance-data"
    ) {
      return true;
    }

    if (isPrivateIp(hostname)) {
      return true;
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
  if (!urlOrPath || typeof urlOrPath !== "string") {
    throw new GatewayError("Invalid image URL or file path", "SHOPIFY_INVALID_INPUT", 400);
  }
  const trimmed = urlOrPath.trim();
  if (!trimmed) {
    throw new GatewayError("Empty image URL or file path", "SHOPIFY_INVALID_INPUT", 400);
  }

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

  // 2. Pinterest POD output assets (e.g. /api/pinterest-pod/assets/:jobId/:filename)
  const podMatch = /\/api\/pinterest-pod\/assets\/([^/?#]+)\/([^?#]+)/.exec(trimmed);
  if (podMatch) {
    const rawJobId = podMatch[1] ?? "";
    const rawFileName = podMatch[2] ?? "";
    let jobId: string;
    let decodedFileName: string;
    try {
      jobId = decodeURIComponent(rawJobId);
      decodedFileName = decodeURIComponent(rawFileName);
    } catch {
      throw new GatewayError("Invalid URI encoding in Pinterest POD URL", "SHOPIFY_INVALID_INPUT", 400);
    }
    if (
      rawJobId.includes("..") ||
      rawFileName.includes("..") ||
      jobId.includes("..") ||
      decodedFileName.includes("..")
    ) {
      throw new GatewayError("Path traversal detected in Pinterest POD URL", "SHOPIFY_SECURITY_ERROR", 403);
    }
    const fileName = path.basename(decodedFileName);
    if (!fileName) {
      throw new GatewayError("Invalid filename in Pinterest POD URL", "SHOPIFY_INVALID_INPUT", 400);
    }

    const candidateRoots = getAllowedUploadRoots();
    let foundFilePath: string | undefined;

    for (const rootDir of candidateRoots) {
      if (!fs.existsSync(rootDir)) continue;
      const directJobPath = path.join(rootDir, jobId, fileName);
      if (fs.existsSync(directJobPath)) {
        foundFilePath = directJobPath;
        break;
      }
      const directPath = path.join(rootDir, fileName);
      if (fs.existsSync(directPath)) {
        foundFilePath = directPath;
        break;
      }
      const recursivePath = findFileRecursively(rootDir, fileName);
      if (recursivePath && fs.existsSync(recursivePath)) {
        foundFilePath = recursivePath;
        break;
      }
    }

    if (foundFilePath) {
      const safePath = assertPathInAllowedRoots(foundFilePath);
      const buffer = await fs.promises.readFile(safePath);
      const contentType = guessMimeType(fileName);
      return { buffer, contentType, filename: fileName };
    }

    throw new GatewayError(
      `Pinterest POD asset '${fileName}' not found on disk under allowed roots`,
      "SHOPIFY_USER_ERROR",
      404,
    );
  }

  // 3. Local direct file on disk or file:// URI
  if (
    trimmed.startsWith("file:") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  ) {
    const safePath = assertPathInAllowedRoots(trimmed);
    const stats = await fs.promises.stat(safePath);
    if (!stats.isFile()) {
      throw new GatewayError(`Path is not a regular file: '${safePath}'`, "SHOPIFY_USER_ERROR", 400);
    }
    const buffer = await fs.promises.readFile(safePath);
    const filename = path.basename(safePath);
    const contentType = guessMimeType(filename);
    return { buffer, contentType, filename };
  }

  // 4. HTTP / HTTPS URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return await fetchSafePublicUrl(trimmed);
  }

  // 5. Fallback: treat as relative file path and enforce allowed roots check
  const safePath = assertPathInAllowedRoots(trimmed);
  const stats = await fs.promises.stat(safePath);
  if (!stats.isFile()) {
    throw new GatewayError(`Path is not a regular file: '${safePath}'`, "SHOPIFY_USER_ERROR", 400);
  }
  const buffer = await fs.promises.readFile(safePath);
  const filename = path.basename(safePath);
  const contentType = guessMimeType(filename);
  return { buffer, contentType, filename };
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

  const stageResult = await executeFilesStageBinary(
    store,
    client,
    {
      filename,
      mimeType: contentType,
      content: buffer,
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

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
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

  const updatedMediaList = await mapConcurrent(
    mediaList,
    4,
    async (item) => {
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
    },
  );

  return { mediaList: updatedMediaList, urlMap };
}
