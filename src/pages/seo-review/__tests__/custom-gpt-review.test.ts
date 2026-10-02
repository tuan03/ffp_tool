import assert from "node:assert/strict";
import test from "node:test";

import { loadAllCustomGptReviewRecords } from "../custom-gpt-review";

test("loads every custom GPT review page instead of stopping at 50 records", async () => {
  const requestedOffsets: number[] = [];
  const reviews = await loadAllCustomGptReviewRecords({
    async reviews(storeId: string, offset: number) {
      assert.equal(storeId, "jeminise-real");
      requestedOffsets.push(offset);
      return offset === 0
        ? { reviews: Array.from({ length: 50 }, (_, index) => index), nextOffset: 50 }
        : { reviews: Array.from({ length: 50 }, (_, index) => index + 50), nextOffset: null };
    },
  }, "jeminise-real");

  assert.deepEqual(requestedOffsets, [0, 50]);
  assert.equal(reviews.length, 100);
  assert.equal(reviews[99], 99);
});
