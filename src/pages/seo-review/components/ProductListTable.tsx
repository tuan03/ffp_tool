import { SourceBadge } from "./SourceBadge";
import type { SeoProcessingStatus, SeoProductUiViewModel } from "../types";

export interface ProductListTableProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelect: (id: string) => void;
  readonly onToggleSelectAll: () => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
}

export function ProductListTable({
  products,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onViewProduct,
  onApproveProduct,
  onRejectProduct,
}: ProductListTableProps): React.JSX.Element {
  const allSelected = products.length > 0 && products.every((p) => selectedIds.has(p.id));
  const someSelected = products.some((p) => selectedIds.has(p.id)) && !allSelected;

  function renderSeoStatusBadge(status: SeoProcessingStatus, isMock: boolean) {
    if (status === "completed") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Completed
          {isMock && <SourceBadge source="mock" />}
        </span>
      );
    }
    if (status === "processing") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
          <svg className="animate-spin h-3 w-3 text-cyan-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Processing
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
        Failed
      </span>
    );
  }

  function renderReviewBadge(decision: "pending" | "approved" | "rejected") {
    if (decision === "approved") {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-700">
          ✓ Approved
        </span>
      );
    }
    if (decision === "rejected") {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-rose-950/80 text-rose-300 border border-rose-700">
          ✕ Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700">
        Pending
      </span>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-400">
          🔍
        </div>
        <h3 className="mt-3 text-sm font-semibold text-slate-200">Không tìm thấy sản phẩm nào</h3>
        <p className="mt-1 text-xs text-slate-500">
          Thử thay đổi bộ lọc tìm kiếm hoặc nạp dữ liệu SEO Content mới.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
            <tr>
              <th scope="col" className="p-4 w-12">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = someSelected;
                    }
                  }}
                  onChange={onToggleSelectAll}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 cursor-pointer"
                  aria-label="Chọn tất cả sản phẩm"
                />
              </th>
              <th scope="col" className="py-3 px-3 w-16 text-center">
                Ảnh
              </th>
              <th scope="col" className="py-3 px-4 min-w-[280px]">
                Sản phẩm / Tiêu đề SEO
              </th>
              <th scope="col" className="py-3 px-4 w-36">
                SEO Status
              </th>
              <th scope="col" className="py-3 px-4 w-32">
                Review Status
              </th>
              <th scope="col" className="py-3 px-4 w-44 text-right">
                Hành động
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {products.map((product) => {
              const isSelected = selectedIds.has(product.id);
              const firstImage = product.images[0]?.previewUrl.value || "https://placehold.co/100x100?text=No+Img";
              const hasMockFields =
                product.productTitle.source === "mock" ||
                product.seoTitle.source === "mock" ||
                product.seoDescription.source === "mock" ||
                product.handle.source === "mock";

              return (
                <tr
                  key={product.id}
                  className={`transition hover:bg-slate-800/40 ${
                    isSelected ? "bg-cyan-950/20" : ""
                  }`}
                >
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(product.id)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 cursor-pointer"
                      aria-label={`Chọn sản phẩm ${product.productTitle.value}`}
                    />
                  </td>

                  <td className="py-3 px-3">
                    <div className="relative h-12 w-12 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                      <img
                        src={firstImage}
                        alt={product.images[0]?.alt.value || product.productTitle.value}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          const target = e.currentTarget;
                          target.src = "https://placehold.co/100x100/1e293b/94a3b8?text=Image";
                        }}
                      />
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onViewProduct(product)}
                          className="font-semibold text-slate-100 hover:text-cyan-400 text-left line-clamp-1 transition cursor-pointer"
                        >
                          {product.productTitle.value}
                        </button>
                        <SourceBadge source={product.productTitle.source} />
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                        <span className="text-cyan-500/80">/{product.handle.value}</span>
                        {product.asin && (
                          <span className="text-slate-500">ASIN: {product.asin}</span>
                        )}
                        {hasMockFields && (
                          <span className="text-[10px] text-amber-500/80 font-sans">
                            (chứa trường mock)
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-4 whitespace-nowrap">
                    {renderSeoStatusBadge(product.seoStatus.value, product.seoStatus.source === "mock")}
                  </td>

                  <td className="py-3 px-4 whitespace-nowrap">
                    {renderReviewBadge(product.reviewDecision)}
                  </td>

                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onViewProduct(product)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 border border-cyan-500/30 transition cursor-pointer"
                      >
                        👁️ Review
                      </button>

                      <button
                        type="button"
                        title="Phê duyệt nhanh"
                        onClick={() => onApproveProduct(product.id)}
                        className="p-1.5 rounded-lg text-xs font-semibold text-emerald-400 hover:bg-emerald-950/60 border border-emerald-800/40 hover:border-emerald-600 transition cursor-pointer"
                        aria-label="Phê duyệt"
                      >
                        ✓
                      </button>

                      <button
                        type="button"
                        title="Từ chối nhanh"
                        onClick={() => onRejectProduct(product.id)}
                        className="p-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-950/60 border border-rose-800/40 hover:border-rose-600 transition cursor-pointer"
                        aria-label="Từ chối"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
