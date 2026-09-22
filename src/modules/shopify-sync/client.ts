import type { GraphqlResponse, ShopifyCredentials, ShopifySyncOptions } from "./types";

export interface ShopifyClient {
  readonly shop: string;
  readonly apiVersion: string;
  readonly request: <T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<T>;
}

function normalizeShopDomain(shop: string): string {
  const clean = shop.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!clean) {
    throw new Error("Shopify shop domain is required.");
  }
  if (!clean.includes(".")) {
    return `${clean}.myshopify.com`;
  }
  return clean;
}

function isThrottled(errors?: readonly { readonly message?: string; readonly extensions?: { readonly code?: string } }[]): boolean {
  if (!errors || errors.length === 0) {
    return false;
  }
  return errors.some((error) => {
    const code = error.extensions?.code?.toUpperCase() ?? "";
    const msg = error.message ?? "";
    return code === "THROTTLED" || /throttl/i.test(msg);
  });
}

function calculateThrottleDelayMs(
  attempt: number,
  baseDelayMs: number,
  retryAfterHeader?: string | null,
): number {
  if (retryAfterHeader) {
    const seconds = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  const exponential = Math.min(10000, baseDelayMs * 2 ** attempt);
  const jitter = Math.random() * 200;
  return exponential + jitter;
}

export function createShopifyClient(
  credentials?: ShopifyCredentials,
  options?: ShopifySyncOptions,
): ShopifyClient {
  const shop = normalizeShopDomain(
    credentials?.shop ||
      (typeof process !== "undefined" && process.env?.SHOPIFY_SHOP) ||
      "",
  );
  const token =
    credentials?.accessToken ||
    (typeof process !== "undefined" && process.env?.SHOPIFY_ACCESS_TOKEN) ||
    "";
  const apiVersion = credentials?.apiVersion || "2026-04";

  if (!token) {
    throw new Error("Shopify accessToken is required.");
  }

  const maxAttempts = Math.max(1, options?.maxThrottleAttempts ?? 4);
  const baseDelayMs = Math.max(100, options?.throttleBaseDelayMs ?? 1000);

  return {
    shop,
    apiVersion,
    async request<T = Record<string, unknown>>(
      query: string,
      variables: Record<string, unknown> = {},
    ): Promise<T> {
      const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query, variables }),
        });

        const json = (await response.json().catch(() => ({}))) as GraphqlResponse<T>;
        const throttled = response.status === 429 || isThrottled(json.errors);

        if (throttled && attempt + 1 < maxAttempts) {
          const delay = calculateThrottleDelayMs(
            attempt,
            baseDelayMs,
            response.headers.get("retry-after"),
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          const errorMsg = json.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`;
          throw new Error(`Shopify GraphQL HTTP error: ${errorMsg}`);
        }

        if (json.errors && json.errors.length > 0) {
          const errorMsg = json.errors.map((e) => e.message).join("; ");
          throw new Error(`Shopify GraphQL error: ${errorMsg}`);
        }

        if (!json.data) {
          throw new Error("Shopify GraphQL response did not contain data.");
        }

        return json.data;
      }

      throw new Error("Shopify GraphQL request exhausted maximum retry attempts.");
    },
  };
}
