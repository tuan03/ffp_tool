import assert from "node:assert/strict";
import test from "node:test";

import { getBrowserSeoContentRunner } from "../browser";
import { TEST_STORE_PROFILE } from "./test-profile";

const sampleInput = {
  images: [],
  niche: "home decor",
  storeProfile: TEST_STORE_PROFILE,
} as const;

test("browser SEO runtime keeps mock execution in the browser-safe entry point", async () => {
  const output = await getBrowserSeoContentRunner("mock")(sampleInput);

  assert.ok(output.productTitle);
});

test("browser SEO runtime rejects local server execution outside mock mode", async () => {
  await assert.rejects(
    () => getBrowserSeoContentRunner("development")(sampleInput),
    /must run through the gateway API/,
  );
});
