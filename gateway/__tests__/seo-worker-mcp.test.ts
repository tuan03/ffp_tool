import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";

import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { createWorkerMcpServer } from "../seo-worker/mcp-server";
import { SeoWorkerRepository } from "../seo-worker/repository";
import { createWorkerWorkflow } from "../seo-worker/workflow";
import { handleWorkerMcp } from "../seo-worker/mcp-handler";
import { handleSeoAgentHttp } from "../seo-worker/admin-handler";

test("operator token issuance grants registry stores only and retains authentication/CSRF checks", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  const repository = new SeoWorkerRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) });
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, {
    operator: req.headers.authorization === "Basic test" ? "admin" : undefined,
    hasStore: storeId => ["demo", "second"].includes(storeId), listStoreIds: () => ["demo", "second"], repository: async () => repository,
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-agent/tokens?storeId=demo`;
    const headers = { authorization: "Basic test", "x-ffp-agent": "1", "content-type": "application/json" };
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { authorization: "Basic test" }, body: "{}" })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ workerId: "machine", storeIds: ["injected"] }) })).status, 400);
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ workerId: "machine" }) });
    assert.equal(response.status, 201);
    const issued = z.object({ token: z.string(), tokenId: z.string() }).parse(await response.json());
    assert.deepEqual((await repository.identify(issued.token)).storeIds, ["demo", "second"]);
    assert.deepEqual((await repository.listAccess("second", 0)).tokens[0].storeIds, ["demo", "second"]);
    assert.equal((await repository.listAccess("injected", 0)).total, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
});

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
    for (const name of ["get_seo_performance", "list_seo_opportunities", "get_page_seo_evidence", "request_page_inspection", "save_seo_recommendation", "get_seo_change_history"]) {
      assert.ok(tools.some(tool => tool.name === name));
    }
    const disabled = await client.callTool({ name: "get_seo_performance", arguments: {} });
    assert.equal(disabled.isError, true);
    assert.match(JSON.stringify(disabled), /SEO_PERFORMANCE_DISABLED/);
    assert.ok(tools.every(tool => !/publish|approve|sync|sql|configure/.test(tool.name)));
    assert.ok(tools.filter(tool => tool.name !== "worker_select_store").every(tool => !Object.hasOwn(tool.inputSchema.properties ?? {}, "storeId")));
    const forbiddenStore = await client.callTool({ name: "worker_select_store", arguments: { storeId: "other", expectedStoreId: "demo", requestId: "denied-store" } });
    assert.equal(forbiddenStore.isError, true);
    assert.match(JSON.stringify(forbiddenStore), /STORE_NOT_AUTHORIZED/);
    const contracts = await client.readResource({ uri: "ffp://seo-worker/contracts" });
    assert.match(JSON.stringify(contracts), /productSeoTitle/);
    const status = await client.callTool({ name: "worker_status", arguments: {} });
    assert.notEqual(status.isError, true);
    assert.match(JSON.stringify(status), /demo/);
    const job = { id: "context-job", storeId: "demo", source: "auto_seo", sourceIdentity: "123", status: "PENDING", input: { productId: "123", images: [] }, original: {}, settings: { provider: "codex_mcp" }, checkpoints: {} };
    await pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ('context-job','demo','context','PENDING',$1,1,'codex_mcp')", [JSON.stringify(job)]);
    await repository.enableStore("demo");
    const { sessionId } = await repository.register(issued.token, "register-context");
    const run = await repository.startRun(issued.token, sessionId, 1, "context-run");
    const claim = await repository.claim(issued.token, sessionId, run.id, "context-claim");
    assert.ok(claim.lease);
    assert.deepEqual((await workflow.context(issued.token, claim.lease)).gsc, { status: "disabled" });
    const optional = createWorkerWorkflow(repository, { checkSource: async () => undefined, performanceEvidence: async source => {
      assert.equal(source.storeId, "demo"); assert.equal(source.input.productId, "123");
      throw new Error("synthetic private database error");
    } });
    const context = await optional.context(issued.token, claim.lease);
    assert.match(JSON.stringify(context.gsc), /unavailable/);
    assert.doesNotMatch(JSON.stringify(context), /private database/);
    await repository.revoke("demo", issued.tokenId);
    const revoked = await client.callTool({ name: "worker_status", arguments: {} });
    assert.equal(revoked.isError, true);
    assert.match(JSON.stringify(revoked), /TOKEN_REVOKED/);
    assert.equal(JSON.stringify(revoked).includes(issued.token), false);
    const revokedAudit = await client.callTool({ name: "get_seo_performance", arguments: {} });
    assert.equal(revokedAudit.isError, true);
    assert.match(JSON.stringify(revokedAudit), /TOKEN_REVOKED/);
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
    await pg.query("UPDATE seo_worker_tokens SET created_at=0,expires_at=1 WHERE id=$1", [token.tokenId]);
    assert.equal((await invoke()).status, 401);
    assert.equal((await pg.query<{ kind: string }>("SELECT kind FROM seo_worker_metric_events WHERE store_id='demo'")).rows[0].kind, "TOKEN_EXPIRED");
    await repository.revoke("demo", token.tokenId);
    assert.equal((await invoke()).status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
});
