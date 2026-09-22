import type { ProductUnderstanding } from "../domain-types";
import type { ProductImageAnalysis } from "./product-image-analyzer";
import type { TextProductSignals } from "./text-product-signals";

const MAX_ENTITIES = 12;
const MAX_DOMINANT_COLORS = 5;

const COLOR_ALIAS_MAP: Readonly<Record<string, string>> = {
  grey: "gray",
  "off white": "cream",
  "off-white": "cream",
  "dark blue": "navy",
  golden: "gold",
};

const CATEGORY_ALIAS_MAP: Readonly<Record<string, string>> = {
  tee: "t-shirt",
  shirt: "t-shirt",
  "t shirt": "t-shirt",
  tshirt: "t-shirt",
  "coffee mug": "mug",
  "area rug": "rug",
  "floor rug": "rug",
  "pullover hoodie": "hoodie",
  crewneck: "sweatshirt",
  "bedding set": "bedding set",
  bedding: "bedding set",
  "quilt set": "quilt",
  "comforter set": "comforter",
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeColor(color: string): string {
  const cleaned = normalizeWhitespace(color).toLowerCase();
  return COLOR_ALIAS_MAP[cleaned] ?? cleaned;
}

function normalizeCategory(category: string): string {
  const cleaned = normalizeWhitespace(category).toLowerCase();
  return CATEGORY_ALIAS_MAP[cleaned] ?? cleaned;
}

export function buildProductUnderstanding(
  imageAnalyses: readonly ProductImageAnalysis[],
  textSignals: TextProductSignals,
): ProductUnderstanding {
  // 1. OCR Texts (Strictly from image evidence only, never hallucinate from text)
  const ocrCandidates: string[] = [];
  for (const analysis of imageAnalyses) {
    if (analysis.ocrTexts && Array.isArray(analysis.ocrTexts)) {
      for (const text of analysis.ocrTexts) {
        const cleaned = normalizeWhitespace(text);
        if (cleaned) {
          ocrCandidates.push(cleaned);
        }
      }
    }
  }

  // Deduplicate case-insensitively, preserving original casing of first appearance
  const seenOcrLower = new Set<string>();
  const ocrTexts: string[] = [];
  for (const text of ocrCandidates) {
    const lower = text.toLowerCase();
    if (!seenOcrLower.has(lower)) {
      seenOcrLower.add(lower);
      ocrTexts.push(text);
    }
  }

  // 2. Detected Entities (Rank by frequency across images, fallback to text if empty)
  const entityImageCounts = new Map<string, number>();
  const entityFirstSeen = new Map<string, number>();
  let entityIndex = 0;

  for (const analysis of imageAnalyses) {
    if (analysis.detectedEntities && Array.isArray(analysis.detectedEntities)) {
      const seenInImage = new Set<string>();
      for (const entity of analysis.detectedEntities) {
        const cleaned = normalizeWhitespace(entity).toLowerCase();
        if (cleaned && !seenInImage.has(cleaned)) {
          seenInImage.add(cleaned);
          entityImageCounts.set(cleaned, (entityImageCounts.get(cleaned) ?? 0) + 1);
          if (!entityFirstSeen.has(cleaned)) {
            entityFirstSeen.set(cleaned, entityIndex++);
          }
        }
      }
    }
  }

  let finalEntities: string[] = [];
  if (entityImageCounts.size > 0) {
    // Sort by image count DESC, then by first seen order ASC
    finalEntities = Array.from(entityImageCounts.keys()).sort((a, b) => {
      const countDiff = (entityImageCounts.get(b) ?? 0) - (entityImageCounts.get(a) ?? 0);
      if (countDiff !== 0) return countDiff;
      return (entityFirstSeen.get(a) ?? 0) - (entityFirstSeen.get(b) ?? 0);
    });
  } else {
    // Field-level fallback to text signals (deduplicated)
    finalEntities = Array.from(
      new Set(textSignals.detectedEntities.map((e) => normalizeWhitespace(e).toLowerCase())),
    );
  }
  const detectedEntities = finalEntities.slice(0, MAX_ENTITIES);

  // 3. Dominant Colors (Rank by frequency across images, fallback to text if empty)
  const colorImageCounts = new Map<string, number>();
  const colorFirstSeen = new Map<string, number>();
  let colorIndex = 0;

  for (const analysis of imageAnalyses) {
    if (analysis.dominantColors && Array.isArray(analysis.dominantColors)) {
      const seenInImage = new Set<string>();
      for (const color of analysis.dominantColors) {
        const normalized = normalizeColor(color);
        if (normalized && !seenInImage.has(normalized)) {
          seenInImage.add(normalized);
          colorImageCounts.set(normalized, (colorImageCounts.get(normalized) ?? 0) + 1);
          if (!colorFirstSeen.has(normalized)) {
            colorFirstSeen.set(normalized, colorIndex++);
          }
        }
      }
    }
  }

  let finalColors: string[] = [];
  if (colorImageCounts.size > 0) {
    finalColors = Array.from(colorImageCounts.keys()).sort((a, b) => {
      const countDiff = (colorImageCounts.get(b) ?? 0) - (colorImageCounts.get(a) ?? 0);
      if (countDiff !== 0) return countDiff;
      return (colorFirstSeen.get(a) ?? 0) - (colorFirstSeen.get(b) ?? 0);
    });
  } else {
    // Field-level fallback to text signals (deduplicated)
    finalColors = Array.from(new Set(textSignals.dominantColors.map(normalizeColor)));
  }
  const dominantColors = finalColors.slice(0, MAX_DOMINANT_COLORS);

  // 4. Visual Style (Most frequent or first defined style from images, fallback to text, then "unspecified")
  const styleCounts = new Map<string, number>();
  for (const analysis of imageAnalyses) {
    if (analysis.visualStyle) {
      const cleaned = normalizeWhitespace(analysis.visualStyle).toLowerCase();
      if (
        cleaned &&
        cleaned !== "unspecified" &&
        cleaned !== "standard" &&
        cleaned !== "unknown" &&
        cleaned !== "none" &&
        cleaned !== "n/a"
      ) {
        styleCounts.set(cleaned, (styleCounts.get(cleaned) ?? 0) + 1);
      }
    }
  }

  let visualStyle = "unspecified";
  if (styleCounts.size > 0) {
    visualStyle = Array.from(styleCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  } else if (textSignals.visualStyle) {
    visualStyle = normalizeWhitespace(textSignals.visualStyle).toLowerCase();
  }

  // 5. Product Category (First defined category from images, fallback to text, then "unknown")
  let productCategory = "unknown";
  for (const analysis of imageAnalyses) {
    if (analysis.productCategory) {
      const normalized = normalizeCategory(analysis.productCategory);
      if (
        normalized &&
        normalized !== "unknown" &&
        normalized !== "general" &&
        normalized !== "unspecified" &&
        normalized !== "none" &&
        normalized !== "n/a"
      ) {
        productCategory = normalized;
        break;
      }
    }
  }

  if (productCategory === "unknown" && textSignals.productCategory) {
    productCategory = normalizeCategory(textSignals.productCategory);
  }

  return Object.freeze({
    ocrTexts: Object.freeze([...ocrTexts]),
    detectedEntities: Object.freeze([...detectedEntities]),
    dominantColors: Object.freeze([...dominantColors]),
    visualStyle,
    productCategory,
  });
}
