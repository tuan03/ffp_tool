import assert from "node:assert/strict";
import test from "node:test";

import { createReviewClient, isMissingReviewJobError } from "../index";
import { isReviewJobConflictError } from "../service";

test("review generation submits a durable job without sending browser context or API credentials", async () => {
  const job = { id: "generation", contextJobId: "context", storeId: "fixture", count: 10, status: "queued", createdAt: "2026-01-01", accepted: 0, rejected: 0, warnings: [] };
  const client = createReviewClient({ coordinatorUrl: "http://localhost", fetchImplementation: async (url, options) => {
    assert.equal(url, "/api/amazon-reviews/samples");
    assert.deepEqual(JSON.parse(String(options?.body)), { contextJobId: "context", storeId: "fixture", count: 10, requestId: "request" });
    return Response.json({ job }, { status: 202 });
  } });
  assert.equal((await client.generate({ contextJobId: "context", storeId: "fixture", count: 10, requestId: "request" })).status, "queued");
});

test("review client distinguishes an active job conflict from connection failures", async () => {
  for (const status of [409, 503]) {
    const client = createReviewClient({
      coordinatorUrl: "http://127.0.0.1:8766",
      fetchImplementation: async () => Response.json({ detail: "Request rejected" }, { status }),
    });
    const error = await client.create("B012345678").catch((cause: unknown) => cause);
    assert.equal(isReviewJobConflictError(error), status === 409);
  }
  assert.equal(isReviewJobConflictError(new Error("Network unavailable")), false);
});

test("review client retains the Bridge response phase while generation is running", async () => {
  const client = createReviewClient({ coordinatorUrl: "http://localhost", fetchImplementation: async () => Response.json({
    job: { id: "generation", contextJobId: "context", storeId: "fixture", count: 5, status: "running",
      phase: "sending_response", createdAt: "2026-01-01", accepted: 0, rejected: 0, warnings: [] },
  }) });
  assert.equal((await client.latestGeneration("context", "fixture"))?.phase, "sending_response");
});

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

test("review client identifies a saved job that no longer exists", async () => {
  const client = createReviewClient({
    coordinatorUrl: "http://127.0.0.1:8766",
    fetchImplementation: async () => Response.json({ detail: "Review job not found" }, { status: 404 }),
  });
  const error = await client.get("expired-job").catch((cause: unknown) => cause);
  assert.equal(isMissingReviewJobError(error), true);
});
