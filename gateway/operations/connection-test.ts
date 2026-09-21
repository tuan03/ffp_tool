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
  _payload: unknown,
): Promise<ConnectionTestData> {
  const data = await client.query<ConnectionTestRawResponse>(store, CONNECTION_TEST_QUERY);
  return {
    isConnected: true,
    connected: true,
    shopDomain: data.shop.myshopifyDomain || store.shopDomain,
    shopName: data.shop.name,
    currencyCode: data.shop.currencyCode,
  };
}
