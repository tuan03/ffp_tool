import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import { runSeoContentMigrations } from "../internal/persistence/migrations";
import { PostgresSeoProviderCircuitRepository } from "../internal/persistence/repositories";
import { SeoProviderCircuitBreaker } from "../internal/providers/seo-provider-circuit-breaker";

const connectionString = process.env.SEO_CONTENT_TEST_DATABASE_URL;

test("PostgreSQL provider failures preserve timestamp types across insert, conflict, probe and reset", {
  skip: connectionString ? false : "SEO_CONTENT_TEST_DATABASE_URL is not configured",
}, async () => {
  const schema = `circuit_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const now = 1_700_000_000_000;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await runSeoContentMigrations(pool);
    const repository = new PostgresSeoProviderCircuitRepository(pool);
    const first = await repository.recordFailure("fixture", "model", now, { code: "QUOTA" }, 3, 60_000);
    assert.equal(first.state, "closed");
    assert.equal(first.failureCount, 1);
    assert.equal(first.openedAt, undefined);
    assert.equal(first.retryAfter, undefined);
    await repository.recordFailure("fixture", "model", now + 1, { code: "QUOTA" }, 3, 60_000);
    const opened = await repository.recordFailure("fixture", "model", now + 2, { code: "QUOTA" }, 3, 60_000);
    assert.equal(opened.state, "open");
    assert.equal(opened.failureCount, 3);
    assert.equal(opened.openedAt, now + 2);
    assert.equal(opened.retryAfter, now + 60_002);
    assert.equal(await repository.tryAcquireProbe("fixture", "model", now + 3), false);
    assert.equal(await repository.tryAcquireProbe("fixture", "model", now + 60_002), true);
    await repository.recordSuccess("fixture", "model", now + 60_003);
    const reset = await repository.get("fixture", "model");
    assert.equal(reset?.state, "closed");
    assert.equal(reset?.openedAt, undefined);
    assert.equal(reset?.retryAfter, undefined);
    const immediate = await repository.recordFailure("fixture", "immediate", now, { code: "QUOTA" }, 1, 1000);
    assert.equal(immediate.openedAt, now);
    assert.equal(immediate.retryAfter, now + 1000);
    const breaker = new SeoProviderCircuitBreaker(repository);
    const fallback = await breaker.executeWithFallbackObservation("fixture", "fallback", async () => ({
      result: "fallback-result", primaryFailure: new Error("Fixture provider unavailable"),
    }));
    assert.equal(fallback, "fallback-result");
    const original = new Error("Fixture provider rejected request");
    await assert.rejects(breaker.execute("fixture", "failed", async () => { throw original; }), error => error === original);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
