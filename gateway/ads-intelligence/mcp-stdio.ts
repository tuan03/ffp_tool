import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAdsMcpServer } from "./mcp-server";
import { getAdsIntelligenceService } from "./service";

/**
 * Entrypoint for running the FFP Ads Intelligence MCP Server via standard I/O (stdio).
 * Compatible with Claude Desktop, Cursor IDE, Windsurf, Roo Code, and @modelcontextprotocol/inspector.
 */
async function main() {
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
