import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { assertV2WorkerJob } from "../custom-gpt-seo/input-contract";
import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { SeoWorkerRepository } from "../seo-worker/repository";
import { createWorkerWorkflow } from "../seo-worker/workflow";

const FORBIDDEN_SENTINELS = [
  "FORBIDDEN_TITLE_SENTINEL",
  "FORBIDDEN_DESCRIPTION_SENTINEL",
  "FORBIDDEN_HANDLE_SENTINEL",
  "FORBIDDEN_VARIANT_SENTINEL",
  "FORBIDDEN_KEYWORD_SENTINEL",
  "FORBIDDEN_ALT_SENTINEL",
  "FORBIDDEN_SOURCE_SNAPSHOT_SENTINEL",
  "FORBIDDEN_GSC_SENTINEL",
  "FORBIDDEN_INSTRUCTION_SENTINEL",
] as const;

test("V2 job context exposes only images, niche, and storeProfile as semantic input", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  const repository = new SeoWorkerRepository({
    transaction: operation => pg.transaction(tx => operation({
      query: async (sql, values) => ({
        rows: (await tx.query<Record<string, unknown>>(sql, values)).rows,
      }),
    })),
  });
  const issued = await repository.issueToken({
    storeId: "jeminise",
    workerId: "leakage-test-worker",
    createdBy: "test",
  });
  const workflow = createWorkerWorkflow(repository, {
    checkSource: async () => undefined,
    performanceEvidence: async () => ({ query: "FORBIDDEN_GSC_SENTINEL" }),
  });
  const input = {
    images: [{
      id: "image-1",
      url: "https://cdn.example.test/product.webp",
    }],
    niche: "Bedding",
    storeProfile: {
      profileId: "jeminise",
      profileVersion: "2",
      storeId: "jeminise",
      storeName: "Jeminise",
      locale: "en-US",
      language: "en",
      niche: "Bedding",
      brandVoice: ["clear"],
      contentRules: ["ground claims in image evidence"],
      prohibitedClaims: ["unsupported materials"],
      seoConstraints: {
        maxTitleCharacters: 70,
        maxDescriptionCharacters: 160,
        maxAltCharacters: 125,
      },
    },
  };
  const originalSnapshot = FORBIDDEN_SENTINELS.join("|");
  const job = {
    id: "v2-context-leakage-job",
    storeId: "jeminise",
    source: "auto_seo",
    sourceIdentity: "123",
    sourceRevision: "2026-10-05T00:00:00.000Z",
    status: "PENDING",
    input,
    execution: {
      storeId: "jeminise",
      productId: "123",
      source: "auto_seo",
      sourceIdentity: "123",
      sourceRevision: "2026-10-05T00:00:00.000Z",
      shopifyUpdatedAt: "2026-10-05T00:00:00.000Z",
      providerId: "codex_mcp",
      pipelineVersion: "seo-b1-b6-v2",
      originalSnapshot,
    },
    original: originalSnapshot,
    settings: {
      provider: "codex_mcp",
      language: "en",
      instructions: "FORBIDDEN_INSTRUCTION_SENTINEL",
    },
    checkpoints: {},
  };

  await pg.query(
    "INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ($1,$2,$3,'PENDING',$4,1,'codex_mcp')",
    [job.id, job.storeId, "v2-context-leakage", JSON.stringify(job)],
  );
  await repository.enableStore("jeminise");
  const { sessionId } = await repository.register(issued.token, "register-v2-context");
  const run = await repository.startRun(issued.token, sessionId, 1, "start-v2-context");
  const claim = await repository.claim(
    issued.token,
    sessionId,
    run.id,
    "claim-v2-context",
  );
  assert.ok(claim.lease);

  try {
    const persistedJob = await repository.readJob(issued.token, claim.lease);
    assert.deepEqual(persistedJob.input, input);
    assert.equal(persistedJob.storeId, persistedJob.execution.storeId);
    assert.equal(persistedJob.source, persistedJob.execution.source);
    assert.equal(persistedJob.sourceIdentity, persistedJob.execution.sourceIdentity);
    assert.equal(persistedJob.sourceRevision, persistedJob.execution.sourceRevision);
    assert.deepEqual(persistedJob.original, persistedJob.execution.originalSnapshot);
    assertV2WorkerJob(persistedJob);
    const context = await workflow.context(issued.token, claim.lease);
    const serializedContext = JSON.stringify(context);
    const semanticInput = (context as { readonly input?: Readonly<Record<string, unknown>> }).input;

    assert.ok(semanticInput, "worker context must expose the projected semantic input");
    assert.deepEqual(Object.keys(semanticInput).sort(), ["images", "niche", "storeProfile"]);
    assert.deepEqual(
      Object.keys((semanticInput.images as readonly Record<string, unknown>[])[0] ?? {}).sort(),
      ["id"],
      "worker context must expose image IDs, not URL/alt/file transport metadata",
    );
    for (const sentinel of FORBIDDEN_SENTINELS) {
      assert.equal(
        serializedContext.includes(sentinel),
        false,
        `job_get_context leaked ${sentinel}`,
      );
    }
    for (const forbiddenKey of [
      "sourceSnapshot",
      "sourceRevision",
      "gsc",
      "rules",
      "title",
      "description",
      "handle",
      "productId",
      "siteDomain",
      "url",
      "variants",
      "variantSummary",
      "existingKeywords",
      "alt",
    ]) {
      assert.equal(
        Object.hasOwn(context, forbiddenKey),
        false,
        `job_get_context exposed forbidden top-level key ${forbiddenKey}`,
      );
    }
  } finally {
    await pg.close();
  }
});

test("V1 job without an execution envelope fails closed", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  const repository = new SeoWorkerRepository({
    transaction: operation => pg.transaction(tx => operation({
      query: async (sql, values) => ({
        rows: (await tx.query<Record<string, unknown>>(sql, values)).rows,
      }),
    })),
  });
  const issued = await repository.issueToken({
    storeId: "jeminise",
    workerId: "v1-rejection-test-worker",
    createdBy: "test",
  });
  const workflow = createWorkerWorkflow(repository, {
    checkSource: async () => undefined,
  });
  const legacyJob = {
    id: "v1-context-rejection-job",
    storeId: "jeminise",
    source: "auto_seo",
    sourceIdentity: "123",
    status: "PENDING",
    input: {
      title: "FORBIDDEN_TITLE_SENTINEL",
      description: "FORBIDDEN_DESCRIPTION_SENTINEL",
      handle: "FORBIDDEN_HANDLE_SENTINEL",
      niche: "Bedding",
      productId: "123",
      images: [{
        id: "image-1",
        url: "https://cdn.example.test/product.webp",
        alt: "FORBIDDEN_ALT_SENTINEL",
      }],
    },
    original: "FORBIDDEN_SOURCE_SNAPSHOT_SENTINEL",
    settings: {
      provider: "codex_mcp",
      language: "en",
      instructions: "FORBIDDEN_INSTRUCTION_SENTINEL",
    },
    checkpoints: {},
  };

  await repository.enableStore("jeminise");
  await pg.query(
    "INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ($1,$2,$3,'PENDING',$4,1,'codex_mcp')",
    [legacyJob.id, legacyJob.storeId, "v1-context-rejection", JSON.stringify(legacyJob)],
  );
  await pg.query(
    "INSERT INTO seo_worker_jobs(job_id,store_id,product_key,state,updated_at) VALUES ($1,$2,$3,'READY',1)",
    [legacyJob.id, legacyJob.storeId, "shopify:123"],
  );
  const { sessionId } = await repository.register(issued.token, "register-v1-context");
  const run = await repository.startRun(issued.token, sessionId, 1, "start-v1-context");
  const claim = await repository.claim(
    issued.token,
    sessionId,
    run.id,
    "claim-v1-context",
  );
  assert.ok(claim.lease);

  try {
    await assert.rejects(
      workflow.context(issued.token, claim.lease),
      /INPUT_CONTRACT_UNSUPPORTED/,
    );
  } finally {
    await pg.close();
  }
});
