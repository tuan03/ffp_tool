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

test("review workspace filters use server-side stages and reject unknown workspaces", () => {
  const query = readReviewListQuery(new URL("http://test/?workspace=work&stage=ready"), "demo");
  assert.equal(query.workspace, "work");
  assert.equal(query.stage, "ready");
  const where = reviewListWhere(query);
  assert.match(where.sql, /review_stage/);
  assert.ok(where.parameters.includes("ready"));
  assert.throws(() => readReviewListQuery(new URL("http://test/?workspace=wrong"), "demo"));
  assert.throws(() => readReviewListQuery(new URL("http://test/?stage=wrong"), "demo"));
});
