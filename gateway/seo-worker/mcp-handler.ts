import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createWorkerMcpServer } from "./mcp-server";
import { SeoWorkerError } from "./protocol";
import type { SeoWorkerRepository } from "./repository";
import type { WorkerWorkflow } from "./workflow";

export async function handleWorkerMcp(req: IncomingMessage, res: ServerResponse, repository: SeoWorkerRepository, workflow: WorkerWorkflow): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const fail = (status: number, message: string): void => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } })); };
  if (req.method !== "POST") { fail(405, "METHOD_NOT_ALLOWED"); return; }
  const match = /^Bearer (ffp_worker_[A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? "");
  if (!match) { fail(401, "INVALID_TOKEN"); return; }
  const token = match[1];
  try { await repository.identify(token); }
  catch (error) {
    if (error instanceof SeoWorkerError) await repository.metrics.record(token, error.code);
    fail(error instanceof SeoWorkerError ? 401 : 503, error instanceof SeoWorkerError ? error.code : "WORKER_UNAVAILABLE"); return;
  }
  const server = createWorkerMcpServer(repository, workflow, token);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
      if (size > 1_000_000) { fail(413, "REQUEST_TOO_LARGE"); return; }
      chunks.push(bytes);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) { if (!res.headersSent) fail(error instanceof SyntaxError ? 400 : 500, error instanceof SyntaxError ? "INVALID_JSON" : "WORKER_UNAVAILABLE"); }
  finally { await transport.close(); await server.close(); }
}
