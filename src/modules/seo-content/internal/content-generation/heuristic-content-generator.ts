import type {
  ContentGenerationInput,
  ContentGenerator,
  GeneratedBullet,
  GeneratedContentDraft,
} from "./content-generation-types";
import { fitProductTitle, fitSeoDescription, fitSeoTitle, toTitleCase } from "./content-fitters";

import { buildHeuristicProductTitle } from "./heuristic-title-builder";

/**
 * Deterministic, offline rule-based copywriting generator.
 * Zero external network calls. Produces clean, highly grounded e-commerce content.
 */
export class HeuristicContentGenerator implements ContentGenerator {
  async generate(input: ContentGenerationInput): Promise<GeneratedContentDraft> {
    const { facts, keywords, constraints } = input;

    // 1. Build Product Title (Preserve -> Enrich -> Rebuild policy)
    const productTitle = buildHeuristicProductTitle({
      facts,
      keywords,
      maxLength: 80,
    });

    // 2. Build Intro
    const category = facts.physicalProductIdentity || "item";
    const entityClause = facts.visualEntities ? ` featuring ${facts.visualEntities}` : "";
    const styleClause = facts.typographyStyleSummary ? ` with ${facts.typographyStyleSummary}` : "";

    const intro = `Elevate your collection with this distinctive ${category}${entityClause}${styleClause}. Carefully designed to combine character, visual appeal, and everyday functionality.`;

    // 3. Build Bullets
    const bullets: GeneratedBullet[] = [];

    // Bullet 1: Design / Art
    if (facts.visualEntities || facts.typographyStyleSummary) {
      const entityText = facts.visualEntities ? `showcasing ${facts.visualEntities}` : "with verified design details";
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

    // Bullet 2: Style & Fit
    const secondaryClause =
      keywords.secondary.length > 0
        ? `Ideal choice for ${keywords.secondary[0]}.`
        : `A versatile statement piece that complements a wide range of settings.`;

    bullets.push({
      label: "Style",
      text: `${styleClause ? toTitleCase(styleClause.trim()) + ". " : ""}${secondaryClause}`,
    });

    // Bullet 3: Personalization (if explicitly supported)
    if (facts.personalizationSupported) {
      bullets.push({
        label: "Personalization",
        text: "Customizable with custom details, making it truly unique for yourself or a loved one.",
      });
    }

    // Bullet 4: Made for / Audience & Occasions
    const audience = facts.targetAudience.length > 0 ? facts.targetAudience[0] : "enthusiasts";
    const occasion = facts.occasions.length > 0 ? ` during ${facts.occasions[0]}` : "";
    bullets.push({
      label: "Made for",
      text: `A memorable gift or personal accent for ${audience}${occasion}.`,
    });

    // Bullet 5: Use Case (if space permits)
    if (facts.useCases.length > 0 && bullets.length < constraints.maxBullets) {
      bullets.push({
        label: "Use",
        text: `Perfect for ${facts.useCases.slice(0, 2).join(" as well as ")}.`,
      });
    }

    // 4. Build Guidance (only if grounded in source description)
    const guidance: string[] = [];
    if (/wash|clean|wipe|hand wash/i.test(facts.originalDescription)) {
      guidance.push("Wipe clean or follow specific garment care guidelines.");
    }

    // 5. Build Closing
    const closing = `Whether buying for yourself or searching for a memorable gift, this ${category} offers the perfect blend of distinctive styling and reliable everyday enjoyment.`;

    // 6. Build SEO Title (<= 70 chars)
    const rawSeoTitle = keywords.primary
      ? `${toTitleCase(keywords.primary)} | Quality & Style`
      : `${productTitle} | Shop Online`;
    const productSeoTitle = fitSeoTitle(rawSeoTitle, keywords.primary, constraints.maxSeoTitleLength);

    // 7. Build SEO Description (<= 160 chars)
    const audienceFrag = facts.targetAudience.length > 0 ? ` for ${facts.targetAudience[0]}` : "";
    const primaryFrag = keywords.primary ? keywords.primary : productTitle.toLowerCase();
    const rawSeoDesc = `Discover this ${primaryFrag}${audienceFrag}. Distinctive design, premium look, and everyday functionality. Shop now!`;
    const productSeoDescription = fitSeoDescription(rawSeoDesc, constraints.maxSeoDescriptionLength);

    return {
      productTitle,
      intro,
      bullets,
      guidance,
      closing,
      productSeoTitle,
      productSeoDescription,
    };
  }
}
