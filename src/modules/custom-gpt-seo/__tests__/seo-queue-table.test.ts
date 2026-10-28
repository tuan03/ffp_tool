import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { mockJobs } from "../mocks/data";
import { QueueJobsTable } from "../ui/components/QueueJobsTable";

test("desktop queue presents source labels, real checkpoint summaries and retry only for eligible jobs", () => {
  const seed = mockJobs[0];
  assert.ok(seed);
  const jobs = [
    { ...seed, id: "pending", status: "PENDING" as const, original: null },
    { ...seed, id: "failed", status: "FAILED" as const, error: "QUOTA_EXHAUSTED secret-value", queueDisplay: { sourceTitle: "Record Round Rug", sourceHandle: "record-rug", checkpointStages: ["analysis" as const, "research" as const] } },
  ];
  const html = renderToStaticMarkup(createElement(QueueJobsTable, { jobs, isBusy: false, onOpenJob: () => undefined, onRetryJob: () => undefined }));
  assert.match(html, /Record Round Rug/);
  assert.match(html, /Chờ AI nhận việc/);
  assert.match(html, /Đã lưu: Nghiên cứu/);
  assert.match(html, /2\/4 bước đã có checkpoint/);
  assert.match(html, /chạm giới hạn quota/);
  assert.equal((html.match(/>Thử lại<\/button>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /secret-value|0\/4|Dọn Queue/);
  assert.match(html, /Sao chép job ID/);
});

test("retry only disables the selected product and shows its pending action", () => {
  const seed = mockJobs[0];
  assert.ok(seed);
  const jobs = ["first", "second"].map(id => ({ ...seed, id, status: "FAILED" as const }));
  const html = renderToStaticMarkup(createElement(QueueJobsTable, {
    jobs, isBusy: false, retryingJobIds: new Set(["first"]),
    onOpenJob: () => undefined, onRetryJob: () => undefined,
  }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 1);
  assert.match(html, /Đang thử lại/);
  assert.equal((html.match(/>Thử lại<\/button>/g) ?? []).length, 1);
});
