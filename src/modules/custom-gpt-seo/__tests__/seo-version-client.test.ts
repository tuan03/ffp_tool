import assert from "node:assert/strict";
import test from "node:test";

import { createCustomGptClient } from "../service";

test("SEO version client sends store-scoped read and CSRF-protected draft requests", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ entries: [], total: 0, nextOffset: null, status: "REQUESTED" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const client = createCustomGptClient(fetcher);
  const gid = "gid://shopify/Product/1";
  await client.seoVersionHistory("jeminise", gid, 10, 20);
  await client.requestSeoRollbackDraft("jeminise", gid, "version-0", "13a9eb97-2a47-4f59-8cb0-aa735c80ea20");
  assert.equal(calls[0]?.url, "/api/seo-agent/versioning/history?productGid=gid%3A%2F%2Fshopify%2FProduct%2F1&limit=10&offset=20&storeId=jeminise");
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[1]?.init?.method, "POST");
  assert.equal((calls[1]?.init?.headers as Record<string, string>)["x-ffp-agent"], "1");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { productGid: gid, targetVersionId: "version-0", requestId: "13a9eb97-2a47-4f59-8cb0-aa735c80ea20" });
});
