import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCrawlerInput } from "../ui/crawler-input";

test("crawler input counts unique ASINs across URLs without changing the original sources", () => {
  const analysis = analyzeCrawlerInput("\nhttps://www.amazon.com/dp/B0MOCK1001?tag=demo\nb0mock1001\nB0MOCK1002\nnot-an-asin\n");
  assert.equal(analysis.lineCount, 4);
  assert.equal(analysis.validCount, 2);
  assert.equal(analysis.duplicateCount, 1);
  assert.deepEqual(analysis.invalidEntries, [{ line: 5, value: "not-an-asin" }]);
  assert.equal(analysis.deduplicatedText, "https://www.amazon.com/dp/B0MOCK1001?tag=demo\nB0MOCK1002\nnot-an-asin");
});

test("crawler input does not discard invalid rows or accept another site's product URL", () => {
  const analysis = analyzeCrawlerInput("https://example.com/dp/B0MOCK1001\nB0MOCK1002");
  assert.equal(analysis.validCount, 1);
  assert.equal(analysis.invalidEntries.length, 1);
  assert.equal(analysis.duplicateCount, 0);
  assert.equal(analyzeCrawlerInput(" \n").lineCount, 0);
});
