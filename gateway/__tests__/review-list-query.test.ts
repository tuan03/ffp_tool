import assert from "node:assert/strict";
import test from "node:test";
import { readReviewListQuery, reviewListWhere } from "../review-list-query";

test("review list requires a store and bounded pagination and binds literal search values", () => {
  const query = readReviewListQuery(new URL("http://test/?search=50%25_blue&decision=approved"), "demo");
  const where = reviewListWhere(query);
  assert.deepEqual(where.parameters, ["demo", "%50\\%\\_blue%", "%50\\%\\_blue%", "%50\\%\\_blue%", "approved"]);
  assert.equal(query.limit, 50);
  for (const suffix of ["?limit=51", "?offset=-1", "?offset=NaN", "?decision=bad"]) {
    assert.throws(() => readReviewListQuery(new URL(`http://test/${suffix}`), "demo"));
  }
  assert.throws(() => readReviewListQuery(new URL("http://test/"), ""));
});
