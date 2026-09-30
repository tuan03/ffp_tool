import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createCodexSeoMcpHandler } from "../custom-gpt-seo/mcp-handler";
import { createCodexSeoMcpServer } from "../custom-gpt-seo/mcp-server";
import { processCustomGptJob } from "../custom-gpt-seo/finalizer";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { createExternalSeoWorkflow } from "../custom-gpt-seo/workflow";

function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function enqueueProduct(queue: CustomGptQueue, provider: "custom_gpt" | "codex_mcp", sourceIdentity: string) {
  return queue.enqueue({
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity,
    input: {
      productId: sourceIdentity,
      title: `${provider} product`,
      description: "Grounded source description",
      handle: `${provider}-product`,
      niche: "home",
      images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }],
    },
    original: { sourceIdentity },
    settings: {
      provider,
      batchSize: 5,
      version: 1,
      language: "en-US",
      instructions: "Use grounded facts only.",
    },
  });
}

async function connectClient(queue: CustomGptQueue) {
  const workflow = createExternalSeoWorkflow({
    queue,
    downloadImage: async () => ({
      bytes: Buffer.from("fake-png"),
      contentType: "image/png",
      extension: "png",
    }),
  });
  const server = createCodexSeoMcpServer({ workflow, storeId: "capozen" });
  const client = new Client({ name: "codex-seo-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("Codex SEO MCP initializes and publishes the complete safe tool surface", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const { client, server } = await connectClient(queue);

  try {
    assert.match(client.getInstructions() || "", /untrusted/i);
    assert.match(client.getInstructions() || "", /every image/i);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), [
      "choose_seo_keywords",
      "claim_seo_batch",
      "get_seo_job",
      "get_seo_job_image",
      "get_seo_result",
      "get_seo_work",
      "list_waiting_seo_jobs",
      "release_seo_batch",
      "renew_seo_batch",
      "report_seo_issue",
      "research_seo_keywords",
      "save_seo_analysis",
      "submit_seo_draft",
    ]);
    assert.ok(tools.tools.every(tool => tool.inputSchema.type === "object"));
    assert.equal(tools.tools.find(tool => tool.name === "get_seo_job_image")?.annotations?.readOnlyHint, true);
    assert.equal(tools.tools.find(tool => tool.name === "submit_seo_draft")?.annotations?.destructiveHint, false);
  } finally {
    await client.close();
    await server.close();
    db.close();
  }
});

test("Codex SEO MCP claims only codex_mcp jobs and returns image content", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const customJob = enqueueProduct(queue, "custom_gpt", "custom-1");
  const codexJob = enqueueProduct(queue, "codex_mcp", "codex-1");
  const { client, server } = await connectClient(queue);

  try {
    const work = await client.callTool({ name: "get_seo_work", arguments: {} });
    assert.equal(work.isError, undefined);
    assert.match(JSON.stringify(work.structuredContent), /"PENDING":1/);

    const claim = await client.callTool({ name: "claim_seo_batch", arguments: { requestId: "codex-claim-1" } });
    assert.equal(claim.isError, undefined);
    assert.match(JSON.stringify(claim.structuredContent), new RegExp(codexJob.id));
    assert.doesNotMatch(JSON.stringify(claim.structuredContent), new RegExp(customJob.id));
    assert.equal(queue.get("capozen", customJob.id).status, "PENDING");
    assert.equal(queue.get("capozen", codexJob.id).status, "IN_PROGRESS");

    const job = await client.callTool({ name: "get_seo_job", arguments: { jobId: codexJob.id } });
    assert.match(JSON.stringify(job.structuredContent), /"imageIds":\["front"\]/);
    assert.doesNotMatch(JSON.stringify(job.structuredContent), /cdn\.shopify\.com/);

    const image = await client.callTool({ name: "get_seo_job_image", arguments: { jobId: codexJob.id, imageId: "front" } });
    assert.deepEqual(image.content, [{ type: "image", data: Buffer.from("fake-png").toString("base64"), mimeType: "image/png" }]);

    const forbidden = await client.callTool({ name: "get_seo_job", arguments: { jobId: customJob.id } });
    assert.equal(forbidden.isError, true);
    assert.match(JSON.stringify(forbidden.content), /not found/i);
  } finally {
    await client.close();
    await server.close();
    db.close();
  }
});

test("Streamable HTTP MCP authenticates bearer tokens and isolates their stores", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  enqueueProduct(queue, "codex_mcp", "capozen-job");
  queue.enqueue({
    storeId: "wrydeco",
    source: "auto_seo",
    sourceIdentity: "wrydeco-job",
    input: {
      productId: "wrydeco-job",
      title: "Wrydeco product",
      description: "Description",
      handle: "wrydeco-product",
      niche: "home",
      images: [],
    },
    original: {},
    settings: {
      provider: "codex_mcp",
      batchSize: 5,
      version: 1,
      language: "en-US",
      instructions: "Grounded facts only.",
    },
  });
  const workflow = createExternalSeoWorkflow({ queue });
  const handler = createCodexSeoMcpHandler({
    workflow,
    mcpKeys: { capozen: "capozen-mcp-key", wrydeco: "wrydeco-mcp-key" },
  });
  const httpServer = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp/gpt-seo`);

  try {
    const missing = await fetch(endpoint, { method: "POST", body: "{}" });
    assert.equal(missing.status, 401);
    const wrong = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
      body: "{}",
    });
    assert.equal(wrong.status, 401);

    const client = new Client({ name: "http-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: "Bearer wrydeco-mcp-key" } },
    });
    await client.connect(transport);
    const work = await client.callTool({ name: "get_seo_work", arguments: {} });
    assert.match(JSON.stringify(work.structuredContent), /"PENDING":1/);
    const claim = await client.callTool({ name: "claim_seo_batch", arguments: { requestId: "wrydeco-claim" } });
    assert.match(JSON.stringify(claim.structuredContent), /Wrydeco product/);
    assert.doesNotMatch(JSON.stringify(claim.structuredContent), /codex_mcp product/);
    await client.close();
  } finally {
    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    db.close();
  }
});

test("Codex MCP completes every checkpoint and finalizes a review-ready draft", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const job = enqueueProduct(queue, "codex_mcp", "codex-e2e");
  const workflow = createExternalSeoWorkflow({
    queue,
    research: async seeds => Object.fromEntries(seeds.map(seed => [seed, [`${seed} decor`]])),
    checkKeywords: async (_input, keywords) => ({
      revision: 3,
      previousKeywords: [],
      conflicts: keywords.map(keyword => ({ keyword, matches: [] })),
      semanticMode: "local_with_gpt_review" as const,
    }),
  });
  const server = createCodexSeoMcpServer({ workflow, storeId: "capozen" });
  const client = new Client({ name: "codex-e2e-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const claimed = await client.callTool({ name: "claim_seo_batch", arguments: { requestId: "claim-e2e" } });
    const batch = object(claimed.structuredContent);
    const lease = {
      jobId: job.id,
      batchId: String(batch.id),
      leaseToken: String(batch.leaseToken),
    };
    await client.callTool({
      name: "save_seo_analysis",
      arguments: {
        ...lease,
        requestId: "analysis-e2e",
        analysis: {
          physicalProductIdentity: "decor product",
          visualEntities: "visible geometric detail",
          sceneContext: "plain background",
          typography: { visibleTexts: [], styleSummary: "no visible text" },
          shoppingContext: {
            targetAudience: ["home decorators"],
            suitableOccasions: [],
            useCases: ["home decor"],
            buyerIntentKeywords: ["geometric decor"],
          },
          evidence: [{ imageId: "front", observation: "A geometric detail is visible." }],
        },
      },
    });
    await client.callTool({
      name: "research_seo_keywords",
      arguments: { ...lease, requestId: "research-e2e", seeds: ["geometric decor"] },
    });
    const keywords = await client.callTool({
      name: "choose_seo_keywords",
      arguments: {
        ...lease,
        requestId: "keywords-e2e",
        keywords: ["geometric home decor"],
        reason: "Matches visible geometry and source facts.",
      },
    });
    assert.equal(object(keywords.structuredContent).saved, true);
    await client.callTool({
      name: "submit_seo_draft",
      arguments: {
        ...lease,
        requestId: "submit-e2e",
        submission: {
          draft: { productTitle: "Geometric home decor" },
          alts: { front: "Geometric home decor product" },
        },
      },
    });
    assert.equal(queue.get("capozen", job.id).status, "VALIDATING");

    await processCustomGptJob(queue, async input => ({
      output: {
        productTitle: "Geometric home decor",
        productDescription: "Grounded description",
        productSeoTitle: "Geometric home decor",
        productSeoDescription: "Grounded description",
        productHandle: input.handle,
        images: input.images.map(image => ({
          sourceUrl: image.url,
          alt: "Geometric home decor product",
          webp: { filename: "geometric-home-decor.webp", url: image.url },
        })),
      },
      metadata: {
        engine: "custom_gpt",
        fieldsApplied: ["title"],
        fallbackStages: [],
        warnings: [],
        approvedKeywords: ["geometric home decor"],
      },
    }));

    const result = await client.callTool({ name: "get_seo_result", arguments: { jobId: job.id } });
    assert.equal(object(result.structuredContent).status, "REVIEW_READY");
    assert.match(JSON.stringify(result.structuredContent), /"engine":"codex_mcp"/);
  } finally {
    await client.close();
    await server.close();
    db.close();
  }
});

test("keyword conflicts are not saved and fence changed payloads by request ID", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const job = enqueueProduct(queue, "codex_mcp", "codex-conflict");
  const workflow = createExternalSeoWorkflow({
    queue,
    research: async () => ({ decor: ["decor product"] }),
    checkKeywords: async (_input, keywords) => ({
      revision: 1,
      previousKeywords: [],
      conflicts: keywords.map(keyword => ({ keyword, matches: [{ url: "https://example.test/owned", primaryKeyword: "owned keyword" }] })),
      semanticMode: "local_with_gpt_review" as const,
    }),
  });
  const batch = workflow.claim("capozen", "codex_mcp", "conflict-claim");
  const lease = { jobId: job.id, batchId: batch.id, leaseToken: batch.leaseToken };
  const analysis = {
    physicalProductIdentity: "decor product",
    visualEntities: "geometric detail",
    sceneContext: "plain background",
    typography: { visibleTexts: [], styleSummary: "no visible text" },
    shoppingContext: { targetAudience: [], suitableOccasions: [], useCases: [], buyerIntentKeywords: [] },
    evidence: [{ imageId: "front", observation: "Geometric detail" }],
  };
  workflow.saveAnalysis("capozen", "codex_mcp", { ...lease, requestId: "conflict-analysis", analysis });
  await workflow.research("capozen", "codex_mcp", { ...lease, requestId: "conflict-research", seeds: ["decor"] });

  try {
    const conflict = await workflow.chooseKeywords("capozen", "codex_mcp", {
      ...lease,
      requestId: "conflict-keywords",
      keywords: ["owned keyword"],
      reason: "Candidate keyword",
    });
    assert.equal(object(conflict).saved, false);
    assert.equal(queue.get("capozen", job.id).checkpoints.keywords, undefined);
    await assert.rejects(workflow.chooseKeywords("capozen", "codex_mcp", {
      ...lease,
      requestId: "conflict-keywords",
      keywords: ["changed keyword"],
      reason: "Changed payload",
    }), /idempotency/i);
  } finally {
    db.close();
  }
});
