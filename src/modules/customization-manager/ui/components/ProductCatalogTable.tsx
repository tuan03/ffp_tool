import React, { useState, useMemo } from "react";
import type { ShopifyProduct } from "../../../module-api";

export interface ProductCatalogTableProps {
  readonly products: readonly ShopifyProduct[];
  readonly isLoading: boolean;
  readonly configuredProductIds: ReadonlySet<string>;
  readonly onSelectProductForEdit: (product: ShopifyProduct) => void;
  readonly onPreviewCustomerView?: (product: ShopifyProduct) => void;
  readonly onCloneProduct?: (product: ShopifyProduct) => void;
  readonly onDeleteCustomizer: (product: ShopifyProduct) => void;
}

export function ProductCatalogTable({
  products,
  isLoading,
  configuredProductIds,
  onSelectProductForEdit,
  onDeleteCustomizer,
}: ProductCatalogTableProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Filtered products list by search query
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase().trim();
    return products.filter((p) => {
      const titleMatch = (p.title || "").toLowerCase().includes(q);
      const handleMatch = (p.handle || "").toLowerCase().includes(q);
      return titleMatch || handleMatch;
    });
  }, [products, searchQuery]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const paginatedProducts = useMemo(() => {
    const start = (validCurrentPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, validCurrentPage, pageSize]);

  return (
    <div className="space-y-4">
      {/* Search & Header Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm backdrop-blur-sm">
        {/* Search Input */}
        <div className="flex-1 min-w-[280px]">
          <div className="relative">
            <span className="absolute left-3.5 top-2.5 text-slate-400 text-sm">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Tìm kiếm sản phẩm theo tên..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none transition shadow-inner"
            />
          </div>
        </div>

        {/* Counter Badge */}
        <div className="text-xs text-slate-400 font-medium">
          Hiển thị <span className="text-cyan-400 font-bold">{filteredProducts.length}</span> sản phẩm
        </div>
      </div>

      {/* Products Table Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden backdrop-blur-md">
        {isLoading ? (
          <div className="p-16 text-center space-y-3">
            <span className="inline-block animate-spin text-2xl">⏳</span>
            <p className="text-xs text-slate-400">Đang tải danh sách sản phẩm...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <span className="text-3xl block">📦</span>
            <h4 className="text-sm font-bold text-slate-200">Không tìm thấy sản phẩm nào</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Không có sản phẩm nào khớp với từ khóa tìm kiếm.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-4 pl-6 pr-4">Sản phẩm</th>
                  <th className="py-4 px-4 w-48 text-center">Trạng thái Tùy Biến</th>
                  <th className="py-4 pr-6 pl-4 w-56 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paginatedProducts.map((product) => {
                  const hasCustomizer =
                    configuredProductIds.has(product.id) ||
                    configuredProductIds.has(product.id.replace("gid://shopify/Product/", ""));
                  const imageUrl =
                    product.featuredImage?.url ||
                    product.images?.[0]?.url ||
                    "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=300&auto=format&fit=crop&q=80";

                  return (
                    <tr
                      key={product.id}
                      onClick={() => onSelectProductForEdit(product)}
                      className="hover:bg-slate-800/40 transition group cursor-pointer"
                    >
                      {/* Product Thumbnail & Clean Title */}
                      <td className="py-4 pl-6 pr-4">
                        <div className="flex items-center gap-3.5">
                          <div className="h-14 w-14 flex-shrink-0 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center shadow-sm group-hover:border-cyan-500/50 transition">
                            <img
                              src={imageUrl}
                              alt={product.title}
                              className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src =
                                  "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=300&auto=format&fit=crop&q=80";
                              }}
                            />
                          </div>
                          <div className="min-w-0">
                            <h4
                              className="font-bold text-slate-200 text-sm group-hover:text-cyan-300 transition line-clamp-2"
                              title={product.title}
                            >
                              {product.title}
                            </h4>
                            {product.handle && (
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                /{product.handle}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Customizer Status Badge */}
                      <td className="py-4 px-4 text-center">
                        {hasCustomizer ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-950/80 border border-cyan-800 px-3 py-1 text-xs font-semibold text-cyan-300 shadow-sm">
                            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                            <span>Đã có Customizer</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-800/80 border border-slate-700 px-3 py-1 text-xs text-slate-400">
                            Chưa cấu hình
                          </span>
                        )}
                      </td>

                      {/* Direct Actions: Open Studio & Delete */}
                      <td className="py-4 pr-6 pl-4 text-right">
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectProductForEdit(product)}
                            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition cursor-pointer shadow-md ${
                              hasCustomizer
                                ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-cyan-950/40 hover:from-cyan-500 hover:to-blue-500 hover:shadow-cyan-900/60"
                                : "border border-slate-700 bg-slate-800 text-slate-300 hover:border-cyan-500 hover:bg-slate-750 hover:text-white"
                            }`}
                            title={hasCustomizer ? "Xem trực quan và sửa cấu hình đã có" : "Sản phẩm chưa có tùy biến. Bấm để tạo cấu hình mới."}
                          >
                            <span>{hasCustomizer ? "🎨" : "✨"}</span>
                            <span>{hasCustomizer ? "Mở Tùy Biến" : "Tạo Mới Tùy Biến"}</span>
                          </button>

                          {hasCustomizer && (
                            <button
                              type="button"
                              onClick={() => onDeleteCustomizer(product)}
                              className="rounded-xl border border-slate-800 bg-slate-950/80 p-2 text-slate-400 hover:border-rose-800 hover:bg-rose-950/50 hover:text-rose-300 transition cursor-pointer"
                              title="Xóa cấu hình Customizer của sản phẩm này"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!isLoading && filteredProducts.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/80 px-6 py-3.5 text-xs text-slate-400">
            <div>
              Trang <span className="text-slate-200 font-semibold">{validCurrentPage}</span> / <span className="text-slate-200 font-semibold">{totalPages}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={validCurrentPage <= 1}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition cursor-pointer"
              >
                ← Trước
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
                Math.max(0, validCurrentPage - 3),
                Math.min(totalPages, validCurrentPage + 2),
              ).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`h-7 w-7 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    validCurrentPage === page
                      ? "bg-cyan-600 text-white shadow-md shadow-cyan-900/40"
                      : "border border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={validCurrentPage >= totalPages}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition cursor-pointer"
              >
                Sau →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
