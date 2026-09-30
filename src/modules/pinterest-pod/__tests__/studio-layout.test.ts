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
