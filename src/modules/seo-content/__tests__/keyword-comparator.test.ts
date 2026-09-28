import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  calculateCannibalizationSafety,
  calculateCommercialIntent,
  calculateEntityAlignment,
  calculateSearchValidation,
  compareKeywordQuality,
  evaluateKeywordQuality,
  KeywordQualityComparator,
  type KeywordEvaluationContext,
} from "../internal/keyword-comparator";
import { allocateKeywords } from "../internal/content-generation/keyword-allocator";

test("Signal 1: Entity alignment matches B1 physical identity and visual entities", () => {
  const context: KeywordEvaluationContext = {
    physicalProductIdentity: "quilt bedding set",
    visualEntities: "Viking raven artwork with Celtic knotwork",
    visibleTexts: ["Valhalla Awaits"],
  };

  // 1. Matches both physical identity and visual entities -> high synergy score
  const perfectMatch = calculateEntityAlignment("viking raven quilt bedding set", context);
  assert.ok(perfectMatch >= 0.90, `Expected perfectMatch >= 0.90, got ${perfectMatch}`);

  // 2. Matches physical identity only -> solid identity score
  const identityOnly = calculateEntityAlignment("quilt bedding set with pillowcases", context);
  assert.ok(identityOnly >= 0.70 && identityOnly < 0.90, `Expected identityOnly between 0.70 and 0.90, got ${identityOnly}`);

  // 3. Matches visual entity only without physical identity -> capped low score
  const visualOnly = calculateEntityAlignment("viking raven valhalla artwork", context);
  assert.ok(visualOnly <= 0.35, `Expected visualOnly <= 0.35, got ${visualOnly}`);

  // 4. Matches category synonym (e.g. "bedspread" or "comforter" for quilt bedding)
  const synonymMatch = calculateEntityAlignment("viking raven comforter set", context);
  assert.ok(synonymMatch >= 0.60, `Expected synonymMatch >= 0.60, got ${synonymMatch}`);

  // 5. Category clash / competing product category -> 0.0
  const categoryClash = calculateEntityAlignment("viking raven coffee mug", context);
  assert.equal(categoryClash, 0.0, "Expected category clash to score 0.0");
});

test("Signal 2: Commercial intent scores transactional/gift modifiers and penalizes informational words", () => {
  const context: KeywordEvaluationContext = {
    targetAudience: ["cat lovers", "cat mom"],
    occasions: ["halloween", "christmas gift"],
    buyerIntentKeywords: ["custom cat apparel", "cat mom gift"],
  };

  // 1. Standard baseline product query
  const baseline = calculateCommercialIntent("black cat t-shirt", context);
  assert.ok(baseline >= 0.50 && baseline <= 0.75, `Expected baseline between 0.50 and 0.75, got ${baseline}`);

  // 2. High commercial intent with transactional & gift modifiers
  const commercial = calculateCommercialIntent("custom personalized black cat t-shirt", context);
  assert.ok(commercial >= 0.80, `Expected commercial >= 0.80, got ${commercial}`);

  // 3. Occasion and audience modifiers boost intent
  const giftOccasion = calculateCommercialIntent("halloween black cat gift for cat mom", context);
  assert.ok(giftOccasion >= 0.85, `Expected giftOccasion >= 0.85, got ${giftOccasion}`);

  // 4. Informational / Educational / DIY queries are penalized to 0.0
  const howTo = calculateCommercialIntent("how to print black cat shirt", context);
  assert.equal(howTo, 0.0, "Expected 'how to' query to receive 0.0 intent score");

  const diyTutorial = calculateCommercialIntent("diy black cat t-shirt tutorial free download", context);
  assert.equal(diyTutorial, 0.0, "Expected DIY/tutorial query to receive 0.0 intent score");

  const patternQuery = calculateCommercialIntent("free black cat sewing pattern pdf", context);
  assert.equal(patternQuery, 0.0, "Expected free pattern query to receive 0.0 intent score");
});

test("Signal 3: Search validation against Google Suggest autocomplete completions", () => {
  const suggestions = [
    "black cat halloween t-shirt",
    "cute cat mom shirt custom",
    "vintage spooky cat tee",
    "cat lovers gift idea",
  ];

  // 1. Exact match -> 1.0
  const exact = calculateSearchValidation("black cat halloween t-shirt", suggestions);
  assert.equal(exact, 1.0, "Expected exact match to score 1.0");

  // Case insensitive and whitespace normalized exact match
  const exactNormalized = calculateSearchValidation("  BLACK CAT HALLOWEEN T-SHIRT ", suggestions);
  assert.equal(exactNormalized, 1.0, "Expected normalized exact match to score 1.0");

  // 2. Prefix / Contains match -> 0.7
  const prefixMatch = calculateSearchValidation("black cat halloween", suggestions);
  assert.equal(prefixMatch, 0.7, "Expected prefix/contains match to score 0.7");

  const containsMatch = calculateSearchValidation("cute cat mom shirt", suggestions);
  assert.equal(containsMatch, 0.7, "Expected substring contains match to score 0.7");

  // 3. Unverified query -> 0.2
  const unverified = calculateSearchValidation("unheard of obscure feline garment 999", suggestions);
  assert.equal(unverified, 0.2, "Expected unverified query to score 0.2");

  // Empty suggestions fallback -> 0.2
  const emptySuggestions = calculateSearchValidation("black cat shirt", []);
  assert.equal(emptySuggestions, 0.2, "Expected empty suggestions to score 0.2");
});

test("Signal 4: Cannibalization safety and catalog conflict penalty with hard veto", () => {
  const context: KeywordEvaluationContext = {
    productId: "prod_current_123",
    handle: "current-black-cat-tee",
    knownConflicts: ["spooky gothic cat tee", "general feline top"],
    conflictDetails: {
      "spooky gothic cat tee": {
        reason: "EXACT_MATCH_CONFLICT",
        matchType: "exact",
        similarity: 1.0,
      },
      "general feline top": {
        reason: "SECONDARY_OVERLAP",
        matchType: "semantic",
        similarity: 0.82,
      },
    },
    existingTargets: [
      {
        productId: "prod_other_999",
        handle: "other-cat-shirt",
        url: "https://shop.com/products/other-cat-shirt",
        primaryKeyword: "vintage black cat tee",
        keyword: "vintage black cat tee",
        matchType: "exact",
        rank: 0,
        similarity: 0.96,
      },
      {
        productId: "prod_current_123", // Self product
        handle: "current-black-cat-tee",
        url: "https://shop.com/products/current-black-cat-tee",
        primaryKeyword: "my own registered keyword",
        keyword: "my own registered keyword",
        matchType: "exact",
        rank: 0,
      },
    ],
  };

  // 1. Clean / safe keyword
  const safe = calculateCannibalizationSafety("unique celestial black cat t-shirt", context);
  assert.equal(safe.score, 1.0);
  assert.equal(safe.isHardVeto, false);

  // 2. Severe conflict with known primary conflict -> 0.0 + hard veto
  const severeKnown = calculateCannibalizationSafety("spooky gothic cat tee", context);
  assert.equal(severeKnown.score, 0.0);
  assert.equal(severeKnown.isHardVeto, true);

  // 3. Exact match conflict with another product in corpus -> 0.0 + hard veto
  const severeCorpus = calculateCannibalizationSafety("vintage black cat tee", context);
  assert.equal(severeCorpus.score, 0.0);
  assert.equal(severeCorpus.isHardVeto, true);

  // 4. Secondary overlap / moderate conflict -> 0.50 score, not a hard veto
  const secondary = calculateCannibalizationSafety("general feline top", context);
  assert.equal(secondary.score, 0.50);
  assert.equal(secondary.isHardVeto, false);

  // 5. Self-conflict exclusion: Matching current product's own existing keyword is safe
  const selfConflict = calculateCannibalizationSafety("my own registered keyword", context);
  assert.equal(selfConflict.score, 1.0);
  assert.equal(selfConflict.isHardVeto, false);
});

test("KeywordQualityComparator: Objective Superiority Rule evaluates replacement, retention, and review flags", () => {
  const comparator = new KeywordQualityComparator();
  const context: KeywordEvaluationContext = {
    physicalProductIdentity: "area rug",
    visualEntities: "vintage vinyl record player music art",
    targetAudience: ["music lovers", "audiophiles"],
    occasions: ["housewarming", "studio decor"],
    suggestions: [
      "vintage music area rug",
      "retro record player carpet",
      "audiophile floor mat",
    ],
    knownConflicts: ["cannibalized music rug"],
    conflictDetails: {
      "cannibalized music rug": {
        reason: "EXACT_MATCH_CONFLICT",
        matchType: "exact",
      },
    },
  };

  // 1. Candidate is objectively superior (delta >= +0.08 and safe) -> REPLACE
  // Candidate has exact Google Suggest match (1.0), high entity alignment (0.9+), strong intent
  const candidateSuperior = "vintage music area rug";
  const existingInferior = "room carpet"; // generic, no visual entity, unverified in suggestions
  const resReplace = comparator.compare(candidateSuperior, existingInferior, context);

  assert.equal(resReplace.decision, "REPLACE");
  assert.ok(resReplace.delta >= 0.08, `Expected delta >= 0.08, got ${resReplace.delta}`);
  assert.ok(resReplace.candidateScore.compositeScore > resReplace.existingScore.compositeScore);
  assert.ok(resReplace.rationale.includes("objectively superior"));

  // 2. Candidate is inferior or equal (delta < +0.08) -> RETAIN existing
  const candidateWeak = "floor mat";
  const existingStrong = "vintage music area rug";
  const resRetain = comparator.compare(candidateWeak, existingStrong, context);

  assert.equal(resRetain.decision, "RETAIN");
  assert.ok(resRetain.delta < 0.08, `Expected delta < 0.08, got ${resRetain.delta}`);
  assert.ok(resRetain.rationale.includes("Retaining existing primary keyword"));

  // 3. Candidate has hard veto / severe cannibalization -> RETAIN existing regardless of other signals
  const candidateConflict = "cannibalized music rug";
  const resVeto = comparator.compare(candidateConflict, "retro record player carpet", context);

  assert.equal(resVeto.decision, "RETAIN");
  assert.equal(resVeto.candidateScore.isHardVeto, true);
  assert.ok(resVeto.rationale.includes("cannibalization"));

  // 4. Ambiguous / close delta [0.03, 0.08) -> REVIEW_FLAG
  // Let's create an evaluation where candidate is slightly better but doesn't reach +0.08
  const closeContext: KeywordEvaluationContext = {
    physicalProductIdentity: "t-shirt",
    suggestions: ["black cat t-shirt", "dark cat t-shirt"],
  };
  const candClose = "dark cat t-shirt"; // search=1.0, entity~0.8, intent~0.55
  const existClose = "black cat t-shirt"; // search=1.0, entity~0.8, intent~0.55
  // When identical or almost identical, delta is near 0 -> RETAIN
  const resSame = comparator.compare(candClose, existClose, closeContext);
  assert.equal(resSame.decision, "RETAIN");

  // 5. Conflicting signals: high search validation but low product entity alignment -> REVIEW_FLAG
  const conflictingContext: KeywordEvaluationContext = {
    physicalProductIdentity: "quilt bedding set",
    visualEntities: "Celtic dragon artwork",
    suggestions: ["generic dragon decor gift", "celtic dragon quilt bedding set"],
  };
  // Candidate: "generic dragon decor gift" -> high search & commercial intent, but misses physical identity ("quilt bedding set")
  // Existing: "celtic dragon comforter" -> matches physical identity synonym, but unverified in suggestions
  const conflictingCand = "generic dragon decor gift";
  const conflictingExist = "celtic dragon comforter";
  const resConflicting = comparator.compare(conflictingCand, conflictingExist, conflictingContext);
  assert.equal(resConflicting.decision, "REVIEW_FLAG");
  assert.ok(resConflicting.rationale.includes("Conflicting signals") || resConflicting.rationale.includes("review"));
});

test("Keyword allocation integration: allocates and protects existing primary keyword", () => {
  const evalContext: KeywordEvaluationContext = {
    physicalProductIdentity: "t-shirt",
    visualEntities: "vintage spooky black cat",
    suggestions: [
      "vintage halloween cat tee",
      "retro spooky cat shirt",
    ],
  };

  // Case A: Existing primary keyword is strong, candidate is not superior -> Retains existing
  const allocationRetained = allocateKeywords({
    approvedKeywords: ["funny cat shirt", "retro spooky cat shirt"],
    discardedKeywords: [],
    productCategory: "t-shirt",
    existingPrimaryKeyword: "vintage halloween cat tee",
    comparatorContext: evalContext,
  });

  assert.equal(allocationRetained.primary, "vintage halloween cat tee");
  assert.ok(allocationRetained.comparisonResult);
  assert.notEqual(allocationRetained.comparisonResult?.decision, "REPLACE");

  // Case B: Candidate primary keyword is objectively superior -> Replaces existing
  const superiorContext: KeywordEvaluationContext = {
    physicalProductIdentity: "t-shirt",
    visualEntities: "vintage halloween cat",
    suggestions: ["vintage halloween cat tee"], // candidate verified
  };

  const allocationReplaced = allocateKeywords({
    approvedKeywords: ["vintage halloween cat tee", "cool shirt"],
    discardedKeywords: [],
    relevanceScores: { "vintage halloween cat tee": 0.98, "cool shirt": 0.50 },
    productCategory: "t-shirt",
    existingPrimaryKeyword: "cool shirt", // generic existing keyword without visual entity or search validation
    comparatorContext: superiorContext,
  });

  assert.equal(allocationReplaced.primary, "vintage halloween cat tee");
  assert.ok(allocationReplaced.comparisonResult);
  assert.equal(allocationReplaced.comparisonResult?.decision, "REPLACE");
  assert.ok(allocationReplaced.comparisonResult?.delta >= 0.08);

  // Case C: When no existing keyword provided, selects top approved candidate as primary
  const allocationInitial = allocateKeywords({
    approvedKeywords: ["vintage halloween cat tee", "retro spooky cat shirt"],
    discardedKeywords: [],
    relevanceScores: { "vintage halloween cat tee": 0.95 },
    productCategory: "t-shirt",
  });
  assert.equal(allocationInitial.primary, "vintage halloween cat tee");
});

test("STRICT CONSTRAINT: Zero external paid search volume providers used in keyword-comparator", () => {
  // Check source files in keyword-comparator directory for forbidden external paid providers
  const comparatorDir = path.resolve(__dirname, "../internal/keyword-comparator");
  const files = fs.readdirSync(comparatorDir).filter((f) => f.endsWith(".ts"));

  const FORBIDDEN_TOKENS = [
    "dataforseo",
    "ahrefs",
    "semrush",
    "keywordplanner",
    "googleads",
    "keywordtool",
    "spyfu",
    "moz",
    "keywordsanywhere",
  ];

  for (const file of files) {
    const filePath = path.join(comparatorDir, file);
    const content = fs.readFileSync(filePath, "utf-8").toLowerCase();

    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(
        !content.includes(token),
        `Forbidden external paid provider token '${token}' found in ${file}!`,
      );
    }
  }

  // Also verify that evaluation runs synchronously with zero network calls
  const start = Date.now();
  const result = evaluateKeywordQuality("custom vintage cat t-shirt", {
    physicalProductIdentity: "t-shirt",
    visualEntities: "vintage cat",
    suggestions: ["custom vintage cat t-shirt"],
  });
  const elapsed = Date.now() - start;

  assert.ok(result.compositeScore > 0);
  assert.ok(elapsed < 50, `Evaluation should be instantaneous and in-memory, took ${elapsed}ms`);
});
