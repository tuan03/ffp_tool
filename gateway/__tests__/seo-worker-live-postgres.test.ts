import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

import { Pool } from "pg";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;

test("live PostgreSQL worker cutover blocks legacy claims and concurrent clients cannot share a job", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const schema = `seo_worker_test_${randomUUID().replaceAll("-", "")}`;
  const first = new PostgresCustomGptQueue({ databaseUrl, schema });
  const second = new PostgresCustomGptQueue({ databaseUrl, schema });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await first.initialize(); await second.initialize();
    await first.configure("worker-test", { provider: "codex_mcp", batchSize: 10 });
    const input = { storeId: "worker-test", source: "auto_seo" as const, sourceIdentity: "1",
      input: { productId: "1", title: "Test blanket", description: "", handle: "test", niche: "blankets", images: [] }, original: {} };
    await first.enqueue(input);
    await second.enqueue({ ...input, sourceIdentity: "2", input: { ...input.input, productId: "2" } });
    await first.workers.enableStore("worker-test");
    await assert.rejects(first.claim("worker-test", "legacy", "codex_mcp", "legacy-worker"), /WORKER_CLIENT_UPGRADE_REQUIRED/);
    await assert.rejects(second.enqueue({ ...input, input: { ...input.input, title: "Changed title" } }), /ALREADY_IN_SEO_PIPELINE/);
    const [a, b] = await Promise.all([first, second].map(async (queue, index) => {
      const { token } = await queue.workers.issueToken({ storeId: "worker-test", workerId: `worker-${index}`, createdBy: "test" });
      const { sessionId } = await queue.workers.register(token, "register");
      const run = await queue.workers.startRun(token, sessionId, 1, "start");
      return { queue, token, sessionId, run };
    }));
    const claims = await Promise.all([a, b].map(worker => worker.queue.workers.claim(worker.token, worker.sessionId, worker.run.id, "claim")));
    assert.ok(claims[0].lease); assert.ok(claims[1].lease);
    assert.notEqual(claims[0].lease.jobId, claims[1].lease.jobId);
    await assert.rejects(first.workers.claim(a.token, a.sessionId, a.run.id, "another"), /LEASE_ALREADY_ACTIVE/);
    await first.workers.disableClaims("worker-test");
    await assert.rejects(second.claim("worker-test", "legacy-after-disable", "codex_mcp", "legacy-worker"), /WORKER_CLIENT_UPGRADE_REQUIRED/);
    await assert.rejects(first.workers.claim(a.token, a.sessionId, a.run.id, "disabled"), /WORKER_STORE_DISABLED/);
    const rows = await pool.query(`SELECT count(*) FROM "${schema}".gpt_jobs WHERE status='IN_PROGRESS'`);
    assert.equal(Number(rows.rows[0].count), 2);
    await first.workers.enableStore("worker-test");
    for (const id of ["3", "4"]) await first.enqueue({ ...input, sourceIdentity: id, input: { ...input.input, productId: id } });
    const fixture = fileURLToPath(new URL("./fixtures/seo-worker-claim-process.ts", import.meta.url));
    const processes = await Promise.all(["process-a", "process-b"].map(workerId => promisify(execFile)(process.execPath,
      ["--import", "tsx", fixture, schema, workerId], { env: { ...process.env, SEO_QUEUE_TEST_DATABASE_URL: databaseUrl }, timeout: 30_000 })));
    const processClaims = processes.map(output => JSON.parse(output.stdout) as { jobId: string });
    assert.notEqual(processClaims[0].jobId, processClaims[1].jobId);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM "${schema}".gpt_jobs WHERE status='IN_PROGRESS'`)).rows[0].count), 4);
  } finally {
    await first.close(); await second.close();
    // The target is a generated test-only schema, never the application schema.
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
