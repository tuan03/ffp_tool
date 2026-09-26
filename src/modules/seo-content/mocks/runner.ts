import type { SeoContentInput, SeoContentOutput } from "../types";

import { seoContentMockData } from "./data";

export async function runMockSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  const images = seoContentMockData.images.map((img) => ({
    sourceUrl: img.sourceUrl,
    alt: img.alt,
    webp: {
      filename: img.webp.filename,
      localFilePath: img.webp.localFilePath,
      url: img.webp.url,
      data: img.webp.data,
    },
  }));

  const aeo_faq = seoContentMockData.aeo_faq?.map((item) => ({
    question: item.question,
    answer: item.answer,
  }));

  const trimmedHandle = input.handle.trim();

  return {
    ...seoContentMockData,
    images,
    ...(aeo_faq ? { aeo_faq } : {}),
    productHandle: trimmedHandle ? trimmedHandle : seoContentMockData.productHandle,
  };
}
