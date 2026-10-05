import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBootstrappedStores, loadLocalEnv } from "../store-config-loader";
import { CompositeTokenProvider } from "../token-provider";
import { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { InMemoryThrottleManager } from "../throttle-manager";
import { configureAdsGateway } from "./gateway-connection";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAdsMcpServer } from "./mcp-server";
import { getAdsIntelligenceService } from "./service";
import { listAvailableStoreProfileIds, loadStoreAdsProfile } from "./store-profile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

/**
 * Entrypoint for running the FFP Ads Intelligence MCP Server via standard I/O (stdio).
 * Compatible with Claude Desktop, Cursor IDE, Windsurf, Roo Code, and @modelcontextprotocol/inspector.
 */
async function main() {
  process.chdir(projectRoot);
  const env = loadLocalEnv(projectRoot);
  const stores = () => {
    const bootstrapped = loadBootstrappedStores({
      env,
      cwd: projectRoot,
      configFile: env.GATEWAY_STORES_FILE?.trim() || ".runtime/stores.local.json",
    });
    const profileIds = listAvailableStoreProfileIds({ configDir: path.resolve(projectRoot, "config/stores") });
    for (const pid of profileIds) {
      if (!bootstrapped.some((s) => s.storeId === pid)) {
        try {
          const profile = loadStoreAdsProfile(pid, { configDir: path.resolve(projectRoot, "config/stores") });
          bootstrapped.push({
            storeId: profile.storeId,
            shopDomain: profile.shopify?.shopDomain || `${profile.storeId}.myshopify.com`,
            apiVersion: profile.shopify?.apiVersion || "2026-07",
            auth: { type: "static", staticToken: "stdio-mock-token" },
          });
        } catch {
          // ignore
        }
      }
    }
    return bootstrapped;
  };

  configureAdsGateway({
    storeRegistry: {
      getStore: async (id) => stores().find((store) => store.storeId === id),
      listStores: async () => stores(),
    },
    graphqlClient: new ShopifyGraphqlClient({
      tokenProvider: new CompositeTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
    }),
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
