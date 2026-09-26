import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { ProductCustomization } from "../../customization-normalizer";
import {
  deleteCustomization,
  readCustomization,
  updateCustomization,
  validateCustomizationPayloadSize,
} from "../service";
import type {
  CustomizationGateway,
  ReadCustomizationOutput,
} from "../types";
import { mockCustomizationConfig } from "../mocks/data";
import { createCustomizationGatewayAdapter } from "../../module-api/gateway-adapter";
import type {
  ModuleApiRunner,
  ShopifyProduct,
  ShopifyStoreSummary,
} from "../../module-api";
import { shopifyMockProducts } from "../../module-api/mocks/data";
import { SurfaceManager } from "./components/SurfaceManager";
import { OptionGroupEditor } from "./components/OptionGroupEditor";
import { ProductCatalogTable } from "./components/ProductCatalogTable";

export interface CustomizationManagerPageProps {
  readonly moduleApiRunner?: ModuleApiRunner;
  readonly defaultStoreId?: string;
}

const FALLBACK_STORES: readonly ShopifyStoreSummary[] = [
  { storeId: "chillgen", shopDomain: "chillgen.myshopify.com", authType: "static", connected: true },
  { storeId: "capozen", shopDomain: "capozen.myshopify.com", authType: "static", connected: true },
  { storeId: "jeminise", shopDomain: "jeminise.myshopify.com", authType: "static", connected: true },
  { storeId: "quickstart-demo", shopDomain: "quickstart-demo.myshopify.com", authType: "static", connected: true },
];

export function CustomizationManagerPage({
  moduleApiRunner,
  defaultStoreId = "capozen",
}: CustomizationManagerPageProps): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlProductId = searchParams.get("productId") || "";
  const urlStoreId = searchParams.get("storeId") || defaultStoreId;

  // Stores State
  const [stores, setStores] = useState<readonly ShopifyStoreSummary[]>(FALLBACK_STORES);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(urlStoreId);
  const [isLoadingStores, setIsLoadingStores] = useState(false);

  // Products Catalog State
  const [products, setProducts] = useState<readonly ShopifyProduct[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [configuredProductIds, setConfiguredProductIds] = useState<Set<string>>(
    new Set(["gid://shopify/Product/1001", "1001"]),
  );

  // Active View Mode: 'catalog' or 'editor'
  const [viewMode, setViewMode] = useState<"catalog" | "editor">(
    urlProductId ? "editor" : "catalog",
  );

  // Selected Product for Editing / Preview
  const [activeProduct, setActiveProduct] = useState<ShopifyProduct | null>(null);
  const [activeProductId, setActiveProductId] = useState<string>(urlProductId);

  // Studio Sub-tab for Editor Controls: 'surfaces' | 'options' | 'raw'
  const [studioTab, setStudioTab] = useState<"surfaces" | "options" | "raw">("surfaces");

  // Customization Data State
  const [customization, setCustomization] = useState<ProductCustomization | null>(null);
  const [, setTrackedFileIds] = useState<readonly string[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Live Customer Preview Interactive State
  const [activeSurfaceIndex, setActiveSurfaceIndex] = useState(0);
  const [previewTestText, setPreviewTestText] = useState("Tên Của Bạn");
  const [previewTestFont, setPreviewTestFont] = useState("sans-serif");
  const [previewTestColor, setPreviewTestColor] = useState("#ffffff");

  // Gateway Adapter for Customization API
  const gateway: CustomizationGateway = useMemo(() => {
    return createCustomizationGatewayAdapter(selectedStoreId || "default-store", {
      runner: moduleApiRunner,
    });
  }, [selectedStoreId, moduleApiRunner]);

  // Real-time payload size calculation
  const payloadValidation = useMemo(() => {
    if (!customization) return { byteSize: 0, isSafe: true };
    return validateCustomizationPayloadSize(customization);
  }, [customization]);

  // 1. Load Stores on mount
  useEffect(() => {
    let isMounted = true;
    async function loadStores() {
      if (!moduleApiRunner) return;
      setIsLoadingStores(true);
      try {
        const response = await moduleApiRunner({
          storeId: selectedStoreId || "default",
          operation: "stores.list",
          payload: {},
        });
        const fetchedStores = response?.data?.stores;
        if (isMounted && Array.isArray(fetchedStores) && fetchedStores.length > 0) {
          setStores(fetchedStores);
          if (!selectedStoreId || !fetchedStores.some((s) => s.storeId === selectedStoreId)) {
            setSelectedStoreId(fetchedStores[0].storeId);
          }
        }
      } catch {
        // Fallback to FALLBACK_STORES
      } finally {
        if (isMounted) setIsLoadingStores(false);
      }
    }
    void loadStores();
    return () => {
      isMounted = false;
    };
  }, [moduleApiRunner]);

  // 2. Load Products whenever selectedStoreId changes
  useEffect(() => {
    let isMounted = true;
    async function loadStoreProducts() {
      setIsLoadingProducts(true);
      try {
        let loadedProducts: readonly ShopifyProduct[] = [];
        if (moduleApiRunner) {
          try {
            const res = await moduleApiRunner({
              storeId: selectedStoreId,
              operation: "products.list",
              payload: { limit: 100 },
            });
            if (Array.isArray(res?.data?.products) && res.data.products.length > 0) {
              loadedProducts = res.data.products;
            }
          } catch {
            loadedProducts = shopifyMockProducts;
          }
        } else {
          loadedProducts = shopifyMockProducts;
        }

        if (isMounted) {
          setProducts(loadedProducts);
          // Mark only products that actually have customizer configured
          const detected = new Set<string>();
          for (const p of loadedProducts) {
            if (p.hasCustomizer) {
              detected.add(p.id);
              detected.add(p.id.replace("gid://shopify/Product/", ""));
            }
          }
          setConfiguredProductIds(detected);

          // If navigated in with urlProductId, match active product
          if (urlProductId && !activeProduct) {
            const match = loadedProducts.find(
              (p) => p.id === urlProductId || p.id.replace("gid://shopify/Product/", "") === urlProductId,
            );
            if (match) {
              setActiveProduct(match);
            }
          }
        }
      } catch {
        if (isMounted) setProducts(shopifyMockProducts);
      } finally {
        if (isMounted) setIsLoadingProducts(false);
      }
    }

    void loadStoreProducts();
    return () => {
      isMounted = false;
    };
  }, [selectedStoreId, moduleApiRunner, urlProductId]);

  // 3. Load Customization Config for a specific product
  const loadProductConfig = async (prod: ShopifyProduct) => {
    setActiveProduct(prod);
    setActiveProductId(prod.id);
    setViewMode("editor");
    setIsLoadingConfig(true);
    setStatusMessage(null);
    setActiveSurfaceIndex(0);
    setSearchParams({ productId: prod.id, storeId: selectedStoreId });

    try {
      const result: ReadCustomizationOutput = await readCustomization(gateway, {
        productId: prod.id,
      });

      if (result.exists && result.customization) {
        setCustomization(result.customization);
        setTrackedFileIds(result.trackedFileIds);
        setConfiguredProductIds((prev) => new Set([...prev, prod.id, prod.id.replace("gid://shopify/Product/", "")]));
        setStatusMessage({
          type: "success",
          text: `Đã nạp thành công cấu hình Customizer của sản phẩm.`,
        });
      } else {
        // Fallback: Product has no customizer metafield yet
        setCustomization(null);
        setTrackedFileIds([]);
        setConfiguredProductIds((prev) => {
          const next = new Set(prev);
          next.delete(prod.id);
          next.delete(prod.id.replace("gid://shopify/Product/", ""));
          return next;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Lỗi khi tải cấu hình: ${msg}` });
      setCustomization(null);
    } finally {
      setIsLoadingConfig(false);
    }
  };

  // Auto-load config if urlProductId is present on mount
  useEffect(() => {
    if (urlProductId) {
      void (async () => {
        setIsLoadingConfig(true);
        try {
          const result = await readCustomization(gateway, { productId: urlProductId });
          if (result.exists && result.customization) {
            setCustomization(result.customization);
            setTrackedFileIds(result.trackedFileIds);
            setConfiguredProductIds((prev) => new Set([...prev, urlProductId]));
          }
        } catch {
          // Ignore
        } finally {
          setIsLoadingConfig(false);
        }
      })();
    }
  }, [urlProductId, gateway]);

  // Quick action: Initialize a new customizer config based on product image
  const handleInitializeFromProduct = () => {
    if (!activeProduct) return;
    const imgUrl =
      activeProduct.featuredImage?.url ||
      activeProduct.images?.[0]?.url ||
      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80";

    const initialConfig: ProductCustomization = {
      product: {
        id: activeProduct.id,
        title: activeProduct.title,
        handle: activeProduct.handle,
        productImageUrl: imgUrl,
      },
      surfaces: [
        {
          name: "Mặt trước",
          surfaceId: "surface_front",
          previewUrl: imgUrl,
          placements: [
            {
              name: "Vùng in tên",
              placementId: "placement_text_1",
              allowedTypes: ["text"],
            },
          ],
        },
      ],
      optionGroups: [
        {
          id: "font_group",
          label: "Kiểu Chữ (Font Style)",
          type: "select",
          required: false,
          options: [
            { id: "font_sans", label: "Sans-serif", isAvailable: true },
            { id: "font_serif", label: "Playfair Serif", isAvailable: true },
            { id: "font_script", label: "Pacifico Script", isAvailable: true },
          ],
        },
      ],
      assets: [],
    };

    setCustomization(initialConfig);
    setConfiguredProductIds((prev) => new Set([...prev, activeProduct.id]));
    setStatusMessage({
      type: "info",
      text: "Đã khởi tạo phôi tùy biến từ hình ảnh sản phẩm. Bạn có thể chỉnh sửa và bấm 'Lưu Thay Đổi'.",
    });
  };

  // Save Customization to Shopify Metafield custom.amazon_customizer
  const handleSaveConfig = async () => {
    if (!activeProductId || !customization) return;

    if (!payloadValidation.isSafe) {
      const proceed = window.confirm(
        `Cảnh báo: Dung lượng cấu hình (${(payloadValidation.byteSize / 1024).toFixed(1)} KB) đã vượt trần 128 KB của Shopify Metafield. Bạn có muốn tiếp tục lưu không?`,
      );
      if (!proceed) return;
    }

    setIsSaving(true);
    setStatusMessage(null);
    try {
      const result = await updateCustomization(gateway, {
        productId: activeProductId,
        customization,
        autoCleanReplacedAssets: true,
      });

      if (result.success) {
        setConfiguredProductIds((prev) => new Set([...prev, activeProductId]));
        setStatusMessage({
          type: "success",
          text: `Đã lưu cấu hình Customizer lên Shopify thành công!`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Lỗi khi lưu cấu hình: ${msg}` });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Customization Metafield
  const handleDeleteConfig = async (targetProduct?: ShopifyProduct) => {
    const prod = targetProduct || activeProduct;
    const prodId = prod?.id || activeProductId;
    if (!prodId) return;

    const confirmed = window.confirm(
      `Bạn có chắc chắn muốn xóa cấu hình Customizer của sản phẩm "${prod?.title || prodId}" không?`,
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setStatusMessage(null);
    try {
      const result = await deleteCustomization(gateway, {
        productId: prodId,
        cascadeDeleteFiles: false,
      });

      if (result.success) {
        setConfiguredProductIds((prev) => {
          const next = new Set(prev);
          next.delete(prodId);
          return next;
        });
        if (prodId === activeProductId) {
          setCustomization(null);
          setTrackedFileIds([]);
        }
        setStatusMessage({
          type: "success",
          text: `Đã xóa cấu hình Customizer thành công!`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Lỗi khi xóa: ${msg}` });
    } finally {
      setIsDeleting(false);
    }
  };

  // Active Surface for Preview Mockup
  const surfaces = (customization?.surfaces as any[]) || [];
  const activeSurface = surfaces[activeSurfaceIndex] || surfaces[0] || null;

  // Active Mockup Image
  const previewMockupUrl =
    activeSurface?.previewUrl ||
    activeSurface?.baseImage?.url ||
    activeProduct?.featuredImage?.url ||
    activeProduct?.images?.[0]?.url ||
    "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80";

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8 text-slate-100 font-sans">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* VIEW MODE 1: CATALOG VIEW */}
        {viewMode === "catalog" && (
          <div className="space-y-6">
            {/* Header: Store Selector & Module Title */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl backdrop-blur-md">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-xl">
                    🎨
                  </span>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-100">
                      Quản Lý Tùy Biến Sản Phẩm
                    </h1>
                    <p className="text-xs text-slate-400">
                      Xem trực quan giao diện khách hàng và chỉnh sửa cấu hình in ấn theo sản phẩm
                    </p>
                  </div>
                </div>
              </div>

              {/* Store Selector */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Cửa hàng:
                </span>
                <select
                  value={selectedStoreId}
                  onChange={(e) => {
                    setSelectedStoreId(e.target.value);
                    setSearchParams({ storeId: e.target.value });
                  }}
                  disabled={isLoadingStores}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-bold text-cyan-300 focus:border-cyan-500 focus:outline-none cursor-pointer shadow-inner min-w-[220px]"
                >
                  {stores.map((s) => (
                    <option key={s.storeId} value={s.storeId}>
                      {s.storeId} ({s.shopDomain || `${s.storeId}.myshopify.com`})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Notification message */}
            {statusMessage && (
              <div
                className={`rounded-2xl border p-4 text-xs flex items-center justify-between shadow-md ${
                  statusMessage.type === "success"
                    ? "border-emerald-800/80 bg-emerald-950/50 text-emerald-300"
                    : statusMessage.type === "error"
                      ? "border-rose-800/80 bg-rose-950/50 text-rose-300"
                      : "border-cyan-800/80 bg-cyan-950/50 text-cyan-300"
                }`}
              >
                <span className="font-medium">{statusMessage.text}</span>
                <button
                  type="button"
                  onClick={() => setStatusMessage(null)}
                  className="text-slate-400 hover:text-slate-200 ml-4 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Product Catalog Table */}
            <ProductCatalogTable
              products={products}
              isLoading={isLoadingProducts}
              configuredProductIds={configuredProductIds}
              onSelectProductForEdit={loadProductConfig}
              onDeleteCustomizer={handleDeleteConfig}
            />
          </div>
        )}

        {/* VIEW MODE 2: UNIFIED VISUAL LIVE STUDIO */}
        {viewMode === "editor" && activeProduct && (
          <div className="space-y-6">
            {/* Studio Navigation & Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("catalog");
                    setSearchParams({ storeId: selectedStoreId });
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer shadow-sm"
                >
                  <span>←</span>
                  <span>Danh Sách Sản Phẩm</span>
                </button>

                <div className="h-6 w-px bg-slate-800 hidden sm:block" />

                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 flex-shrink-0 rounded-lg overflow-hidden border border-slate-700 bg-slate-950">
                    <img
                      src={
                        activeProduct.featuredImage?.url ||
                        activeProduct.images?.[0]?.url ||
                        previewMockupUrl
                      }
                      alt={activeProduct.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-100 max-w-md truncate">
                      {activeProduct.title}
                    </h2>
                    <span className="text-[11px] text-slate-400">
                      {activeProduct.handle ? `/${activeProduct.handle}` : activeProduct.id}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Delete & Save */}
              <div className="flex items-center gap-2.5">
                {customization && (
                  <button
                    type="button"
                    onClick={() => handleDeleteConfig()}
                    disabled={isDeleting}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-800/80 bg-rose-950/40 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-900/50 transition cursor-pointer"
                  >
                    <span>🗑️</span>
                    <span>{isDeleting ? "Đang xóa..." : "Xóa Customizer"}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={isSaving || !customization}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/50 hover:from-emerald-500 hover:to-teal-400 disabled:opacity-50 transition cursor-pointer"
                >
                  <span>💾</span>
                  <span>{isSaving ? "Đang lưu lên Shopify..." : "Lưu Thay Đổi"}</span>
                </button>
              </div>
            </div>

            {/* Notification message */}
            {statusMessage && (
              <div
                className={`rounded-2xl border p-4 text-xs flex items-center justify-between shadow-md ${
                  statusMessage.type === "success"
                    ? "border-emerald-800/80 bg-emerald-950/50 text-emerald-300"
                    : statusMessage.type === "error"
                      ? "border-rose-800/80 bg-rose-950/50 text-rose-300"
                      : "border-cyan-800/80 bg-cyan-950/50 text-cyan-300"
                }`}
              >
                <span className="font-medium">{statusMessage.text}</span>
                <button
                  type="button"
                  onClick={() => setStatusMessage(null)}
                  className="text-slate-400 hover:text-slate-200 ml-4 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {/* If product has no customization yet */}
            {isLoadingConfig ? (
              <div className="p-20 text-center space-y-3 rounded-3xl border border-slate-800 bg-slate-900/40">
                <span className="inline-block animate-spin text-3xl">⏳</span>
                <p className="text-xs text-slate-400">Đang nạp cấu hình tùy biến của sản phẩm...</p>
              </div>
            ) : !customization ? (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-16 text-center space-y-4">
                <span className="text-4xl block">🎨</span>
                <h3 className="text-base font-bold text-slate-200">
                  Sản phẩm này chưa có cấu hình tùy biến
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Bạn có thể khởi tạo cấu hình in ấn ngay bây giờ từ hình ảnh hiện tại của sản phẩm để bắt đầu tùy chỉnh.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleInitializeFromProduct}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-950/50 hover:bg-cyan-500 transition cursor-pointer"
                  >
                    <span>✨</span>
                    <span>Khởi Tạo Cấu Hình Ngay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomization(mockCustomizationConfig);
                      setStatusMessage({
                        type: "info",
                        text: "Đã nạp mẫu cấu hình chăn ga demo. Bạn có thể sửa đổi và bấm Lưu.",
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition cursor-pointer"
                  >
                    <span>Nạp Bản Mẫu Demo</span>
                  </button>
                </div>
              </div>
            ) : (
              /* UNIFIED 2-COLUMN STUDIO: Live Customer Preview on Left, Direct Controls on Right */
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* LEFT COLUMN: Customer Mockup Canvas & Live Preview (7/12) */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl backdrop-blur-md space-y-5">
                    {/* Surface Switcher Pills */}
                    <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider mr-1">
                          Mặt in:
                        </span>
                        {surfaces.map((s, idx) => (
                          <button
                            key={s.surfaceId || idx}
                            type="button"
                            onClick={() => setActiveSurfaceIndex(idx)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                              activeSurfaceIndex === idx
                                ? "bg-cyan-600 text-white shadow-md shadow-cyan-950/40"
                                : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {s.name || `Mặt in ${idx + 1}`}
                          </button>
                        ))}
                      </div>

                      <span className="rounded-full bg-emerald-950/80 border border-emerald-800 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
                        Góc Nhìn Khách Hàng
                      </span>
                    </div>

                    {/* Interactive Mockup Container */}
                    <div className="relative mx-auto w-full max-w-lg aspect-square rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center shadow-inner group">
                      <img
                        src={previewMockupUrl}
                        alt={activeSurface?.name || "Mockup"}
                        className="w-full h-full object-contain select-none"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80";
                        }}
                      />

                      {/* Real-time Placement Area Overlay with Live Text */}
                      <div className="absolute inset-x-1/4 top-1/4 bottom-1/3 border-2 border-dashed border-cyan-400/60 rounded-xl flex items-center justify-center p-3 pointer-events-none group-hover:border-cyan-400 transition">
                        <div
                          className="text-center font-bold break-words max-w-full drop-shadow-md select-none transition-all duration-200"
                          style={{
                            fontFamily: previewTestFont,
                            color: previewTestColor,
                            fontSize:
                              previewTestText.length > 20
                                ? "14px"
                                : previewTestText.length > 10
                                  ? "18px"
                                  : "24px",
                          }}
                        >
                          {previewTestText || "Nhập tên của bạn"}
                        </div>
                        <span className="absolute top-1 left-1.5 text-[9px] font-mono text-cyan-300/80 bg-slate-950/80 px-1.5 py-0.5 rounded">
                          Vùng in (Print Area)
                        </span>
                      </div>
                    </div>

                    {/* Customer Interactive Test Controls */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-300">
                          ✍️ Thử nghiệm góc nhìn khách hàng (Live Sandbox):
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Thay đổi bên dưới sẽ phản chiếu ngay lên mockup
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-1">
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Nội dung chữ in:
                          </label>
                          <input
                            type="text"
                            value={previewTestText}
                            onChange={(e) => setPreviewTestText(e.target.value)}
                            placeholder="Nhập tên..."
                            maxLength={30}
                            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Kiểu font:
                          </label>
                          <select
                            value={previewTestFont}
                            onChange={(e) => setPreviewTestFont(e.target.value)}
                            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none cursor-pointer"
                          >
                            <option value="sans-serif">Mặc định (Sans-serif)</option>
                            <option value="'Playfair Display', serif">Playfair Serif</option>
                            <option value="'Pacifico', cursive">Viết tay Pacifico</option>
                            <option value="'Impact', fantasy">Đậm nét Impact</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Màu chữ:
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={previewTestColor}
                              onChange={(e) => setPreviewTestColor(e.target.value)}
                              className="h-8 w-10 cursor-pointer rounded-lg border border-slate-800 bg-slate-900 p-0.5"
                            />
                            <span className="text-xs font-mono text-slate-400 uppercase">
                              {previewTestColor}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: Direct Customizer Configuration (5/12) */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl backdrop-blur-md space-y-5">
                    {/* Studio Sub-tabs */}
                    <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setStudioTab("surfaces")}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-center ${
                          studioTab === "surfaces"
                            ? "bg-cyan-600 text-white shadow-md shadow-cyan-950/40"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        🖼️ Mặt In & Phôi ({surfaces.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => setStudioTab("options")}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-center ${
                          studioTab === "options"
                            ? "bg-cyan-600 text-white shadow-md shadow-cyan-950/40"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        🎨 Lựa Chọn & Màu ({(customization.optionGroups || []).length})
                      </button>

                      <button
                        type="button"
                        onClick={() => setStudioTab("raw")}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                          studioTab === "raw"
                            ? "bg-cyan-600 text-white shadow-md shadow-cyan-950/40"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                        title="Xem cấu trúc Metafield JSON"
                      >
                        ⚡ JSON
                      </button>
                    </div>

                    {/* Sub-tab 1: Surfaces Editor */}
                    {studioTab === "surfaces" && (
                      <div className="space-y-4">
                        <SurfaceManager
                          surfaces={(customization.surfaces as any) || []}
                          onChange={(updated) =>
                            setCustomization({ ...customization, surfaces: updated })
                          }
                        />
                      </div>
                    )}

                    {/* Sub-tab 2: Option Groups & Choices Editor */}
                    {studioTab === "options" && (
                      <div className="space-y-4">
                        <OptionGroupEditor
                          groups={customization.optionGroups || []}
                          onChange={(updated) =>
                            setCustomization({ ...customization, optionGroups: updated })
                          }
                        />
                      </div>
                    )}

                    {/* Sub-tab 3: Clean Raw Metafield JSON */}
                    {studioTab === "raw" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Metafield: <strong className="text-cyan-400">custom.amazon_customizer</strong></span>
                          <span className="font-mono text-slate-400">
                            {payloadValidation.byteSize} bytes
                          </span>
                        </div>
                        <pre className="max-h-96 overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs font-mono text-cyan-300">
                          {JSON.stringify(customization, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
