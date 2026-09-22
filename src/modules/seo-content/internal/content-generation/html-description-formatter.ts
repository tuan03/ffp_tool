import type { GeneratedBullet, GeneratedContentDraft } from "./content-generation-types";

/**
 * Escapes characters with special meaning in HTML to prevent XSS and tag injection.
 */
export function escapeHtml(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Normalizes bullet labels to clean, standardized e-commerce categories.
 */
export function canonicalizeBulletLabel(rawLabel: string): string {
  const trimmed = rawLabel.trim().replace(/[:\-_]+$/, "");
  const lower = trimmed.toLowerCase();

  if (lower.includes("design") || lower.includes("artwork") || lower.includes("graphic")) {
    return "Design";
  }
  if (lower.includes("style") || lower.includes("fit") || lower.includes("look")) {
    return "Style";
  }
  if (lower.includes("material") || lower.includes("fabric") || lower.includes("craft")) {
    return "Materials";
  }
  if (lower.includes("personal") || lower.includes("custom")) {
    return "Personalization";
  }
  if (lower.includes("occasion") || lower.includes("event") || lower.includes("holiday")) {
    return "Occasion";
  }
  if (lower.includes("audience") || lower.includes("recipient") || lower.includes("made for") || lower.includes("gift for")) {
    return "Made for";
  }
  if (lower.includes("use") || lower.includes("care") || lower.includes("function")) {
    return "Use & Care";
  }

  // Remove promotional hype labels
  if (/^(best|guarantee|why you need|deal|offer|sale|value)/i.test(trimmed)) {
    return "Details";
  }

  // Capitalize first letter of label
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Formats a GeneratedContentDraft into semantic, sanitized HTML rich text for Shopify.
 * Guaranteed to use only semantic tags: <p>, <ul>, <li>, <strong>.
 */
export function formatProductDescriptionHtml(draft: GeneratedContentDraft): string {
  const sections: string[] = [];

  // 1. Hook / Intro Paragraph
  if (draft.intro && draft.intro.trim().length > 0) {
    sections.push(`<p>${escapeHtml(draft.intro.trim())}</p>`);
  }

  // 2. Feature & Benefit Bullets
  if (draft.bullets && draft.bullets.length > 0) {
    const listItems = draft.bullets
      .map((bullet: GeneratedBullet) => {
        const label = canonicalizeBulletLabel(bullet.label);
        const text = escapeHtml(bullet.text.trim());
        return `  <li><strong>${escapeHtml(label)}:</strong> ${text}</li>`;
      })
      .join("\n");

    sections.push(`<ul>\n${listItems}\n</ul>`);
  }

  // 3. Guidance / Care Details (if present)
  if (draft.guidance && draft.guidance.length > 0) {
    const guidanceText = draft.guidance
      .map((g) => g.trim())
      .filter(Boolean)
      .map(escapeHtml)
      .join("; ");

    if (guidanceText) {
      sections.push(`<p><strong>Care & Instructions:</strong> ${guidanceText}</p>`);
    }
  }

  // 4. Closing / Value Proposition Paragraph
  if (draft.closing && draft.closing.trim().length > 0) {
    sections.push(`<p>${escapeHtml(draft.closing.trim())}</p>`);
  }

  return sections.join("\n\n");
}
