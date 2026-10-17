import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveCrawlStatus } from "../ui/crawl-status";
import { CrawlStatusNotice } from "../ui/components/CrawlStatusNotice";

const base = { isRunning: false, isChecking: false, isStale: false, blockers: [], errors: [], summary: { totalProducts: 18, handedOver: 10, pending: 8, notHandedOver: 0 } };
test("completed links remain handing over until products reach Queue", () => {
  const status = resolveCrawlStatus({ ...base, isRunning: true, progress: { completed: 1, total: 1, phase: "seo", message: "" } });
  assert.match(status.title, /bàn giao/);
  assert.match(status.detail, /10\/18/);
  assert.equal(status.tone, "working");
});
test("errors and stale snapshots override completion without discarding counts", () => {
  assert.equal(resolveCrawlStatus({ ...base, errors: ["network"], completion: { label: "done", tone: "success" } }).tone, "error");
  assert.equal(resolveCrawlStatus({ ...base, isStale: true, completion: { label: "done", tone: "success" } }).tone, "warning");
});
test("new preflight hides old results and completion keeps warning tone", () => {
  const next = resolveCrawlStatus({ ...base, isChecking: true, completion: { label: "old", tone: "success" } });
  assert.doesNotMatch(next.detail, /old|10\/18/);
  assert.equal(resolveCrawlStatus({ ...base, summary: { totalProducts: 18, handedOver: 16, pending: 0, notHandedOver: 2 }, completion: { label: "16/18", tone: "warning" } }).tone, "warning");
});
test("pausing and captcha are not reported as normal crawling or success", () => {
  assert.match(resolveCrawlStatus({ ...base, isRunning: true, executionState: "paused" }).title, /Tạm dừng/);
  assert.equal(resolveCrawlStatus({ ...base, isRunning: true, progress: { completed: 0, total: 1, phase: "captcha", message: "" } }).tone, "warning");
});

test("sticky keeps readable errors in expandable details and never renders error HTML", () => {
  const errors = ["ASIN: <script>bad()</script>"];
  const markup = renderToStaticMarkup(createElement(CrawlStatusNotice, { status: resolveCrawlStatus({ ...base, errors }), errors }));
  assert.match(markup, /Xem lỗi/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

test("a finished crawl with pending handoffs stays working, not success", () => {
  assert.equal(resolveCrawlStatus({ ...base, completion: { label: "10/18", tone: "warning" } }).tone, "working");
});
