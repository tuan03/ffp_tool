import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("trend results render after the query form so completed discovery does not shift the active viewport", async () => {
  const source = await readFile(
    new URL("../ui/PinterestPodStudio.tsx", import.meta.url),
    "utf8",
  );
  const queryLayoutPosition = source.indexOf('data-testid="pinterest-query-layout"');
  const trendResultsPosition = source.indexOf('data-testid="pinterest-trend-results"');

  assert.notEqual(queryLayoutPosition, -1);
  assert.notEqual(trendResultsPosition, -1);
  assert.ok(trendResultsPosition > queryLayoutPosition);
});
