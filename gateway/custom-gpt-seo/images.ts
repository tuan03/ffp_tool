import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function signImage(key: string, jobId: string, imageId: string, expires: number): string {
  return createHmac("sha256", key).update(JSON.stringify([jobId, imageId, expires])).digest("hex");
}
export function verifyImageSignature(key: string, jobId: string, imageId: string, expires: number, signature: string): boolean {
  if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + 15 * 60_000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signImage(key, jobId, imageId, expires)), Buffer.from(signature));
}
/** Only established product CDNs are fetched; no arbitrary URL proxy or local file access. */
export async function downloadProductImage(source: string): Promise<{ bytes: Buffer; contentType: string; extension: string }> {
  let url = new URL(source);
  const signal = AbortSignal.timeout(10_000);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !(hostname === "cdn.shopify.com" || hostname.endsWith(".media-amazon.com") || hostname.endsWith(".ssl-images-amazon.com"))) throw new Error("Image host is not an approved product CDN; use manual attachment");
    const response = await fetch(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Image redirect has no location");
      url = new URL(location, url); continue;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0] || "";
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[contentType];
    if (!response.ok || !extension || Number(response.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw new Error("Image is unavailable, unsupported or exceeds 8 MB"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Image has no content");
    const chunks: Buffer[] = []; let size = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 8 MB"); chunks.push(Buffer.from(chunk.value)); }
    } finally { await reader.cancel(); }
    return { bytes: Buffer.concat(chunks), contentType, extension };
  }
  throw new Error("Too many image redirects");
}
