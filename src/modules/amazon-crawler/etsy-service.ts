import type { EtsyConnectionStatus, EtsyCrawlerClient, EtsyListingStatus, EtsyPreflightResult } from "./etsy-types";
import { normalizeEtsyListingId } from "./etsy-input";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body)) throw new Error(`Không thực hiện được yêu cầu Etsy (HTTP ${response.status}). Kiểm tra kết nối và quyền truy cập.`);
  return body;
}

function readStatus(body: Record<string, unknown>): EtsyConnectionStatus {
  if (typeof body.configured !== "boolean") throw new Error("Trạng thái kết nối Etsy không hợp lệ.");
  return { configured: body.configured, hasAccessToken: body.hasAccessToken === true,
    hasRefreshToken: body.hasRefreshToken === true, refreshEnabled: body.refreshEnabled === true,
    environmentOwner: typeof body.environmentOwner === "string" ? body.environmentOwner : "" };
}

const STATUSES: readonly string[] = ["available", "existing", "processing", "queue_cleared", "crawled_pending_sync", "reconciliation_required"];

export function createEtsyCrawlerClient(options: {
  readonly engineUrl: string;
  readonly fetchImplementation?: typeof fetch;
  readonly shopifyFetch?: typeof fetch;
}): EtsyCrawlerClient {
  const coordinatorFetch = options.fetchImplementation ?? fetch;
  const shopifyFetch = options.shopifyFetch ?? fetch;
  const baseUrl = options.engineUrl.replace(/\/+$/, "");
  const request = async (path: string, method: string, payload?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> =>
    readResponse(await coordinatorFetch(`${baseUrl}/api/v1/${path}`, { method, signal, cache: "no-store",
      headers: { "Content-Type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }));
  return {
    async check(storeId, listingIds, signal) {
      const ids = [...new Set(listingIds.map(normalizeEtsyListingId))];
      if (!storeId || ids.length === 0 || ids.length > 200) throw new Error("Chọn store và nhập từ 1 đến 200 listing Etsy.");
      const metadata = await request("etsy-listings/resolve", "POST", { storeId, listingIds: ids }, signal);
      if (!Array.isArray(metadata.listings)) throw new Error("Không kiểm tra được trạng thái Etsy trong FFP.");
      const body = await readResponse(await shopifyFetch("/api/shopify", { method: "POST", signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, operation: "products.preflightEtsyListings",
          mode: "apply", requestId: `etsy-preflight-${crypto.randomUUID()}`, payload: { listingIds: ids, listings: metadata.listings } }) }));
      const result = body.data;
      if (body.success !== true || !isRecord(result) || typeof result.ready !== "boolean"
        || !Array.isArray(result.listings) || !Array.isArray(result.matches) || !Array.isArray(result.allowedListingIds)) {
        throw new Error("Shopify trả kết quả kiểm tra Etsy không hợp lệ.");
      }
      if (!result.ready) return { ready: false, listings: [], matches: [], allowedListingIds: [] };
      const listings: EtsyPreflightResult["listings"][number][] = [];
      for (const listing of result.listings) {
        if (!isRecord(listing) || typeof listing.listingId !== "string" || !ids.includes(listing.listingId)
          || typeof listing.status !== "string" || !STATUSES.includes(listing.status)) throw new Error("Trạng thái listing Etsy không hợp lệ.");
        listings.push({ listingId: listing.listingId, status: listing.status as EtsyListingStatus });
      }
      if (new Set(listings.map(listing => listing.listingId)).size !== ids.length) throw new Error("Kết quả kiểm tra Etsy không đầy đủ; chưa thể bắt đầu cào.");
      const matches: EtsyPreflightResult["matches"][number][] = [];
      for (const match of result.matches) {
        if (!isRecord(match) || typeof match.listingId !== "string" || !ids.includes(match.listingId)
          || typeof match.productId !== "string" || typeof match.title !== "string" || typeof match.adminUrl !== "string") throw new Error("Kết quả Shopify không hợp lệ.");
        matches.push({ listingId: match.listingId, productId: match.productId, title: match.title, adminUrl: match.adminUrl });
      }
      return { ready: true, listings, matches, allowedListingIds: listings.filter(listing => listing.status === "available" || listing.status === "queue_cleared").map(listing => listing.listingId) };
    },
    async status() { return readStatus(await request("etsy/auth/status", "GET")); },
    async save(credentials) {
      const payload = Object.fromEntries(Object.entries(credentials).filter(([, value]) => typeof value !== "string" || value.trim()));
      return readStatus(await request("etsy/auth/credentials", "PUT", payload));
    },
    async test() { return (await request("etsy/auth/test", "POST", {})).ok === true; },
  };
}
