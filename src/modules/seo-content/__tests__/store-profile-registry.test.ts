import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPOZEN_RUG_PROFILE,
  JEMINISE_BEDDING_PROFILE,
  PREAUREUM_HANDBAG_PROFILE,
  listSeoStoreProfiles,
  normalizeDomain,
  resolveStoreProfile,
} from "../internal/store-profiles";
import { projectStoreContentProfile } from "../internal/store-profiles/types";

test("normalizeDomain strips protocols, www, paths, queries, and ports", () => {
  assert.equal(normalizeDomain("https://www.jeminise.com:443/products/x?q=1"), "jeminise.com");
});

test("registry resolves Jeminise before the semantic contract is built", () => {
  assert.equal(resolveStoreProfile({ storeId: "jeminise" }), JEMINISE_BEDDING_PROFILE);
  assert.equal(resolveStoreProfile({ siteDomain: "b6-theme-test.myshopify.com" }), JEMINISE_BEDDING_PROFILE);
  assert.equal(resolveStoreProfile({ siteDomain: "unknown.example" }), undefined);
});

test("registry resolves the Capozen rug profile by store ID and Shopify domain", () => {
  assert.equal(resolveStoreProfile({ storeId: "capozen" }), CAPOZEN_RUG_PROFILE);
  assert.equal(resolveStoreProfile({ siteDomain: "capozen.myshopify.com" }), CAPOZEN_RUG_PROFILE);
  assert.equal(CAPOZEN_RUG_PROFILE.niche, "Rugs & Doormats");
  assert.equal(CAPOZEN_RUG_PROFILE.catalogPolicies, undefined);
});

test("registry resolves the Preaureum handbag profile by store ID and Shopify domain", () => {
  assert.equal(resolveStoreProfile({ storeId: "preaureum" }), PREAUREUM_HANDBAG_PROFILE);
  const developmentProfile = resolveStoreProfile({
    storeId: "preaureum_dev",
    siteDomain: "leatherbag-3anqqbf8.myshopify.com",
  });
  assert.equal(developmentProfile?.profileId, PREAUREUM_HANDBAG_PROFILE.profileId);
  assert.equal(developmentProfile?.profileVersion, PREAUREUM_HANDBAG_PROFILE.profileVersion);
  assert.equal(developmentProfile?.storeId, "preaureum_dev");
  assert.equal(PREAUREUM_HANDBAG_PROFILE.storeId, "preaureum");
  assert.equal(
    resolveStoreProfile({ siteDomain: "leatherbag-3anqqbf8.myshopify.com" }),
    PREAUREUM_HANDBAG_PROFILE,
  );
  assert.equal(PREAUREUM_HANDBAG_PROFILE.niche, "Personalized Handbags & Wallets");
  assert.equal(PREAUREUM_HANDBAG_PROFILE.profileVersion, "2.1.0");
  assert.equal(PREAUREUM_HANDBAG_PROFILE.productDescriptionPolicy?.mode, "visual-design-only");
  assert.equal(PREAUREUM_HANDBAG_PROFILE.catalogPolicies, undefined);
});

test("registry exposes safe profile choices and scopes an explicit profile to any runtime store", () => {
  assert.deepEqual(
    listSeoStoreProfiles().map(({ profileId }) => profileId),
    ["capozen-rugs", "jeminise-bedding", "preaureum-handbags"],
  );
  const profile = resolveStoreProfile({ profileId: "preaureum-handbags", storeId: "future-store" });
  assert.equal(profile?.profileId, "preaureum-handbags");
  assert.equal(profile?.storeId, "future-store");
  assert.equal(resolveStoreProfile({ profileId: "missing-profile", storeId: "future-store" }), undefined);
});

test("Jeminise V2 profile is versioned and declares three structured offerings", () => {
  assert.equal(JEMINISE_BEDDING_PROFILE.profileVersion, "2.1.0");
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
