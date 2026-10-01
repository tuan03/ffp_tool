import assert from "node:assert/strict";
import test from "node:test";

import { getBrowserSeoContentRunner } from "../browser";

const sampleInput = {
  images: [],
  niche: "home decor",
  title: "Sample product",
  description: "Sample description",
  handle: "sample-product",
} as const;

test("browser SEO runtime keeps mock execution in the browser-safe entry point", async () => {
  const output = await getBrowserSeoContentRunner("mock")(sampleInput);

  assert.equal(output.productHandle, "sample-product");
});

test("browser SEO runtime rejects local server execution outside mock mode", async () => {
  await assert.rejects(
    () => getBrowserSeoContentRunner("development")(sampleInput),
    /must run through the gateway API/,
  );
});
