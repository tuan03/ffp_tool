import assert from "node:assert/strict";
import test from "node:test";

import { JEMINISE_BEDDING_PROFILE, normalizeDomain, resolveStoreProfile } from "../internal/store-profiles";
import { projectStoreContentProfile } from "../internal/store-profiles/types";

test("normalizeDomain strips protocols, www, paths, queries, and ports", () => {
  assert.equal(normalizeDomain("https://www.jeminise.com:443/products/x?q=1"), "jeminise.com");
});

test("registry resolves Jeminise only before the semantic contract is built", () => {
  assert.equal(resolveStoreProfile({ storeId: "jeminise" }), JEMINISE_BEDDING_PROFILE);
  assert.equal(resolveStoreProfile({ siteDomain: "b6-theme-test.myshopify.com" }), JEMINISE_BEDDING_PROFILE);
  assert.equal(resolveStoreProfile({ siteDomain: "unknown.example" }), undefined);
});

test("Jeminise V2 profile is versioned and declares three structured offerings", () => {
  assert.equal(JEMINISE_BEDDING_PROFILE.profileVersion, "2.0.0");
  assert.deepEqual(
    JEMINISE_BEDDING_PROFILE.catalogPolicies?.[0]?.offerings.map((offering) => offering.name),
    ["Comforter", "Quilt", "Duvet Cover"],
  );
});

test("Jeminise offering policy requires niche, grounded identity and minimum confidence", () => {
  const deniedIdentity = projectStoreContentProfile(JEMINISE_BEDDING_PROFILE, "fleece blanket", "bedding", 0.99);
  const deniedConfidence = projectStoreContentProfile(JEMINISE_BEDDING_PROFILE, "quilt bedding set", "bedding", 0.79);
  const allowed = projectStoreContentProfile(JEMINISE_BEDDING_PROFILE, "quilt bedding set", "bedding", 0.95);
  assert.equal(deniedIdentity.bedding, undefined);
  assert.equal(deniedConfidence.bedding, undefined);
  assert.deepEqual(allowed.bedding?.options.map((offering) => offering.name), ["Comforter", "Quilt", "Duvet Cover"]);
});
