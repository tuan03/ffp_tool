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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-50 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-lg border border-amber-300 bg-white shadow-sm overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-blue-50 border-b border-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700 font-bold text-lg border border-amber-300">
              <AppIcon name="warning" />
            </span>
            <div>
              <h3 id="version-conflict-title" className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>PHÁT HIỆN XUNG ĐỘT PHIÊN BẢN (SHOPIFY_VERSION_CONFLICT)</span>
              </h3>
              <p className="text-[11px] text-amber-700">
                Sản phẩm trên Shopify đã bị thay đổi kể từ khi tạo nội dung SEO. Vui lòng so sánh và chọn giải pháp bên dưới.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition cursor-pointer"
            aria-label="Đóng modal xung đột phiên bản"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Diff Comparison Table */}
        <div className="p-5 overflow-y-auto flex-1 text-xs text-slate-700 space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
            <strong>Nguyên nhân:</strong> Phiên bản sản phẩm trên Shopify hiện tại (<code>{shopifyUpdatedAt}</code>) khác với phiên bản lúc tạo SEO (<code>{proposedUpdatedAt}</code>). Việc ghi đè tự động đã bị chặn để bảo vệ dữ liệu mới nhất trên Store.
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-4 w-1/5">Trường dữ liệu</th>
                  <th className="py-2.5 px-4 w-2/5 border-l border-slate-200 text-blue-700">
                    <AppIcon name="store" /> Shopify Hiện Tại
                  </th>
                  <th className="py-2.5 px-4 w-2/5 border-l border-slate-200 text-emerald-700">
                    <AppIcon name="seo" /> Đề Xuất SEO Cần Ghi Đè
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                {/* Updated At */}
                <tr className="bg-rose-50">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 font-sans">Thời gian cập nhật</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-rose-700 font-bold bg-rose-50">
                    {shopifyUpdatedAt}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-amber-700">
                    {proposedUpdatedAt}
                  </td>
                </tr>

                {/* Title */}
                <tr className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 font-sans">Tiêu đề (Title)</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-slate-900 whitespace-pre-wrap font-sans">
                    {shopifyTitle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-emerald-700 whitespace-pre-wrap font-sans font-medium">
                    {proposedTitle}
                  </td>
                </tr>

                {/* Handle */}
                <tr className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 font-sans">Đường dẫn (Handle)</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-slate-600">
                    {shopifyHandle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-emerald-700 font-semibold">
                    {proposedHandle}
                  </td>
                </tr>

                {/* SEO Title */}
                <tr className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 font-sans">SEO Title</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-slate-700 whitespace-pre-wrap font-sans">
                    {shopifySeoTitle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-emerald-700 whitespace-pre-wrap font-sans font-medium">
                    {proposedSeoTitle}
                  </td>
                </tr>

                {/* SEO Description */}
                <tr className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-semibold text-slate-700 font-sans">SEO Description</td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-slate-600 whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
                    {shopifySeoDescription}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-200 text-emerald-700 whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
                    {proposedSeoDescription}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions with 2-Button Resolution */}
        <div className="p-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Hủy bỏ"
            className="w-full sm:w-auto px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition cursor-pointer"
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
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-50 text-blue-700 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md "
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
