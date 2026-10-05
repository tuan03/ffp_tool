import { loadBootstrappedStores, loadLocalEnv } from "../store-config-loader";
import { CompositeTokenProvider } from "../token-provider";
import { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { InMemoryThrottleManager } from "../throttle-manager";
import { configureAdsGateway } from "./gateway-connection";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAdsMcpServer } from "./mcp-server";
import { getAdsIntelligenceService } from "./service";

/**
 * Entrypoint for running the FFP Ads Intelligence MCP Server via standard I/O (stdio).
 * Compatible with Claude Desktop, Cursor IDE, Windsurf, Roo Code, and @modelcontextprotocol/inspector.
 */
async function main() {
  const env = loadLocalEnv();
  const stores = () => loadBootstrappedStores({ env: loadLocalEnv(), configFile: env.GATEWAY_STORES_FILE?.trim() || ".runtime/stores.local.json" });
  configureAdsGateway({
    storeRegistry: { getStore: id => stores().find(store => store.storeId === id), listStores: stores },
    graphqlClient: new ShopifyGraphqlClient({ tokenProvider: new CompositeTokenProvider(), throttleManager: new InMemoryThrottleManager() }),
  });
  const defaultStoreId = process.env.DEFAULT_STORE_ID || "chillgen";
  const service = getAdsIntelligenceService();
  const server = createAdsMcpServer({
    service,
    defaultStoreId,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[ffp-ads-mcp-stdio] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
