import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { Pool } from "pg";
import { z } from "zod";
import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";

import { createTestEnqueue } from "./seo-v2-fixtures";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;
test("two HTTP processes fence crashed leases and revoked tokens on real PostgreSQL", { skip: !databaseUrl, timeout: 60_000 }, async () => {
  assert.ok(databaseUrl);
  const schema = `seo_worker_http_${randomUUID().replaceAll("-", "")}`;
  const queue = new PostgresCustomGptQueue({ databaseUrl, schema });
  const pool = new Pool({ connectionString: databaseUrl });
  const children: ReturnType<typeof fork>[] = [];
  const start = async () => {
    const child = fork(new URL("./fixtures/seo-worker-http-process.ts", import.meta.url), [schema], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"], env: { ...process.env, SEO_QUEUE_TEST_DATABASE_URL: databaseUrl } });
    children.push(child);
    const [message] = await once(child, "message", { signal: AbortSignal.timeout(20_000) });
    return { child, url: `http://127.0.0.1:${z.object({ port: z.number() }).parse(message).port}/mcp/seo-worker` };
  };
  const invoke = async (url: string, token: string, name: string, args: Record<string, unknown>) => {
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), signal: AbortSignal.timeout(10_000) });
    return { status: response.status, text: await response.text() };
  };
  const payload = (text: string): unknown => JSON.parse(z.object({ result: z.object({ content: z.array(z.object({ type: z.string(), text: z.string() })) }) }).parse(JSON.parse(text)).result.content[0].text);
  try {
    await queue.initialize();
    await queue.configure("demo", { provider: "codex_mcp", batchSize: 1 });
    for (const id of ["1", "2"]) await queue.enqueue(createTestEnqueue({ storeId: "demo", productId: id, input: { images: [{ id: `front-${id}`, url: `https://cdn.shopify.com/${id}.png` }], niche: "blankets" } }));
    await queue.workers.enableStore("demo");
    const [first, second] = await Promise.all([start(), start()]);
    const workers = await Promise.all([first, second].map(async (server, index) => {
      const issued = await queue.workers.issueToken({ storeId: "demo", workerId: `machine-${index}`, createdBy: "test" });
      const registered = await invoke(server.url, issued.token, "worker_register", { requestId: "register" });
      const { sessionId } = z.object({ sessionId: z.string() }).parse(payload(registered.text));
      const started = await invoke(server.url, issued.token, "run_start", { sessionId, targetCount: 2, requestId: "start" });
      const { id: runId } = z.object({ id: z.string() }).parse(payload(started.text));
      return { ...issued, sessionId, runId, server };
    }));
    const claims = await Promise.all(workers.map(async worker => {
      const response = await invoke(worker.server.url, worker.token, "queue_claim_next", { sessionId: worker.sessionId, runId: worker.runId, requestId: "claim" });
      return z.object({ lease: z.object({ jobId: z.string(), leaseVersion: z.number() }).passthrough() }).parse(payload(response.text)).lease;
    }));
    assert.notEqual(claims[0].jobId, claims[1].jobId);
    const exited = once(first.child, "exit"); first.child.kill(); await exited;
    await pool.query(`UPDATE "${schema}".seo_worker_jobs SET expires_at=0 WHERE job_id=$1`, [claims[0].jobId]);
    await queue.workers.recover();
    await pool.query(`UPDATE "${schema}".seo_worker_jobs SET retry_at=0 WHERE job_id=$1`, [claims[0].jobId]);
    await queue.workers.recover();
    const replacement = await queue.workers.issueToken({ storeId: "demo", workerId: "replacement", createdBy: "test" });
    const { sessionId } = await queue.workers.register(replacement.token, "register");
    const run = await queue.workers.startRun(replacement.token, sessionId, 1, "run");
    const reclaimed = await invoke(second.url, replacement.token, "queue_claim_next", { sessionId, runId: run.id, requestId: "reclaim" });
    const replacementLease = z.object({ lease: z.object({ jobId: z.string(), leaseVersion: z.number() }) }).parse(payload(reclaimed.text)).lease;
    assert.equal(replacementLease.jobId, claims[0].jobId);
    assert.ok(replacementLease.leaseVersion > claims[0].leaseVersion);
    const stale = await invoke(second.url, workers[0].token, "queue_heartbeat", { lease: claims[0], requestId: "old-heartbeat" });
    assert.match(stale.text, /STALE_LEASE/);
    const observations = await pool.query(`SELECT kind FROM "${schema}".seo_worker_metric_events WHERE store_id='demo'`);
    assert.deepEqual(observations.rows.map(row => row.kind), ["STALE_LEASE"]);
    await pool.query(`UPDATE "${schema}".seo_worker_metric_events SET occurred_at=$1`, [Date.now() - 1000]);
    assert.equal((await queue.workers.metrics.report("demo", 24)).staleLeaseRejections, 1);
    assert.equal((await queue.workers.metrics.report("other", 24)).staleLeaseRejections, 0);
    await queue.workers.revoke("demo", workers[1].tokenId);
    assert.equal((await invoke(second.url, workers[1].token, "worker_status", {})).status, 401);
  } finally {
    await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null).map(async child => { const exited = once(child, "exit"); child.kill(); await exited; }));
    await queue.close();
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
