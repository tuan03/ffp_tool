import type { ContentFactSheet, GeneratedContentDraft } from "./content-generation-types";

/**
 * Known high-risk objective claims that must be strictly grounded in factual source data.
 */
export const HIGH_RISK_CLAIM_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /\b(genuine|real|authentic)\s+leather\b/i, label: "genuine leather" },
  { pattern: /\bwaterproof\b/i, label: "waterproof" },
  { pattern: /\bwater\s+resistant\b/i, label: "water resistant" },
  { pattern: /\bmachine\s+washable\b/i, label: "machine washable" },
  { pattern: /\bhand-?made\b/i, label: "handmade" },
  { pattern: /\bhand-?crafted\b/i, label: "handcrafted" },
  { pattern: /\beco-?friendly\b/i, label: "eco-friendly" },
  { pattern: /\bsustainable\b/i, label: "sustainable" },
  { pattern: /\bhypoallergenic\b/i, label: "hypoallergenic" },
  { pattern: /\bnon-?toxic\b/i, label: "non-toxic" },
  { pattern: /\bscratch\s+resistant\b/i, label: "scratch resistant" },
  { pattern: /\buv\s+resistant\b/i, label: "uv resistant" },
  { pattern: /\bmade\s+in\s+usa\b/i, label: "made in usa" },
  { pattern: /\bfree\s+shipping\b/i, label: "free shipping" },
  { pattern: /\bfast\s+shipping\b/i, label: "fast shipping" },
  { pattern: /\b(lifetime|money-?back)\s+warranty\b/i, label: "warranty guarantee" },
  { pattern: /\bmoney-?back\s+guarantee\b/i, label: "money-back guarantee" },
];

const PERSONALIZATION_CLAIMS = [
  /\bpersonalized\b/i,
  /\bpersonalised\b/i,
  /\bcustomizable\b/i,
  /\bcustomisable\b/i,
  /\badd\s+your\s+name\b/i,
  /\bupload\s+your\s+photo\b/i,
  /\bcustom\s+photo\b/i,
  /\bcustom\s+name\b/i,
];

function buildFactualCorpus(facts: ContentFactSheet): string {
  const pieces = [
    facts.originalTitle,
    facts.originalDescription,
    facts.niche ?? "",
    facts.productCategory ?? "",
    ...facts.ocrTexts,
    ...facts.entities,
  ];
  return pieces.join(" ").toLowerCase();
}

/**
 * Checks a GeneratedContentDraft against high-risk claims and grounding rules.
 * Returns an array of detected violation descriptions. Empty array means PASS.
 */
export function checkClaimGrounding(
  draft: GeneratedContentDraft,
  facts: ContentFactSheet,
): readonly string[] {
  const violations: string[] = [];
  const factualCorpus = buildFactualCorpus(facts);

  const generatedText = [
    draft.productTitle,
    draft.intro,
    ...draft.bullets.map((b) => `${b.label} ${b.text}`),
    ...draft.guidance,
    draft.closing,
    draft.productSeoTitle,
    draft.productSeoDescription,
  ]
    .join(" ")
    .toLowerCase();

  // 1. High-risk material and service claims
  for (const { pattern, label } of HIGH_RISK_CLAIM_PATTERNS) {
    if (pattern.test(generatedText) && !pattern.test(factualCorpus)) {
      violations.push(`Unsupported claim: '${label}' not present in product source facts`);
    }
  }

  // 2. Personalization claim when not supported
  if (!facts.personalizationSupported) {
    for (const pattern of PERSONALIZATION_CLAIMS) {
      if (pattern.test(generatedText)) {
        violations.push(
          "Unsupported personalization claim: product does not support custom/personalized attributes",
        );
        break;
      }
    }
  }

  // 3. Fabric composition percentages (e.g. 100% cotton) when not in source
  const percentageMatches = generatedText.match(/\b\d{2,3}%\s+[a-z]+/gi);
  if (percentageMatches) {
    for (const match of percentageMatches) {
      if (!factualCorpus.includes(match.toLowerCase())) {
        violations.push(`Unsupported numeric claim: '${match}' not found in source`);
      }
    }
  }

  return violations;
}
