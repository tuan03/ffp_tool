import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_AMAZON_CRAWLER_SETTINGS } from "../types";
import type { AmazonCrawlerJobSnapshot } from "../types";
import { describeJobCancellation } from "../ui/job-cancellation";

function createJob(overrides: Partial<AmazonCrawlerJobSnapshot> = {}): AmazonCrawlerJobSnapshot {
  return {
    jobId: "job-1",
    status: "cancelling",
    progress: { phase: "seo", completed: 0, total: 1, message: "Stopping" },
    result: null,
    error: null,
    inputs: ["B0MOCK0001"],
    settings: DEFAULT_AMAZON_CRAWLER_SETTINGS,
    createdAt: "2026-09-24T00:00:00.000Z",
    startedAt: "2026-09-24T00:00:01.000Z",
    completedAt: null,
    replacementOfJobId: null,
    cancellation: {
      id: "cancel-1",
      requestedAt: "2026-09-24T00:00:02.000Z",
      pendingAgents: [],
      pendingPipeline: [],
      pendingPipelineItems: 0,
      isExecutionConfirmed: false,
    },
    ...overrides,
  };
}

test("cancellation message distinguishes an agent waiting to receive Stop", () => {
  const job = createJob({
    cancellation: {
      ...createJob().cancellation,
      pendingAgents: [{
        clientId: "agent-1",
        displayName: "May Sang",
        status: "busy",
        taskCount: 1,
        receivedTaskCount: 0,
        hasReceived: false,
      }],
    },
  });

  assert.match(describeJobCancellation(job, Date.parse("2026-09-24T00:00:12.000Z")) ?? "", /chờ May Sang nhận lệnh dừng/);
});

test("cancellation message identifies received agent and pipeline acknowledgements", () => {
  const job = createJob({
    cancellation: {
      ...createJob().cancellation,
      pendingAgents: [{
        clientId: "agent-1",
        displayName: "May Sang",
        status: "busy",
        taskCount: 1,
        receivedTaskCount: 1,
        hasReceived: true,
      }],
      pendingPipeline: [{
        itemId: "item-1",
        sourceKey: "B0MOCK0001",
        phase: "seo",
        workerId: "pipeline-1",
        receivedAt: "2026-09-24T00:00:05.000Z",
      }],
      pendingPipelineItems: 1,
    },
  });

  const message = describeJobCancellation(job, Date.parse("2026-09-24T00:02:02.000Z")) ?? "";
  assert.match(message, /2 phút trước/);
  assert.match(message, /May Sang đã nhận lệnh/);
  assert.match(message, /pipeline đã nhận lệnh, đang kết thúc bước tạo nội dung SEO/);
});

test("cancelled job message confirms final completion", () => {
  const job = createJob({ status: "cancelled", completedAt: "2026-09-24T00:03:00.000Z" });
  assert.match(describeJobCancellation(job) ?? "", /Đã dừng hoàn tất/);
});
