import type { ProductPipelineTimings, SeoPipelinePerformance } from "../types";

function durationLabel(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds}ms`
    : `${(milliseconds / 1_000).toFixed(2)}s`;
}

export function formatPipelineTimings(timings?: ProductPipelineTimings, seo?: SeoPipelinePerformance): readonly string[] {

  const entries: Array<readonly [string, number | undefined]> = [
    ["Chuẩn hóa", timings?.pipeline?.normalizationMs],
    ["Tìm product Shopify", timings?.pipeline?.shopifyResolveMs],
    ["SEO lần đầu", timings?.pipeline?.seoInitialMs],
    ["Chờ SEO corpus", timings?.pipeline?.seoQueueWaitMs],
    ["SEO chạy lại", timings?.pipeline?.seoRebaseMs],
    ["Commit SEO corpus", timings?.pipeline?.seoRegistrationMs],
    ["Shopify ghi product", timings?.shopify?.productWriteMs],
    ["Shopify variants", timings?.shopify?.variantsMs],
    ["Shopify assets", timings?.shopify?.assetUploadMs],
    ["Shopify metafields", timings?.shopify?.metafieldMs],
    ["Tổng Shopify", timings?.shopify?.totalMs],
    ["Tổng pipeline", timings?.pipeline?.totalMs],
  ];
  for (const stage of ["b1", "b2", "b3", "b4", "b5", "b6"]) {
    entries.push([`SEO ${stage.toUpperCase()}`, seo?.stageDurationsMs[stage]]);
  }
  entries.push(
    ["Chờ slot AI/Suggest", seo?.providerQueueMs],
    ["Request AI/Suggest", seo?.providerRequestMs],
    ["Chờ retry", seo?.retryWaitMs],
    ["Chờ đăng ký từ khóa", seo?.commitQueueMs],
    ["Đăng ký từ khóa", seo?.commitMs],
  );
  const counters: Array<readonly [string, number | undefined]> = [
    ["Request", seo?.requestCount], ["Retry", seo?.retryCount],
    ["Cache hit", seo?.cacheHits], ["Tính lại B4", seo?.revisionRetries],
  ];
  return [...entries.flatMap(([label, milliseconds]) =>
    typeof milliseconds === "number" ? [`${label}: ${durationLabel(milliseconds)}`] : [],
  ), ...counters.flatMap(([label, count]) => typeof count === "number" ? [`${label}: ${count}`] : [])];
}
