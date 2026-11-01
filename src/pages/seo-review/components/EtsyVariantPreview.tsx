import { fromCustomizationNormalizerProduct } from "../../../modules/shopify-sync";
import type { CrawlProduct } from "../../../modules/customization-normalizer";

export function EtsyVariantPreview({ product }: { readonly product?: CrawlProduct }): React.JSX.Element | null {
  if (!product || (product.sourcePlatform !== "etsy" && !product.sourceKey?.startsWith("etsy:"))) return null;
  try {
    const prepared = fromCustomizationNormalizerProduct(product);
    const summary = prepared.etsyVariantProjection;
    if (!summary) return null;
    return <section aria-label="Biến thể Etsy khi sync" className="m-5 space-y-1 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
      <p className="font-semibold">Khi sync: {summary.variantCount} biến thể Shopify</p>
      <p>{summary.optionNames.join(" · ")} · Từ {summary.baseVariantCount} biến thể nguồn</p>
      <p>{prepared.customization ? "Ô nhập chữ và tải ảnh vẫn nằm trong Customize." : "Không cần popup Customize."} Giới hạn store được kiểm tra trước khi sync.</p>
    </section>;
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.startsWith("ETSY_PERSONALIZATION")
      ? error.message.replace(/^ETSY_PERSONALIZATION[^:]*:\s*/, "") : "Chưa chuẩn bị được biến thể Etsy; cần kiểm tra dữ liệu nguồn trước khi sync.";
    return <section role="alert" className="m-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <p className="font-semibold">Cần xử lý biến thể Etsy</p><p>{message}</p>
    </section>;
  }
}
