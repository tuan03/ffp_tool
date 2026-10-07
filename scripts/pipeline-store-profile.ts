import type { StoreConfig } from "../gateway/types";
import type { SeoStoreProfile } from "../src/modules/seo-content";

interface StoreProfileQuery {
  readonly profileId?: string;
  readonly storeId?: string;
  readonly siteDomain?: string;
}

export interface ResolvePipelineStoreProfileInput {
  readonly storeId: string;
  readonly stores: readonly StoreConfig[];
  readonly reloadStores: () => readonly StoreConfig[];
  readonly resolveProfile: (query: StoreProfileQuery) => SeoStoreProfile | undefined;
}

export interface ResolvedPipelineStoreProfile {
  readonly stores: readonly StoreConfig[];
  readonly storeConfig?: StoreConfig;
  readonly storeProfile?: SeoStoreProfile;
}

function resolveFromStores(
  storeId: string,
  stores: readonly StoreConfig[],
  resolveProfile: ResolvePipelineStoreProfileInput["resolveProfile"],
): Omit<ResolvedPipelineStoreProfile, "stores"> {
  const storeConfig = stores.find((store) => store.storeId === storeId);
  return {
    storeConfig,
    storeProfile: resolveProfile({
      profileId: storeConfig?.seoProfileId,
      storeId,
      siteDomain: storeConfig?.shopDomain,
    }),
  };
}

export function resolvePipelineStoreProfile(
  input: ResolvePipelineStoreProfileInput,
): ResolvedPipelineStoreProfile {
  const current = resolveFromStores(input.storeId, input.stores, input.resolveProfile);
  if (current.storeProfile) {
    return { stores: input.stores, ...current };
  }

  const refreshedStores = input.reloadStores();
  const refreshed = resolveFromStores(input.storeId, refreshedStores, input.resolveProfile);
  return { stores: refreshedStores, ...refreshed };
}
