import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQueueSummaries,
  canRetryJob,
  filterQueueJobs,
  getJobProgress,
  getProviderPresentation,
  getStatusPresentation,
} from "../ui/seo-queue-view-model";
import type { GptSeoJob, GptJobStatus, SeoProvider } from "../types";

function createJob(input: {
  readonly id: string;
  readonly title: string;
  readonly status: GptJobStatus;
  readonly provider?: SeoProvider;
  readonly checkpoints?: GptSeoJob["checkpoints"];
  readonly handle?: string;
}): GptSeoJob {
  return {
    id: input.id,
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity: input.id,
    inputHash: `hash-${input.id}`,
    input: {
      title: input.title,
      description: "Description",
      handle: input.handle ?? `handle-${input.id}`,
      niche: "home decor",
      images: [],
    },
    original: {},
    settings: {
      provider: input.provider ?? "codex_mcp",
      batchSize: 5,
      version: 1,
      language: "en-US",
      instructions: "Use grounded facts.",
    },
    status: input.status,
    checkpoints: input.checkpoints ?? {},
    createdAt: 1,
    updatedAt: 1,
  };
}

test("presents provider and status values with operator-friendly Vietnamese labels", () => {
  assert.deepEqual(getProviderPresentation("codex_mcp"), {
    label: "Codex MCP",
    description: "Xử lý thủ công qua MCP",
  });
  assert.equal(getProviderPresentation("custom_gpt").label, "GPT Custom");
  assert.equal(getStatusPresentation("REVIEW_READY").label, "Sẵn sàng duyệt");
  assert.equal(getStatusPresentation("WAITING_INPUT").label, "Cần bổ sung");
});

test("falls back to readable values when the server introduces a new provider or status", () => {
  assert.deepEqual(getProviderPresentation("future_ai"), {
    label: "future ai",
    description: "AI xử lý chưa xác định",
  });
  assert.equal(getStatusPresentation("QUEUED_FOR_REVIEW").label, "QUEUED FOR REVIEW");
});

test("groups each queue job into exactly one summary card", () => {
  const jobs = [
    createJob({ id: "1", title: "One", status: "PENDING" }),
    createJob({ id: "2", title: "Two", status: "IN_PROGRESS" }),
    createJob({ id: "3", title: "Three", status: "VALIDATING" }),
    createJob({ id: "4", title: "Four", status: "WAITING_INPUT" }),
    createJob({ id: "5", title: "Five", status: "NEEDS_CHANGES" }),
    createJob({ id: "6", title: "Six", status: "FAILED" }),
    createJob({ id: "7", title: "Seven", status: "REVIEW_READY" }),
    createJob({ id: "8", title: "Eight", status: "CANCELLED" }),
  ];

  const summaries = buildQueueSummaries(jobs);

  assert.deepEqual(summaries.map(summary => [summary.key, summary.count]), [
    ["waiting", 1],
    ["processing", 2],
    ["attention", 3],
    ["ready", 1],
    ["cancelled", 1],
  ]);
  assert.equal(summaries.reduce((total, summary) => total + summary.count, 0), jobs.length);
});

test("uses server totals when the current page contains only part of the queue", () => {
  const currentPage = [createJob({ id: "1", title: "One", status: "PENDING" })];

  const summaries = buildQueueSummaries(currentPage, {
    PENDING: 6,
    IN_PROGRESS: 2,
    REVIEW_READY: 9,
  });

  assert.deepEqual(summaries.map(summary => [summary.key, summary.count]), [
    ["waiting", 6],
    ["processing", 2],
    ["attention", 0],
    ["ready", 9],
    ["cancelled", 0],
  ]);
});

test("calculates checkpoint progress and exposes retry only for recoverable states", () => {
  const job = createJob({
    id: "progress",
    title: "Progress",
    status: "IN_PROGRESS",
    checkpoints: { analysis: {}, research: {} },
  });

  assert.deepEqual(getJobProgress(job), { completed: 2, total: 4 });
  assert.deepEqual(getJobProgress(createJob({ id: "ready", title: "Ready", status: "REVIEW_READY" })), {
    completed: 4,
    total: 4,
  });
  assert.equal(canRetryJob(createJob({ id: "failed", title: "Failed", status: "FAILED" })), true);
  assert.equal(canRetryJob(createJob({ id: "pending", title: "Pending", status: "PENDING" })), false);
});

test("filters case-insensitively across product identity, source, and provider", () => {
  const jobs = [
    createJob({ id: "JOB-CODEX", title: "Christmas Tree Rug", status: "REVIEW_READY", provider: "codex_mcp" }),
    createJob({ id: "job-gemini", title: "Bear Doormat", status: "FAILED", provider: "gemini", handle: "winter-bear" }),
  ];

  assert.deepEqual(filterQueueJobs(jobs, { query: "tree", group: "all", provider: "all" }).map(job => job.id), ["JOB-CODEX"]);
  assert.deepEqual(filterQueueJobs(jobs, { query: "WINTER", group: "all", provider: "all" }).map(job => job.id), ["job-gemini"]);
  assert.deepEqual(filterQueueJobs(jobs, { query: "AUTO_SEO", group: "all", provider: "gemini" }).map(job => job.id), ["job-gemini"]);
  assert.deepEqual(filterQueueJobs(jobs, { query: "", group: "ready", provider: "all" }).map(job => job.id), ["JOB-CODEX"]);
});
