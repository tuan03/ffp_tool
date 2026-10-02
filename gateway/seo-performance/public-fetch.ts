import { lookup } from "node:dns/promises";
import { request } from "node:https";

import robotsParser from "robots-parser";

import { isPublicAddress, normalizePageUrl } from "./url-policy";

export const CRAWLER_AGENT = "FFPSeoAudit";
export interface PublicDocument { readonly url: string; readonly status: number; readonly body: string; readonly robots: string; readonly contentType: string }
/** DNS is validated AND pinned for the socket; every redirect is independently checked. */
export async function fetchPublicDocument(rawUrl: string, origin: string, redirects = 0, robots?: string): Promise<PublicDocument> {
  const url = new URL(normalizePageUrl(rawUrl));
  if (url.origin !== origin || redirects > 5) throw new Error("CRAWL_ORIGIN_FORBIDDEN");
  if (robots !== undefined && !isCrawlAllowed(origin, robots, url.href)) throw new Error("ROBOTS_DISALLOWED");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) throw new Error("CRAWL_ADDRESS_FORBIDDEN");
  const address = addresses[0];
  const response = await new Promise<PublicDocument & { location?: string }>((resolve, reject) => {
    const outgoing = request(url, {
      headers: { "User-Agent": `${CRAWLER_AGENT}/1.0`, Accept: "text/html,application/xml,text/xml,text/plain", "Accept-Encoding": "identity" },
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      }, signal: AbortSignal.timeout(15_000),
    }, incoming => {
      const chunks: Buffer[] = []; let size = 0;
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_000_000) { incoming.destroy(new Error("CRAWL_RESPONSE_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => resolve({ url: url.href, status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), contentType: String(incoming.headers["content-type"] ?? ""), robots: String(incoming.headers["x-robots-tag"] ?? ""), location: incoming.headers.location }));
    });
    outgoing.on("error", reject); outgoing.end();
  });
  if (response.status >= 300 && response.status < 400 && response.location) return fetchPublicDocument(new URL(response.location, url).href, origin, redirects + 1, robots);
  return response;
}
export async function loadRobots(origin: string): Promise<string> {
  const document = await fetchPublicDocument(`${origin}/robots.txt`, origin);
  if (document.status === 404) return "";
  if (document.status !== 200) throw new Error("ROBOTS_UNAVAILABLE");
  return document.body;
}
export function isCrawlAllowed(origin: string, robots: string, url: string): boolean {
  return robotsParser(`${origin}/robots.txt`, robots).isAllowed(url, CRAWLER_AGENT) !== false;
}
export function crawlDelay(origin: string, robots: string): number { return Math.max(1, robotsParser(`${origin}/robots.txt`, robots).getCrawlDelay(CRAWLER_AGENT) ?? 1); }
