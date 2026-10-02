import { BlockList, isIP } from "node:net";

const blockedIpv6 = new BlockList();
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3ffe::", 16], ["3fff::", 20]] as const) blockedIpv6.addSubnet(address, prefix, "ipv6");

export function normalizePageUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("INVALID_PUBLIC_URL");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

export function assertPropertyMapping(property: string, rawOrigin: string): URL {
  const origin = new URL(normalizePageUrl(rawOrigin));
  if (origin.pathname !== "/" || origin.search || isIP(origin.hostname) || !origin.hostname.includes(".")) throw new Error("INVALID_STOREFRONT_ORIGIN");
  if (property.startsWith("sc-domain:")) {
    const domain = property.slice(10).toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(domain) || !(origin.hostname === domain || origin.hostname.endsWith(`.${domain}`))) throw new Error("PROPERTY_DOMAIN_MISMATCH");
  } else {
    const prefix = new URL(property);
    if (prefix.origin !== origin.origin || prefix.pathname !== "/" || prefix.search) throw new Error("PROPERTY_PREFIX_MUST_COVER_STOREFRONT");
  }
  return origin;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  // Only global unicast IPv6. Exclude mapped, transition and documentation ranges.
  const lower = address.toLowerCase();
  return isIP(address) === 6 && /^[23]/.test(lower) && !blockedIpv6.check(address, "ipv6");
}

export function pageKind(raw: string): "product" | "collection" | "blog" | "page" | "home" | "other" {
  const path = new URL(raw).pathname;
  if (path === "/") return "home";
  if (/\/products\/[^/]+\/?$/.test(path)) return "product";
  if (/\/collections\//.test(path)) return "collection";
  if (/\/blogs\//.test(path)) return "blog";
  if (/\/pages\//.test(path)) return "page";
  return "other";
}
