import assert from "node:assert/strict";
import test from "node:test";

import { VertexTextEmbeddingProvider } from "../internal/conflict-control/vertex-text-embedding-provider";

test("Vertex caches valid vectors by text, model and task type and preserves input order", async () => {
  let calls = 0;
  const provider = new VertexTextEmbeddingProvider({ projectId: "test", client: { models: {
    async embedContent(request) {
      calls++;
      const texts = typeof request.contents === "string" ? [request.contents] : request.contents;
      return { embeddings: texts.map(text => ({ values: [text.length, calls] })) };
    },
  } } });
  const options = { taskType: "RETRIEVAL_QUERY" as const };
  const initial = await provider.embed(["rug", "bedding", "rug"], options);
  assert.deepEqual(initial[0], initial[2]);
  assert.deepEqual(await provider.embed(["bedding", "rug"], options), [initial[1], initial[0]]);
  assert.equal(calls, 1);
  await provider.embed(["rug"], { taskType: "RETRIEVAL_DOCUMENT" });
  await provider.embed(["rug"], { ...options, model: "other-model" });
  assert.equal(calls, 3);
});

test("Vertex rejects invalid vectors and does not cache them", async () => {
  let calls = 0;
  const provider = new VertexTextEmbeddingProvider({ projectId: "test", client: { models: {
    async embedContent() { calls++; return { embeddings: [{ values: calls === 1 ? [NaN] : [1, 2] }] }; },
  } } });
  await assert.rejects(provider.embed(["rug"], { taskType: "SEMANTIC_SIMILARITY" }));
  assert.deepEqual(await provider.embed(["rug"], { taskType: "SEMANTIC_SIMILARITY" }), [[1, 2]]);
  assert.equal(calls, 2);
});

test("Vertex cache expires after 24 hours and never crosses injected vector spaces", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let calls = 0;
  const provider = new VertexTextEmbeddingProvider({ projectId: "test", client: { models: {
    async embedContent() { calls++; return { embeddings: [{ values: [calls, 1] }] }; },
  } } });
  const options = { taskType: "SEMANTIC_SIMILARITY" as const };
  assert.deepEqual(await provider.embed(["rug"], options), [[1, 1]]);
  context.mock.timers.tick(24 * 60 * 60 * 1000 - 1);
  assert.deepEqual(await provider.embed(["rug"], options), [[1, 1]]);
  context.mock.timers.tick(2);
  assert.deepEqual(await provider.embed(["rug"], options), [[2, 1]]);
  const other = new VertexTextEmbeddingProvider({ projectId: "test", client: { models: {
    async embedContent() { return { embeddings: [{ values: [9, 9, 9] }] }; },
  } } });
  assert.deepEqual(await other.embed(["rug"], options), [[9, 9, 9]]);
});
