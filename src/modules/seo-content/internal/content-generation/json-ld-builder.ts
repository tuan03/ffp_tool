import type { GeneratedFaqItem } from "./content-generation-types";

export interface JsonLdProductInput {
  readonly productTitle: string;
  readonly description: string;
  readonly faq?: readonly GeneratedFaqItem[];
}

/**
 * Builds a Schema.org compliant JSON-LD string combining Product and FAQPage
 * within a single unified @graph block.
 */
export function buildJsonLdSchema(input: JsonLdProductInput): string {
  const cleanDescription = (input.description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const graph: Array<Record<string, unknown>> = [
    {
      "@type": "Product",
      name: input.productTitle.trim(),
      description: cleanDescription,
    },
  ];

  const validFaq = (input.faq || []).filter(
    (item) =>
      item &&
      typeof item.question === "string" &&
      item.question.trim().length > 0 &&
      typeof item.answer === "string" &&
      item.answer.trim().length > 0,
  );

  if (validFaq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: validFaq.map((item) => ({
        "@type": "Question",
        name: item.question.trim(),
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer.trim(),
        },
      })),
    });
  }

  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": graph,
    },
    null,
    2,
  );
}
