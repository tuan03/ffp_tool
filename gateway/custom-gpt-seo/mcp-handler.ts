import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { McpCredential } from "../../src/config/custom-gpt-environment";

import { createCodexSeoMcpServer } from "./mcp-server";
import type { ExternalSeoWorkflow } from "./workflow";

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
  res.end(JSON.stringify(payload));
}

export interface CodexSeoMcpHandlerOptions {
  readonly workflow: ExternalSeoWorkflow;
  readonly mcpCredentials: readonly McpCredential[];
}

export function createCodexSeoMcpHandler(options: CodexSeoMcpHandlerOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      });
      return;
    }

    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const credential = options.mcpCredentials.find(candidate => matchesSecret(bearer, candidate.secret));
    if (!credential) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendJson(res, 401, {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Invalid MCP credentials" },
        id: null,
      });
      return;
    }

    const server = createCodexSeoMcpServer({
      workflow: options.workflow,
      storeId: credential.storeId,
      ownerId: `codex_mcp:${credential.workerId}`,
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
            message: error instanceof SyntaxError ? "Invalid JSON" : "Internal MCP error",
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
