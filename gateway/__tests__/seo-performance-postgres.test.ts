import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { PerformanceRepository } from "../seo-performance/repository";
import type { PerformanceDatabase } from "../seo-performance/repository";
import { GoogleSearchClient } from "../seo-performance/google-client";
import { PerformanceService } from "../seo-performance/service";
import { PerformanceWorker } from "../seo-performance/worker";
import { inspectHtml } from "../seo-performance/page-audit";
import { registerPerformanceTools } from "../seo-performance/mcp-tools";
import { PERFORMANCE_SCHEMA_SQL } from "../seo-performance/schema";
import { pacificDate } from "../seo-performance/analytics";
import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { SeoWorkerRepository } from "../seo-worker/repository";
import { createWorkerMcpServer } from "../seo-worker/mcp-server";
import { createWorkerWorkflow } from "../seo-worker/workflow";

test("SEO Performance executes PostgreSQL schema, OAuth, reports, jobs and MCP safely", async t => {
  const database = await PGlite.create();
  const adapter: PerformanceDatabase = {
    query: async <Row,>(sql: string, values?: unknown[]) => {
      if (sql === PERFORMANCE_SCHEMA_SQL) { await database.exec(sql); return { rows: [], rowCount: 0 }; }
      const result = await database.query<Row>(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
    },
    connect: async () => ({ query: adapter.query, release: () => {} }),
    end: () => database.close(),
  };
  const repository = new PerformanceRepository("", adapter);
  const config = { enabled: true, databaseUrl: "", clientId: "test-client", clientSecret: "test-secret", redirectUri: "https://ffp.example/api/seo-performance/oauth/callback", encryptionKey: "7".repeat(64) };
  let apiMode = "ok";
  let tokenCalls = 0;
  const google = new GoogleSearchClient(adapter, config, async (input, options) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      tokenCalls++;
      if (apiMode === "revoked") return new Response("{}", { status: 400 });
      return Response.json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 0, scope: "https://www.googleapis.com/auth/webmasters.readonly" });
    }
    if (url.endsWith("/sites")) return Response.json({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] });
    if (url.includes("searchAnalytics")) {
      const request = JSON.parse(String(options?.body)) as { dimensions: string[]; startDate: string };
      const keys = request.dimensions.length === 2 ? ["https://example.com/products/a", "test query"] : request.dimensions[0] === "date" ? [request.startDate] : ["https://example.com/products/a"];
      return Response.json({ rows: [{ keys, clicks: 2, impressions: 100, position: 8 }] });
    }
    if (url.includes("urlInspection")) return Response.json({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } });
    return Response.json({});
  });
  const settings = { provider: "codex_mcp" as const, version: 1, batchSize: 5, language: "en-US", instructions: "Grounded facts only" };
  const service = new PerformanceService(repository, google, { settings: async () => settings, revise: async () => ({ jobId: "new-job" }), syncState: async () => null });
  try {
    await repository.initialize();
    await t.test("worker evidence is cached, product-ID scoped and fails closed on ambiguous mapping", async () => {
      await repository.map("worker-evidence", "sc-domain:worker.example", "https://worker.example");
      await repository.putPage("worker-evidence", "https://worker.example/products/one", { id: "gid://shopify/Product/123" });
      assert.match(JSON.stringify(await service.workerProductEvidence("worker-evidence", "123")), /available/);
      assert.deepEqual(await service.workerProductEvidence("other-store", "123"), { status: "not_mapped" });
      await repository.putPage("worker-evidence", "https://worker.example/products/alias", { id: "123" });
      assert.deepEqual(await service.workerProductEvidence("worker-evidence", "123"), { status: "not_mapped" });
      // Do not let the later scheduler tests discover this fixture store.
      await adapter.query("DELETE FROM sp_pages WHERE store_id='worker-evidence'");
      await adapter.query("DELETE FROM sp_mappings WHERE store_id='worker-evidence'");
    });
    await t.test("OAuth state is session bound and one-use; refresh credentials stay encrypted", async () => {
      const connection = await google.connect("session-a");
      const state = new URL(connection.url).searchParams.get("state") ?? "";
      await assert.rejects(google.callback({ state, code: "code", session: "session-b", cookie: connection.cookie }), /INVALID_OAUTH_STATE/);
      assert.equal(tokenCalls, 0);
      await google.callback({ state, code: "code", session: "session-a", cookie: connection.cookie });
      await assert.rejects(google.callback({ state, code: "code", session: "session-a", cookie: connection.cookie }), /INVALID_OAUTH_STATE/);
      const stored = await adapter.query<{ encrypted_token: string }>("SELECT encrypted_token FROM sp_connection");
      assert.equal(stored.rows[0].encrypted_token.includes("test-refresh"), false);
    });
    await t.test("Mapping requires property access and does not silently rebind historical data", async () => {
      await service.map("store-a", "sc-domain:example.com", "https://example.com");
      await assert.rejects(service.map("store-b", "sc-domain:unowned.com", "https://unowned.com"), /GSC_PROPERTY_FORBIDDEN/);
      await assert.rejects(repository.map("store-a", "sc-domain:elsewhere.com", "https://elsewhere.com"), /MAPPING_CHANGE/);
    });
    await t.test("Filters and counts precede pagination and stores stay isolated", async () => {
      await repository.map("store-b", "sc-domain:other.example", "https://other.example");
      await adapter.query("UPDATE sp_mappings SET last_sync=now() WHERE store_id='store-b'");
      for (let index = 0; index < 55; index++) await repository.putPage("store-a", `https://example.com/products/p-${index}`);
      await repository.putPage("store-a", "https://example.com/blogs/news/story");
      await repository.putPage("store-b", "https://other.example/products/private");
      const first = await repository.pages("store-a", { kind: "product", startDate: "2026-01-01", endDate: "2026-01-28" });
      assert.equal(first.total, 55); assert.equal(first.items.length, 50); assert.equal(first.nextOffset, 50);
      const last = await repository.pages("store-a", { kind: "product", offset: 50 });
      assert.equal(last.items.length, 5); assert.equal(last.nextOffset, null);
      await assert.rejects(repository.page("store-a", "https://other.example/products/private"), /PAGE_NOT_FOUND/);
      assert.equal((await repository.pages("store-a", { kind: "blog" })).total, 1);
    });
    await t.test("Background sync resumes day/dataset checkpoints and retries without duplicate metrics", async () => {
      await adapter.query("UPDATE sp_jobs SET payload=$1", [JSON.stringify({ days: 1, end: "2026-01-28" })]);
      const source = { products: async () => ({ products: [], cursor: null }), product: async () => ({}), summary: async () => undefined };
      const worker = new PerformanceWorker(repository, google, source);
      for (let step = 0; step < 3; step++) { await adapter.query("UPDATE sp_jobs SET next_at=now()"); await worker.tick(); }
      const metrics = await repository.metrics("store-a", "2026-01-28", "2026-01-28", "property");
      assert.equal(metrics?.clicks, 2);
      assert.equal((await repository.queries("store-a", "https://example.com/products/a", { startDate: "2026-01-28", endDate: "2026-01-28" })).items[0].query, "test query");
      const job = await repository.startJob("store-a", "sync", "retry", { days: 1, end: "2026-01-28" });
      const again = await repository.startJob("store-a", "sync", "other-request", {});
      assert.equal(job.jobId, again.jobId);
      for (let step = 0; step < 3; step++) { await adapter.query("UPDATE sp_jobs SET next_at=now()"); await worker.tick(); }
      assert.equal((await repository.metrics("store-a", "2026-01-28", "2026-01-28", "property"))?.clicks, 2);
      assert.equal((await service.overview("store-a", { startDate: "2026-01-28", endDate: "2026-01-28" })).current?.clicks, 2);
      assert.equal((await repository.jobs("store-a")).find(row => row.id === job.jobId)?.status, "done");
      assert.equal(await repository.metrics("store-a", "2026-01-01", "2026-01-28", "property"), null, "Incomplete periods must not appear as complete totals");
    });
    await t.test("Blocked crawl URLs do not monopolize subsequent batches", async () => {
      const worker = new PerformanceWorker(repository, google, { products: async () => ({ products: [], cursor: null }), product: async () => ({}), summary: async () => undefined });
      const payload = { robots: "User-agent: *\nDisallow: /", inventoryDone: true, sitemapQueue: [] };
      const first = await repository.startJob("store-a", "crawl", "blocked-first", payload);
      await worker.tick();
      const attempted = await adapter.query<{ url: string; checked_at: Date | null }>("SELECT url,checked_at FROM sp_pages WHERE store_id='store-a' AND attempted_at IS NOT NULL");
      assert.equal(attempted.rows.length, 1);
      assert.equal(attempted.rows[0].checked_at, null, "Blocked is not a successful audit");
      await adapter.query("UPDATE sp_jobs SET status='done' WHERE id=$1", [first.jobId]);
      const second = await repository.startJob("store-a", "crawl", "blocked-second", payload);
      await worker.tick();
      const next = await adapter.query("SELECT url FROM sp_pages WHERE store_id='store-a' AND attempted_at IS NOT NULL");
      assert.equal(next.rows.length, 2, "Next batch attempts an untouched URL");
      await adapter.query("UPDATE sp_jobs SET status='done' WHERE id=$1", [second.jobId]);
    });
    await t.test("Recommendations are idempotent, scoped and reject stale snapshots", async () => {
      const url = "https://example.com/products/a";
      await repository.putPage("store-a", url, { id: "123", updatedAt: "2026-01-01T00:00:00Z" });
      await repository.saveAudit("store-a", url, inspectHtml({ url, status: 200, html: "<title>Test</title><h1>Test</h1>" }));
      const evidence = await service.evidence("store-a", url) as { snapshotId: string; rulesVersion: string };
      const proposal = { requestId: "proposal1", url, snapshotId: evidence.snapshotId, rulesVersion: evidence.rulesVersion, issue: "Description missing", evidence: ["META_DESCRIPTION_NOT_OBSERVED"], proposed: "Grounded proposal", rationale: "Clarify source facts", risk: "No guarantee", priority: "medium", confidence: "low", startDate: "2026-01-01", endDate: "2026-01-28" };
      const first = await service.saveRecommendation("store-a", "worker-a", proposal);
      assert.deepEqual(await service.saveRecommendation("store-a", "worker-a", proposal), first);
      await assert.rejects(service.saveRecommendation("store-a", "worker-a", { ...proposal, proposed: "Changed" }), /IDEMPOTENCY_CONFLICT/);
      await assert.rejects(service.saveRecommendation("store-b", "worker-a", proposal), /STALE_SEO_EVIDENCE/);
      await assert.rejects(service.saveRecommendation("store-a", "worker-a", { ...proposal, requestId: "new", snapshotId: "old" }), /STALE_SEO_EVIDENCE/);
      assert.equal((await repository.recommendations("store-a")).total, 1);
      assert.equal((await service.revise("store-a", first.id, "operator")).jobId, "new-job");
      assert.equal((await service.revise("store-a", first.id, "operator")).jobId, "new-job");
      assert.equal((await repository.recommendations("store-a")).items[0].status, "queued");
      await assert.rejects(service.dismiss("store-a", first.id, "operator"), /RECOMMENDATION_NOT_ACTIONABLE/);
      await repository.event("store-a", "FOLLOW_UP_DUE", { key: "same-followup" });
      await repository.event("store-a", "FOLLOW_UP_DUE", { key: "same-followup" });
      assert.equal((await repository.history("store-a")).items.filter(event => event.event === "FOLLOW_UP_DUE").length, 1);
    });
    await t.test("MCP tools bind store on server and cannot publish, revise or approve", async () => {
      const server = new McpServer({ name: "performance-test", version: "1" });
      registerPerformanceTools(server, "store-a", "worker-a", () => service);
      const client = new Client({ name: "test", version: "1" });
      const [left, right] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(right), client.connect(left)]);
      try {
        const tools = await client.listTools();
        assert.equal(tools.tools.length, 6);
        assert.equal(tools.tools.some(tool => /publish|approve|revise|sync_shopify/.test(tool.name)), false);
        assert.equal(tools.tools.some(tool => "storeId" in (tool.inputSchema.properties ?? {})), false);
        const forbidden = await client.callTool({ name: "get_page_seo_evidence", arguments: { url: "https://other.example/products/private" } });
        assert.equal(forbidden.isError, true);
      } finally { await client.close(); await server.close(); }
    });
    await t.test("one worker credential audits without a Queue run and cannot cross stores or survive revocation", async () => {
      await database.exec(getQueueSchemaSql("public"));
      const workers = new SeoWorkerRepository({ transaction: operation => database.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) });
      const issued = await workers.issueToken({ storeId: "store-a", workerId: "unified-worker", createdBy: "operator" });
      const server = createWorkerMcpServer(workers, createWorkerWorkflow(workers, { checkSource: async () => undefined }), issued.token, () => service);
      const client = new Client({ name: "unified-test", version: "1" });
      const [left, right] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(right), client.connect(left)]);
      try {
        const url = "https://example.com/products/a";
        const evidence = await service.evidence("store-a", url) as { snapshotId: string; rulesVersion: string };
        const proposal = { requestId: "unified-proposal", url, snapshotId: evidence.snapshotId, rulesVersion: evidence.rulesVersion, issue: "Description missing", evidence: ["META_DESCRIPTION_NOT_OBSERVED"], proposed: "Grounded proposal", rationale: "Clarify facts", risk: "No guarantee", priority: "medium", confidence: "low", startDate: "2026-01-01", endDate: "2026-01-28" };
        const calls = [
          { name: "get_seo_performance", arguments: {} },
          { name: "list_seo_opportunities", arguments: {} },
          { name: "get_page_seo_evidence", arguments: { url } },
          { name: "get_seo_change_history", arguments: {} },
          { name: "save_seo_recommendation", arguments: proposal },
        ];
        for (const call of calls) {
          const response = await client.callTool(call);
          assert.notEqual(response.isError, true, JSON.stringify(response));
        }
        const first = await client.callTool(calls[4]);
        assert.deepEqual(await client.callTool(calls[4]), first);
        assert.equal((await client.callTool({ name: "save_seo_recommendation", arguments: { ...proposal, proposed: "Changed" } })).isError, true);
        assert.equal((await client.callTool({ name: "get_page_seo_evidence", arguments: { url: "https://other.example/private" } })).isError, true);
        assert.equal((await repository.recommendations("store-b")).total, 0);
        await workers.revoke("store-a", issued.tokenId);
        for (const call of [...calls, { name: "request_page_inspection", arguments: { url } }]) {
          const denied = await client.callTool(call);
          assert.equal(denied.isError, true);
          assert.match(JSON.stringify(denied), /TOKEN_REVOKED/);
        }
      } finally { await client.close(); await server.close(); }
    });
    await t.test("URL Inspection caches indexed snapshots and caps daily quota", async () => {
      const worker = new PerformanceWorker(repository, google, { products: async () => ({ products: [], cursor: null }), product: async () => ({}), summary: async () => undefined });
      const url = "https://example.com/products/a";
      const inspection = await service.inspect("store-a", url);
      await worker.tick();
      assert.equal((await repository.jobs("store-a")).find(row => row.id === inspection.jobId)?.status, "done");
      assert.ok((await repository.page("store-a", url)).inspection);
      assert.equal((await service.inspect("store-a", url)).jobId, inspection.jobId);
      await adapter.query("INSERT INTO sp_inspection_quota(property,day,used) VALUES($1,$2,100) ON CONFLICT(property,day) DO UPDATE SET used=100", ["sc-domain:example.com", pacificDate(new Date())]);
      const capped = await service.inspect("store-a", "https://example.com/products/p-1");
      await worker.tick();
      const cappedJob = (await repository.jobs("store-a")).find(row => row.id === capped.jobId);
      assert.equal(cappedJob?.status, "failed"); assert.equal(cappedJob?.error, "INSPECTION_DAILY_LIMIT");
    });
    await t.test("Revoked Google token marks reconnect without deleting cached reports", async () => {
      apiMode = "revoked";
      await assert.rejects(google.token(), /GSC_RECONNECT_REQUIRED/);
      assert.equal((await service.overview("store-a")).reconnectRequired, true);
      assert.equal((await repository.pages("store-a")).total, 57);
    });
  } finally { await database.close(); }
});
