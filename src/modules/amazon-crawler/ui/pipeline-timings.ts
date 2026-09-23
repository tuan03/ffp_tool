import type { ProductPipelineTimings } from "../types";

function durationLabel(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds}ms`
    : `${(milliseconds / 1_000).toFixed(2)}s`;
}

export function formatPipelineTimings(timings?: ProductPipelineTimings): readonly string[] {
  if (!timings) return [];
  const entries: Array<readonly [string, number | undefined]> = [
    ["Chuẩn hóa", timings.pipeline?.normalizationMs],
    ["Tìm product Shopify", timings.pipeline?.shopifyResolveMs],
    ["SEO lần đầu", timings.pipeline?.seoInitialMs],
    ["Chờ SEO corpus", timings.pipeline?.seoQueueWaitMs],
    ["SEO chạy lại", timings.pipeline?.seoRebaseMs],
    ["Commit SEO corpus", timings.pipeline?.seoRegistrationMs],
    ["Shopify ghi product", timings.shopify?.productWriteMs],
    ["Shopify variants", timings.shopify?.variantsMs],
    ["Shopify assets", timings.shopify?.assetUploadMs],
    ["Shopify metafields", timings.shopify?.metafieldMs],
    ["Tổng Shopify", timings.shopify?.totalMs],
    ["Tổng pipeline", timings.pipeline?.totalMs],
  ];
  return entries.flatMap(([label, milliseconds]) =>
    typeof milliseconds === "number" ? [`${label}: ${durationLabel(milliseconds)}`] : [],
  );
}
