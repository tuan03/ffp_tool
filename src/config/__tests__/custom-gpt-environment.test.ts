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

test("Custom GPT environment preserves legacy store-scoped MCP keys as default workers", () => {
  const config = parseCustomGptEnvironment({
    GPT_SEO_ACTION_KEYS_JSON: JSON.stringify({ capozen: "action-key" }),
    GPT_SEO_MCP_KEYS_JSON: JSON.stringify({ capozen: "mcp-key", wrydeco: "other-mcp-key" }),
    GATEWAY_AUTH_TOKEN: "admin-key",
  });

  assert.deepEqual(config.mcpCredentials, [
    { storeId: "capozen", workerId: "default", secret: "mcp-key" },
    { storeId: "wrydeco", workerId: "default", secret: "other-mcp-key" },
  ]);
});

test("Custom GPT environment parses named MCP workers for one store", () => {
  const config = parseCustomGptEnvironment({
    GPT_SEO_MCP_KEYS_JSON: JSON.stringify({
      capozen: {
        "office-pc": "office-token",
        laptop: "laptop-token",
      },
    }),
  });

  assert.deepEqual(config.mcpCredentials, [
    { storeId: "capozen", workerId: "office-pc", secret: "office-token" },
    { storeId: "capozen", workerId: "laptop", secret: "laptop-token" },
  ]);
});

test("Custom GPT environment rejects MCP keys shared with another credential", () => {
  assert.throws(() => parseCustomGptEnvironment({
    GPT_SEO_ACTION_KEYS_JSON: JSON.stringify({ capozen: "shared-key" }),
    GPT_SEO_MCP_KEYS_JSON: JSON.stringify({ capozen: "shared-key" }),
  }), /MCP.*differ|differ.*MCP/i);
  assert.throws(() => parseCustomGptEnvironment({
    GPT_SEO_MCP_KEYS_JSON: JSON.stringify({ capozen: "admin-key" }),
    GATEWAY_AUTH_TOKEN: "admin-key",
  }), /GATEWAY_AUTH_TOKEN/);
});

test("Custom GPT environment rejects unsafe MCP worker maps", () => {
  const invalidMaps = [
    JSON.stringify({ capozen: {} }),
    JSON.stringify({ capozen: { "invalid worker": "token" } }),
    JSON.stringify({ capozen: { laptop: "" } }),
    JSON.stringify({ capozen: { laptop: "shared", desktop: "shared" } }),
    JSON.stringify({ capozen: { laptop: "shared" }, wrydeco: { desktop: "shared" } }),
  ];

  for (const mcpKeysJson of invalidMaps) {
    assert.throws(
      () => parseCustomGptEnvironment({ GPT_SEO_MCP_KEYS_JSON: mcpKeysJson }),
      /GPT_SEO_MCP_KEYS_JSON/,
    );
  }

  assert.throws(() => parseCustomGptEnvironment({
    GPT_SEO_ACTION_KEYS_JSON: JSON.stringify({ capozen: "action-key" }),
    GPT_SEO_MCP_KEYS_JSON: JSON.stringify({ capozen: { laptop: "action-key" } }),
  }), /MCP.*differ|differ.*MCP/i);
  assert.throws(() => parseCustomGptEnvironment({
    GPT_SEO_MCP_KEYS_JSON: JSON.stringify({ capozen: { laptop: "admin-key" } }),
    GATEWAY_AUTH_TOKEN: "admin-key",
  }), /GATEWAY_AUTH_TOKEN/);
});
