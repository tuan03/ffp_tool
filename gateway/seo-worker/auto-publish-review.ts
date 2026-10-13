import { z } from "zod";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";

import { SeoWorkerError } from "./protocol";

const outputSchema = z.object({
  output: z.object({
    productTitle: z.string().min(1),
    productDescription: z.string(),
    productSeoTitle: z.string().min(1),
    productSeoDescription: z.string(),
    images: z.array(z.object({ sourceUrl: z.string().url(), alt: z.string() })),
    aeo_quick_summary: z.string().min(1).optional(),
    aeo_faq: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).optional(),
    aeo_json_ld: z.string().min(1).optional(),
  }),
});

function imageUrlKey(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === "cdn.shopify.com") {
      for (const key of ["width", "height", "crop", "format"]) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return value;
  }
}

function sourceImages(originalSnapshot: unknown): ReadonlyMap<string, ReadonlySet<string>> {
  if (!originalSnapshot || typeof originalSnapshot !== "object" || Array.isArray(originalSnapshot) ||
    !("images" in originalSnapshot) || !Array.isArray(originalSnapshot.images)) return new Map();
  const idsByUrl = new Map<string, Set<string>>();
  for (const image of originalSnapshot.images) {
    if (!image || typeof image !== "object" || Array.isArray(image) || !("id" in image) ||
      typeof image.id !== "string" || !/^gid:\/\/shopify\/MediaImage\/\d+$/.test(image.id)) continue;
    const url = "url" in image && typeof image.url === "string"
      ? image.url
      : "src" in image && typeof image.src === "string"
        ? image.src
        : undefined;
    if (!url) continue;
    const key = imageUrlKey(url);
    const ids = idsByUrl.get(key) ?? new Set<string>();
    ids.add(image.id);
    idsByUrl.set(key, ids);
  }
  return idsByUrl;
}

export interface AutomaticSeoReview {
  readonly reviewDecision: "approved";
  readonly approvalSource: "automatic_policy";
  readonly updatedAt: number;
  readonly productTitle: { readonly value: string };
  readonly productDescription: { readonly value: string };
  readonly seoTitle: { readonly value: string };
  readonly seoDescription: { readonly value: string };
  readonly images?: readonly { readonly id: string; readonly alt: { readonly value: string } }[];
  readonly aeoQuickSummary?: { readonly value: string };
  readonly aeoFaq?: { readonly value: readonly { readonly question: string; readonly answer: string }[] };
  readonly aeoJsonLd?: { readonly value: string };
}

/** Builds the same approved Review contract used by manual sync without importing browser UI code. */
export function buildAutomaticSeoReview(job: GptSeoJob, rawResult: unknown, updatedAt: number): AutomaticSeoReview {
  const parsed = outputSchema.safeParse(rawResult);
  if (!parsed.success) throw new SeoWorkerError("AUTO_PUBLISH_REVIEW_INVALID");
  const output = parsed.data.output;
  const idsByUrl = sourceImages(job.execution.originalSnapshot);
  const images = output.images.map(image => {
    const ids = idsByUrl.get(imageUrlKey(image.sourceUrl));
    if (ids?.size !== 1) throw new SeoWorkerError("REVIEW_IMAGE_MAPPING_REQUIRED");
    const id = ids.values().next().value;
    if (!id) throw new SeoWorkerError("REVIEW_IMAGE_MAPPING_REQUIRED");
    return { id, alt: { value: image.alt } };
  });
  const hasAeo = output.aeo_quick_summary !== undefined || output.aeo_faq !== undefined || output.aeo_json_ld !== undefined;
  if (hasAeo && (!output.aeo_quick_summary || !output.aeo_faq || !output.aeo_json_ld)) {
    throw new SeoWorkerError("INVALID_AEO_FIELDS");
  }
  return {
    reviewDecision: "approved",
    approvalSource: "automatic_policy",
    updatedAt,
    productTitle: { value: output.productTitle },
    productDescription: { value: output.productDescription },
    seoTitle: { value: output.productSeoTitle },
    seoDescription: { value: output.productSeoDescription },
    ...(images.length > 0 ? { images } : {}),
    ...(hasAeo ? {
      aeoQuickSummary: { value: output.aeo_quick_summary ?? "" },
      aeoFaq: { value: output.aeo_faq ?? [] },
      aeoJsonLd: { value: output.aeo_json_ld ?? "" },
    } : {}),
  };
}
