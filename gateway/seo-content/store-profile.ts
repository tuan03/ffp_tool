import { resolveStoreProfile } from "../../src/modules/seo-content";
import type { SeoStoreProfile } from "../../src/modules/seo-content";

import { loadRuntimeStores } from "../store-config-loader";
import { normalizeShopDomain } from "../store-registry";
import type { StoreConfig } from "../types";

interface AutoSeoStoreIdentity {
  readonly storeId: string;
  readonly shopDomain: string;
}

export class AutoSeoStoreProfileError extends Error {
  public constructor(
    public readonly code: "STORE_PROFILE_REQUIRED" | "STORE_DOMAIN_MISMATCH",
  ) {
    super(code === "STORE_PROFILE_REQUIRED"
      ? "Store chưa có SEO profile hợp lệ. Mở Sửa store, chọn SEO profile phù hợp, lưu rồi chạy lại Auto SEO."
      : "Domain Shopify không khớp cấu hình store. Tải lại danh sách sản phẩm đúng store rồi thử lại.");
    this.name = "AutoSeoStoreProfileError";
  }
}

/** Runtime policy is authoritative; never infer a new store's policy from its name. */
export function requireAutoSeoStoreProfile(
  identity: AutoSeoStoreIdentity,
  stores: readonly StoreConfig[] = loadRuntimeStores(),
): SeoStoreProfile {
  const store = stores.find(candidate => candidate.storeId === identity.storeId);
  if (store && normalizeShopDomain(store.shopDomain) !== normalizeShopDomain(identity.shopDomain)) {
    throw new AutoSeoStoreProfileError("STORE_DOMAIN_MISMATCH");
  }
  const profile = resolveStoreProfile({
    profileId: store?.seoProfileId,
    storeId: identity.storeId,
    siteDomain: store?.shopDomain ?? identity.shopDomain,
  });
  if (!profile) throw new AutoSeoStoreProfileError("STORE_PROFILE_REQUIRED");
  return profile;
}
