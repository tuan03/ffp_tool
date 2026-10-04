import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createAdsMcpServer } from "./mcp-server";
import { getAdsIntelligenceService } from "./service";
import type { AdsIntelligenceService } from "./service";

const MAX_MCP_REQUEST_BYTES = 1_000_000;

function matchesSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_MCP_REQUEST_BYTES) throw new Error("MCP request exceeds 1 MB");
    chunks.push(bytes);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload, null, 2));
}

export interface AdsMcpHandlerOptions {
  readonly service?: AdsIntelligenceService;
  readonly authToken?: string;
  readonly defaultStoreId?: string;
}

export function createAdsMcpHandler(options: AdsMcpHandlerOptions = {}) {
  const service = options.service ?? getAdsIntelligenceService();
  const configuredSecret = options.authToken || process.env.ADS_MCP_SECRET || process.env.GATEWAY_AUTH_TOKEN;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Info probe for GET
    if (req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        server: "ffp-ads-intelligence",
        version: "1.0.0",
        transport: "StreamableHTTP",
        description: "FFP Ads Intelligence MCP Server exposing performance, creative gaps, brief studio, and experiment ledger tools for Codex & AI agents.",
        endpoints: {
          mcpStreamableHttp: req.url?.split("?")[0] || "/mcp/ads",
          openApiSpec: "/api/ads-intelligence/openapi.json",
        },
        toolsCount: 30, // 15 canonical tools + 15 ffp_* aliases
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed. Use POST for JSON-RPC 2.0 or GET for server info." },
        id: null,
      });
      return;
    }

    // Optional authentication check
    if (configuredSecret) {
      const authHeader = req.headers.authorization;
      const bearer = authHeader?.replace(/^Bearer\s+/i, "") || (req.headers["x-gateway-key"] as string | undefined);
      if (!matchesSecret(bearer, configuredSecret)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="ffp-ads-mcp"');
        sendJson(res, 401, {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Invalid or missing MCP authorization credentials." },
          id: null,
        });
        return;
      }
    }

    // Extract storeId if passed as query parameter
    let storeId = options.defaultStoreId || "chillgen";
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const storeParam = url.searchParams.get("storeId");
      if (storeParam) {
        storeId = storeParam;
      }
    } catch {
      // Use fallback
    }

    const server = createAdsMcpServer({
      service,
      defaultStoreId: storeId,
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      const body = await readJson(req);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, error instanceof SyntaxError ? 400 : 500, {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof SyntaxError ? "Invalid JSON" : "Internal MCP server error",
          },
          id: null,
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  };
}

let cachedHandler: ReturnType<typeof createAdsMcpHandler> | null = null;

export async function handleAdsMcpHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!cachedHandler) {
    cachedHandler = createAdsMcpHandler();
  }
  await cachedHandler(req, res);
}
