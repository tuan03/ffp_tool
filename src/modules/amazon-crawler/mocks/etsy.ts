import type { EtsyCrawlerClient } from "../etsy-types";
import { normalizeEtsyListingId } from "../etsy-input";

export const mockEtsyClient: EtsyCrawlerClient = {
  async check(_storeId, listingIds, signal) {
    signal?.throwIfAborted();
    const ids = [...new Set(listingIds.map(normalizeEtsyListingId))];
    if (ids.length === 0 || ids.length > 200) throw new Error("Nhập từ 1 đến 200 listing.");
    return { ready: true, listings: ids.map(listingId => ({ listingId, status: "available" })), matches: [], allowedListingIds: ids };
  },
  async status() { return { configured: true, hasAccessToken: true, hasRefreshToken: true, refreshEnabled: false, environmentOwner: "mock" }; },
  async save() { return this.status(); },
  async test() { return true; },
};
