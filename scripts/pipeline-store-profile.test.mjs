import assert from "node:assert/strict";
import test from "node:test";

import { resolvePipelineStoreProfile } from "./pipeline-store-profile.ts";

const profile = Object.freeze({
  profileId: "capozen-rugs",
  profileVersion: "1",
  storeId: "capozen",
  storeName: "Capozen",
  locale: "en-US",
  language: "English",
  niche: "rugs",
  brandVoice: [],
  contentRules: [],
  prohibitedClaims: [],
  seoConstraints: {
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  },
});

test("pipeline reloads runtime stores before rejecting a newly registered store", () => {
  const staleStores = [];
  const freshStores = [{
    storeId: "chillgen-real",
    shopDomain: "bbjttb-n9.myshopify.com",
    seoProfileId: "capozen-rugs",
    auth: { type: "static_access_token", accessToken: "test-only" },
  }];
  let reloads = 0;

  const resolved = resolvePipelineStoreProfile({
    storeId: "chillgen-real",
    stores: staleStores,
    reloadStores: () => {
      reloads += 1;
      return freshStores;
    },
    resolveProfile: ({ profileId, storeId }) =>
      profileId === "capozen-rugs" ? { ...profile, storeId } : undefined,
  });

  assert.equal(reloads, 1);
  assert.equal(resolved.storeProfile?.storeId, "chillgen-real");
  assert.equal(resolved.storeConfig?.seoProfileId, "capozen-rugs");
  assert.equal(resolved.stores, freshStores);
});

test("pipeline does not reload when the current registry already resolves the store profile", () => {
  const stores = [{
    storeId: "preaureum_dev",
    shopDomain: "leatherbag-3anqqbf8.myshopify.com",
    seoProfileId: "preaureum-handbags",
    auth: { type: "static_access_token", accessToken: "test-only" },
  }];

  const resolved = resolvePipelineStoreProfile({
    storeId: "preaureum_dev",
    stores,
    reloadStores: () => {
      throw new Error("reload should not run");
    },
    resolveProfile: ({ storeId }) => ({ ...profile, storeId }),
  });

  assert.equal(resolved.storeProfile?.storeId, "preaureum_dev");
  assert.equal(resolved.stores, stores);
});

test("pipeline returns the refreshed registry when a store profile remains unavailable", () => {
  const freshStores = [{
    storeId: "unknown-store",
    shopDomain: "unknown.myshopify.com",
    auth: { type: "static_access_token", accessToken: "test-only" },
  }];

  const resolved = resolvePipelineStoreProfile({
    storeId: "unknown-store",
    stores: [],
    reloadStores: () => freshStores,
    resolveProfile: () => undefined,
  });

  assert.equal(resolved.storeProfile, undefined);
  assert.equal(resolved.storeConfig?.storeId, "unknown-store");
  assert.equal(resolved.stores, freshStores);
});
