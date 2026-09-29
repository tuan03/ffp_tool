import assert from "node:assert/strict";
import test from "node:test";

import { hasUsableReviewContext } from "../product-context";

test("AI context requires at least one usable product fact", () => {
  assert.equal(hasUsableReviewContext(undefined), false);
  assert.equal(hasUsableReviewContext({ asin: "B012345678", url: "https://www.amazon.com/dp/B012345678", title: "", bullets: [], details: {} }), false);
  assert.equal(hasUsableReviewContext({ asin: "B012345678", url: "https://www.amazon.com/dp/B012345678", title: "Rug" }), false);
  assert.equal(hasUsableReviewContext({ asin: "B012345678", url: "https://www.amazon.com/dp/B012345678", bullets: ["Printed deer pattern"] }), true);
});
