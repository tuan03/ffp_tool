import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { BenchmarkStore } from "../seo-performance/benchmark-store";
import type { BenchmarkSql, SaveBenchmarkRunInput } from "../seo-performance/benchmark-store";
import { applyPerformanceMigrations } from "../seo-performance/migrations";
import { SeoVersionRepository, applySeoVersionMigrations } from "../seo-versioning";
import type { WorkerDatabase } from "../seo-worker/database";

async function fixture() {
  const pg = await PGlite.create();
  const workerDatabase: WorkerDatabase = {
    transaction: operation => pg.transaction(tx => operation({
      query: async (sql, values) => ({
        rows: (await tx.query<Record<string, unknown>>(sql, values)).rows,
      }),
    })),
  };
  await applySeoVersionMigrations(workerDatabase, "public", () => 100);
  await applyPerformanceMigrations({
    connect: async () => ({
      query: async <Row,>(sql: string, values?: readonly unknown[]) => {
        const result = await pg.query<Row>(sql, values ? [...values] : undefined);
        return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
      },
      release: () => {},
    }),
  });
  const sql: BenchmarkSql = {
    query: async <Row,>(statement: string, values?: readonly unknown[]) => {
      const result = await pg.query<Row>(statement, values ? [...values] : undefined);
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
    },
  };
  let nextId = 0;
  const versions = new SeoVersionRepository(
    workerDatabase,
    "public",
    () => `fixture-${++nextId}`,
  );
  for (const storeId of ["store-a", "store-b"]) {
    await versions.setStoreFlags({
      storeId,
      readEnabled: true,
      writeEnabled: false,
    }, 1_700_000_000_000);
    await versions.ensureBaseline({
      storeId,
      shopifyProductGid: "gid://shopify/Product/123",
      observedAt: 1_700_000_000_000,
      snapshot: {
        contentHash: (storeId === "store-a" ? "a" : "b").repeat(64),
        title: `${storeId} Quilt`,
        descriptionHtml: "<p>Quilt</p>",
        seoTitle: null,
        seoDescription: null,
        images: [],
        aeoMetafields: {},
        handle: `${storeId}-quilt`,
        onlineStoreUrl: `https://${storeId}.example/products/quilt`,
        observedCanonicalUrl: null,
        shopifyStatus: "ACTIVE",
        vendor: null,
        productType: "Quilt",
        tags: [],
      },
    });
  }
  return { pg, versions, store: new BenchmarkStore(sql) };
}

function runInput(versionId: string): SaveBenchmarkRunInput {
  return {
    id: "benchmark-store-a-v0-28",
    storeId: "store-a",
    shopifyProductGid: "gid://shopify/Product/123",
    versionId,
    mode: "VERSION",
    checkpointDays: 28,
    rulesVersion: "rules-v1",
    metricContractVersion: "gsc-v1",
    dataRevision: "revision-001",
    filters: { device: null, country: "USA" },
    beforeWindow: { startDay: "2026-01-01", endDay: "2026-01-28" },
    afterWindow: { startDay: "2026-02-05", endDay: "2026-03-04" },
    output: { measurementStatus: "BASELINE", clicks: 0 },
  };
}

test("benchmark store preserves unknown public effective time without applied fallback", async () => {
  const f = await fixture();
  try {
    const context = await f.store.versionContext({
      storeId: "store-a",
      shopifyProductGid: "gid://shopify/Product/123",
    });
    assert.ok(context);
    assert.equal(context.appliedAt, 1_700_000_000_000);
    assert.equal(context.publicEffectiveAt, null);

    const saved = await f.store.saveRun(runInput(context.versionId));
    assert.equal(saved.versionPublicEffectiveAt, null);
    assert.equal(saved.versionId, context.versionId);
  } finally {
    await f.pg.close();
  }
});

test("benchmark version reads and run lists remain store isolated", async () => {
  const f = await fixture();
  try {
    const storeA = await f.store.versionContext({
      storeId: "store-a",
      shopifyProductGid: "gid://shopify/Product/123",
    });
    const storeB = await f.store.versionContext({
      storeId: "store-b",
      shopifyProductGid: "gid://shopify/Product/123",
    });
    assert.ok(storeA);
    assert.ok(storeB);
    assert.notEqual(storeA.productId, storeB.productId);
    assert.equal(await f.store.versionContext({
      storeId: "store-b",
      shopifyProductGid: "gid://shopify/Product/123",
      versionId: storeA.versionId,
    }), null);

    await f.store.saveRun(runInput(storeA.versionId));
    assert.equal((await f.store.listLatestProductRuns({
      storeId: "store-a",
      shopifyProductGid: "gid://shopify/Product/123",
    })).total, 1);
    assert.equal((await f.store.listLatestProductRuns({
      storeId: "store-b",
      shopifyProductGid: "gid://shopify/Product/123",
    })).total, 0);
  } finally {
    await f.pg.close();
  }
});

test("stable benchmark id returns the exact immutable run and rejects collisions", async () => {
  const f = await fixture();
  try {
    const context = await f.store.versionContext({
      storeId: "store-a",
      shopifyProductGid: "gid://shopify/Product/123",
    });
    assert.ok(context);
    const input = runInput(context.versionId);
    const first = await f.store.saveRun(input);
    const repeated = await f.store.saveRun({
      ...input,
      filters: { country: "USA", device: null },
    });
    assert.deepEqual(repeated, first);
    assert.equal(Number((await f.pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM sp_benchmark_runs",
    )).rows[0].count), 1);

    await assert.rejects(
      f.store.saveRun({ ...input, dataRevision: "revision-002" }),
      /BENCHMARK_RUN_ID_COLLISION/,
    );
    await assert.rejects(
      f.store.saveRun({ ...input, id: "another-stable-id" }),
      /BENCHMARK_RUN_SIGNATURE_COLLISION/,
    );
  } finally {
    await f.pg.close();
  }
});

test("latest product runs paginate deterministically", async () => {
  const f = await fixture();
  try {
    const context = await f.store.versionContext({
      storeId: "store-a",
      shopifyProductGid: "gid://shopify/Product/123",
    });
    assert.ok(context);
    for (let index = 0; index < 3; index++) {
      const input = runInput(context.versionId);
      await f.store.saveRun({
        ...input,
        id: `calendar-run-${index}`,
        versionId: null,
        mode: "CALENDAR",
        checkpointDays: null,
        dataRevision: `calendar-revision-${index}`,
      });
    }
    const first = await f.store.listLatestProductRuns({
      storeId: "store-a",
      shopifyProductGid: "gid://shopify/Product/123",
      limit: 2,
    });
    assert.equal(first.total, 3);
    assert.equal(first.items.length, 2);
    assert.equal(first.nextOffset, 2);
    const second = await f.store.listLatestProductRuns({
      storeId: "store-a",
      shopifyProductGid: "gid://shopify/Product/123",
      limit: 2,
      offset: 2,
    });
    assert.equal(second.items.length, 1);
    assert.equal(second.nextOffset, null);
  } finally {
    await f.pg.close();
  }
});
