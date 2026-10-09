import assert from "node:assert/strict";
import test from "node:test";

import {
  findExcludedLiterals,
  normalizeExcludedLiterals,
} from "../internal/literal-text-guard";

test("normalizes vertically arranged artwork letters as one excluded name", () => {
  assert.deepEqual(
    normalizeExcludedLiterals(["GOD", "A", "M", "E", "L", "I", "A", "PA"]),
    ["GOD", "AMELIA", "PA"],
  );
});

test("ignores an isolated single-letter OCR fragment", () => {
  assert.deepEqual(normalizeExcludedLiterals(["I", "gold roses"]), ["gold roses"]);
});

test("reports every literal artwork violation with its path and literal", () => {
  assert.deepEqual(
    findExcludedLiterals(
      {
        draft: {
          intro: "Faith and Fear typography",
          productSeoTitle: "Amelia Gold Portrait",
        },
      },
      ["Faith", "Fear", "AMELIA"],
    ),
    [
      { path: "content.draft.intro", literal: "Faith" },
      { path: "content.draft.intro", literal: "Fear" },
      { path: "content.draft.productSeoTitle", literal: "AMELIA" },
    ],
  );
});
