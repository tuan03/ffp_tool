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
  assert.match(source, /const \[isCrawlSettingsOpen, setIsCrawlSettingsOpen\] = useState\(false\)/);
  assert.match(source, /const \[isMockupSettingsOpen, setIsMockupSettingsOpen\] = useState\(false\)/);
  assert.match(source, /aria-controls="crawl-settings-content"/);
  assert.match(source, /aria-controls="mockup-settings-content"/);
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

  const recentRunsSource = await readFile(
    new URL("../ui/components/RecentRunsAccordion.tsx", import.meta.url),
    "utf8",
  );
  assert.match(recentRunsSource, /const \[isOpen, setIsOpen\] = useState\(false\)/);
});

test("step one removes static hot suggestions and consolidates connection controls", async () => {
  const formSource = await readFile(
    new URL("../ui/components/InitForm.tsx", import.meta.url),
    "utf8",
  );
  const headerSource = await readFile(
    new URL("../ui/components/HeaderBar.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(formSource, /SUGGESTED_CHIPS|Gợi ý xu hướng hot/);
  assert.match(headerSource, /Pinterest API · Sẵn sàng/);
  assert.match(headerSource, /Crawler · Online · Đã login/);
  assert.doesNotMatch(headerSource, /Đã lưu API Token|Agent Online|Agent chưa login|Xác thực Pinterest/);
});

test("job selector dropdown stays above the step content", async () => {
  const headerSource = await readFile(
    new URL("../ui/components/HeaderBar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(headerSource, /<header className="[^"]*relative z-40[^"]*"/);
  assert.match(headerSource, /Floating Dropdown Panel[\s\S]*z-50/);
});
