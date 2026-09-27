import React, { useState, useMemo, useRef, useEffect } from "react";
import type { ShopifyProduct, ShopifyCollection } from "../../../module-api";

export interface ProductCatalogTableProps {
  readonly products: readonly ShopifyProduct[];
  readonly collections?: readonly ShopifyCollection[];
  readonly isLoading: boolean;
  readonly configuredProductIds: ReadonlySet<string>;
  readonly onSelectProductForEdit: (product: ShopifyProduct) => void;
  readonly onPreviewCustomerView?: (product: ShopifyProduct) => void;
  readonly onCloneProduct?: (product: ShopifyProduct) => void;
  readonly onDeleteCustomizer: (product: ShopifyProduct) => void;

  // Optional Controlled Filter Props
  readonly filterMode?: "all" | "collection" | "asin";
  readonly onFilterModeChange?: (mode: "all" | "collection" | "asin") => void;
  readonly selectedCollectionId?: string;
  readonly onSelectedCollectionIdChange?: (id: string) => void;
  readonly searchQuery?: string;
  readonly onSearchQueryChange?: (query: string) => void;
  readonly filteredProducts?: readonly ShopifyProduct[];
}

export function extractProductAsin(product: ShopifyProduct): string | null {
  for (const tag of product.tags || []) {
    const cleanTag = tag.trim();
    if (/^B0[A-Z0-9]{8}$/i.test(cleanTag)) {
      return cleanTag.toUpperCase();
    }
    const match = cleanTag.match(/^(?:ASIN_|asin:)(B0[A-Z0-9]{8})/i);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  for (const v of product.variants || []) {
    if (v.sku) {
      const match = v.sku.match(/\b(B0[A-Z0-9]{8})\b/i);
      if (match?.[1]) {
        return match[1].toUpperCase();
      }
    }
  }

  if (product.handle) {
    const match = product.handle.match(/(?:-|^)(b0[a-z0-9]{8})(?:-|$)/i);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  if (product.title) {
    const match = product.title.match(/\b(B0[A-Z0-9]{8})\b/i);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

export function filterCatalogProducts(
  products: readonly ShopifyProduct[],
  collections: readonly ShopifyCollection[],
  filterMode: "all" | "collection" | "asin",
  selectedCollectionId: string,
  searchQuery: string,
): readonly ShopifyProduct[] {
  let result = products;

  if (filterMode === "collection") {
    if (selectedCollectionId) {
      const col = collections.find((c) => c.id === selectedCollectionId);
      if (col) {
        const colTitleLower = col.title.toLowerCase().trim();
        const colHandleLower = (col.handle || "").toLowerCase().trim();
        result = result.filter((p) => {
          const hasTag = (p.tags || []).some(
            (t) =>
              t.toLowerCase() === colTitleLower ||
              t.toLowerCase() === colHandleLower ||
              t.toLowerCase().includes(colHandleLower),
          );
          const inType = (p.productType || "").toLowerCase().includes(colTitleLower);
          const inTitle = (p.title || "").toLowerCase().includes(colTitleLower);
          const inHandle = (p.handle || "").toLowerCase().includes(colHandleLower);
          return hasTag || inType || inTitle || inHandle;
        });
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((p) => {
        const titleMatch = (p.title || "").toLowerCase().includes(q);
        const handleMatch = (p.handle || "").toLowerCase().includes(q);
        const tagMatch = (p.tags || []).some((t) => t.toLowerCase().includes(q));
        return titleMatch || handleMatch || tagMatch;
      });
    }
  } else if (filterMode === "asin") {
    const q = searchQuery.trim().toUpperCase();
    if (q) {
      result = result.filter((p) => {
        const asin = extractProductAsin(p);
        if (asin && asin.includes(q)) return true;
        const tagMatch = (p.tags || []).some((t) => t.toUpperCase().includes(q));
        const skuMatch = (p.variants || []).some((v) => (v.sku || "").toUpperCase().includes(q));
        const titleMatch = (p.title || "").toUpperCase().includes(q);
        const handleMatch = (p.handle || "").toUpperCase().includes(q);
        return tagMatch || skuMatch || titleMatch || handleMatch;
      });
    } else {
      // Prioritize showing products with detected ASIN
      const asinProducts = result.filter((p) => extractProductAsin(p) !== null);
      if (asinProducts.length > 0) {
        result = asinProducts;
      }
    }
  } else {
    // filterMode === "all"
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const qUpper = searchQuery.trim().toUpperCase();
      result = result.filter((p) => {
        const titleMatch = (p.title || "").toLowerCase().includes(q);
        const handleMatch = (p.handle || "").toLowerCase().includes(q);
        const tagMatch = (p.tags || []).some((t) => t.toLowerCase().includes(q));
        const skuMatch = (p.variants || []).some((v) => (v.sku || "").toUpperCase().includes(qUpper));
        const asin = extractProductAsin(p);
        const asinMatch = asin ? asin.includes(qUpper) : false;
        return titleMatch || handleMatch || tagMatch || skuMatch || asinMatch;
      });
    }
  }

  return result;
}

export function ProductCatalogTable({
  products,
  collections = [],
  isLoading,
  configuredProductIds,
  onSelectProductForEdit,
  onDeleteCustomizer,
  filterMode: propFilterMode,
  onFilterModeChange: propOnFilterModeChange,
  selectedCollectionId: propSelectedCollectionId,
  onSelectedCollectionIdChange: propOnSelectedCollectionIdChange,
  searchQuery: propSearchQuery,
  onSearchQueryChange: propOnSearchQueryChange,
  filteredProducts: propFilteredProducts,
}: ProductCatalogTableProps): React.JSX.Element {
  const [internalFilterMode, setInternalFilterMode] = useState<"all" | "collection" | "asin">("all");
  const [internalCollectionId, setInternalCollectionId] = useState<string>("");
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  const filterMode = propFilterMode !== undefined ? propFilterMode : internalFilterMode;
  const setFilterMode = propOnFilterModeChange ?? setInternalFilterMode;

  const selectedCollectionId =
    propSelectedCollectionId !== undefined ? propSelectedCollectionId : internalCollectionId;
  const setSelectedCollectionId = propOnSelectedCollectionIdChange ?? setInternalCollectionId;

  const searchQuery = propSearchQuery !== undefined ? propSearchQuery : internalSearchQuery;
  const setSearchQuery = propOnSearchQueryChange ?? setInternalSearchQuery;

  // Close filter dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        filterDropdownRef.current &&
        !filterDropdownRef.current.contains(event.target as Node)
      ) {
        setIsFilterDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    if (propFilteredProducts !== undefined) {
      return propFilteredProducts;
    }
    return filterCatalogProducts(products, collections, filterMode, selectedCollectionId, searchQuery);
  }, [propFilteredProducts, products, collections, filterMode, selectedCollectionId, searchQuery]);

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
      <div className="relative z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 shadow-sm backdrop-blur-sm">
        {/* Search Input with Shopify-style filter dropdown */}
        <div className="flex-1 min-w-[320px] flex items-center rounded-xl border border-slate-800 bg-slate-950 px-2 py-1 shadow-inner focus-within:border-cyan-500 transition">
          {/* Filter selector popup */}
          <div className="relative" ref={filterDropdownRef}>
            <button
              type="button"
              onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-cyan-400 transition cursor-pointer select-none rounded-lg hover:bg-slate-900"
            >
              <span>
                {filterMode === "all" && "All"}
                {filterMode === "collection" && "Collection"}
                {filterMode === "asin" && "Amazon ASIN"}
              </span>
              <span className="text-[10px] text-slate-400">▼</span>
            </button>

            {/* Dropdown Menu */}
            {isFilterDropdownOpen && (
              <div className="absolute left-0 top-full mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-900/98 p-1.5 shadow-2xl backdrop-blur-md z-50 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setFilterMode("all");
                    setIsFilterDropdownOpen(false);
                    setCurrentPage(1);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                    filterMode === "all"
                      ? "bg-cyan-600 text-white font-bold"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span>Tất cả (All)</span>
                  {filterMode === "all" && <span>✓</span>}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFilterMode("collection");
                    setIsFilterDropdownOpen(false);
                    setCurrentPage(1);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                    filterMode === "collection"
                      ? "bg-cyan-600 text-white font-bold"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>📁</span>
                    <span>Collection (Bộ sưu tập)</span>
                  </span>
                  {filterMode === "collection" && <span>✓</span>}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFilterMode("asin");
                    setIsFilterDropdownOpen(false);
                    setCurrentPage(1);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                    filterMode === "asin"
                      ? "bg-cyan-600 text-white font-bold"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>📦</span>
                    <span>Amazon ASIN</span>
                  </span>
                  {filterMode === "asin" && <span>✓</span>}
                </button>
              </div>
            )}
          </div>

          <div className="h-5 w-px bg-slate-800 mx-1 flex-shrink-0" />

          {/* If Collection mode and collections are available, show Collection Picker */}
          {filterMode === "collection" && collections.length > 0 && (
            <>
              <select
                value={selectedCollectionId}
                onChange={(e) => {
                  setSelectedCollectionId(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-cyan-300 font-semibold focus:outline-none focus:border-cyan-500 cursor-pointer max-w-[200px] truncate mr-2"
              >
                <option value="" className="bg-slate-950 text-slate-200">
                  -- Tất cả bộ sưu tập ({collections.length}) --
                </option>
                {collections.map((col) => (
                  <option key={col.id} value={col.id} className="bg-slate-950 text-slate-200">
                    {col.title} {col.productsCount ? `(${col.productsCount})` : ""}
                  </option>
                ))}
              </select>
              <div className="h-5 w-px bg-slate-800 mx-1 flex-shrink-0" />
            </>
          )}

          {/* Search input field */}
          <div className="relative flex-1 flex items-center">
            <span className="text-slate-500 text-xs mr-2">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={
                filterMode === "asin"
                  ? "Nhập mã Amazon ASIN (ví dụ: B0GQGGXN47)..."
                  : filterMode === "collection"
                    ? "Tìm kiếm trong bộ sưu tập hoặc nhập tên..."
                    : "Tìm kiếm sản phẩm theo tên, handle, tag..."
              }
              className="w-full bg-transparent py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setCurrentPage(1);
                }}
                className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer px-1.5"
                title="Xóa tìm kiếm"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Counter Badge & Reset Filter button */}
        <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
          {(filterMode !== "all" || searchQuery || selectedCollectionId) && (
            <button
              type="button"
              onClick={() => {
                setFilterMode("all");
                setSearchQuery("");
                setSelectedCollectionId("");
                setCurrentPage(1);
              }}
              className="text-xs text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
            >
              Xóa bộ lọc
            </button>
          )}
          <div>
            Hiển thị <span className="text-cyan-400 font-bold">{filteredProducts.length}</span> / {products.length} sản phẩm
          </div>
        </div>
      </div>

      {/* Products Table Card */}
      <div className="relative z-10 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden backdrop-blur-md">
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
              Không có sản phẩm nào khớp với bộ lọc hoặc từ khóa tìm kiếm.
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
                  const asin = extractProductAsin(product);

                  return (
                    <tr
                      key={product.id}
                      onClick={() => onSelectProductForEdit(product)}
                      className="hover:bg-slate-800/40 transition group cursor-pointer"
                    >
                      {/* Product Thumbnail, Title & ASIN Badge */}
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
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {product.handle && (
                                <span className="text-[11px] text-slate-500 truncate">
                                  /{product.handle}
                                </span>
                              )}
                              {asin && (
                                <span
                                  className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-300 shadow-sm"
                                  title={`Amazon ASIN: ${asin}`}
                                >
                                  <span>🏷️</span>
                                  <span>{asin}</span>
                                </span>
                              )}
                            </div>
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
