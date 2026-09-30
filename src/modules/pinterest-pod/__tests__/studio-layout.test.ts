import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("completed trend discovery renders below the form and scrolls the result into view", async () => {
  const source = await readFile(
    new URL("../ui/PinterestPodStudio.tsx", import.meta.url),
    "utf8",
  );
  const queryLayoutPosition = source.indexOf('data-testid="pinterest-query-layout"');
  const trendResultsPosition = source.indexOf('data-testid="pinterest-trend-results"');

  assert.notEqual(queryLayoutPosition, -1);
  assert.notEqual(trendResultsPosition, -1);
  assert.ok(trendResultsPosition > queryLayoutPosition);
  assert.match(source, /ref=\{trendResultsRef\}/);
  assert.match(
    source,
    /trendResultsRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/,
  );
  assert.match(source, /className="scroll-mt-24"/);
});

test("step one groups the one-time configuration and gives official trends the primary action", async () => {
  const source = await readFile(
    new URL("../ui/components/InitForm.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /data-testid="step-one-topic" className="order-1/);
  assert.match(source, /data-testid="step-one-trend-scope" className="order-2/);
  assert.match(source, /data-testid="step-one-crawl-settings" className="order-3/);
  assert.match(source, /data-testid="step-one-mockup-settings" className="order-4/);
  assert.match(source, /data-testid="step-one-run-mode" className="order-6/);
  assert.match(source, /Phân tích Pinterest Trends/);
  assert.match(source, /Các phương án khác/);
  assert.doesNotMatch(source, /API CALLS ĐỒNG THỜI/);
});

test("step one keeps recent runs outside the configuration column", async () => {
  const source = await readFile(
    new URL("../ui/PinterestPodStudio.tsx", import.meta.url),
    "utf8",
  );
  const queryLayoutPosition = source.indexOf('data-testid="pinterest-query-layout"');
  const queryLayoutEndPosition = source.indexOf('data-testid="pinterest-query-layout-end"');
  const recentRunsPosition = source.indexOf("<RecentRunsAccordion");

  assert.ok(queryLayoutPosition >= 0);
  assert.ok(queryLayoutEndPosition > queryLayoutPosition);
  assert.ok(recentRunsPosition > queryLayoutEndPosition);
});
