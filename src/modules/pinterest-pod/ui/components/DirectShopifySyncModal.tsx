import { useState } from "react";

import { syncPinterestPodToShopify } from "../../service";
import type {
  DeliverablesData,
  DirectShopifySyncOutput,
  PinterestPodDeliverables,
} from "../../types";

export interface DirectShopifySyncModalProps {
  readonly isOpen: boolean;
  readonly payload: PinterestPodDeliverables;
  readonly deliverables: DeliverablesData;
  readonly approvedMockupCount: number;
  readonly onClose: () => void;
  readonly onSyncSuccess?: (res: DirectShopifySyncOutput) => void;
  readonly customSyncRunner?: (payload: PinterestPodDeliverables) => Promise<DirectShopifySyncOutput>;
}

export function DirectShopifySyncModal({
  isOpen,
  payload,
  deliverables,
  approvedMockupCount,
  onClose,
  onSyncSuccess,
  customSyncRunner,
}: DirectShopifySyncModalProps): React.JSX.Element | null {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<DirectShopifySyncOutput | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const storeId = payload.storeId || "default";
  const itemsCount = payload.items.length;
  const printCmykCount = deliverables.print_cmyk_images?.length ?? itemsCount;
  const variants = payload.variants ?? [];

  async function handleExecuteSync(): Promise<void> {
    setIsSyncing(true);
    setErrorMessage(null);
    try {
      const runner = customSyncRunner ?? syncPinterestPodToShopify;
      const result = await runner(payload);
      setSyncResult(result);
      onSyncSuccess?.(result);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="direct-sync-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative flex flex-col max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🛍️</span>
            <div>
              <h2 id="direct-sync-modal-title" className="text-base font-bold text-slate-100">
                Đẩy trực tiếp lên Shopify Store
              </h2>
              <p className="text-xs text-slate-400">
                Tạo sản phẩm trực tiếp từ thiết kế POD hoàn thiện mà không cần qua SEO Review
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 text-xs text-slate-300">
          {errorMessage && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-800/80 bg-rose-950/70 p-3.5 text-rose-200">
              <span className="text-base shrink-0">⚠️</span>
              <p>{errorMessage}</p>
            </div>
          )}

          {syncResult ? (
            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-3 rounded-xl border border-emerald-700 bg-emerald-950/70 p-4 text-emerald-200">
                <span className="text-2xl">🎉</span>
                <div>
                  <h3 className="font-bold text-sm text-emerald-100">{syncResult.message}</h3>
                  <p className="text-[11px] text-emerald-300/80 mt-0.5">
                    Toàn bộ {syncResult.products.length} sản phẩm đã được đăng tải và sẵn sàng bán trên cửa hàng.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="font-semibold text-slate-200">Danh sách sản phẩm đã tạo:</h4>
                <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-2 divide-y divide-slate-800/60">
                  {syncResult.products.map((prod) => (
                    <div key={prod.designId} className="flex items-center justify-between py-2.5 px-3">
                      <div className="flex flex-col gap-0.5 max-w-[70%]">
                        <span className="font-semibold text-slate-200 truncate">{prod.title}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          ID: {prod.shopifyProductId} • {prod.variantsCount} biến thể • {prod.mediaCount} ảnh
                        </span>
                      </div>
                      {prod.url ? (
                        <a
                          href={prod.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 rounded-lg bg-emerald-900/60 px-2.5 py-1 text-[11px] font-bold text-emerald-300 border border-emerald-700/60 hover:bg-emerald-800 hover:text-white transition"
                        >
                          <span>Xem trên Store</span>
                          <span>↗</span>
                        </a>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400">Đã lưu</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Configuration Summary Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-slate-400 text-[11px]">Cửa hàng đích</span>
                  <span className="font-bold text-cyan-300 text-sm mt-0.5 truncate">{storeId}</span>
                  <span className="text-[10px] text-slate-500 mt-1">Shopify Store Profile</span>
                </div>

                <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-slate-400 text-[11px]">Số lượng mẫu</span>
                  <span className="font-bold text-amber-300 text-sm mt-0.5">{itemsCount} thiết kế</span>
                  <span className="text-[10px] text-slate-500 mt-1">{printCmykCount} bản in CMYK 300DPI</span>
                </div>

                <div className="col-span-2 sm:col-span-1 flex flex-col rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-slate-400 text-[11px]">Media đính kèm</span>
                  <span className="font-bold text-emerald-300 text-sm mt-0.5">{approvedMockupCount} Mockup AI</span>
                  <span className="text-[10px] text-slate-500 mt-1">+ Phôi bóc nền trắng</span>
                </div>
              </div>

              {/* Price Variants Table Preview */}
              {variants.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">Biến thể kích thước &amp; Bảng giá:</span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Cộng thêm: +${payload.priceAddition ?? 0} | Giảm giá: {payload.discountPercent ?? 0}%
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                    <table className="w-full text-left text-[11px]">
                      <thead className="border-b border-slate-800 text-slate-400 uppercase font-semibold">
                        <tr>
                          <th className="py-2 px-3">Kích thước</th>
                          <th className="py-2 px-3">Giá bán</th>
                          <th className="py-2 px-3">Giá gốc so sánh</th>
                          <th className="py-2 px-3">SKU</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {variants.map((v, i) => (
                          <tr key={`${v.title || i}`} className="text-slate-200">
                            <td className="py-2 px-3 font-medium">{v.title || `Size ${i + 1}`}</td>
                            <td className="py-2 px-3 text-emerald-400 font-bold">${v.price}</td>
                            <td className="py-2 px-3 text-slate-400 line-through">
                              {v.compareAtPrice ? `$${v.compareAtPrice}` : "—"}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-400">{v.sku || "AUTO-GEN"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-cyan-800/40 bg-cyan-950/20 p-3.5 text-[11px] text-cyan-200">
                <p className="font-semibold mb-1">💡 Lưu ý quy trình POD:</p>
                <p className="text-slate-400 leading-relaxed">
                  File in độ phân giải cao công nghiệp (300 DPI CMYK) được lưu trữ an toàn trên máy cục bộ của bạn.
                  Hệ thống sẽ tải các hình ảnh phối cảnh Mockup AI và phôi nền trắng lên Shopify để phục vụ trang sản phẩm khách hàng.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4 bg-slate-950/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
          >
            {syncResult ? "Đóng" : "Hủy bỏ"}
          </button>

          {!syncResult && (
            <button
              type="button"
              onClick={() => void handleExecuteSync()}
              disabled={isSyncing}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-teal-500 transition disabled:opacity-50 cursor-pointer"
            >
              {isSyncing ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-slate-950" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Đang đẩy lên Shopify...</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Xác nhận Đẩy trực tiếp lên Store ➔</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
