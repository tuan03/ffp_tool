import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQueueSummaries,
  canRetryJob,
  filterQueueJobs,
  getBatchOwnerLabel,
  getJobProgress,
  getJobIdentityLabel,
  getJobIssueSummary,
  getJobProgressPresentation,
  getJobSourceTitle,
  getProviderPresentation,
  getStatusesForGroup,
  getStatusPresentation,
} from "../ui/seo-queue-view-model";
import type { GptSeoJob, GptJobStatus, SeoProvider } from "../types";

const TEST_STORE_PROFILE = {
  profileId: "capozen-test",
  profileVersion: "2.0.0",
  storeId: "capozen",
  storeName: "Capozen",
  locale: "en-US",
  language: "English",
  niche: "home decor",
  brandVoice: ["clear"],
  contentRules: ["Use image-grounded facts."],
  prohibitedClaims: ["No unsupported claims."],
  seoConstraints: {
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  },
} as const;

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
      niche: "home decor",
      storeProfile: TEST_STORE_PROFILE,
      images: [],
    },
    execution: {
      storeId: "capozen",
      productId: input.id,
      source: "auto_seo",
      sourceIdentity: input.id,
      providerId: input.provider ?? "codex_mcp",
      pipelineVersion: "seo-content-input-v2",
      originalSnapshot: {
        title: input.title,
        handle: input.handle ?? `handle-${input.id}`,
      },
    },
    original: {
      title: input.title,
      handle: input.handle ?? `handle-${input.id}`,
    },
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
  assert.equal(getStatusPresentation("WAITING_INPUT").label, "Cần xử lý");
});

test("presents safe batch owner labels without credentials", () => {
  assert.equal(getBatchOwnerLabel("codex_mcp:office-pc"), "office-pc");
  assert.equal(getBatchOwnerLabel("codex_mcp:default"), "Máy mặc định");
  assert.equal(getBatchOwnerLabel("custom_gpt"), "GPT Custom");
  assert.equal(getBatchOwnerLabel("future_worker"), "future worker");
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

test("maps queue summary filters to the statuses sent before pagination", () => {
  assert.deepEqual(getStatusesForGroup("waiting"), ["PENDING"]);
  assert.deepEqual(getStatusesForGroup("processing"), ["IN_PROGRESS", "VALIDATING"]);
  assert.deepEqual(getStatusesForGroup("attention"), ["WAITING_INPUT", "NEEDS_CHANGES", "FAILED"]);
  assert.deepEqual(getStatusesForGroup("ready"), ["REVIEW_READY"]);
  assert.equal(getStatusesForGroup("all"), undefined);
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

test("presents a readable source identity when the catalog omits the original snapshot", () => {
  const job = { ...createJob({ id: "source", title: "Original", status: "PENDING" }), source: "amazon" as const, sourceIdentity: "amazon:B012345678:color:style #3", original: null };
  assert.equal(getJobIdentityLabel(job), "ASIN B012345678 · color:style #3");
  assert.equal(getJobSourceTitle(job), "ASIN B012345678 · color:style #3");
  assert.equal(getJobIdentityLabel({ ...job, source: "auto_seo", sourceIdentity: "gid://shopify/Product/12345" }), "Shopify #12345");
  assert.deepEqual(filterQueueJobs([job], { query: "B012345678", group: "all", provider: "all" }).map(entry => entry.id), ["source"]);
});

test("checkpoint presentation distinguishes omitted catalog details from saved checkpoints", () => {
  const job = createJob({ id: "progress", title: "Progress", status: "IN_PROGRESS", checkpoints: { analysis: {}, research: {} } });
  assert.deepEqual(getJobProgressPresentation(job, false), { label: "AI đang xử lý", detail: "Mở chi tiết để xem checkpoint", completed: null });
  assert.deepEqual(getJobProgressPresentation(job, true), { label: "Đã lưu: Nghiên cứu", detail: "2/4 bước đã có checkpoint", completed: 2 });
  assert.equal(getJobProgressPresentation({ ...job, status: "PENDING" }, false).label, "Chờ AI nhận việc");
  assert.equal(getJobProgressPresentation({ ...job, status: "VALIDATING" }, false).label, "Đang kiểm tra kết quả");
  assert.equal(getJobProgressPresentation({ ...job, status: "REVIEW_READY" }, false).completed, 4);
});

test("new catalog metadata restores title, handle search and real progress without full snapshots", () => {
  const job = { ...createJob({ id: "catalog", title: "Original", status: "IN_PROGRESS" }), original: null, checkpoints: {}, queueDisplay: { sourceTitle: "Vinyl Record Rug", sourceHandle: "vinyl-record", checkpointStages: ["analysis" as const, "research" as const] } };
  assert.equal(getJobSourceTitle(job), "Vinyl Record Rug");
  assert.equal(getJobProgressPresentation(job, false).completed, 2);
  assert.equal(getJobProgressPresentation(job, false).label, "Đã lưu: Nghiên cứu");
  assert.equal(filterQueueJobs([job], { query: "vinyl-record", group: "all", provider: "all" }).length, 1);
});

test("operator error summaries explain known issues without displaying raw internal messages", () => {
  const job = createJob({ id: "issue", title: "Issue", status: "FAILED" });
  assert.equal(getJobIssueSummary({ ...job, error: "QUOTA_EXHAUSTED: private request body" }), "Máy xử lý đã chạm giới hạn quota. Kiểm tra tài khoản trước khi thử lại.");
  assert.equal(getJobIssueSummary({ ...job, error: "TOKEN_EXPIRED secret-value" }), "Quyền truy cập đã hết hạn hoặc không hợp lệ. Kiểm tra kết nối máy.");
  const summary = getJobIssueSummary({ ...job, error: "Unhandled internal error: secret-value" });
  assert.ok(summary);
  assert.doesNotMatch(summary, /secret-value|Unhandled/);
  assert.equal(getJobIssueSummary({ ...job, status: "PENDING", error: undefined }), null);
});
