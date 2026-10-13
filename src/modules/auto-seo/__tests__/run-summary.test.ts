import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AutoSeoRunSummary } from "../ui/components/AutoSeoRunSummary";
import type { AutoSeoBackupBatchProgress } from "../types";

const progress: AutoSeoBackupBatchProgress = {
  total: 30, hydrated: 30, backedUp: 18, handedOver: 18, skipped: 12, alreadyQueued: 8, unchanged: 4,
  completedBatches: 1, phase: "completed",
};

test("Auto SEO keeps a readable result with separate handoff and skip counts and explicit navigation", () => {
  const html = renderToStaticMarkup(React.createElement(AutoSeoRunSummary, {
    progress, onOpenQueue() {}, onOpenReview() {},
  }));
  assert.match(html, /Kết quả Auto SEO/);
  assert.match(html, /Bàn giao mới: <strong>18/);
  assert.match(html, /Đang trong Queue\/Review: <strong>8/);
  assert.match(html, /Không đổi\/đã xử lý: <strong>4/);
  assert.match(html, /Mở SEO Queue/);
  assert.match(html, /Mở SEO Review/);
  assert.doesNotMatch(html, /Chưa xác nhận/);
});

test("a failed Auto SEO batch keeps confirmed handoffs distinct from unconfirmed products", () => {
  const html = renderToStaticMarkup(React.createElement(AutoSeoRunSummary, {
    progress: { ...progress, skipped: 0, alreadyQueued: 0, unchanged: 0, phase: "failed" },
    onOpenQueue() {}, onOpenReview() {},
  }));
  assert.match(html, /Chưa xác nhận: <strong>12/);
  assert.match(html, /kết quả đã xác nhận được giữ nguyên/);
});
