import type { StoreContentProfile } from "./types";
import { JEMINISE_BEDDING_PROFILE } from "./jeminise-bedding-profile";

export const STORE_PROFILES_REGISTRY: readonly StoreContentProfile[] = Object.freeze([
  JEMINISE_BEDDING_PROFILE,
]);

export interface StoreProfileQuery {
  readonly storeId?: string;
  readonly siteDomain?: string;
  readonly url?: string;
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

/**
 * Resolves a StoreContentProfile based on storeId, siteDomain, or url.
 */
export function resolveStoreProfile(
  query: StoreProfileQuery,
  registry: readonly StoreContentProfile[] = STORE_PROFILES_REGISTRY,
): StoreContentProfile | undefined {
  const storeId = query.storeId?.trim().toLowerCase();
  const normalizedDomain = normalizeDomain(query.siteDomain || query.url);

  for (const profile of registry) {
    if (storeId && profile.storeId.toLowerCase() === storeId) {
      return profile;
    }

    if (normalizedDomain) {
      for (const alias of profile.domainAliases) {
        const normalizedAlias = normalizeDomain(alias);
        if (
          normalizedDomain === normalizedAlias ||
          normalizedDomain.endsWith(`.${normalizedAlias}`)
        ) {
          return profile;
        }
      }
    }
  }

  return undefined;
}
