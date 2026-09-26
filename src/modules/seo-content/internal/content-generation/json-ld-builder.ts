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
  const graph: Array<Record<string, unknown>> = [
    {
      "@type": "Product",
      name: input.productTitle,
      description: input.description,
    },
  ];

  if (input.faq && input.faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: input.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
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
