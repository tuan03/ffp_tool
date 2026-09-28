import { useEffect } from "react";
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-amber-500/40 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-amber-950/80 via-slate-950/90 to-rose-950/80 border-b border-amber-900/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 font-bold text-lg border border-amber-500/30">
              ⚠️
            </span>
            <div>
              <h3 id="version-conflict-title" className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>PHÁT HIỆN XUNG ĐỘT PHIÊN BẢN (SHOPIFY_VERSION_CONFLICT)</span>
              </h3>
              <p className="text-[11px] text-amber-300/90">
                Sản phẩm trên Shopify đã bị thay đổi kể từ khi tạo nội dung SEO. Vui lòng so sánh và chọn giải pháp bên dưới.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            aria-label="Đóng modal xung đột phiên bản"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Diff Comparison Table */}
        <div className="p-5 overflow-y-auto flex-1 text-xs text-slate-300 space-y-4">
          <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-3 text-[11px] text-amber-200/90">
            <strong>Nguyên nhân:</strong> Phiên bản sản phẩm trên Shopify hiện tại (<code>{shopifyUpdatedAt}</code>) khác với phiên bản lúc tạo SEO (<code>{proposedUpdatedAt}</code>). Việc ghi đè tự động đã bị chặn để bảo vệ dữ liệu mới nhất trên Store.
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-400 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-4 w-1/5">Trường dữ liệu</th>
                  <th className="py-2.5 px-4 w-2/5 border-l border-slate-800 text-sky-400">
                    🏪 Shopify Hiện Tại
                  </th>
                  <th className="py-2.5 px-4 w-2/5 border-l border-slate-800 text-emerald-400">
                    ✨ Đề Xuất SEO Cần Ghi Đè
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {/* Updated At */}
                <tr className="bg-rose-950/20">
                  <td className="py-2.5 px-4 font-semibold text-slate-300 font-sans">Thời gian cập nhật</td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-rose-300 font-bold bg-rose-950/30">
                    {shopifyUpdatedAt}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-amber-300">
                    {proposedUpdatedAt}
                  </td>
                </tr>

                {/* Title */}
                <tr className="hover:bg-slate-900/40">
                  <td className="py-2.5 px-4 font-semibold text-slate-300 font-sans">Tiêu đề (Title)</td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-slate-200 whitespace-pre-wrap font-sans">
                    {shopifyTitle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-emerald-300 whitespace-pre-wrap font-sans font-medium">
                    {proposedTitle}
                  </td>
                </tr>

                {/* Handle */}
                <tr className="hover:bg-slate-900/40">
                  <td className="py-2.5 px-4 font-semibold text-slate-300 font-sans">Đường dẫn (Handle)</td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-slate-400">
                    {shopifyHandle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-emerald-400 font-semibold">
                    {proposedHandle}
                  </td>
                </tr>

                {/* SEO Title */}
                <tr className="hover:bg-slate-900/40">
                  <td className="py-2.5 px-4 font-semibold text-slate-300 font-sans">SEO Title</td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-slate-300 whitespace-pre-wrap font-sans">
                    {shopifySeoTitle}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-emerald-300 whitespace-pre-wrap font-sans font-medium">
                    {proposedSeoTitle}
                  </td>
                </tr>

                {/* SEO Description */}
                <tr className="hover:bg-slate-900/40">
                  <td className="py-2.5 px-4 font-semibold text-slate-300 font-sans">SEO Description</td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-slate-400 whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
                    {shopifySeoDescription}
                  </td>
                  <td className="py-2.5 px-4 border-l border-slate-800 text-emerald-200/90 whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
                    {proposedSeoDescription}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions with 2-Button Resolution */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Hủy bỏ"
            className="w-full sm:w-auto px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
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
              className="w-full sm:w-auto px-4 py-2 rounded-xl border border-cyan-700 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-cyan-950/40"
              title="Lấy dữ liệu mới nhất từ Shopify và sinh lại toàn bộ nội dung SEO"
            >
              <span>🔄</span>
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
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-rose-950/40"
              title="Bỏ qua kiểm tra phiên bản và ghi đè nội dung SEO lên Shopify"
            >
              <span>⚠️</span>
              <span>Force Overwrite (Ghi đè cưỡng bức)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
