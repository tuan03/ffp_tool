import assert from "node:assert/strict";
import test from "node:test";
import { createCrawlerOperatorFetch, discoverCrawlerOperatorAuth } from "../service";

test("operator transport binds credentials to crawler routes and rejects redirects", async () => {
  let calls = 0;
  const transport = createCrawlerOperatorFetch({ engineUrl: "https://fixture.test", username: "operator", password: "fixture",
    fetchImplementation: async (_url, options) => {
      calls++;
      assert.equal(new Headers(options?.headers).get("Authorization"), "Basic b3BlcmF0b3I6Zml4dHVyZQ==");
      assert.equal(options?.redirect, "error");
      return new Response("[]");
    } });
  await transport("https://fixture.test/api/v1/clients");
  await transport("https://fixture.test/api/v1/clients/agent-1/commands?limit=20");
  await transport("https://fixture.test/api/v1/admission-gate");
  await transport("https://fixture.test/api/v1/dead-letter/actions", { method: "POST" });
  await transport("https://fixture.test/api/v1/crawl-tasks/task-1/attempts");
  await assert.rejects(transport("https://other.test/api/v1/clients"));
  await assert.rejects(transport("https://fixture.test/api/shopify"));
  await assert.rejects(transport("https://fixture.test/api/v1/worker/register"));
  assert.equal(calls, 5);
});

test("operator transport dispatches the validated absolute destination", async () => {
  const transport = createCrawlerOperatorFetch({
    engineUrl: "https://fixture.test", username: "operator", password: "fixture",
    fetchImplementation: async (url) => {
      assert.equal(String(url), "https://fixture.test/api/v1/clients");
      return new Response("[]");
    },
  });
  await transport("/api/v1/clients");
});

test("operator discovery uses its own contract independently from agent authentication", async () => {
  const requestedUrls: string[] = [];
  assert.equal(await discoverCrawlerOperatorAuth("https://fixture.test", async (url) => {
    requestedUrls.push(String(url));
    return new Response(null, { status: 404 });
  }), false);
  assert.deepEqual(requestedUrls, ["https://fixture.test/api/v1/operator/security", "https://fixture.test/api/v1/worker/security"]);
  assert.equal(await discoverCrawlerOperatorAuth("https://fixture.test", async () => Response.json({ authRequired: true, authProtocol: 1 })), true);
  await assert.rejects(discoverCrawlerOperatorAuth("https://fixture.test", async () => Response.json({ authRequired: false })));
  await assert.rejects(discoverCrawlerOperatorAuth("https://fixture.test", async () => new Response(null, { status: 503 })));
  await assert.rejects(discoverCrawlerOperatorAuth("https://fixture.test", async () => { throw new Error("offline"); }));
});

test("operator transport aborts in-flight requests and refuses requests after logout", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  let calls = 0;
  const transport = createCrawlerOperatorFetch({
    engineUrl: "https://fixture.test", username: "operator", password: "fixture",
    sessionSignal: controller.signal,
    fetchImplementation: async (_url, options) => {
      calls++;
      requestSignal = options?.signal;
      return new Response("[]");
    },
  });
  await transport("https://fixture.test/api/v1/clients");
  controller.abort();
  assert.equal(requestSignal?.aborted, true);
  await assert.rejects(transport("https://fixture.test/api/v1/clients"));
  assert.equal(calls, 1);
});

test("operator transport clears an unauthorized session and preserves caller headers", async () => {
  let unauthorized = false;
  const transport = createCrawlerOperatorFetch({
    engineUrl: "https://fixture.test", username: "operator", password: "fixture",
    onUnauthorized: () => { unauthorized = true; },
    fetchImplementation: async (_url, options) => {
      assert.equal(new Headers(options?.headers).get("Content-Type"), "application/json");
      return new Response(null, { status: 401 });
    },
  });
  await transport("https://fixture.test/api/v1/crawl-jobs", { headers: { "Content-Type": "application/json" } });
  assert.equal(unauthorized, true);
  assert.throws(() => createCrawlerOperatorFetch({ engineUrl: "http://remote.test", username: "x", password: "y" }));
});
