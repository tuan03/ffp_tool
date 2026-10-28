import assert from "node:assert/strict";
import test from "node:test";

import { createCustomGptClient } from "../index";

test("queue warm reads are isolated by store/filter and invalidated by writes", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(`${init?.method}:${String(input)}`);
    return new Response(JSON.stringify({ jobs: [], counts: {}, activeBatches: [], activeBatch: null, nextOffset: null }), { headers: { "Content-Type": "application/json" } });
  };
  const client = createCustomGptClient(fetcher);
  await client.list("one"); await client.list("one"); assert.equal(calls.length, 1);
  await client.list("two"); await client.list("one", 50); await client.list("one", 0, { statuses: ["FAILED"] }); assert.equal(calls.length, 4);
  await client.retry("one", "job"); await client.list("one"); assert.equal(calls.length, 6);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.list("one", 0, { signal: controller.signal }), { name: "AbortError" });
});

test("a read during retry cannot cache pre-retry state after the server confirms it", async () => {
  let resolveRetry: (response: Response) => void = () => undefined;
  const pendingRetry = new Promise<Response>(resolve => { resolveRetry = resolve; });
  let reads = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") return pendingRetry;
    reads += 1;
    return Response.json({ jobs: [], counts: {}, activeBatches: [], activeBatch: null, nextOffset: null });
  };
  const client = createCustomGptClient(fetcher);
  const retry = client.retry("sample", "job");
  await client.list("sample");
  resolveRetry(Response.json({ status: "PENDING" }));
  await retry;
  await client.list("sample");
  assert.equal(reads, 2);
});
