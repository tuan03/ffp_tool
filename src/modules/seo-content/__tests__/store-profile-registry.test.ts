import assert from "node:assert/strict";
import test from "node:test";

import {
  JEMINISE_BEDDING_PROFILE,
  normalizeDomain,
  resolveStoreProfile,
} from "../internal/store-profiles";
import { buildContentFactSheet } from "../internal/content-generation/content-fact-sheet";
import { createInitialContext } from "../internal/pipeline-context";

test("normalizeDomain strips protocols, www, paths, queries, and ports", () => {
  assert.equal(normalizeDomain("https://jeminise.com"), "jeminise.com");
  assert.equal(normalizeDomain("http://www.jeminise.com/"), "jeminise.com");
  assert.equal(normalizeDomain("https://jeminise.com/products/viking-quilt?variant=123"), "jeminise.com");
  assert.equal(normalizeDomain("jeminise.com:8080"), "jeminise.com");
  assert.equal(normalizeDomain("  B6-Theme-Test.myshopify.com  "), "b6-theme-test.myshopify.com");
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain(undefined), "");
});

test("resolveStoreProfile finds Jeminise Bedding Profile by siteDomain", () => {
  const profile1 = resolveStoreProfile({ siteDomain: "jeminise.com" });
  assert.ok(profile1);
  assert.equal(profile1.storeId, "jeminise");
  assert.equal(profile1.storeName, "Jeminise");
  assert.equal(profile1.bedding?.options.length, 3);

  const profile2 = resolveStoreProfile({ siteDomain: "https://jeminise.com/collections/all" });
  assert.ok(profile2);
  assert.equal(profile2.storeId, "jeminise");

  const profile3 = resolveStoreProfile({ siteDomain: "www.jeminise.com" });
  assert.ok(profile3);
  assert.equal(profile3.storeId, "jeminise");
});

test("resolveStoreProfile finds Jeminise Bedding Profile by domain alias", () => {
  const profile = resolveStoreProfile({ siteDomain: "b6-theme-test.myshopify.com" });
  assert.ok(profile);
  assert.equal(profile.storeId, "jeminise");
});

test("resolveStoreProfile recognizes the production Jeminise store aliases", () => {
  assert.equal(resolveStoreProfile({ storeId: "jeminise-real" })?.storeId, "jeminise");
  assert.equal(resolveStoreProfile({ siteDomain: "f4hgwc-hu.myshopify.com" })?.storeId, "jeminise");
});

test("Jeminise fleece blankets do not inherit three-style bedding claims", () => {
  const facts = buildContentFactSheet(createInitialContext({
    storeId: "jeminise-real",
    siteDomain: "f4hgwc-hu.myshopify.com",
    title: "Personalized Reading Blanket",
    description: "Polyester blanket available in Fleece or Sherpa.",
    niche: "Blanket",
    handle: "personalized-reading-blanket",
    images: [],
    variants: [
      { title: "Fleece / 50 x 40", options: { Material: "Fleece", Size: "50 x 40" } },
      { title: "Sherpa / 60 x 50", options: { Material: "Sherpa", Size: "60 x 50" } },
    ],
  }));

  assert.equal(facts.storeProfile?.storeId, "jeminise");
  assert.equal(facts.storeProfile?.bedding, undefined);
  assert.equal(facts.storeProfile?.seoDescriptionGuidelines, undefined);
});

test("Jeminise products retain the bedding profile only with all three verified styles", () => {
  const facts = buildContentFactSheet(createInitialContext({
    storeId: "jeminise-real",
    siteDomain: "f4hgwc-hu.myshopify.com",
    title: "Viking Bedding Set",
    description: "Choose a Comforter, Quilt, or Duvet Cover.",
    niche: "Bedding",
    handle: "viking-bedding-set",
    images: [],
    variants: [
      { title: "Comforter", options: { Style: "Comforter" } },
      { title: "Quilt", options: { Style: "Quilt" } },
      { title: "Duvet Cover", options: { Style: "Duvet Cover" } },
    ],
  }));

  assert.equal(facts.storeProfile?.bedding?.options.length, 3);
});

test("resolveStoreProfile finds Jeminise Bedding Profile by storeId", () => {
  const profileLower = resolveStoreProfile({ storeId: "jeminise" });
  assert.ok(profileLower);
  assert.equal(profileLower.storeId, "jeminise");

  const profileUpper = resolveStoreProfile({ storeId: "JEMINISE" });
  assert.ok(profileUpper);
  assert.equal(profileUpper.storeId, "jeminise");
});

test("resolveStoreProfile finds Jeminise Bedding Profile by product url fallback", () => {
  const profile = resolveStoreProfile({ url: "https://jeminise.com/products/viking-warrior-quilt" });
  assert.ok(profile);
  assert.equal(profile.storeId, "jeminise");
});

test("resolveStoreProfile returns undefined for unknown domain or storeId", () => {
  assert.equal(resolveStoreProfile({ siteDomain: "random-store.com" }), undefined);
  assert.equal(resolveStoreProfile({ storeId: "random_id" }), undefined);
  assert.equal(resolveStoreProfile({}), undefined);
});

test("JEMINISE_BEDDING_PROFILE has complete specifications for POD Bedding", () => {
  assert.equal(JEMINISE_BEDDING_PROFILE.storeId, "jeminise");
  assert.ok(JEMINISE_BEDDING_PROFILE.bedding);
  const options = JEMINISE_BEDDING_PROFILE.bedding.options;
  assert.equal(options.length, 3);
  assert.deepEqual(options.map((o) => o.name), ["Comforter", "Quilt", "Duvet Cover"]);
  assert.match(JEMINISE_BEDDING_PROFILE.bedding.fabricMaterial, /microfiber/i);
  assert.match(JEMINISE_BEDDING_PROFILE.bedding.printTechnology, /sublimation/i);
  assert.match(JEMINISE_BEDDING_PROFILE.bedding.careGuidance, /machine wash/i);
  assert.ok(JEMINISE_BEDDING_PROFILE.seoDescriptionGuidelines?.mandatoryKeywords.includes("Comforter"));
  assert.ok(JEMINISE_BEDDING_PROFILE.seoDescriptionGuidelines?.mandatoryKeywords.includes("Quilt"));
  assert.ok(JEMINISE_BEDDING_PROFILE.seoDescriptionGuidelines?.mandatoryKeywords.includes("Duvet Cover"));
});
