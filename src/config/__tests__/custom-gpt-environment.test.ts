import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCustomGptEnvironment } from "../custom-gpt-environment";

test("Custom GPT environment maps one action key to each configured store", () => {
  const actionKeys = Object.fromEntries([
    ["capozen", "capozen-key"],
    ["wrydeco", "wrydeco-key"],
    ["__proto__", "prototype-key"],
  ]);
  const config = parseCustomGptEnvironment({
    GPT_SEO_ACTION_KEYS_JSON: JSON.stringify(actionKeys),
  });

  assert.deepEqual(config.actionKeys, actionKeys);
});

test("Custom GPT environment preserves the legacy single-store action key", () => {
  const config = parseCustomGptEnvironment({
    GPT_SEO_ACTION_KEY: "legacy-key",
    GPT_SEO_STORE_ID: "capozen",
  });

  assert.deepEqual(config.actionKeys, { capozen: "legacy-key" });
});

test("Custom GPT environment prefers the multi-store map over legacy action credentials", () => {
  const config = parseCustomGptEnvironment({
    GPT_SEO_ACTION_KEYS_JSON: JSON.stringify({ wrydeco: "wrydeco-key" }),
    GPT_SEO_ACTION_KEY: "legacy-key",
    GPT_SEO_STORE_ID: "capozen",
  });

  assert.deepEqual(config.actionKeys, { wrydeco: "wrydeco-key" });
});

test("Custom GPT environment rejects unsafe multi-store action key maps", () => {
  const invalidMaps = [
    "[]",
    "{}",
    JSON.stringify({ "invalid store": "key" }),
    JSON.stringify({ capozen: "" }),
    JSON.stringify({ capozen: "shared-key", wrydeco: "shared-key" }),
  ];

  for (const actionKeysJson of invalidMaps) {
    assert.throws(
      () => parseCustomGptEnvironment({ GPT_SEO_ACTION_KEYS_JSON: actionKeysJson }),
      /GPT_SEO_ACTION_KEYS_JSON/,
    );
  }
  assert.throws(
    () => parseCustomGptEnvironment({
      GPT_SEO_ACTION_KEYS_JSON: JSON.stringify({ capozen: "shared-key" }),
      GATEWAY_AUTH_TOKEN: "shared-key",
    }),
    /must differ from GATEWAY_AUTH_TOKEN/,
  );
});
