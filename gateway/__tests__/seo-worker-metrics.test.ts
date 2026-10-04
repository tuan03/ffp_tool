import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { SeoWorkerMetrics } from "../seo-worker/metrics";
import { SeoWorkerRepository } from "../seo-worker/repository";
import { handleSeoAgentHttp } from "../seo-worker/admin-handler";

import { createTestEnqueue } from "./seo-v2-fixtures";

test("worker metrics isolate stores, bound windows and distinguish missing denominators", async () => {
  const pg = await PGlite.create();
  let now = Date.UTC(2030, 0, 2);
  await pg.exec(getQueueSchemaSql("public"));
  const repository = new SeoWorkerRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) }, () => now, () => 0);
  const metrics: SeoWorkerMetrics = repository.metrics;
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, { operator: req.headers.authorization === "Basic test" ? "test" : undefined, hasStore: storeId => storeId === "demo", repository: async () => repository }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-agent/metrics?storeId=demo&hours=24`;
    const headers = { authorization: "Basic test" };
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url.replace("hours=24", "hours=999"), { headers })).status, 400);
    assert.equal((await fetch(url.replace("storeId=demo", "storeId=other"), { headers })).status, 404);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const empty = await metrics.report("demo", 24);
    assert.equal(empty.failureRate, null); assert.equal(empty.averageProcessingMs, null);
    assert.equal(empty.series.length, 24);
    await assert.rejects(metrics.report("demo", 999), /INVALID_METRICS_WINDOW/);
    await metrics.record("unrecognized-credential", "STALE_LEASE");
    assert.equal((await metrics.report("demo", 24)).staleLeaseRejections, 0);
    // Synthetic metadata only; no product content or credential in metric events.
    await pg.query("INSERT INTO seo_worker_metric_events VALUES ('one','demo','STALE_LEASE',$1),('two','other','STALE_LEASE',$1),('old','demo','STALE_LEASE',$2)", [now - 1000, now - 25 * 3600000]);
    const report = await metrics.report("demo", 24);
    assert.equal(report.staleLeaseRejections, 1);
    assert.equal((await metrics.report("other", 24)).staleLeaseRejections, 1);
    assert.equal((await metrics.report("demo", 168)).staleLeaseRejections, 2);
    for (const id of ["1", "2"]) {
      const enqueue = createTestEnqueue({ storeId: "demo", productId: id });
      await pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES($1,'demo',$1,'PENDING',$2,$3,'codex_mcp')", [id, JSON.stringify({ id, storeId: "demo", status: "PENDING", source: "auto_seo", sourceIdentity: id, input: enqueue.input, execution: enqueue.execution, original: enqueue.execution.originalSnapshot, settings: { provider: "codex_mcp" }, checkpoints: {} }), now]);
    }
    await repository.enableStore("demo");
    const issued = await repository.issueToken({ storeId: "demo", workerId: "test", createdBy: "test" });
    const { sessionId } = await repository.register(issued.token, "register");
    const run = await repository.startRun(issued.token, sessionId, 2, "start");
    const first = await repository.claim(issued.token, sessionId, run.id, "first"); assert.ok(first.lease);
    now += 120000;
    await pg.query("UPDATE gpt_jobs SET status='REVIEW_READY' WHERE id=$1", [first.lease.jobId]);
    await pg.query("INSERT INTO gpt_deliveries VALUES($1,'{}',1)", [first.lease.jobId]);
    await repository.runStatus(issued.token, run.id);
    const second = await repository.claim(issued.token, sessionId, run.id, "second"); assert.ok(second.lease);
    await repository.release(issued.token, second.lease, { code: "AGENT_QUOTA_EXHAUSTED", retryable: true, requestId: "quota" });
    now += 31000; await repository.recover();
    const retried = await repository.claim(issued.token, sessionId, run.id, "retry"); assert.ok(retried.lease);
    now += 601000; await repository.recover(); now++;
    await metrics.record(issued.token, "STALE_SOURCE"); now++;
    const measured = await metrics.report("demo", 24);
    assert.equal(measured.successfulJobs, 1); assert.equal(measured.attemptsStarted, 3);
    assert.equal(measured.jobsPerHour, 1 / 24); assert.equal(measured.series.reduce((sum, bucket) => sum + bucket.completed, 0), 1);
    assert.equal(measured.retriedAttempts, 1); assert.equal(measured.retryRate, 1 / 3);
    assert.equal(measured.failedAttempts, 2); assert.equal(measured.failureRate, 2 / 3);
    assert.equal(measured.averageProcessingMs, 120000); assert.equal(measured.leaseExpirations, 1); assert.equal(measured.quotaFailures, 1);
    assert.equal(measured.staleSourceRejections, 1); assert.equal(measured.queueDepth, 1);
    assert.equal((await metrics.report("other", 24)).successfulJobs, 0);
    now = issued.expiresAt + 1;
    assert.equal((await metrics.report("demo", 24)).tokenExpirations, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
});
