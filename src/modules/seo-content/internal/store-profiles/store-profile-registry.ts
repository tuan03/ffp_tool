import type { SeoStoreProfile } from "../../types";
import { CAPOZEN_RUG_PROFILE } from "./capozen-rug-profile";
import { JEMINISE_BEDDING_PROFILE } from "./jeminise-bedding-profile";
import { PREAUREUM_HANDBAG_PROFILE } from "./preaureum-handbag-profile";

export const STORE_PROFILES_REGISTRY: readonly SeoStoreProfile[] = Object.freeze([
  CAPOZEN_RUG_PROFILE,
  JEMINISE_BEDDING_PROFILE,
  PREAUREUM_HANDBAG_PROFILE,
]);

const STORE_DOMAIN_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  capozen: Object.freeze(["capozen.myshopify.com"]),
  jeminise: Object.freeze(["jeminise.com", "b6-theme-test.myshopify.com", "f4hgwc-hu.myshopify.com"]),
  preaureum: Object.freeze(["leatherbag-3anqqbf8.myshopify.com"]),
});

export interface StoreProfileQuery {
  readonly profileId?: string;
  readonly storeId?: string;
  readonly siteDomain?: string;
  readonly url?: string;
}

export interface SeoStoreProfileSummary {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly storeName: string;
  readonly niche: string;
}

export function listSeoStoreProfiles(
  registry: readonly SeoStoreProfile[] = STORE_PROFILES_REGISTRY,
): readonly SeoStoreProfileSummary[] {
  return registry.map((profile) => Object.freeze({
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    storeName: profile.storeName,
    niche: profile.niche,
  }));
}

export function normalizeDomain(rawDomainOrUrl?: string): string {
  if (!rawDomainOrUrl || typeof rawDomainOrUrl !== "string") {
    return "";
  }
  let domain = rawDomainOrUrl.trim().toLowerCase();
  // Strip protocol
  domain = domain.replace(/^https?:\/\//i, "");
  // Strip path and query parameters
  domain = domain.split("/")[0].split("?")[0].split("#")[0];
  // Strip credentials if present (user:pass@)
  if (domain.includes("@")) {
    domain = domain.split("@")[1];
  }
  // Strip port if present
  domain = domain.split(":")[0];
  // Strip trailing dot
  domain = domain.replace(/\.+$/, "");
  // Strip leading www.
  if (domain.startsWith("www.")) {
    domain = domain.slice(4);
  }
  return domain;
}

function scopeProfileToExecutionStore(
  profile: SeoStoreProfile,
  requestedStoreId: string | undefined,
): SeoStoreProfile {
  const executionStoreId = requestedStoreId?.trim();
  if (!executionStoreId || executionStoreId === profile.storeId) {
    return profile;
  }

  // A runtime store may intentionally reuse a versioned policy profile through
  // its registered Shopify domain. Keep that policy immutable while binding
  // the semantic input to the exact execution store required by GPT SEO.
  return Object.freeze({
    ...profile,
    storeId: executionStoreId,
  });
}

/**
 * Resolves a StoreContentProfile based on storeId, siteDomain, or url.
 */
export function resolveStoreProfile(
  query: StoreProfileQuery,
  registry: readonly SeoStoreProfile[] = STORE_PROFILES_REGISTRY,
): SeoStoreProfile | undefined {
  const profileId = query.profileId?.trim().toLowerCase();
  const storeId = query.storeId?.trim().toLowerCase();
  const normalizedDomain = normalizeDomain(query.siteDomain || query.url);

  if (profileId) {
    const profile = registry.find((candidate) => candidate.profileId.toLowerCase() === profileId);
    return profile ? scopeProfileToExecutionStore(profile, query.storeId) : undefined;
  }

  for (const profile of registry) {
    if (
      storeId &&
      (
        profile.storeId.toLowerCase() === storeId
      )
    ) {
      return scopeProfileToExecutionStore(profile, query.storeId);
    }

    if (normalizedDomain) {
      const aliases = STORE_DOMAIN_ALIASES[profile.storeId.toLowerCase()] ?? [];
      for (const alias of aliases) {
        const normalizedAlias = normalizeDomain(alias);
        if (
          normalizedDomain === normalizedAlias ||
          normalizedDomain.endsWith(`.${normalizedAlias}`)
        ) {
          return scopeProfileToExecutionStore(profile, query.storeId);
        }
      }
    }
  }

  return undefined;
}
