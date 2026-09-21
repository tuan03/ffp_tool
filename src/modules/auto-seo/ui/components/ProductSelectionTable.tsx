import { useMemo, useState } from "react";

import { ProductDecisionBadge } from "./ProductDecisionBadge";
import { filterAutoSeoProducts } from "./product-filter";

import type {
  ProductReviewDecision,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
} from "../../types";

export interface ProductSelectionTableProps {
  products: readonly ShopifyProductForAutoSeoUi[];
  selectedProductIds: readonly string[];
  decisions: Record<string, ProductReviewDecision>;
  searchQuery?: string;
  onSearchQueryChange?(query: string): void;
  statusFilter?: ShopifyStatusFilter;
  onStatusFilterChange?(status: ShopifyStatusFilter): void;
  decisionFilter?: string;
  onDecisionFilterChange?(decision: string): void;
  filteredProducts?: readonly ShopifyProductForAutoSeoUi[];
  onToggleSelect(productId: string): void;
  onApprove(productId: string): void;
  onEdit(product: ShopifyProductForAutoSeoUi): void;
  onMarkDraft(productId: string): void;
  onSkip(productId: string): void;
  onOpenDetail(product: ShopifyProductForAutoSeoUi): void;
}

export function ProductSelectionTable(props: ProductSelectionTableProps): React.JSX.Element {
  const {
    products,
    selectedProductIds,
    decisions,
    onToggleSelect,
    onApprove,
    onEdit,
    onMarkDraft,
    onSkip,
    onOpenDetail,
  } = props;

  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalStatusFilter, setInternalStatusFilter] = useState<ShopifyStatusFilter>("all");
  const [internalDecisionFilter, setInternalDecisionFilter] = useState<string>("all");

  const searchQuery = props.searchQuery !== undefined ? props.searchQuery : internalSearchQuery;
  const statusFilter = props.statusFilter !== undefined ? props.statusFilter : internalStatusFilter;
  const decisionFilter = props.decisionFilter !== undefined ? props.decisionFilter : internalDecisionFilter;

  const handleSearchQueryChange = (query: string): void => {
    if (props.onSearchQueryChange) {
      props.onSearchQueryChange(query);
    } else {
      setInternalSearchQuery(query);
    }
  };

  const handleStatusFilterChange = (status: ShopifyStatusFilter): void => {
    if (props.onStatusFilterChange) {
      props.onStatusFilterChange(status);
    } else {
      setInternalStatusFilter(status);
    }
  };

  const handleDecisionFilterChange = (decision: string): void => {
    if (props.onDecisionFilterChange) {
      props.onDecisionFilterChange(decision);
    } else {
      setInternalDecisionFilter(decision);
    }
  };

  const statusCounts = useMemo(() => {
    let active = 0;
    let draft = 0;
    let archived = 0;

    for (const product of products) {
      const status = (product.status ?? "").toUpperCase();
      if (status === "ACTIVE") {
        active++;
      } else if (status === "DRAFT") {
        draft++;
      } else if (status === "ARCHIVED") {
        archived++;
      }
    }

    return {
      all: products.length,
      ACTIVE: active,
      DRAFT: draft,
      ARCHIVED: archived,
    };
  }, [products]);

  const displayProducts = useMemo(() => {
    if (props.filteredProducts !== undefined) {
      return props.filteredProducts;
    }
    return filterAutoSeoProducts(products, {
      searchQuery,
      statusFilter,
      decisionFilter,
      decisions,
      selectedProductIds,
    });
  }, [
    props.filteredProducts,
    products,
    searchQuery,
    statusFilter,
    decisionFilter,
    decisions,
    selectedProductIds,
  ]);

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/80 text-2xl text-slate-400 mb-3">
          📦
        </div>
        <h3 className="text-base font-semibold text-slate-200">Chưa có sản phẩm nào được tải</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
          Bấm nút <strong>&quot;Tải sản phẩm (Shopify)&quot;</strong> ở trên để lấy danh sách sản phẩm từ cửa hàng.
        </p>
      </div>
    );
  }

  const statusTabs: readonly { readonly id: ShopifyStatusFilter; readonly label: string }[] = [
    { id: "all", label: `Tất cả (${statusCounts.all})` },
    { id: "ACTIVE", label: `Active (${statusCounts.ACTIVE})` },
    { id: "DRAFT", label: `Draft (${statusCounts.DRAFT})` },
    { id: "ARCHIVED", label: `Archived (${statusCounts.ARCHIVED})` },
  ];

  const decisionTabs: readonly { readonly id: string; readonly label: string }[] = [
    { id: "all", label: "Tất cả" },
    { id: "selected", label: `Đã chọn (${selectedProductIds.length})` },
    { id: "approved", label: "Đã duyệt" },
    { id: "needs_edit", label: "Cần sửa" },
    { id: "mark_draft", label: "Draft" },
    { id: "skipped", label: "Bỏ qua" },
  ];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden backdrop-blur-sm">
      {/* Table Filter Header */}
      <div className="border-b border-slate-800 p-4 bg-slate-900/90 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-sm">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchQueryChange(e.target.value)}
              placeholder="Tìm theo tiêu đề, handle, ID..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchQueryChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
              >
                ✕
              </button>
            )}
          </div>

          {/* Shopify Status Filter Group */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
              Status:
            </span>
            {statusTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleStatusFilterChange(tab.id)}
                className={`rounded-md px-2.5 py-1 transition ${
                  statusFilter === tab.id
                    ? "bg-cyan-950 border border-cyan-700 text-cyan-300 font-semibold"
                    : "bg-slate-800/60 border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Review Decision Filter Row */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs pt-2 border-t border-slate-800/60">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
            Quyết định:
          </span>
          {decisionTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleDecisionFilterChange(tab.id)}
              className={`rounded-md px-2.5 py-1 transition ${
                decisionFilter === tab.id
                  ? "bg-cyan-950 border border-cyan-700 text-cyan-300 font-semibold"
                  : "bg-slate-800/60 border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table Data */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-950/70 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" className="p-3.5 text-center w-10">
                <span className="sr-only">Chọn</span>
              </th>
              <th scope="col" className="py-3.5 px-3 text-center w-12 font-medium">STT</th>
              <th scope="col" className="py-3.5 px-3 w-16 font-medium">Ảnh</th>
              <th scope="col" className="py-3.5 px-3 font-medium">Tiêu đề sản phẩm</th>
              <th scope="col" className="py-3.5 px-3 font-medium hidden md:table-cell">Product ID</th>
              <th scope="col" className="py-3.5 px-3 font-medium hidden lg:table-cell">Handle</th>
              <th scope="col" className="py-3.5 px-3 font-medium text-center">Status</th>
              <th scope="col" className="py-3.5 px-3 font-medium text-center">Quyết định</th>
              <th scope="col" className="py-3.5 px-3 font-medium text-right pr-4">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {displayProducts.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-500 text-xs">
                  Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              displayProducts.map((product, index) => {
              const isSelected = selectedProductIds.includes(product.id);
              const decision = decisions[product.id] ?? "pending";
              const thumbnailUrl = product.featuredImage?.url ?? product.images?.[0]?.url;
              const thumbnailAlt =
                product.featuredImage?.altText ?? product.images?.[0]?.altText ?? product.title;
              const upperStatus = (product.status ?? "").toUpperCase();

              return (
                <tr
                  key={product.id}
                  onClick={() => onOpenDetail(product)}
                  className={`group cursor-pointer transition ${
                    isSelected
                      ? "bg-cyan-950/20 hover:bg-cyan-950/30"
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  {/* Checkbox */}
                  <td
                    className="p-3.5 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label className="inline-flex cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(product.id)}
                        className="h-4 w-4 rounded-sm border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-950 cursor-pointer"
                      />
                    </label>
                  </td>

                  {/* STT */}
                  <td className="py-3.5 px-3 text-center text-slate-500 font-mono">
                    {index + 1}
                  </td>

                  {/* Thumbnail */}
                  <td className="py-3.5 px-3">
                    {thumbnailUrl ? (
                      <div className="h-12 w-12 overflow-hidden rounded-md border border-slate-700 bg-slate-800 shadow-xs">
                        <img
                          src={thumbnailUrl}
                          alt={thumbnailAlt}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-slate-700 bg-slate-800/50 text-[10px] text-slate-500 text-center">
                        No image
                      </div>
                    )}
                  </td>

                  {/* Title & tags */}
                  <td className="py-3.5 px-3 max-w-xs sm:max-w-sm">
                    <div className="font-semibold text-slate-200 group-hover:text-cyan-300 transition-colors line-clamp-2">
                      {product.title}
                    </div>
                    {product.tags && product.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {product.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-xs bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-400"
                          >
                            #{tag}
                          </span>
                        ))}
                        {product.tags.length > 3 && (
                          <span className="text-[10px] text-slate-500">
                            +{product.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Product ID */}
                  <td className="py-3.5 px-3 hidden md:table-cell font-mono text-[11px] text-slate-400">
                    <span title={product.id}>
                      {product.id.replace("gid://shopify/Product/", "prod:")}
                    </span>
                  </td>

                  {/* Handle */}
                  <td className="py-3.5 px-3 hidden lg:table-cell font-mono text-[11px] text-slate-400 max-w-xs truncate">
                    {product.handle}
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-3 text-center">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        upperStatus === "ACTIVE"
                          ? "bg-emerald-950/70 border border-emerald-800 text-emerald-300"
                          : upperStatus === "DRAFT"
                            ? "bg-amber-950/70 border border-amber-800 text-amber-300"
                            : upperStatus === "ARCHIVED"
                              ? "bg-purple-950/70 border border-purple-800 text-purple-300"
                              : "bg-slate-800 border border-slate-700 text-slate-400"
                      }`}
                    >
                      {upperStatus || "UNKNOWN"}
                    </span>
                  </td>

                  {/* Decision Badge */}
                  <td className="py-3.5 px-3 text-center">
                    <ProductDecisionBadge decision={decision} />
                  </td>

                  {/* Actions */}
                  <td
                    className="py-3.5 px-3 text-right pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Duyệt Button */}
                      <button
                        type="button"
                        onClick={() => onApprove(product.id)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                          decision === "approved"
                            ? "bg-emerald-900/70 text-emerald-300 border border-emerald-700"
                            : "bg-slate-800 text-slate-300 hover:bg-emerald-950 hover:text-emerald-300 border border-slate-700 hover:border-emerald-800"
                        }`}
                        title="Duyệt và chọn cho Auto SEO"
                      >
                        ✓ Duyệt
                      </button>

                      {/* Sửa Button */}
                      <button
                        type="button"
                        onClick={() => onEdit(product)}
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 border border-slate-700 hover:bg-amber-950 hover:text-amber-300 hover:border-amber-800 transition"
                        title="Mở chi tiết và đánh dấu cần sửa"
                      >
                        ✎ Sửa
                      </button>

                      {/* Draft Button */}
                      <button
                        type="button"
                        onClick={() => onMarkDraft(product.id)}
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 border border-slate-700 hover:bg-purple-950 hover:text-purple-300 hover:border-purple-800 transition"
                        title="Đánh dấu chuyển Draft"
                      >
                        Draft
                      </button>

                      {/* Bỏ Button */}
                      <button
                        type="button"
                        onClick={() => onSkip(product.id)}
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-400 border border-slate-700 hover:bg-rose-950 hover:text-rose-300 hover:border-rose-800 transition"
                        title="Bỏ qua sản phẩm này"
                      >
                        ✕ Bỏ
                      </button>
                    </div>
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2.5 bg-slate-950/80 text-[11px] text-slate-500">
        <span>Hiển thị {displayProducts.length} / {products.length} sản phẩm</span>
        <span>Click hàng để xem chi tiết sản phẩm (PDP Drawer)</span>
      </div>
    </div>
  );
}
