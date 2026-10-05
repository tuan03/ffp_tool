import assert from "node:assert/strict";
import test from "node:test";

import { requestAgentKeyManagement } from "../service";

test("agent key UI sends credentials only to same-origin management and rejects redirects", async () => {
  const response = await requestAgentKeyManagement({ username: "operator", password: "fixture", action: "list", limit: 25, offset: 50,
    fetchImplementation: async (url, options) => {
      assert.equal(url, "/api/v1/agent-keys?limit=25&offset=50");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.cache, "no-store");
      assert.equal(new Headers(options?.headers).get("Authorization"), "Basic b3BlcmF0b3I6Zml4dHVyZQ==");
      return new Response(JSON.stringify({ keys: [{ id: "one", name: "test", status: "active", agentId: "agent",
        maxWorkers: 2, crawlers: ["amazon"], environment: "test" }], total: 101 }));
    },
  });
  assert.equal(response.keys[0]?.id, "one");
  assert.equal(response.total, 101);
});

test("agent key UI never exposes failed response bodies or retries creation", async () => {
  let requests = 0;
  await assert.rejects(requestAgentKeyManagement({ username: "operator", password: "fixture", action: "create",
    fetchImplementation: async () => {
      requests += 1;
      return new Response("sensitive internal response", { status: 500 });
    },
  }), /HTTP 500/);
  assert.equal(requests, 1);
});
