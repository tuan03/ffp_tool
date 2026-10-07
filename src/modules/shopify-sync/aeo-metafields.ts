import type { SetMetafieldInput, ShopifyAeoInput, ShopifyMetafieldInput } from "./types";

type AeoMetafieldValue = ShopifyMetafieldInput & {
  readonly type: "multi_line_text_field" | "json";
};

export const AEO_SUITE_HTML_METAFIELD = {
  namespace: "custom",
  key: "aeo_suite_html",
  type: "multi_line_text_field",
} as const;

export const AEO_JSON_LD_METAFIELD = {
  namespace: "custom",
  key: "aeo_json_ld",
  type: "json",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hasSchemaType(node: unknown, expectedType: string): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const schemaType = (node as Record<string, unknown>)["@type"];
  return schemaType === expectedType ||
    (Array.isArray(schemaType) && schemaType.includes(expectedType));
}

function normalizeJsonLd(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AEO Schema.org JSON-LD must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AEO Schema.org JSON-LD must be a JSON object.");
  }
  const jsonLd = parsed as Record<string, unknown>;
  if (jsonLd["@context"] !== "https://schema.org") {
    throw new Error("AEO Schema.org JSON-LD requires @context https://schema.org.");
  }
  const graph = jsonLd["@graph"];
  if (!Array.isArray(graph) ||
      !graph.some((node) => hasSchemaType(node, "Product")) ||
      !graph.some((node) => hasSchemaType(node, "FAQPage"))) {
    throw new Error("AEO Schema.org JSON-LD @graph requires Product and FAQPage nodes.");
  }
  return JSON.stringify(parsed);
}

export function buildAeoSuiteHtml(aeo: ShopifyAeoInput): string {
  const summary = aeo.quickSummary.trim();
  if (!summary) throw new Error("AEO quick summary is required.");
  if (aeo.faq.length === 0) throw new Error("AEO FAQ requires at least one question and answer.");

  const faqHtml = aeo.faq.map((faq, index) => {
    const question = faq.question.trim();
    const answer = faq.answer.trim();
    if (!question || !answer) {
      throw new Error(`AEO FAQ item ${index + 1} requires a question and answer.`);
    }
    return `    <dt>${escapeHtml(question)}</dt>\n    <dd>${escapeHtml(answer)}</dd>`;
  }).join("\n");

  return [
    "<section>",
    "  <h2>AEO Suite (AI Search &amp; Overview Optimization)</h2>",
    `  <p>${escapeHtml(summary)}</p>`,
    "  <h3>Frequently Asked Questions</h3>",
    "  <dl>",
    faqHtml,
    "  </dl>",
    "</section>",
  ].join("\n");
}

export function buildAeoMetafields(
  productId: string,
  aeo: ShopifyAeoInput | undefined,
): readonly SetMetafieldInput[] {
  return buildAeoMetafieldValues(aeo).map((metafield) => ({
    ...metafield,
    productId,
  }));
}

export function buildAeoMetafieldValues(
  aeo: ShopifyAeoInput | undefined,
): readonly AeoMetafieldValue[] {
  if (!aeo) return [];
  return [
    {
      ...AEO_SUITE_HTML_METAFIELD,
      value: buildAeoSuiteHtml(aeo),
    },
    {
      ...AEO_JSON_LD_METAFIELD,
      value: normalizeJsonLd(aeo.jsonLd),
    },
  ];
}

export function validateAeoInput(aeo: ShopifyAeoInput | undefined): void {
  if (!aeo) return;
  buildAeoSuiteHtml(aeo);
  normalizeJsonLd(aeo.jsonLd);
}
