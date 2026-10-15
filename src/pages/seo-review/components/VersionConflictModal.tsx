import { useEffect } from "react";

import { AppIcon } from "../../../shared/components/AppIcon";
import type { ShopifyVersionConflictDetails } from "../../../modules/shopify-sync";
import type { SeoProductUiViewModel } from "../types";

export interface VersionConflictModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onForceOverwrite: (productId: string) => void | Promise<void>;
  readonly onReRunSeo: (productId: string) => void | Promise<void>;
  readonly conflictDetails?: ShopifyVersionConflictDetails | null;
  readonly proposedProduct?: {
    readonly id: string;
    readonly title?: string;
    readonly handle?: string;
    readonly seoTitle?: string;
    readonly seoDescription?: string;
    readonly updatedAt?: string;
  } | null;
  readonly product?: SeoProductUiViewModel | null;
}

export function VersionConflictModal({
  isOpen,
  onClose,
  onForceOverwrite,
  onReRunSeo,
  conflictDetails,
  proposedProduct,
  product,
}: VersionConflictModalProps): React.JSX.Element | null {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  // Parse conflict details from props or product error JSON if needed
  const resolvedConflict: ShopifyVersionConflictDetails | undefined =
    conflictDetails ??
    (() => {
      if (!product?.shopifySyncError) return undefined;
      try {
        const parsed = JSON.parse(product.shopifySyncError) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && parsed.code === "SHOPIFY_VERSION_CONFLICT") {
          return parsed as unknown as ShopifyVersionConflictDetails;
        }
      } catch {
        // Not JSON
      }
      return undefined;
    })();

  const targetProductId =
    resolvedConflict?.productId ||
    proposedProduct?.id ||
    product?.productId ||
    product?.id ||
    "";

  // Shopify Current content
  const shopifyUpdatedAt = resolvedConflict?.currentShopifyUpdatedAt ?? "Chưa rõ";
  const shopifyTitle = resolvedConflict?.currentProduct?.title ?? "—";
  const shopifyHandle = resolvedConflict?.currentProduct?.handle ? `/${resolvedConflict.currentProduct.handle}` : "—";
  const shopifySeoTitle = resolvedConflict?.currentProduct?.seo?.title ?? "—";
  const shopifySeoDescription = resolvedConflict?.currentProduct?.seo?.description ?? "—";

  // Proposed SEO content
  const proposedUpdatedAt =
    resolvedConflict?.sourceShopifyUpdatedAt ??
    proposedProduct?.updatedAt ??
    (product?.updatedAt ? new Date(product.updatedAt).toISOString() : "—");
  const proposedTitle =
    proposedProduct?.title ??
    product?.productTitle?.value ??
    "—";
  const proposedHandle =
    proposedProduct?.handle
      ? `/${proposedProduct.handle}`
      : product?.handle?.value
      ? `/${product.handle.value}`
      : "—";
  const proposedSeoTitle =
    proposedProduct?.seoTitle ??
    product?.seoTitle?.value ??
    "—";
  const proposedSeoDescription =
    proposedProduct?.seoDescription ??
    product?.seoDescription?.value ??
    "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-conflict-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-800 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-blue-50 dark:bg-blue-950/60 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold text-lg border border-amber-300 dark:border-amber-800">
              <AppIcon name="warning" />
            </span>
            <div>
              <h3 id="version-conflict-title" className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>PHÁT HIỆN XUNG ĐỘT PHIÊN BẢN (SHOPIFY_VERSION_CONFLICT)</span>
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Sản phẩm trên Shopify đã bị thay đổi kể từ khi tạo nội dung SEO. Vui lòng so sánh và chọn giải pháp bên dưới.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
            aria-label="Đóng modal xung đột phiên bản"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Diff Comparison Table */}
        <div className="p-5 overflow-y-auto flex-1 text-xs text-slate-700 dark:text-slate-300 space-y-4">
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-3 text-xs text-amber-700 dark:text-amber-300">
            <strong>Nguyên nhân:</strong> Phiên bản sản phẩm trên Shopify hiện tại (<code>{shopifyUpdatedAt}</code>) khác với phiên bản lúc tạo SEO (<code>{proposedUpdatedAt}</code>). Việc ghi đè tự động đã bị chặn để bảo vệ dữ liệu mới nhất trên Store.
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-4 w-1/5">Trường dữ liệu</th>
                  <th className="py-2.5 px-4 w-2/5 border-l border-slate-200 dark:border-slate-700 text-blue-700 dark:text-blue-300">
                    <AppIcon name="store" /> Shopify Hiện Tại
                  </th>
                  <th className="py-2.5 px-4 w-2/5 border-l border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300">
                    <AppIcon name="seo" /> Đề Xuất SEO Cần Ghi Đè
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-xs">
                {/* Updated At */}
                <tr className="bg-rose-50 dark:bg-rose-950/60">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300 font-sans">Thời gian cập nhật</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-rose-700 dark:text-rose-300 font-bold bg-rose-50 dark:bg-rose-950/60">
                    {shopifyUpdatedAt}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-amber-700 dark:text-amber-300">
                    {proposedUpdatedAt}
                  </td>
                </tr>

                {/* Title */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300 font-sans">Tiêu đề (Title)</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 whitespace-pre-wrap font-sans">
                    {shopifyTitle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap font-sans font-medium">
                    {proposedTitle}
                  </td>
                </tr>

                {/* Handle */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300 font-sans">Đường dẫn (Handle)</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                    {shopifyHandle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 font-semibold">
                    {proposedHandle}
                  </td>
                </tr>

                {/* SEO Title */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300 font-sans">SEO Title</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans">
                    {shopifySeoTitle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap font-sans font-medium">
                    {proposedSeoTitle}
                  </td>
                </tr>

                {/* SEO Description */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300 font-sans">SEO Description</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                    {shopifySeoDescription}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                    {proposedSeoDescription}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions with 2-Button Resolution */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Hủy bỏ"
            className="w-full sm:w-auto px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition cursor-pointer"
          >
            Hủy Bỏ
          </button>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            {/* Re-run SEO button */}
            <button
              type="button"
              onClick={() => {
                void onReRunSeo(targetProductId);
                onClose();
              }}
              aria-label="Tạo lại SEO"
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-50 dark:hover:bg-blue-950/80 text-blue-700 dark:text-blue-300 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md "
              title="Lấy dữ liệu mới nhất từ Shopify và sinh lại toàn bộ nội dung SEO"
            >
              <span><AppIcon name="refresh" /></span>
              <span>Re-run SEO (Tạo lại SEO)</span>
            </button>

            {/* Force Overwrite button */}
            <button
              type="button"
              onClick={() => {
                void onForceOverwrite(targetProductId);
                onClose();
              }}
              aria-label="Ghi đè cưỡng bức"
              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm "
              title="Bỏ qua kiểm tra phiên bản và ghi đè nội dung SEO lên Shopify"
            >
              <span><AppIcon name="warning" /></span>
              <span>Force Overwrite (Ghi đè cưỡng bức)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
