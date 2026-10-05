/**
 * FFP Ads Intelligence — Production Creative Brief Generator
 * Ticket: FFP-ADS-015
 * Generates 12-section production-ready creative briefs from DecisionCards or CreativeGaps
 * adhering strictly to docs/ads-intelligence/README.md Step 15.
 */

import type {
  CreativeBrief,
  CreativeBriefStoryboardScene,
  CreativeBriefReference,
  DecisionCard,
  CreativeGap,
  StoreAdsProfile,
  AdsHierarchyAd,
  CompetitorHookType,
  CompetitorVisualStyle,
  CompetitorMediaType,
} from "./types";

function generateBriefId(storeId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `brief_${storeId}_${ts}_${rand}`;
}

export function generateBriefFromDecision(
  storeId: string,
  decision: DecisionCard,
  storeProfile: StoreAdsProfile,
  controlAd?: AdsHierarchyAd,
): CreativeBrief {
  const targetCpa = storeProfile.business.targetCpa ?? 25.0;
  const budgetCap = storeProfile.budgets.experimentAuthorizedCap ?? 50.0;
  const targetProduct = storeId === "chillgen"
    ? {
        name: "Ergonomic Lumbar Cushion Pro",
        targetMarket: "US (Remote Workers & Commuters)",
        offer: "Buy 1 Get 1 20% OFF + Free Ergonomic Posture Guide",
        landingPageUrl: "https://chillgen.com/products/lumbar-cushion-pro",
        priceUsd: 49.99,
      }
    : storeId === "jeminise"
    ? {
        name: "Minimalist Celestial Jewelry Set",
        targetMarket: "US (Gen-Z & Millennial Gift Shoppers)",
        offer: "Complimentary Luxury Gift Box with orders over $60",
        landingPageUrl: "https://jeminise.com/collections/celestial",
        priceUsd: 38.0,
      }
    : {
        name: "Nordic Minimalist Ceramic Vase",
        targetMarket: "US (Home Decor Enthusiasts)",
        offer: "Bundle & Save 15% on 2+ Vases",
        landingPageUrl: "https://wrydeco.com/collections/vases",
        priceUsd: 45.0,
      };

  const adName = decision.entity.name;
  const isFatigue = decision.decision === "TEST_CREATIVE";

  const hookAngle = isFatigue
    ? "Pattern Interrupt: Why your back still aches despite buying a $500 chair"
    : "Social Proof: Over 12,000 office workers switched to this posture reset in 2026";

  const hookType: CompetitorHookType = isFatigue ? "PROBLEM_AGITATION" : "SOCIAL_PROOF";
  const visualStyle: CompetitorVisualStyle = "UGC_LOFI";
  const format: CompetitorMediaType = "VIDEO";

  const storyboard: CreativeBriefStoryboardScene[] = [
    {
      timestamp: "0:00 - 0:03",
      scene: "Hook (Pattern Interrupt)",
      visualAction: "Close-up selfie camera of creator rubbing lower back in frustration at desk; sudden audio scratch.",
      audioVoiceover: "Stop buying expensive office chairs. Your lower spine doesn't need more foam, it needs active curvature support.",
      onScreenText: "🚨 The $500 desk chair trap",
      isNewIdea: true,
    },
    {
      timestamp: "0:04 - 0:12",
      scene: "Problem Agitation & Demonstration",
      visualAction: "Split screen showing slouching spine without support vs instantaneous posture realignment when placing cushion.",
      audioVoiceover: "When you sit for 8 hours without lumbar lock, your L4-L5 vertebrae bear 200% bodyweight pressure. Watch what happens here.",
      onScreenText: "Normal posture vs Active Lumbar Lock",
      isNewIdea: false,
    },
    {
      timestamp: "0:13 - 0:22",
      scene: "Product Truth & Micro-Demo",
      visualAction: "Hands pressing memory foam rebound; creator sliding cushion onto car seat and office chair seamlessly.",
      audioVoiceover: "High-density heat-responsive memory foam that never goes flat, wrapped in breathable athletic mesh.",
      onScreenText: "Zero-sag memory core • Breathable mesh",
      isNewIdea: true,
    },
    {
      timestamp: "0:23 - 0:30",
      scene: "CTA & Risk-Free Offer",
      visualAction: "Creator smiling comfortably, screen overlay displaying 30-day money-back badge and store checkout URL.",
      audioVoiceover: "Try it risk-free for 30 days. If your back doesn't feel refreshed by 5 PM, send it back for a full refund.",
      onScreenText: "30-Day Pain-Free Trial • Tap Below",
      isNewIdea: false,
    },
  ];

  const references: CreativeBriefReference[] = [
    {
      referenceId: "INTERNAL_FATIGUE_ANALYSIS",
      source: `Decision Card ${decision.id} (${decision.title})`,
      whatWeLearned: `Current ad ${adName} suffered CTR decay below 1.5% due to repetitive studio b-roll without an engaging first-3s hook.`,
      creativeDifference: "Replaces static studio shot with genuine smartphone UGC pattern interrupt and explicit anatomical problem agitation.",
    },
  ];

  return {
    briefId: generateBriefId(storeId),
    storeId,
    title: `Creative Refresh for ${decision.entity.name}: ${hookAngle.substring(0, 45)}...`,
    assignee: "Media Buyer / Content Producer",
    status: "DRAFT",
    problemOrOpportunity: `Decision Card ${decision.id}: ${decision.title} — ${decision.summary}`,
    product: targetProduct,
    targetAudience: "Adults 25-45 sitting 6+ hours daily (office workers, remote engineers, long-distance drivers).",
    hypothesis: `Replacing the worn creative in ad ${adName} with an agitation-focused UGC hook will lift Link CTR from under 1.5% to >= 2.2% and reduce CPA by at least 15%.`,
    creativeConcept: {
      hookAngle,
      hookType,
      visualStyle,
      format,
      aspectRatio: "9:16",
      conceptSummary: "30s UGC smartphone video testing pain-agitation hook against existing control creative.",
    },
    storyboard,
    copyAndCta: {
      primaryText: "Sitting for 8+ hours a day is ruining your lower back. The Ergonomic Lumbar Cushion Pro locks your spine into natural curvature within 3 seconds. Over 12,000 remote workers agree.",
      headline: "Fix Your Sitting Posture In 3 Seconds",
      ctaButton: "Shop Now",
      productTruths: [
        "100% slow-rebound memory foam tested to 50,000 compressions",
        "Dual adjustable straps fit any desk or car seat",
        "Removable washable organic cotton cover",
      ],
      brandConstraints: [
        "No medical diagnosis claims or guaranteed cure statements",
        "Keep audio crisp with clear English subtitles",
        "Display genuine 30-day trial terms",
      ],
    },
    references,
    testVariables: {
      isolatedVariable: "First 3 seconds hook visual & script (Pattern Interrupt vs Static Studio)",
      constantVariables: [
        "Target product & landing page URL",
        "Offer terms (Buy 1 Get 1 20% OFF)",
        "Post-hook body and CTA scenes",
      ],
      controlAdId: controlAd?.id ?? decision.entity.id,
      controlAdName: controlAd?.name ?? decision.entity.name,
    },
    guardrails: {
      primaryMetric: "cpa",
      metricBasis: "META_PURCHASE",
      budgetCapUsd: budgetCap,
      killCriteria: `Kill variant if spend exceeds 2x Target CPA ($${(targetCpa * 2).toFixed(2)}) with 0 purchases, or Link CTR remains below 1.0% after 2,500 impressions.`,
      reviewWindowDays: 14,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function generateBriefFromCreativeGap(
  storeId: string,
  gap: CreativeGap,
  storeProfile: StoreAdsProfile,
  controlAd?: AdsHierarchyAd,
): CreativeBrief {
  const targetCpa = storeProfile.business.targetCpa ?? 25.0;
  const budgetCap = storeProfile.budgets.experimentAuthorizedCap ?? 60.0;
  const targetProduct = storeId === "chillgen"
    ? {
        name: "Ergonomic Lumbar Cushion Pro",
        targetMarket: "US (Office & Remote Workers)",
        offer: "Free Shipping + 20% OFF Posture Bundle",
        landingPageUrl: "https://chillgen.com/products/lumbar-cushion-pro",
        priceUsd: 49.99,
      }
    : storeId === "jeminise"
    ? {
        name: "Celestial Zodiac Pendant Necklace",
        targetMarket: "US (Astrology & Fine Jewelry Shoppers)",
        offer: "Free Velvet Keepsake Pouch + 15% OFF",
        landingPageUrl: "https://jeminise.com/products/zodiac-pendant",
        priceUsd: 42.0,
      }
    : {
        name: "Minimalist Stoneware Carafe & Tumbler",
        targetMarket: "US (Modern Architecture & Tableware)",
        offer: "Buy 2 Get 1 25% OFF",
        landingPageUrl: "https://wrydeco.com/products/stoneware-carafe",
        priceUsd: 55.0,
      };

  const sampleCompetitors = gap.sampleCompetitorAds.map((s) => s.pageName).join(", ");
  const competitorReferences: CreativeBriefReference[] = gap.sampleCompetitorAds.map((s) => ({
    referenceId: s.archiveAdId,
    source: `Competitor ${s.pageName} (Active ${s.daysActive} days)`,
    whatWeLearned: `Competitor ran headline '${s.headline}' for ${s.daysActive} days, proving customer retention on this angle.`,
    creativeDifference: "Distinct custom script, original proprietary product demonstration, authentic creator voice with no copied imagery.",
  }));

  const storyboard: CreativeBriefStoryboardScene[] = [
    {
      timestamp: "0:00 - 0:03",
      scene: "Hook (Competitor Gap Angle)",
      visualAction: `High-energy opening showcasing ${gap.hookType.toLowerCase()} scenario in natural home office setting.`,
      audioVoiceover: gap.suggestedBrief.hookAngle,
      onScreenText: `⚡ ${gap.patternName}`,
      isNewIdea: true,
    },
    {
      timestamp: "0:04 - 0:14",
      scene: "Storyboard Narrative & Agitation",
      visualAction: gap.suggestedBrief.storyboardIdea,
      audioVoiceover: "Most alternatives fail because they don't address the root ergonomic pressure angle.",
      onScreenText: "The ergonomic angle difference",
      isNewIdea: true,
    },
    {
      timestamp: "0:15 - 0:24",
      scene: "Feature Proof & Texture Reveal",
      visualAction: "Close tactile shots of fabric texture, seam stitching, and instant rebound under pressure.",
      audioVoiceover: "Crafted with hospital-grade contour resilience that adapts to your natural spine curve without flattening out.",
      onScreenText: "Hospital-grade ergonomic memory curve",
      isNewIdea: false,
    },
    {
      timestamp: "0:25 - 0:30",
      scene: "Call to Action",
      visualAction: "Clean product packshot with promo code overlay and direct link arrow.",
      audioVoiceover: `${gap.suggestedBrief.callToAction} today with free insured shipping across the US.`,
      onScreenText: `${gap.suggestedBrief.callToAction} • Tap Link`,
      isNewIdea: false,
    },
  ];

  return {
    briefId: generateBriefId(storeId),
    storeId,
    title: `Test Competitor Angle Gap: ${gap.patternName} (${gap.hookType})`,
    assignee: "Media Buyer / Creative Lead",
    status: "DRAFT",
    problemOrOpportunity: `Competitor Creative Gap ${gap.id}: ${gap.patternName} successfully run by ${sampleCompetitors} (up to ${Math.max(...gap.sampleCompetitorAds.map((a) => a.daysActive))} days active), currently UNTESTED on ${storeId}.`,
    product: targetProduct,
    targetAudience: "US consumers browsing social media experiencing product category friction.",
    hypothesis: `Deploying the ${gap.patternName} angle will tap into an unexploited competitor customer segment, achieving Link CTR >= 2.0% and qualifying as a scalable angle within 14 days.`,
    creativeConcept: {
      hookAngle: gap.suggestedBrief.hookAngle,
      hookType: gap.hookType,
      visualStyle: gap.visualStyle,
      format: gap.format,
      aspectRatio: "9:16",
      conceptSummary: `Original implementation of winning competitor angle ${gap.patternName} formatted in ${gap.format} with ${gap.visualStyle}.`,
    },
    storyboard,
    copyAndCta: {
      primaryText: `Discover why thousands are switching to ${targetProduct.name}. Designed specifically for daily comfort and tested to last. ${targetProduct.offer}.`,
      headline: `The New Standard in ${targetProduct.name}`,
      ctaButton: gap.suggestedBrief.callToAction,
      productTruths: [
        "Premium breathable fabrics certified hypoallergenic",
        "Backed by 30-day money-back guarantee",
        "Fast 3-day US domestic shipping",
      ],
      brandConstraints: [
        "Strictly original assets; zero copy-paste of competitor footage or logos",
        "Truthful claims aligned with product documentation",
      ],
    },
    references: competitorReferences,
    testVariables: {
      isolatedVariable: `New Hook Angle (${gap.hookType}) and Visual Style (${gap.visualStyle})`,
      constantVariables: [
        "Landing page destination",
        "Store pricing and standard shipping offer",
        "Meta audience targeting set",
      ],
      controlAdId: controlAd?.id,
      controlAdName: controlAd?.name ?? "Current Top Spending Creative",
    },
    guardrails: {
      primaryMetric: "cpa",
      metricBasis: "META_PURCHASE",
      budgetCapUsd: budgetCap,
      killCriteria: `Stop test if spend reaches $${(targetCpa * 2).toFixed(2)} with zero purchases or if CTR < 0.9% after 2,000 impressions.`,
      reviewWindowDays: 14,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function formatBriefMarkdown(brief: CreativeBrief): string {
  const scenes = brief.storyboard
    .map(
      (s) =>
        `| **${s.timestamp}** | ${s.scene} | ${s.visualAction} | *"${s.audioVoiceover}"* | \`${s.onScreenText}\` | ${s.isNewIdea ? "⭐ Ý tưởng mới" : "Kế thừa"} |`,
    )
    .join("\n");

  const references = brief.references
    .map(
      (r) =>
        `- **Reference:** \`${r.referenceId}\` (${r.source})\n  - **Học được:** ${r.whatWeLearned}\n  - **Khác biệt sáng tạo (Anti-copy):** ${r.creativeDifference}`,
    )
    .join("\n");

  return `# Creative Production Brief: ${brief.title}

- **Brief ID:** \`${brief.briefId}\`
- **Store:** \`${brief.storeId.toUpperCase()}\`
- **Phụ trách:** ${brief.assignee}
- **Trạng thái:** \`${brief.status}\`
- **Ngày tạo:** ${brief.createdAt}

---

### 1. Vấn đề & Cơ hội (Context & Evidence)
> ${brief.problemOrOpportunity}

### 2. Sản phẩm & Thị trường Mục tiêu
- **Sản phẩm:** ${brief.product.name}
- **Thị trường:** ${brief.product.targetMarket}
- **Offer kích hoạt:** ${brief.product.offer}
- **Landing Page:** [${brief.product.landingPageUrl}](${brief.product.landingPageUrl})
- **Khách hàng thể hiện:** ${brief.targetAudience}

### 3. Giả thuyết cần kiểm chứng (Hypothesis)
> **Giả thuyết:** ${brief.hypothesis}

### 4. Định hướng Sáng tạo (Concept & Format)
- **Hook Angle:** "${brief.creativeConcept.hookAngle}"
- **Hook Type:** \`${brief.creativeConcept.hookType}\`
- **Visual Style:** \`${brief.creativeConcept.visualStyle}\`
- **Format / Tỉ lệ:** \`${brief.creativeConcept.format}\` (${brief.creativeConcept.aspectRatio})
- **Tóm tắt:** ${brief.creativeConcept.conceptSummary}

### 5. Storyboard Chi tiết (30s Breakdown)
| Khung thời gian | Phân cảnh | Hành động thị giác (Visual Action) | Lời thoại / Voiceover | Text trên màn hình | Phân loại |
|---|---|---|---|---|---|
${scenes}

### 6. Copy & Call-To-Action (CTA)
- **Primary Text:**
  > ${brief.copyAndCta.primaryText}
- **Headline:** **${brief.copyAndCta.headline}**
- **CTA Button:** \`${brief.copyAndCta.ctaButton}\`
- **Product Truths:**
${brief.copyAndCta.productTruths.map((t) => `  - ${t}`).join("\n")}
- **Brand Constraints:**
${brief.copyAndCta.brandConstraints.map((c) => `  - ⚠️ ${c}`).join("\n")}

### 7. References & Điểm khác biệt Sáng tạo (Anti-Plagiarism)
${references}

### 8. Thiết kế Biến số Thử nghiệm (Test Variables)
- **Biến cô lập cần test (Isolated Variable):** \`${brief.testVariables.isolatedVariable}\`
- **Biến giữ ổn định (Constants):**
${brief.testVariables.constantVariables.map((v) => `  - ${v}`).join("\n")}
- **Control Ad ID làm mốc so sánh:** \`${brief.testVariables.controlAdId ?? "N/A"}\` (${brief.testVariables.controlAdName ?? "Chưa chỉ định"})

### 9. Guardrails & Điều kiện Dừng (Kill Criteria)
- **Primary Metric:** \`${brief.guardrails.primaryMetric.toUpperCase()}\` (Căn cứ: \`${brief.guardrails.metricBasis}\`)
- **Budget Cap:** **$${brief.guardrails.budgetCapUsd.toFixed(2)} USD**
- **Kill Criteria:** ${brief.guardrails.killCriteria}
- **Thời lượng theo dõi:** **${brief.guardrails.reviewWindowDays} ngày** (Maturity Requirement)
`;
}
