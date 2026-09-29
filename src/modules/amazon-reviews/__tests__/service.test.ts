import assert from "node:assert/strict";
import test from "node:test";

import { createReviewClient } from "../index";

test("review client requests only product context from the coordinator", async () => {
  const client = createReviewClient({
    coordinatorUrl: "http://127.0.0.1:8766/",
    fetchImplementation: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8766/api/v1/review-jobs");
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        source: "B012345678", maxPages: 1, contextOnly: true,
      });
      return Response.json({ id: "context-job" }, { status: 202 });
    },
  });
  assert.deepEqual(await client.create("B012345678"), { jobId: "context-job" });
});

test("review client clears the saved job with DELETE and accepts a missing job", async () => {
  for (const status of [204, 404]) {
    const client = createReviewClient({ coordinatorUrl: "http://127.0.0.1:8766/",
      fetchImplementation: async (url, options) => {
        assert.equal(url, "http://127.0.0.1:8766/api/v1/crawl-jobs/job%2Fwith%20spaces");
        assert.equal(options?.method, "DELETE");
        return new Response(null, { status });
      },
    });
    await client.clear("job/with spaces");
  }
});

test("review client reports a failed deletion instead of clearing local results", async () => {
  const client = createReviewClient({ coordinatorUrl: "http://127.0.0.1:8766",
    fetchImplementation: async () => Response.json({ detail: "Coordinator unavailable" }, { status: 503 }),
  });
  await assert.rejects(client.clear("saved-job"), /Coordinator unavailable/);
});
