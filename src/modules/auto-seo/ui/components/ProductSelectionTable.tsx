import { useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import { filterAutoSeoProducts } from "./product-filter";

import {
  extractProductSeoVersion,
  type AutoSeoCollectionOption,
  type AutoSeoEligibilityItem,
  type SeoVersionFilter,
  type ShopifyProductForAutoSeoUi,
  type ShopifyStatusFilter,
} from "../../types";
import type { AutoSeoEligibilityFilter } from "../smart-batch";

export interface ProductSelectionTableProps {
  products: readonly ShopifyProductForAutoSeoUi[];
  selectedProductIds: readonly string[];
  searchQuery?: string;
  onSearchQueryChange?(query: string): void;
  statusFilter?: ShopifyStatusFilter;
  onStatusFilterChange?(status: ShopifyStatusFilter): void;
  filteredProducts?: readonly ShopifyProductForAutoSeoUi[];
  onToggleSelect(productId: string): void;
  onOpenDetail(product: ShopifyProductForAutoSeoUi): void;
  isLoading?: boolean;
  onLoadProducts?(): void;
  canLoadProducts?: boolean;
  eligibilityItems?: readonly AutoSeoEligibilityItem[];
  eligibilityFilter?: AutoSeoEligibilityFilter;
  onEligibilityFilterChange?(filter: AutoSeoEligibilityFilter): void;
  onSelectAllVisible?(): void;
  onClearVisibleSelection?(): void;
  typeFilter?: string;
  onTypeFilterChange?(type: string): void;
  collectionFilter?: string;
  onCollectionFilterChange?(collection: string): void;
  storeCollections?: readonly AutoSeoCollectionOption[];
  asinQuery?: string;
  onAsinQueryChange?(asin: string): void;
  startDate?: string;
  onStartDateChange?(date: string): void;
  endDate?: string;
  onEndDateChange?(date: string): void;
  seoVersionFilter?: SeoVersionFilter;
  onSeoVersionFilterChange?(version: SeoVersionFilter): void;
  onResetAllFilters?(): void;
}

export function ProductSelectionTable(props: ProductSelectionTableProps): React.JSX.Element {
  const {
    products,
    selectedProductIds,
    onToggleSelect,
    onOpenDetail,
    isLoading = false,
    storeCollections,
  } = props;

  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalStatusFilter, setInternalStatusFilter] = useState<ShopifyStatusFilter>("all");
  const [internalTypeFilter, setInternalTypeFilter] = useState("all");
  const [internalCollectionFilter, setInternalCollectionFilter] = useState("all");
  const [internalAsinQuery, setInternalAsinQuery] = useState("");
  const [internalStartDate, setInternalStartDate] = useState("");
  const [internalEndDate, setInternalEndDate] = useState("");
  const [internalSeoVersionFilter, setInternalSeoVersionFilter] = useState<SeoVersionFilter>("all");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(
    Boolean(props.asinQuery || props.startDate || props.endDate),
  );

  const masterCheckboxRef = useRef<HTMLInputElement | null>(null);

  const searchQuery = props.searchQuery !== undefined ? props.searchQuery : internalSearchQuery;
  const statusFilter = props.statusFilter !== undefined ? props.statusFilter : internalStatusFilter;
  const typeFilter = props.typeFilter !== undefined ? props.typeFilter : internalTypeFilter;
  const collectionFilter = props.collectionFilter !== undefined ? props.collectionFilter : internalCollectionFilter;
  const asinQuery = props.asinQuery !== undefined ? props.asinQuery : internalAsinQuery;
  const startDate = props.startDate !== undefined ? props.startDate : internalStartDate;
  const endDate = props.endDate !== undefined ? props.endDate : internalEndDate;
  const seoVersionFilter = props.seoVersionFilter !== undefined ? props.seoVersionFilter : internalSeoVersionFilter;

  const eligibilityByProductId = useMemo(
    () => new Map((props.eligibilityItems ?? []).map(item => [item.productId, item] as const)),
    [props.eligibilityItems],
  );

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

  const handleTypeFilterChange = (type: string): void => {
    if (props.onTypeFilterChange) {
      props.onTypeFilterChange(type);
    } else {
      setInternalTypeFilter(type);
    }
  };

  const handleCollectionFilterChange = (collection: string): void => {
    if (props.onCollectionFilterChange) {
      props.onCollectionFilterChange(collection);
    } else {
      setInternalCollectionFilter(collection);
    }
  };

  const handleAsinQueryChange = (asin: string): void => {
    if (props.onAsinQueryChange) {
      props.onAsinQueryChange(asin);
    } else {
      setInternalAsinQuery(asin);
    }
  };

  const handleStartDateChange = (date: string): void => {
    if (props.onStartDateChange) {
      props.onStartDateChange(date);
    } else {
      setInternalStartDate(date);
    }
  };

  const handleEndDateChange = (date: string): void => {
    if (props.onEndDateChange) {
      props.onEndDateChange(date);
    } else {
      setInternalEndDate(date);
    }
  };

  const handleSeoVersionFilterChange = (version: SeoVersionFilter): void => {
    if (props.onSeoVersionFilterChange) {
      props.onSeoVersionFilterChange(version);
    } else {
      setInternalSeoVersionFilter(version);
    }
  };

  const handleResetAllFilters = (): void => {
    if (props.onResetAllFilters) {
      props.onResetAllFilters();
    } else {
      handleSearchQueryChange("");
      handleStatusFilterChange("all");
      props.onEligibilityFilterChange?.("needs_seo");
      handleTypeFilterChange("all");
      handleCollectionFilterChange("all");
      handleSeoVersionFilterChange("all");
      handleAsinQueryChange("");
      handleStartDateChange("");
      handleEndDateChange("");
    }
  };

  const applyDatePreset = (preset: "today" | "7days" | "30days" | "all"): void => {
    if (preset === "all") {
      handleStartDateChange("");
      handleEndDateChange("");
      return;
    }
    const now = new Date();
    const formatDate = (d: Date) => d.toISOString().slice(0, 10);
    const todayStr = formatDate(now);
    if (preset === "today") {
      handleStartDateChange(todayStr);
      handleEndDateChange(todayStr);
    } else if (preset === "7days") {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      handleStartDateChange(formatDate(past));
      handleEndDateChange(todayStr);
    } else if (preset === "30days") {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      handleStartDateChange(formatDate(past));
      handleEndDateChange(todayStr);
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

  const eligibilityCounts = useMemo(() => {
    if (!props.eligibilityItems) return null;
    let needsSeo = 0;
    let active = 0;
    let current = 0;
    for (const item of props.eligibilityItems) {
      if (item.state === "never_processed" || item.state === "changed" || item.state === "retry") {
        needsSeo++;
      } else if (item.state === "active") {
        active++;
      } else if (item.state === "current") {
        current++;
      }
    }
    return {
      needs_seo: needsSeo,
      active,
      current,
      all: props.eligibilityItems.length,
    };
  }, [props.eligibilityItems]);

  const displayProducts = useMemo(() => {
    if (props.filteredProducts !== undefined) {
      return props.filteredProducts;
    }
    return filterAutoSeoProducts(products, {
      searchQuery,
      statusFilter,
      eligibilityFilter: props.eligibilityFilter,
      eligibilityItems: props.eligibilityItems,
      typeFilter,
      collectionFilter,
      seoVersionFilter,
      asinQuery,
      startDate,
      endDate,
    });
  }, [
    props.filteredProducts,
    products,
    searchQuery,
    statusFilter,
    props.eligibilityFilter,
    props.eligibilityItems,
    typeFilter,
    collectionFilter,
    seoVersionFilter,
    asinQuery,
    startDate,
    endDate,
  ]);

  const availableTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      const type = product.productType?.trim();
      if (type) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [products]);

  const availableCollections = useMemo(() => {
    if (storeCollections && storeCollections.length > 0) {
      return storeCollections.map((col) => ({
        id: col.id,
        name: col.title,
        count: col.productsCount,
      }));
    }

    const counts = new Map<string, { id: string; count: number }>();
    for (const product of products) {
      if (product.collections) {
        for (const col of product.collections) {
          const title = col.title?.trim();
          if (title) {
            const existing = counts.get(title) ?? { id: col.id || title, count: 0 };
            existing.count += 1;
            counts.set(title, existing);
          }
        }
      }
      if (product.tags) {
        for (const tag of product.tags) {
          const lower = tag.toLowerCase();
          if (lower.startsWith("collection:") || lower.startsWith("col:")) {
            const colName = tag.split(":")[1]?.trim();
            if (colName) {
              const existing = counts.get(colName) ?? { id: colName, count: 0 };
              existing.count += 1;
              counts.set(colName, existing);
            }
          }
        }
      }
    }
    return Array.from(counts.entries())
      .map(([name, { id, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count);
  }, [products, storeCollections]);

  const hasActiveAdvancedFilters = Boolean(
    asinQuery || startDate || endDate || (collectionFilter && collectionFilter !== "all"),
  );
  const activeAdvancedFilterCount = [
    Boolean(asinQuery),
    Boolean(startDate || endDate),
    Boolean(collectionFilter && collectionFilter !== "all"),
  ].filter(Boolean).length;

  const isAnyFilterActive = Boolean(
    searchQuery ||
    statusFilter !== "all" ||
    (props.eligibilityFilter && props.eligibilityFilter !== "all") ||
    typeFilter !== "all" ||
    collectionFilter !== "all" ||
    seoVersionFilter !== "all" ||
    asinQuery ||
    startDate ||
    endDate,
  );

  const selectedVisibleCount = useMemo(() => {
    const idSet = new Set(selectedProductIds);
    return displayProducts.filter((p) => idSet.has(p.id)).length;
  }, [displayProducts, selectedProductIds]);

  const isAllVisibleSelected =
    displayProducts.length > 0 && selectedVisibleCount === displayProducts.length;
  const isPartiallySelected =
    selectedVisibleCount > 0 && selectedVisibleCount < displayProducts.length;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  const handleMasterCheckboxChange = (): void => {
    if (isAllVisibleSelected || isPartiallySelected) {
      if (props.onClearVisibleSelection) {
        props.onClearVisibleSelection();
      } else {
        const visibleIdSet = new Set(displayProducts.map((p) => p.id));
        for (const id of selectedProductIds) {
          if (visibleIdSet.has(id)) {
            onToggleSelect(id);
          }
        }
      }
    } else {
      if (props.onSelectAllVisible) {
        props.onSelectAllVisible();
      } else {
        const selectedSet = new Set(selectedProductIds);
        for (const p of displayProducts) {
          if (!selectedSet.has(p.id)) {
            onToggleSelect(p.id);
          }
        }
      }
    }
  };

  if (products.length === 0) {
    if (isLoading) {
      return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/60 text-2xl text-blue-700 dark:text-blue-300 mb-3 animate-pulse">
            <AppIcon name="clock" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Đang tải sản phẩm từ cửa hàng...</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto mt-1">
            Vui lòng chờ trong giây lát trong khi danh sách sản phẩm được đồng bộ từ Shopify.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 dark:bg-slate-800 text-2xl text-slate-600 dark:text-slate-400 mb-3">
          <AppIcon name="folder" />
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Chưa có sản phẩm nào được tải</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto mt-1">
          Chọn cửa hàng rồi tải danh sách để lọc và chọn sản phẩm cần làm SEO.
        </p>
        {props.onLoadProducts ? <button type="button" disabled={!props.canLoadProducts} onClick={props.onLoadProducts} className="mt-5 min-h-9 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">Tải sản phẩm từ Shopify</button> : null}
      </div>
    );
  }

  const statusTabs: readonly { readonly id: ShopifyStatusFilter; readonly label: string }[] = [
    { id: "all", label: `Tất cả (${statusCounts.all})` },
    { id: "ACTIVE", label: `Active (${statusCounts.ACTIVE})` },
    { id: "DRAFT", label: `Draft (${statusCounts.DRAFT})` },
    { id: "ARCHIVED", label: `Archived (${statusCounts.ARCHIVED})` },
  ];

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shadow-sm overflow-hidden backdrop-blur-sm">
      {/* Table Filter Header */}
      <div className="border-b border-slate-200 dark:border-slate-700 p-3 sm:p-4 space-y-3 bg-slate-50 dark:bg-slate-800">
        {/* Row 1: Compact, Responsive Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
          {/* Left: Search input */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchQueryChange(e.target.value)}
              placeholder="🔍 Tìm theo tiêu đề, handle, ID, SKU..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-3 pr-7 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchQueryChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
                title="Xóa tìm kiếm"
              >
                ✕
              </button>
            )}
          </div>

          {/* Right: Compact Dropdowns & Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Shopify Status Select */}
            <div className="relative flex items-center gap-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">Shopify:</span>
              <select
                aria-label="Lọc theo trạng thái Shopify"
                value={statusFilter}
                onChange={(e) => handleStatusFilterChange(e.target.value as ShopifyStatusFilter)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 cursor-pointer"
              >
                {statusTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </div>

            {/* SEO Eligibility Select */}
            {props.eligibilityItems && (
              <div className="relative flex items-center gap-1.5">
                <span className="text-xs text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">SEO:</span>
                <select
                  aria-label="Lọc theo trạng thái SEO"
                  value={props.eligibilityFilter ?? "needs_seo"}
                  onChange={(e) => props.onEligibilityFilterChange?.(e.target.value as AutoSeoEligibilityFilter)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-blue-600/30 cursor-pointer ${
                    (props.eligibilityFilter ?? "needs_seo") === "needs_seo"
                      ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                      : props.eligibilityFilter === "active"
                        ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                        : props.eligibilityFilter === "current"
                          ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  }`}
                >
                  <option value="needs_seo">
                    <AppIcon name="seo" /> Cần SEO {eligibilityCounts ? `(${eligibilityCounts.needs_seo})` : ""}
                  </option>
                  <option value="active">
                    🟣 Đang xử lý {eligibilityCounts ? `(${eligibilityCounts.active})` : ""}
                  </option>
                  <option value="current">
                    🟢 Đã SEO {eligibilityCounts ? `(${eligibilityCounts.current})` : ""}
                  </option>
                  <option value="all">
                    Tất cả {eligibilityCounts ? `(${eligibilityCounts.all})` : ""}
                  </option>
                </select>
              </div>
            )}

            {/* Product Type Filter Select */}
            {availableTypes.length > 0 && (
              <div className="relative">
                <select
                  aria-label="Lọc theo loại sản phẩm"
                  value={typeFilter}
                  onChange={(e) => handleTypeFilterChange(e.target.value)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-blue-600/30 cursor-pointer max-w-[170px] truncate ${
                    typeFilter !== "all"
                      ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold"
                      : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <option value="all"><AppIcon name="folder" /> Loại SP: Tất cả</option>
                  {availableTypes.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} ({t.count})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Collection Filter Select */}
            <div className="relative">
              <select
                aria-label="Lọc theo Collection"
                value={collectionFilter}
                onChange={(e) => handleCollectionFilterChange(e.target.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-blue-600/30 cursor-pointer max-w-[220px] truncate ${
                  collectionFilter !== "all"
                    ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold"
                    : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                }`}
              >
                <option value="all" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                  {availableCollections.length > 0
                    ? `-- Tất cả bộ sưu tập (${availableCollections.length}) --`
                    : "🏷️ Collection: Tất cả"}
                </option>
                {availableCollections.map((col) => (
                  <option key={col.id} value={col.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                    {col.name} {col.count !== undefined ? `(${col.count})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* SEO Version Filter Select */}
            <div className="relative flex items-center gap-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">Version:</span>
              <select
                aria-label="Lọc theo phiên bản SEO"
                value={seoVersionFilter}
                onChange={(e) => handleSeoVersionFilterChange(e.target.value as SeoVersionFilter)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-blue-600/30 cursor-pointer ${
                  seoVersionFilter !== "all"
                    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300 dark:ring-emerald-400"
                    : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                }`}
              >
                <option value="all">Tất cả phiên bản</option>
                <option value="v0">Chưa SEO (v0)</option>
                <option value="v1">Phiên bản v1</option>
                <option value="v2">Phiên bản v2</option>
                <option value="v3_plus">Phiên bản v3+</option>
                <option value="v_any">Đã qua SEO (v1+)</option>
              </select>
            </div>

            {/* Advanced Filters Button (ASIN + Date Range) */}
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                isAdvancedOpen || hasActiveAdvancedFilters
                  ? "bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-semibold shadow-xs"
                  : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              <span><AppIcon name="settings" /></span> Bộ lọc nâng cao
              {activeAdvancedFilterCount > 0 && (
                <span className="rounded-full bg-blue-600 text-white text-xs font-bold px-1.5 py-0.2">
                  {activeAdvancedFilterCount}
                </span>
              )}
              <span className="text-xs">{isAdvancedOpen ? "▲" : "▼"}</span>
            </button>

            {/* Reset All Filters Button */}
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleResetAllFilters}
                className="text-xs text-rose-700 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-300 hover:underline px-1 py-1 transition cursor-pointer whitespace-nowrap"
                title="Xóa tất cả các bộ lọc đang chọn"
              >
                ✕ Xóa lọc
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Advanced Filter Drawer (ASIN & Date Range) */}
        {(isAdvancedOpen || Boolean(asinQuery || startDate || endDate)) && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
            {/* 1. Amazon ASIN Filter */}
            <div className="space-y-1">
              <label htmlFor="filter-asin-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <span><AppIcon name="folder" /></span> Lọc theo Amazon ASIN:
              </label>
              <div className="relative">
                <input
                  id="filter-asin-input"
                  type="text"
                  value={asinQuery}
                  onChange={(e) => handleAsinQueryChange(e.target.value)}
                  placeholder="Nhập ASIN (vd: B08N5WRWNW, B0...)"
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 font-mono uppercase"
                />
                {asinQuery && (
                  <button
                    type="button"
                    onClick={() => handleAsinQueryChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* 2. Date Range Picker (Từ ngày -> Đến ngày) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <span>📅</span> Ngày up sản phẩm:
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Từ ngày"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 flex-1"
                />
                <span className="text-slate-500 dark:text-slate-400 text-xs">→</span>
                <input
                  type="date"
                  aria-label="Đến ngày"
                  value={endDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 flex-1"
                />
                {(startDate || endDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      handleStartDateChange("");
                      handleEndDateChange("");
                    }}
                    className="text-xs text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-300 px-1 cursor-pointer"
                    title="Xóa khoảng ngày"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* 3. Quick Date Presets */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Chọn nhanh khoảng ngày:
              </label>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => applyDatePreset("today")}
                  className="rounded-md bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 transition cursor-pointer"
                >
                  Hôm nay
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset("7days")}
                  className="rounded-md bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 transition cursor-pointer"
                >
                  7 ngày qua
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset("30days")}
                  className="rounded-md bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 transition cursor-pointer"
                >
                  30 ngày qua
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset("all")}
                  className="rounded-md bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 transition cursor-pointer"
                >
                  Tất cả ngày
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Row 3: Active Filter Chips */}
        {isAnyFilterActive && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Đang lọc:</span>

            {searchQuery && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-slate-700 dark:text-slate-300">
                Từ khóa: &ldquo;{searchQuery}&rdquo;
                <button
                  type="button"
                  onClick={() => handleSearchQueryChange("")}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}

            {statusFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-slate-700 dark:text-slate-300">
                Shopify: {statusFilter}
                <button
                  type="button"
                  onClick={() => handleStatusFilterChange("all")}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}

            {props.eligibilityFilter && props.eligibilityFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-slate-700 dark:text-slate-300">
                SEO: {props.eligibilityFilter === "needs_seo" ? "Cần SEO" : props.eligibilityFilter === "active" ? "Đang xử lý" : "Đã SEO"}
                <button
                  type="button"
                  onClick={() => props.onEligibilityFilterChange?.("all")}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}

            {typeFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-blue-700 dark:text-blue-300">
                Loại SP: {typeFilter}
                <button
                  type="button"
                  onClick={() => handleTypeFilterChange("all")}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}

            {collectionFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-blue-700 dark:text-blue-300">
                BST:{" "}
                {availableCollections.find(
                  (c) => c.id === collectionFilter || c.name === collectionFilter,
                )?.name ?? collectionFilter}
                <button
                  type="button"
                  onClick={() => handleCollectionFilterChange("all")}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}

            {seoVersionFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                Phiên bản: {
                  seoVersionFilter === "v0"
                    ? "Chưa SEO (v0)"
                    : seoVersionFilter === "v1"
                      ? "v1"
                      : seoVersionFilter === "v2"
                        ? "v2"
                        : seoVersionFilter === "v3_plus"
                          ? "v3+"
                          : "v1+"
                }
                <button
                  type="button"
                  onClick={() => handleSeoVersionFilterChange("all")}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}

            {asinQuery && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-blue-700 dark:text-blue-300 font-mono">
                ASIN: {asinQuery}
                <button
                  type="button"
                  onClick={() => handleAsinQueryChange("")}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}

            {(startDate || endDate) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                Ngày: {startDate || "..."} → {endDate || "..."}
                <button
                  type="button"
                  onClick={() => {
                    handleStartDateChange("");
                    handleEndDateChange("");
                  }}
                  className="hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table Data */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            <tr>
              <th scope="col" className="p-3.5 text-center w-10">
                <label className="inline-flex cursor-pointer items-center justify-center">
                  <input
                    ref={masterCheckboxRef}
                    type="checkbox"
                    checked={isAllVisibleSelected}
                    onChange={handleMasterCheckboxChange}
                    disabled={displayProducts.length === 0}
                    title={
                      isAllVisibleSelected
                        ? "Bỏ chọn tất cả sản phẩm đang hiển thị"
                        : isPartiallySelected
                          ? `Đang chọn ${selectedVisibleCount}/${displayProducts.length} sản phẩm (click để bỏ chọn)`
                          : `Chọn tất cả ${displayProducts.length} sản phẩm đang hiển thị`
                    }
                    aria-label="Chọn hoặc bỏ chọn tất cả sản phẩm đang hiển thị"
                    className="h-4 w-4 rounded-sm border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 focus:ring-blue-300 dark:focus:ring-blue-400 focus:ring-offset-slate-950 cursor-pointer disabled:opacity-40"
                  />
                </label>
              </th>
              <th scope="col" className="py-3.5 px-3 text-center w-12 font-medium">STT</th>
              <th scope="col" className="py-3.5 px-3 w-16 font-medium">Ảnh</th>
              <th scope="col" className="py-3.5 px-3 font-medium">Tiêu đề sản phẩm</th>
              <th scope="col" className="py-3.5 px-3 font-medium hidden md:table-cell">Product ID</th>
              <th scope="col" className="py-3.5 px-3 font-medium hidden lg:table-cell">Handle</th>
              <th scope="col" className="py-3.5 px-3 font-medium text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {displayProducts.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400 text-xs">
                  Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              displayProducts.map((product, index) => {
              const isSelected = selectedProductIds.includes(product.id);
              const thumbnailUrl = product.featuredImage?.url ?? product.images?.[0]?.url;
              const thumbnailAlt =
                product.featuredImage?.altText ?? product.images?.[0]?.altText ?? product.title;
              const upperStatus = (product.status ?? "").toUpperCase();
              const eligibility = eligibilityByProductId.get(product.id);
              const productVersion = product.seoVersion ?? extractProductSeoVersion(product.tags) ?? 0;

              return (
                <tr
                  key={product.id}
                  onClick={() => onOpenDetail(product)}
                  className={`group cursor-pointer transition ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-50 dark:hover:bg-blue-950/80"
                      : "hover:bg-slate-50 dark:hover:bg-slate-700"
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
                        className="h-4 w-4 rounded-sm border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 focus:ring-blue-300 dark:focus:ring-blue-400 focus:ring-offset-slate-950 cursor-pointer"
                      />
                    </label>
                  </td>

                  {/* STT */}
                  <td className="py-3.5 px-3 text-center text-slate-500 dark:text-slate-400 font-mono">
                    {index + 1}
                  </td>

                  {/* Thumbnail */}
                  <td className="py-3.5 px-3">
                    {thumbnailUrl ? (
                      <div className="h-12 w-12 overflow-hidden rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shadow-xs">
                        <img
                          src={thumbnailUrl}
                          alt={thumbnailAlt}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 text-center">
                        No image
                      </div>
                    )}
                  </td>

                  {/* Title & tags */}
                  <td className="py-3.5 px-3 max-w-xs sm:max-w-sm">
                    <div className="flex items-start gap-2">
                      <button type="button" aria-label={`Xem chi tiết ${product.title}`} onClick={event => { event.stopPropagation(); onOpenDetail(product); }} className="min-h-8 flex-1 text-left font-semibold text-slate-900 dark:text-slate-100 transition-colors line-clamp-2 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                        {product.title}
                      </button>
                      {productVersion > 0 ? (
                        <span className="shrink-0 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          v{productVersion}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                          v0
                        </span>
                      )}
                    </div>
                    {eligibility && <EligibilityBadge state={eligibility.state} />}
                    {product.tags && product.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {product.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-xs bg-slate-50 dark:bg-slate-800 px-1.5 py-0.2 text-xs text-slate-600 dark:text-slate-400"
                          >
                            #{tag}
                          </span>
                        ))}
                        {product.tags.length > 3 && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            +{product.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Product ID */}
                  <td className="py-3.5 px-3 hidden md:table-cell font-mono text-xs text-slate-600 dark:text-slate-400">
                    <span title={product.id}>
                      {product.id.replace("gid://shopify/Product/", "prod:")}
                    </span>
                  </td>

                  {/* Handle */}
                  <td className="py-3.5 px-3 hidden lg:table-cell font-mono text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate">
                    {product.handle}
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-3 text-center">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                        upperStatus === "ACTIVE"
                          ? "bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                          : upperStatus === "DRAFT"
                            ? "bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
                            : upperStatus === "ARCHIVED"
                              ? "bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                              : "bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {upperStatus || "UNKNOWN"}
                    </span>
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <span>Hiển thị {displayProducts.length} / {products.length} sản phẩm</span>
        <span>Click hàng để xem chi tiết sản phẩm (PDP Drawer)</span>
      </div>
    </div>
  );
}

function EligibilityBadge({ state }: { readonly state: AutoSeoEligibilityItem["state"] }): React.JSX.Element {
  const labels: Readonly<Record<AutoSeoEligibilityItem["state"], string>> = {
    never_processed: "Chưa SEO",
    changed: "Có thay đổi",
    retry: "Thử lại",
    current: "Đã SEO",
    active: "Đang xử lý",
  };
  const colors: Readonly<Record<AutoSeoEligibilityItem["state"], string>> = {
    never_processed: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300",
    changed: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300",
    retry: "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300",
    current: "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300",
    active: "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300",
  };
  return (
    <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-xs font-semibold ${colors[state]}`}>
      {labels[state]}
    </span>
  );
}
