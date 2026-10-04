import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";

import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { createWorkerMcpServer } from "../seo-worker/mcp-server";
import { SeoWorkerRepository } from "../seo-worker/repository";
import { createWorkerWorkflow } from "../seo-worker/workflow";
import { handleWorkerMcp } from "../seo-worker/mcp-handler";

test("worker MCP exposes no publish/admin capabilities and rechecks token on every tool", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  const repository = new SeoWorkerRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) });
  const issued = await repository.issueToken({ storeId: "demo", workerId: "laptop", createdBy: "admin" });
  const workflow = createWorkerWorkflow(repository, { checkSource: async () => undefined });
  const server = createWorkerMcpServer(repository, workflow, issued.token);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(tool => tool.name === "job_submit_draft"));
    assert.ok(tools.every(tool => !/publish|approve|sync|sql|configure/.test(tool.name)));
    assert.ok(tools.every(tool => !Object.hasOwn(tool.inputSchema.properties ?? {}, "storeId")));
    const status = await client.callTool({ name: "worker_status", arguments: {} });
    assert.notEqual(status.isError, true);
    assert.match(JSON.stringify(status), /demo/);
    await repository.revoke("demo", issued.tokenId);
    const revoked = await client.callTool({ name: "worker_status", arguments: {} });
    assert.equal(revoked.isError, true);
    assert.match(JSON.stringify(revoked), /TOKEN_REVOKED/);
    assert.equal(JSON.stringify(revoked).includes(issued.token), false);
  } finally { await client.close(); await server.close(); await pg.close(); }
});

test("stateless worker HTTP supports helper JSON calls and rejects revoked credentials", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  const repository = new SeoWorkerRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) });
  const token = await repository.issueToken({ storeId: "demo", workerId: "http-worker", createdBy: "admin" });
  const workflow = createWorkerWorkflow(repository, { checkSource: async () => undefined });
  const server = http.createServer((req, res) => { void handleWorkerMcp(req, res, repository, workflow); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/mcp/seo-worker`;
    const invoke = () => fetch(url, { method: "POST", headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "worker_status", arguments: {} } }) });
    const response = await invoke();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.match(await response.text(), /http-worker/);
    await repository.revoke("demo", token.tokenId);
    assert.equal((await invoke()).status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
});
