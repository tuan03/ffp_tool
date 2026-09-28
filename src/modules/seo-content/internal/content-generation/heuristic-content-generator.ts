import type {
  ContentFactSheet,
  ContentGenerationInput,
  ContentGenerator,
  GeneratedBullet,
  GeneratedContentDraft,
  GeneratedFaqItem,
  GeneratedStyleOption,
  KeywordAllocation,
} from "./content-generation-types";
import { fitProductTitle, fitSeoDescription, fitSeoTitle, toTitleCase } from "./content-fitters";
import { findUnsupportedClaimsInText } from "./claim-guard";
import {
  buildHeuristicProductTitle,
  extractVisionDesignConcept,
} from "./heuristic-title-builder";
import { buildJsonLdSchema } from "./json-ld-builder";
import { sanitizeBeddingTitle } from "../store-profiles";

const PLACEHOLDER_PATTERN =
  /^(unknown|none|n\/a|not applicable|unspecified|sample|test|sku.*)[\s.]*$/i;

function isMeaningfulText(text?: string): text is string {
  if (!text) return false;
  const clean = text.trim();
  return clean.length > 0 && !PLACEHOLDER_PATTERN.test(clean);
}

/**
 * Generates a concise, fact-dense 40-70 word summary highlighting specific design entities,
 * materials, dimensions, and ideal use cases for AI search overviews (ChatGPT Search, Perplexity).
 */
export function buildHeuristicAiQuickSummary(
  facts: ContentFactSheet,
  productTitle: string,
): string {
  if (facts.storeProfile?.bedding) {
    const variantClause = facts.variantLabel ? ` in the ${facts.variantLabel} design` : "";
    const visualText = isMeaningfulText(facts.visualEntities)
      ? ` featuring ${facts.visualEntities.trim()}`
      : "";
    const audience = facts.targetAudience.length > 0 ? facts.targetAudience[0] : "bedding and home decor enthusiasts";
    return `The ${productTitle} is a premium bedding collection${variantClause}${visualText} designed for ${audience}. Available in three distinct style options—plush Comforter, lightweight classic Quilt, or convenient zippered Duvet Cover—it features ultra-soft brushed microfiber and vibrant dye-sublimation print for all-season comfort and easy care.`;
  }

  const identity = isMeaningfulText(facts.physicalProductIdentity)
    ? facts.physicalProductIdentity.trim()
    : isMeaningfulText(facts.niche)
      ? facts.niche.trim()
      : "specialty item";
  const entityText = isMeaningfulText(facts.visualEntities)
    ? `featuring ${facts.visualEntities.trim()}`
    : "";
  const typographyText = facts.typographyVisibleTexts.filter((t) => isMeaningfulText(t)).length > 0
    ? `with printed '${facts.typographyVisibleTexts.filter((t) => isMeaningfulText(t))[0]}' lettering`
    : "";
  const stylePart = [entityText, typographyText].filter(Boolean).join(" ");
  const audience = facts.targetAudience.length > 0 ? facts.targetAudience[0] : "home and lifestyle enthusiasts";
  const useCase = facts.useCases.length > 0 ? facts.useCases[0] : "daily decorative and functional use";
  const occasion = facts.occasions.length > 0 ? ` or special ${facts.occasions[0]} gifting` : "";
  const variantClause = facts.variantLabel ? ` in the exclusive ${facts.variantLabel} edition` : "";

  return `The ${productTitle} is a distinctive ${identity}${variantClause} crafted for ${audience}. Carefully engineered ${stylePart ? `${stylePart}, ` : ""}it combines durable construction with distinctive themed artwork. Ideal for ${useCase}${occasion}, offering balanced performance, easy maintenance, and standout visual appeal for modern spaces.`;
}

/**
 * Builds 4 strategic Q&A pairs (Q1: pre-purchase intent; Q2: usability/durability;
 * Q3: customization or care; Q4: USP differentiation).
 */
export function buildHeuristicFaq(
  facts: ContentFactSheet,
  productTitle: string,
): readonly GeneratedFaqItem[] {
  if (facts.storeProfile?.bedding) {
    const q1 = "What is the difference between the Comforter, Quilt, and Duvet Cover options?";
    const a1 =
      "The Comforter provides thick, plush all-season warmth with fluffy batting fill. The Quilt is a lightweight coverlet with classic diamond stitching, perfect for warm months or layering. The Duvet Cover is a soft protective casing with a hidden zipper and interior corner ties to securely encase your existing insert.";

    const q2 = "Is this bedding set suitable for year-round, all-season comfort?";
    const a2 =
      "Yes. Crafted from premium breathable microfiber, it delivers cozy warmth in cooler months and comfortable airflow during warmer seasons.";

    let q3: string;
    let a3: string;
    if (facts.personalizationSupported) {
      q3 = "Can I personalize or customize this bedding set?";
      a3 =
        "Yes. Personalization options allow you to tailor specific names, dates, or custom details, creating a truly unique keepsake or personalized gift.";
    } else {
      q3 = "How should this bedding set be cleaned and cared for?";
      a3 = `${facts.storeProfile.bedding.careGuidance}. Crafted from ${facts.storeProfile.bedding.fabricMaterial}, the thermal dye-sublimation print maintains vibrant, fade-resistant color wash after wash.`;
    }

    const variantTag = facts.variantLabel ? ` (${facts.variantLabel})` : "";
    const q4 = `What makes this ${facts.physicalProductIdentity || "bedding set"}${variantTag} unique?`;
    const visualText =
      facts.visualEntities && !/^(unknown|none|n\/a|not applicable)[\s.]*$/i.test(facts.visualEntities.trim())
        ? `detailed ${facts.visualEntities.trim()}`
        : "original graphic composition";
    const a4 = `Unlike generic mass-market bedding, this edition features ${visualText}${facts.variantLabel ? ` in the signature ${facts.variantLabel} design` : ""}, paired with verified materials and focused craftsmanship for long-term appeal.`;

    return [
      { question: q1, answer: a1 },
      { question: q2, answer: a2 },
      { question: q3, answer: a3 },
      { question: q4, answer: a4 },
    ];
  }

  const catName = facts.physicalProductIdentity || facts.niche || "item";
  const primaryUseCase = facts.useCases.length > 0
    ? facts.useCases[0]
    : facts.occasions.length > 0
      ? `${facts.occasions[0]} gifting`
      : "daily use";

  // Q1: Pre-purchase intent / How-to-choose
  const q1 = `How do I choose the right ${catName} for ${primaryUseCase}?`;
  const a1 = `When selecting a ${catName}, evaluate your space dimensions, preferred artwork aesthetic, and material durability. This ${productTitle} features verified construction and distinctive styling, making it an ideal choice for ${primaryUseCase}.`;

  // Q2: Usability / Durability adapted to category
  const catCorpus = `${facts.physicalProductIdentity || ""} ${facts.niche || ""} ${facts.originalTitle}`.toLowerCase();
  let q2 = `Is this ${catName} suitable for everyday use?`;
  let a2 = `Yes. Engineered with durable, high-quality materials, it is built to maintain structural integrity and color vibrancy through regular everyday use.`;

  if (/rug|mat|carpet/i.test(catCorpus)) {
    q2 = `Is this ${catName} suitable for high-traffic areas and busy households?`;
    a2 = `Yes. It features a low-pile, resilient surface designed to withstand regular foot traffic while remaining easy to vacuum and position securely.`;
  } else if (/bedding|quilt|blanket|duvet|comforter/i.test(catCorpus)) {
    q2 = `Is this ${catName} suitable for year-round, all-season comfort?`;
    a2 = `Yes. Its balanced, breathable fabric construction delivers cozy warmth in cooler months and comfortable airflow during warmer seasons.`;
  } else if (/bag|backpack|tote/i.test(catCorpus)) {
    q2 = `Is this ${catName} sturdy enough for heavy everyday carry and commuting?`;
    a2 = `Yes. Built with reinforced stress points and durable stitching, it comfortably handles daily essentials, electronics, and commute gear.`;
  } else if (/shirt|hoodie|apparel|clothing|sweatshirt/i.test(catCorpus)) {
    q2 = `Is this ${catName} comfortable for all-day wear and regular washing?`;
    a2 = `Yes. Crafted from soft, breathable fabric with colorfast printing that maintains shape and graphic clarity after repeated wash cycles.`;
  }

  // Q3: Conditional Customization OR Care / Sizing
  let q3: string;
  let a3: string;
  if (facts.personalizationSupported) {
    q3 = `Can I personalize or customize this ${catName}?`;
    a3 = `Yes. Personalization options allow you to tailor specific names, dates, or custom details, creating a truly unique keepsake or personalized gift.`;
  } else {
    q3 = `What is included with this ${catName}, and how should it be cleaned and maintained?`;
    const careMention = /dry\s*clean/i.test(facts.originalDescription)
      ? "Follow care instructions: dry clean only as recommended to maintain fabric and print quality."
      : /wash|clean|wipe/i.test(facts.originalDescription)
        ? "Follow care guidelines: wash cold on gentle cycle or wipe clean, and air dry to maintain material quality."
        : "For best longevity, spot clean or machine wash cold on a gentle cycle and lay flat or tumble dry low. Avoid bleach.";
    a3 = `This package includes the standard ${catName} specification. ${careMention}`;
  }

  // Q4: USP Differentiation
  const variantTag = facts.variantLabel ? ` (${facts.variantLabel})` : "";
  const q4 = `What makes this ${catName}${variantTag} different from similar products?`;
  const visualText = facts.visualEntities && !/^(unknown|none|n\/a|not applicable)[\s.]*$/i.test(facts.visualEntities.trim())
    ? `detailed ${facts.visualEntities.trim()}`
    : "original graphic composition";
  const a4 = `Unlike generic mass-market alternatives, this edition features ${visualText}${facts.variantLabel ? ` in the signature ${facts.variantLabel} design` : ""}, paired with verified materials and focused craftsmanship for long-term appeal.`;

  return [
    { question: q1, answer: a1 },
    { question: q2, answer: a2 },
    { question: q3, answer: a3 },
    { question: q4, answer: a4 },
  ];
}

/**
 * Builds a Schema.org compliant JSON-LD string combining Product and FAQPage.
 */
export function buildHeuristicJsonLd(
  draft: { readonly productTitle: string; readonly productSeoDescription: string },
  faqItems: readonly GeneratedFaqItem[],
): string {
  return buildJsonLdSchema({
    productTitle: draft.productTitle,
    description: draft.productSeoDescription,
    faq: faqItems,
  });
}

/**
 * Builds a compliant SEO meta description for bedding products with 3 available styles
 * (Comforter, Quilt, Duvet Cover), guaranteeing mandatory keywords and strict <= maxLength length.
 */
export function buildBeddingSeoDescription(
  productTitle: string,
  designConcept: string | undefined,
  maxLength: number = 160,
): string {
  const sanitizedTitle = sanitizeBeddingTitle(productTitle);
  const optionsPhrase = "Available in Comforter, Quilt, or Duvet Cover styles.";
  const designText = designConcept ? ` featuring ${designConcept}` : "";
  const cleanedTitle = sanitizedTitle.replace(/\s+/g, " ").trim();

  const features = [
    "Crafted from premium ultra-soft brushed microfiber with vibrant thermal dye-sublimation print",
    "Crafted from premium ultra-soft microfiber with vibrant thermal dye-sublimation print",
    "Crafted from premium ultra-soft microfiber with vibrant thermal sublimation print",
    "Crafted from premium ultra-soft microfiber with vibrant fade-resistant print",
    "Crafted from ultra-soft breathable microfiber with vibrant fade-resistant print",
    "Crafted from premium ultra-soft microfiber with vibrant fade-resistant colors",
    "Crafted from premium ultra-soft microfiber with vibrant colors and easy care",
    "Crafted from premium microfiber with vibrant fade-resistant colors",
    "Crafted from premium microfiber with vibrant colors and easy care",
    "Crafted from ultra-soft microfiber with vivid long-lasting colors",
    "Crafted from premium microfiber with vibrant fade-resistant print",
    "Crafted from premium ultra-soft microfiber with vibrant colors",
    "Crafted from premium breathable microfiber with vibrant print",
    "Crafted from ultra-soft microfiber with vibrant durable print",
    "Crafted from ultra-soft breathable microfiber for all seasons",
    "Crafted from ultra-soft microfiber with vibrant colors",
    "Crafted from premium microfiber with vivid colors",
    "Ultra-soft breathable microfiber with vivid print",
    "Premium ultra-soft microfiber with vivid print",
    "Ultra-soft microfiber for all-season comfort",
    "Ultra-soft microfiber with vibrant print",
    "Soft breathable microfiber construction",
    "Premium microfiber with vibrant colors",
    "Ultra-soft microfiber fabric",
    "Soft breathable microfiber",
    "Premium microfiber fabric",
    "Fade-resistant print",
    "All-season comfort",
    "",
  ];

  const ctas = [
    "Perfect for your master bedroom or guest room. Shop online today!",
    "Perfect for your bedroom decor. Designed for all-season comfort. Shop now!",
    "Perfect for your bedroom decor with vibrant detail. Shop now!",
    "Designed for cozy all-season comfort and easy care. Shop now!",
    "Perfect for your bedroom decor. Shop online today!",
    "Elevate your bedroom decor today. Shop now!",
    "Easy machine wash care. Shop online today!",
    "Perfect for bedroom decor. Shop now!",
    "Designed for cozy comfort. Shop now!",
    "Ideal for any bedroom. Shop now!",
    "Easy machine care. Shop now!",
    "Order yours today!",
    "Shop online today!",
    "Shop online now!",
    "Shop today!",
    "Shop now!",
  ];

  const minTarget = Math.min(155, Math.max(120, maxLength - 5));

  const subjects: string[] = [];
  if (designText) {
    subjects.push(`${cleanedTitle}${designText}`);
  }
  subjects.push(cleanedTitle);

  // Add progressively shortened word-boundary titles for long titles
  const words = cleanedTitle.split(" ");
  for (let i = words.length - 1; i >= 1; i--) {
    const sub = words.slice(0, i).join(" ").trim().replace(/[,.-]$/, "");
    if (sub.length >= 8 && !subjects.includes(sub)) {
      subjects.push(sub);
    }
  }

  // 1. Try to find a combination strictly in [minTarget, maxLength]
  for (const subject of subjects) {
    const prefix = `Discover this ${subject}. ${optionsPhrase}`;
    for (const feat of features) {
      for (const cta of ctas) {
        const mid = feat ? ` ${feat}.` : "";
        const end = ` ${cta}`;
        const candidate = `${prefix}${mid}${end}`;
        if (
          candidate.length >= minTarget &&
          candidate.length <= maxLength &&
          candidate.includes("Comforter") &&
          candidate.includes("Quilt") &&
          candidate.includes("Duvet Cover")
        ) {
          return candidate;
        }
      }
    }
  }

  // 2. Fallback: closest <= maxLength that has all 3 keywords
  let bestCandidate = "";
  for (const subject of subjects) {
    const prefix = `Discover this ${subject}. ${optionsPhrase}`;
    for (const feat of features) {
      for (const cta of ctas) {
        const mid = feat ? ` ${feat}.` : "";
        const end = ` ${cta}`;
        const candidate = `${prefix}${mid}${end}`;
        if (
          candidate.length <= maxLength &&
          candidate.includes("Comforter") &&
          candidate.includes("Quilt") &&
          candidate.includes("Duvet Cover") &&
          candidate.length > bestCandidate.length
        ) {
          bestCandidate = candidate;
        }
      }
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  const standardSuffix = " Premium microfiber fabric with vivid print. Shop now!";
  const reserved = `Discover this . ${optionsPhrase}${standardSuffix}`.length;
  const availForTitle = Math.max(10, maxLength - reserved);
  const shortenedTitle = cleanedTitle.slice(0, availForTitle).trim().replace(/[,.-]$/, "");
  const fallback = `Discover this ${shortenedTitle}. ${optionsPhrase}${standardSuffix}`;
  return fallback.length > maxLength ? fallback.slice(0, maxLength) : fallback;
}

/**
 * Deterministic, offline rule-based copywriting generator.
 * Zero external network calls. Produces clean, highly grounded e-commerce content.
 */
export class HeuristicContentGenerator implements ContentGenerator {
  async generate(input: ContentGenerationInput): Promise<GeneratedContentDraft> {
    const { facts, keywords, constraints } = input;
    const isGroundedKeyword = (keyword: string): boolean =>
      findUnsupportedClaimsInText(keyword, facts).length === 0;
    const groundedKeywords: KeywordAllocation = {
      primary: keywords.primary && isGroundedKeyword(keywords.primary)
        ? keywords.primary
        : undefined,
      secondary: keywords.secondary.filter(isGroundedKeyword),
      supportingKeywords: keywords.supportingKeywords.filter(isGroundedKeyword),
      framingConcepts: keywords.framingConcepts.filter(isGroundedKeyword),
      targetedKeywords: keywords.targetedKeywords.filter(isGroundedKeyword),
    };

    // 1. Build Product Title (Preserve -> Enrich -> Rebuild policy)
    let productTitle = buildHeuristicProductTitle({
      facts,
      keywords: groundedKeywords,
      maxLength: 80,
    });
    if (facts.storeProfile?.bedding) {
      productTitle = sanitizeBeddingTitle(productTitle);
    }

    // 2. Build Intro
    const category = isMeaningfulText(facts.physicalProductIdentity)
      ? facts.physicalProductIdentity.trim()
      : isMeaningfulText(facts.niche)
        ? facts.niche.trim()
        : "item";
    const entityClause = isMeaningfulText(facts.visualEntities)
      ? ` featuring ${facts.visualEntities.trim()}`
      : "";
    const styleClause = isMeaningfulText(facts.typographyStyleSummary)
      ? ` with ${facts.typographyStyleSummary.trim()}`
      : "";

    const intro = `Elevate your collection with this distinctive ${category}${entityClause}${styleClause}. Carefully designed to combine character, visual appeal, and everyday functionality.`;

    // 3. Build Bullets
    const bullets: GeneratedBullet[] = [];

    // Optional style options for bedding profile
    const styleOptions: readonly GeneratedStyleOption[] | undefined = facts.storeProfile?.bedding
      ? facts.storeProfile.bedding.options.map((opt) => ({
          name: opt.name,
          description: `${opt.shortDescription} - ${opt.detailedFeatures}`,
        }))
      : undefined;

    // Dedicated material and print specifications for bedding profile
    if (facts.storeProfile?.bedding) {
      bullets.push({
        label: "Materials",
        text: facts.storeProfile.bedding.fabricMaterial,
      });
      bullets.push({
        label: "Print",
        text: facts.storeProfile.bedding.printTechnology,
      });
    }

    // Bullet: Design / Art
    const hasMeaningfulVisual = isMeaningfulText(facts.visualEntities);
    const hasMeaningfulStyle = isMeaningfulText(facts.typographyStyleSummary);
    if (hasMeaningfulVisual || hasMeaningfulStyle) {
      const entityText = hasMeaningfulVisual
        ? `showcasing ${facts.visualEntities.trim()}`
        : "with verified design details";
      bullets.push({
        label: "Design",
        text: `Features expressive artwork ${entityText}, crafted to stand out.`,
      });
    } else {
      bullets.push({
        label: "Design",
        text: `Thoughtfully composed visual details and clean proportions tailored for the ${category}.`,
      });
    }

    // Bullet: Style & Fit
    if (bullets.length < constraints.maxBullets) {
      const secondaryClause =
        groundedKeywords.secondary.length > 0
          ? `Ideal choice for ${groundedKeywords.secondary[0]}.`
          : `A versatile statement piece that complements a wide range of settings.`;

      const styleLead = hasMeaningfulStyle
        ? `${toTitleCase(styleClause.trim())}. `
        : "";

      bullets.push({
        label: "Style",
        text: `${styleLead}${secondaryClause}`,
      });
    }

    // Bullet: Personalization (if explicitly supported)
    if (facts.personalizationSupported && bullets.length < constraints.maxBullets) {
      bullets.push({
        label: "Personalization",
        text: "Customizable with custom details, making it truly unique for yourself or a loved one.",
      });
    }

    // Bullet: Variant / Option (if present)
    if (facts.variantLabel && bullets.length < constraints.maxBullets) {
      bullets.push({
        label: "Option",
        text: `Features the distinct "${facts.variantLabel}" style and artwork.`,
      });
    }

    // Bullet: Made for / Audience & Occasions
    const audience = facts.targetAudience.length > 0 ? facts.targetAudience[0] : "enthusiasts";
    const occasion = facts.occasions.length > 0 ? ` during ${facts.occasions[0]}` : "";
    if (bullets.length < constraints.maxBullets) {
      bullets.push({
        label: "Made for",
        text: `A memorable gift or personal accent for ${audience}${occasion}.`,
      });
    }

    // Bullet: Use Case (if space permits)
    if (facts.useCases.length > 0 && bullets.length < constraints.maxBullets) {
      bullets.push({
        label: "Use",
        text: `Perfect for ${facts.useCases.slice(0, 2).join(" as well as ")}.`,
      });
    }

    // 4. Build Guidance (only if grounded in source description or store profile)
    const guidance: string[] = [];
    if (facts.storeProfile?.bedding?.careGuidance) {
      guidance.push(facts.storeProfile.bedding.careGuidance);
    }
    if (/wash|clean|wipe|hand wash/i.test(facts.originalDescription)) {
      if (!guidance.some((g) => /wash|clean/i.test(g))) {
        guidance.push("Wipe clean or follow specific garment care guidelines.");
      }
    }

    // 5. Build Closing
    const closing = facts.storeProfile?.bedding
      ? "Whether choosing the plush warmth of a Comforter, the classic stitched style of a Quilt, or the versatile casing of a Duvet Cover, this bedding set offers the ideal balance of comfort, quality, and distinctive style."
      : `Whether buying for yourself or searching for a memorable gift, this ${category} offers the perfect blend of distinctive styling and reliable everyday enjoyment.`;

    let rawSeoTitle: string;
    if (groundedKeywords.primary) {
      const primaryTitle = toTitleCase(groundedKeywords.primary);
      const visionConcept = extractVisionDesignConcept(facts);
      let distinctiveSuffix: string | undefined;
      if (visionConcept) {
        let firstPart = visionConcept.split(/[.;&]/)[0].trim();
        // Remove words already present in primary keyword to avoid "Viking ... Viking"
        const primaryWords = groundedKeywords.primary.toLowerCase().split(/\s+/);
        for (const pw of primaryWords) {
          if (pw.length > 2) {
            const reg = new RegExp(`(^|\\s)${pw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
            firstPart = firstPart.replace(reg, " ").replace(/\s{2,}/g, " ").trim();
          }
        }
        firstPart = firstPart.replace(/\s+(with|and|or|for|of|in|at|by|on)$/i, "").trim();
        if (firstPart.length > 28) {
          const sliced = firstPart.slice(0, 28);
          const lastSpace = sliced.lastIndexOf(" ");
          firstPart = lastSpace > 10 ? sliced.slice(0, lastSpace).trim() : sliced.trim();
          firstPart = firstPart.replace(/\s+(with|and|or|for|of|in|at|by|on)$/i, "").trim();
        }
        distinctiveSuffix = firstPart || undefined;
      }
      if (!distinctiveSuffix) {
        distinctiveSuffix = facts.variantLabel;
      }

      if (
        distinctiveSuffix &&
        !primaryTitle.toLowerCase().includes(distinctiveSuffix.toLowerCase())
      ) {
        rawSeoTitle = `${primaryTitle} - ${distinctiveSuffix} | Shop Online`;
      } else {
        rawSeoTitle = `${primaryTitle} | Quality & Style`;
      }
    } else {
      rawSeoTitle = `${productTitle} | Shop Online`;
    }
    let productSeoTitle = fitSeoTitle(
      rawSeoTitle,
      groundedKeywords.primary,
      constraints.maxSeoTitleLength,
    );
    if (facts.storeProfile?.bedding) {
      productSeoTitle = sanitizeBeddingTitle(productSeoTitle);
    }

    // 7. Build SEO Description (<= 160 chars)
    let productSeoDescription: string;
    if (facts.storeProfile?.bedding) {
      const designConcept = extractVisionDesignConcept(facts);
      productSeoDescription = buildBeddingSeoDescription(
        productTitle,
        designConcept,
        constraints.maxSeoDescriptionLength,
      );
    } else {
      const audienceFrag = facts.targetAudience.length > 0 ? ` for ${facts.targetAudience[0]}` : "";
      const primaryFrag = groundedKeywords.primary
        ? groundedKeywords.primary
        : productTitle.toLowerCase();
      const variantFrag = facts.variantLabel ? ` (${facts.variantLabel})` : "";
      const rawSeoDesc = `Discover this ${primaryFrag}${variantFrag}${audienceFrag}. Distinctive design, premium look, and everyday functionality. Shop now!`;
      productSeoDescription = fitSeoDescription(rawSeoDesc, constraints.maxSeoDescriptionLength);
    }

    // 8. Build AEO Suite (AI Quick Summary, Strategic FAQ, JSON-LD Schema)
    const aeo_quick_summary = buildHeuristicAiQuickSummary(facts, productTitle);
    const aeo_faq = buildHeuristicFaq(facts, productTitle);
    const aeo_json_ld = buildHeuristicJsonLd(
      { productTitle, productSeoDescription },
      aeo_faq,
    );

    return {
      productTitle,
      intro,
      bullets,
      guidance,
      closing,
      productSeoTitle,
      productSeoDescription,
      ...(styleOptions ? { styleOptions } : {}),
      aeo_quick_summary,
      aeo_faq,
      aeo_json_ld,
    };
  }
}
