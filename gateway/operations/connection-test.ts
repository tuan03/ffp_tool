import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { ConnectionTestData, StoreConfig } from "../types";

const CONNECTION_TEST_QUERY = `
  query ConnectionTest {
    shop {
      name
      myshopifyDomain
      currencyCode
    }
  }
`;

interface ConnectionTestRawResponse {
  readonly shop: {
    readonly name: string;
    readonly myshopifyDomain: string;
    readonly currencyCode: string;
  };
}

export async function executeConnectionTest(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload?: unknown,
): Promise<ConnectionTestData> {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
  const rawTimeout = typeof p?.timeoutMs === "number" && p.timeoutMs > 0 ? p.timeoutMs : undefined;
  // Defensive clamp between 1s (1000ms) and 60s (60000ms) to prevent socket hangs or immediate timeouts
  const timeoutMs = rawTimeout !== undefined ? Math.min(Math.max(rawTimeout, 1000), 60000) : undefined;
  const data = await client.query<ConnectionTestRawResponse>(
    store,
    CONNECTION_TEST_QUERY,
    undefined,
    timeoutMs !== undefined ? { timeoutMs } : undefined,
  );
  return {
    isConnected: true,
    connected: true,
    shopDomain: data.shop.myshopifyDomain || store.shopDomain,
    shopName: data.shop.name,
    currencyCode: data.shop.currencyCode,
  };
}
