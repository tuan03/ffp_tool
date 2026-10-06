import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { Pool } from "pg";

import { PostgresSeoCheckpointStore } from "../internal/checkpoint/postgres-checkpoint-store";
import { KeywordClaimConflictError } from "../internal/conflict-control/corpus-errors";
import { PostgresSeoConflictCorpus } from "../internal/conflict-control/postgres-seo-conflict-corpus";
import { runSeoContentMigrations } from "../internal/persistence/migrations";
import { importSeoContentLegacyData } from "../internal/persistence/legacy-importer";
import { PostgresSeoCompletionRepository } from "../internal/persistence/repositories";

const connectionString = process.env.SEO_CONTENT_TEST_DATABASE_URL;

async function clearTestRows(pool: Pool, marker: string): Promise<void> {
  await pool.query("DELETE FROM seo_outbox WHERE aggregate_id LIKE $1", [`${marker}%`]);
  await pool.query("DELETE FROM seo_review_handoffs WHERE run_id LIKE $1", [`${marker}%`]);
  await pool.query("DELETE FROM seo_pipeline_runs WHERE run_id LIKE $1 OR input_hash LIKE $1", [`${marker}%`]);
  await pool.query("DELETE FROM seo_keyword_products WHERE store_id=$1", [marker]);
  await pool.query("DELETE FROM seo_keyword_corpus_revisions WHERE store_id=$1", [marker]);
}

test("PostgreSQL migration is idempotent and checkpoint survives a new store instance", {
  skip: connectionString ? false : "SEO_CONTENT_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString });
  const marker = `seo-persistence-${Date.now()}`;
  try {
    await runSeoContentMigrations(pool);
    await runSeoContentMigrations(pool);
    await clearTestRows(pool, marker);
    const first = new PostgresSeoCheckpointStore(pool);
    await first.set({ schemaVersion: 2, inputHash: `${marker}-hash`, storeId: marker,
      createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_100,
      expiresAt: Date.now() + 60_000,
      stages: { B1: { stage: "B1", status: "completed", stageHash: "b1", data: { visible: true },
        fallbacks: [], warnings: [], durationMs: 12, retryLogs: [],
        createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_100 } } });
    const recovered = await new PostgresSeoCheckpointStore(pool).get(`${marker}-hash`);
    assert.equal(recovered?.stages.B1?.status, "completed");
    assert.deepEqual(recovered?.stages.B1?.data, { visible: true });
  } finally {
    await clearTestRows(pool, marker).catch(() => undefined);
    await pool.end();
  }
});

test("PostgreSQL checkpoint crash matrix recovers the exact committed B1-B6 prefix", {
  skip: connectionString ? false : "SEO_CONTENT_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString });
  const marker = `seo-crash-${Date.now()}`;
  const stages = ["b1", "b2", "b3", "b4", "b5", "b6"] as const;
  try {
    await runSeoContentMigrations(pool);
    for (let boundary = 0; boundary < stages.length; boundary++) {
      const inputHash = `${marker}-${boundary}`;
      const committed = Object.fromEntries(stages.slice(0, boundary + 1).map((stage, index) => [stage, {
        stage, status: "completed" as const, stageHash: `${stage}-hash`, data: { index },
        fallbacks: [], warnings: [], durationMs: index + 1, retryLogs: [],
        createdAt: 1_700_000_000_000 + index, updatedAt: 1_700_000_000_000 + index,
      }]));
      await new PostgresSeoCheckpointStore(pool).set({
        schemaVersion: 2, inputHash, storeId: marker,
        createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_100 + boundary,
        expiresAt: Date.now() + 60_000, stages: committed,
      });
      const recovered = await new PostgresSeoCheckpointStore(pool).get(inputHash);
      assert.deepEqual(Object.keys(recovered?.stages ?? {}).sort(), [...stages.slice(0, boundary + 1)].sort());
    }
  } finally {
    await clearTestRows(pool, marker).catch(() => undefined);
    await pool.end();
  }
});

test("PostgreSQL corpus prevents concurrent products from claiming one keyword", {
  skip: connectionString ? false : "SEO_CONTENT_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString });
  const marker = `seo-claims-${Date.now()}`;
  try {
    await runSeoContentMigrations(pool);
    await clearTestRows(pool, marker);
    const corpus = new PostgresSeoConflictCorpus(pool, { storeId: marker });
    const attempts = await Promise.allSettled([
      corpus.upsertProduct({ identity: { storeId: marker, productId: "one" }, approvedKeywords: ["viking quilt"] }),
      corpus.upsertProduct({ identity: { storeId: marker, productId: "two" }, approvedKeywords: ["Viking Quilt"] }),
    ]);
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    const rejection = attempts.find(result => result.status === "rejected");
    assert.ok(rejection?.status === "rejected" && rejection.reason instanceof KeywordClaimConflictError);
    assert.equal((await corpus.getSnapshot()).products.length, 1);

    const replacementStore = `${marker}-replacement`;
    const replacement = new PostgresSeoConflictCorpus(pool, { storeId: replacementStore });
    const first = await replacement.upsertProduct({
      identity: { storeId: replacementStore, productId: "stable" },
      approvedKeywords: ["old keyword"],
    });
    await replacement.upsertProduct({
      identity: { storeId: replacementStore, productId: "stable" },
      approvedKeywords: ["new keyword"], expectedRevision: first.revision,
    });
    const snapshot = await replacement.getSnapshot();
    assert.deepEqual(snapshot.products[0]?.keywords.map(keyword => keyword.normalizedKeyword), ["new keyword"]);
    await clearTestRows(pool, replacementStore);
  } finally {
    await clearTestRows(pool, marker).catch(() => undefined);
    await pool.end();
  }
});

test("legacy corpus importer is idempotent", {
  skip: connectionString ? false : "SEO_CONTENT_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString });
  const marker = `seo-import-${Date.now()}`;
  const directory = await mkdtemp(join(tmpdir(), "seo-import-"));
  const corpusPath = resolve(directory, "seo-conflict-corpus.json");
  try {
    await runSeoContentMigrations(pool);
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: 1, normalizationVersion: 1, revision: 1,
      updatedAt: new Date().toISOString(),
      products: [{ storeId: marker, productKey: `store:${marker}:id:legacy`, productId: "legacy",
        updatedAt: new Date().toISOString(), keywords: [{ keyword: "legacy quilt", normalizedKeyword: "legacy quilt", rank: 0 }] }],
    }), "utf8");
    const first = await importSeoContentLegacyData(pool, { corpusJsonPaths: [corpusPath], checkpointDirectory: join(directory, "none") });
    const second = await importSeoContentLegacyData(pool, { corpusJsonPaths: [corpusPath], checkpointDirectory: join(directory, "none") });
    assert.equal(first.corpusProducts, 1);
    assert.equal(second.corpusProducts, 0);
    assert.equal(second.skippedSources, 1);
    assert.equal((await new PostgresSeoConflictCorpus(pool, { storeId: marker }).getSnapshot()).products.length, 1);
  } finally {
    await clearTestRows(pool, marker).catch(() => undefined);
    await pool.query("DELETE FROM seo_legacy_imports WHERE source_key=$1", [corpusPath]).catch(() => undefined);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy corpus importer treats blank handles as missing identities", {
  skip: connectionString ? false : "SEO_CONTENT_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString });
  const marker = `seo-blank-handle-${Date.now()}`;
  const directory = await mkdtemp(join(tmpdir(), "seo-blank-handle-"));
  const corpusPath = resolve(directory, "seo-conflict-corpus.json");
  try {
    await runSeoContentMigrations(pool);
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: 1, normalizationVersion: 1, revision: 1,
      updatedAt: new Date().toISOString(),
      products: [
        { storeId: marker, productKey: `store:${marker}:id:first`, productId: "first", handle: "",
          updatedAt: new Date().toISOString(), keywords: [{ keyword: "first quilt", normalizedKeyword: "first quilt", rank: 0 }] },
        { storeId: marker, productKey: `store:${marker}:id:second`, productId: "second", handle: "   ",
          updatedAt: new Date().toISOString(), keywords: [{ keyword: "second quilt", normalizedKeyword: "second quilt", rank: 0 }] },
      ],
    }), "utf8");

    const imported = await importSeoContentLegacyData(pool, {
      corpusJsonPaths: [corpusPath],
      checkpointDirectory: join(directory, "none"),
    });
    const snapshot = await new PostgresSeoConflictCorpus(pool, { storeId: marker }).getSnapshot();

    assert.equal(imported.corpusProducts, 2);
    assert.equal(snapshot.products.length, 2);
    assert.deepEqual(snapshot.products.map(product => product.handle), [undefined, undefined]);
  } finally {
    await clearTestRows(pool, marker).catch(() => undefined);
    await pool.query("DELETE FROM seo_legacy_imports WHERE source_key=$1", [corpusPath]).catch(() => undefined);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});

test("completion commits run, review handoff and outbox together", {
  skip: connectionString ? false : "SEO_CONTENT_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString });
  const marker = `seo-completion-${Date.now()}`;
  try {
    await runSeoContentMigrations(pool);
    await clearTestRows(pool, marker);
    const repository = new PostgresSeoCompletionRepository(pool);
    await repository.complete({
      run: { runId: marker, inputHash: `${marker}-hash`, storeId: marker,
        status: "running", createdAt: Date.now(), updatedAt: Date.now() },
      handoffId: `${marker}-handoff`, outboxEventId: `${marker}-event`,
      handoffPayload: { workerId: "worker-slot-1", productTitle: "Viking Quilt" },
    });
    const counts = await pool.query<{ handoffs: string; events: string; completed: string }>(
      `SELECT
        (SELECT COUNT(*) FROM seo_review_handoffs WHERE run_id=$1) AS handoffs,
        (SELECT COUNT(*) FROM seo_outbox WHERE aggregate_id=$1) AS events,
        (SELECT COUNT(*) FROM seo_pipeline_runs WHERE run_id=$1 AND status='completed') AS completed`, [marker]);
    assert.deepEqual(counts.rows[0], { handoffs: "1", events: "1", completed: "1" });
    const firstClaim = await repository.claimPending("replacement-container-worker", 1, 5_000);
    assert.equal(firstClaim[0]?.eventId, `${marker}-event`);
    assert.equal(firstClaim[0]?.handoffId, `${marker}-handoff`);
    await repository.recordDeliveryFailure(`${marker}-event`, "replacement-container-worker", "temporary", 1_000);
    assert.equal((await repository.claimPending("worker-slot-1", 1)).length, 0);
    await pool.query("UPDATE seo_outbox SET next_attempt_at=NOW() WHERE event_id=$1", [`${marker}-event`]);
    const retry = await repository.claimPending("worker-slot-1", 1);
    assert.equal(retry[0]?.attemptCount, 2);
    await repository.markPublished(`${marker}-handoff`, `${marker}-event`);
    assert.equal((await repository.claimPending("worker-slot-1", 1)).length, 0);
  } finally {
    await clearTestRows(pool, marker).catch(() => undefined);
    await pool.end();
  }
});
