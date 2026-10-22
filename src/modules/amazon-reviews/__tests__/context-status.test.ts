import assert from "node:assert/strict";
import test from "node:test";

import { getContextPresentation, isSameContextSource, recoverContextIssue } from "../context-status";
import type { AmazonReviewJob } from "../types";

const completed: AmazonReviewJob = {
  jobId: "context-1", status: "completed", asin: "B0FXGT6K59", sourceUrl: "https://www.amazon.com/dp/B0FXGT6K59",
  progress: { message: "Đã xử lý 1/1 link." },
  reviewData: { context: { asin: "B0FXGT6K59", url: "https://www.amazon.com/dp/B0FXGT6K59", title: "Round rug", bullets: ["Soft woven rug"] } }, samples: [],
};

test("completed context shows the next step, not crawl counters or zero reviews", () => {
  const state = getContextPresentation(completed);
  assert.equal(state.tone, "success");
  assert.match(state.title, /sẵn sàng/);
  assert.doesNotMatch(state.description, /1\/1|0 mẫu|completed/);
  assert.equal(getContextPresentation({ ...completed, reviewData: {} }).tone, "warning");
});

test("queued and failed context have distinct actionable states", () => {
  assert.match(getContextPresentation({ ...completed, status: "queued", reviewData: {} }).description, /agent local|agent/i);
  assert.equal(getContextPresentation({ ...completed, status: "failed", reviewData: {} }).tone, "error");
  assert.equal(getContextPresentation({ ...completed, status: "cancelled", reviewData: {} }).tone, "warning");
});

test("recovered job clears only its own stale context error", () => {
  assert.equal(recoverContextIssue({ jobId: completed.jobId, source: "", message: "Poll failed" }, completed), null);
  assert.equal(recoverContextIssue({ jobId: null, source: completed.sourceUrl, message: "Repeated request failed" }, completed), null);
  const unrelated = { jobId: null, source: "B012345678", message: "New source failed" };
  assert.equal(recoverContextIssue(unrelated, completed), unrelated);
  assert.equal(isSameContextSource(" b0fxgt6k59 ", completed), true);
  assert.equal(isSameContextSource("https://www.amazon.com/dp/B0FXGT6K59?ref=test", completed), true);
  assert.equal(isSameContextSource("https://example.com/?asin=B0FXGT6K59", completed), false);
});
