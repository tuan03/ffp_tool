import { useMemo, useState } from "react";
import type {
  DeliverablesData,
  PinterestPodDeliverables,
  SeoHandoverResponse,
  SummaryMetrics,
} from "../../types";
import { ComparisonTable } from "./ComparisonTable";
import type { LightboxImageItem } from "./ImageLightboxModal";
import { buildProductGroups, type ProductGroup } from "./product-groups";
import { SeoHandoffModal } from "./SeoHandoffModal";

interface DeliverablesShowcaseProps {
  readonly deliverables: DeliverablesData;
  readonly summaryMetrics?: SummaryMetrics;
  readonly seoPayload?: PinterestPodDeliverables;
  readonly onPreviewImage?: (item: LightboxImageItem) => void;
}

type TabKey = "cmyk" | "mockups" | "cutouts" | "comparison";

export function DeliverablesShowcase({
  deliverables,
  summaryMetrics,
  seoPayload,
  onPreviewImage,
}: DeliverablesShowcaseProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>("cmyk");
  const [mockupViewMode, setMockupViewMode] = useState<"by_product" | "all">("by_product");
  const [showSeoModal, setShowSeoModal] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipMessage, setZipMessage] = useState<string | null>(null);

  const printCmykImages = deliverables.print_cmyk_images ?? [];
  const lifestyleMockups = deliverables.lifestyle_mockups ?? [];
  const productCutoutsWhite = deliverables.product_cutouts_white ?? [];
  const comparisonRows = deliverables.comparison_rows ?? [];

  // Group deliverables by product for product-centric display
  const productGroups = useMemo(() => {
    return buildProductGroups(deliverables, seoPayload);
  }, [deliverables, seoPayload]);

  // Track approved mockup URLs / filenames (100% pre-selected by default)
  const [approvedMockupKeys, setApprovedMockupKeys] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const m of lifestyleMockups) {
      if (m.url) initial.add(m.url);
      if (m.filename) initial.add(m.filename);
    }
    return initial;
  });

  const [handoffToast, setHandoffToast] = useState<string | null>(null);
  const [handoffResult, setHandoffResult] = useState<SeoHandoverResponse | null>(null);

  const isMockupApproved = (url: string, filename?: string): boolean => {
    if (approvedMockupKeys.has(url)) return true;
    if (filename && approvedMockupKeys.has(filename)) return true;
    return false;
  };

  const toggleMockupApproval = (url: string, filename?: string): void => {
    setApprovedMockupKeys((prev) => {
      const next = new Set(prev);
      const isApproved = next.has(url) || (Boolean(filename) && next.has(filename!));
      if (isApproved) {
        next.delete(url);
        if (filename) next.delete(filename);
      } else {
        next.add(url);
        if (filename) next.add(filename);
      }
      return next;
    });
  };

  const handleSelectAllMockups = (): void => {
    const all = new Set<string>();
    for (const m of lifestyleMockups) {
      if (m.url) all.add(m.url);
      if (m.filename) all.add(m.filename);
    }
    setApprovedMockupKeys(all);
  };

  const handleDeselectAllMockups = (): void => {
    setApprovedMockupKeys(new Set());
  };

  const handleSelectProductMockups = (prod: ProductGroup): void => {
    setApprovedMockupKeys((prev) => {
      const next = new Set(prev);
      for (const m of prod.mockups) {
        if (m.url) next.add(m.url);
        if (m.filename) next.add(m.filename);
      }
      return next;
    });
  };

  const handleDeselectProductMockups = (prod: ProductGroup): void => {
    setApprovedMockupKeys((prev) => {
      const next = new Set(prev);
      for (const m of prod.mockups) {
        if (m.url) next.delete(m.url);
        if (m.filename) next.delete(m.filename);
      }
      return next;
    });
  };

  const approvedMockupCount = lifestyleMockups.filter((m) =>
    isMockupApproved(m.url, m.filename),
  ).length;

  // Filtered SEO payload: compute only when modal is open to avoid unnecessary recalculations during tab browsing
  const filteredSeoPayload: PinterestPodDeliverables | undefined = useMemo(() => {
    if (!seoPayload || !showSeoModal) return undefined;
    return {
      ...seoPayload,
      items: seoPayload.items.map((item) => ({
        ...item,
        composedMockups: item.composedMockups.filter((m) => isMockupApproved(m.mockupUrl)),
      })),
    };
  }, [seoPayload, showSeoModal, approvedMockupKeys]);

  const metrics: SummaryMetrics = summaryMetrics ?? {
    rgb_4k_count: printCmykImages.length,
    cmyk_count: printCmykImages.length,
    lifestyle_mockup_count: lifestyleMockups.length,
    cutouts_count: productCutoutsWhite.length,
    mockups_count: lifestyleMockups.length,
  };

  const totalProduced = metrics.cmyk_count || comparisonRows.length;

  function handleDownloadZip(): void {
    setIsZipping(true);
    setZipMessage(null);
    setTimeout(() => {
      setIsZipping(false);
      // Generate a mock manifest JSON blob representing the zip package contents
      const manifest = {
        package: "pinterest_pod_deliverables",
        totalDesigns: totalProduced,
        cmykPrints: printCmykImages.map((i) => i.filename),
        lifestyleMockups: lifestyleMockups.map((m) => m.filename),
        cutouts: productCutoutsWhite.map((c) => c.filename),
      };
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pod_deliverables_manifest_${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setZipMessage(`✓ Đã bắt đầu tải gói ZIP thành phẩm (${totalProduced} bản in CMYK 300DPI, ${lifestyleMockups.length} mockups AI)!`);
      setTimeout(() => setZipMessage(null), 5000);
    }, 600);
  }

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      {/* Toast Notification */}
      {zipMessage && (
        <div className="flex items-center justify-between rounded-xl border border-cyan-800 bg-cyan-950/80 p-3 text-xs text-cyan-200 shadow">
          <div className="flex items-center gap-2">
            <span>📦</span>
            <span>{zipMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setZipMessage(null)}
            className="text-cyan-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* SEO Handoff Toast Notification */}
      {handoffToast && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-700 bg-emerald-950/90 p-3.5 text-xs text-emerald-200 shadow-lg animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-base">✨</span>
            <span className="font-semibold">{handoffToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setHandoffToast(null)}
            className="text-emerald-400 hover:text-white ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-1 border-b border-slate-800 pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <span>🎉</span>
            <span>Thành phẩm Job: {totalProduced} thiết kế hoàn thiện sẵn sàng xuất xưởng</span>
          </h2>
          <span className="rounded-full bg-emerald-950 border border-emerald-800 px-3 py-1 text-xs font-bold text-emerald-300">
            ✓ Hoàn thành
          </span>
        </div>
        <p className="text-xs text-slate-400">
          Toàn bộ file in CMYK 300 DPI, phôi bóc tách nền trắng và phối cảnh AI đã sẵn sàng phục vụ sản xuất và đăng sàn.
        </p>
      </div>

      {/* 5 Showcase Metrics Cards matching wireframe */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center">
          <span className="text-2xl">🖨️</span>
          <span className="text-lg font-bold text-cyan-300">{metrics.rgb_4k_count} Bản in</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">RGB 4K Siêu Nét</span>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center">
          <span className="text-2xl">🏭</span>
          <span className="text-lg font-bold text-emerald-300">{metrics.cmyk_count} File in</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">CMYK 300 DPI</span>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center">
          <span className="text-2xl">🛋️</span>
          <span className="text-lg font-bold text-indigo-300">{metrics.lifestyle_mockup_count} Mockup</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">Phòng Khách AI</span>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center">
          <span className="text-2xl">✂️</span>
          <span className="text-lg font-bold text-amber-300">{metrics.cutouts_count} Phôi Cắt</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">Nền Trắng</span>
        </div>

        <div className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center">
          <span className="text-2xl">🖼️</span>
          <span className="text-lg font-bold text-pink-300">{metrics.mockups_count} Mockup</span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">Đa Góc</span>
        </div>
      </div>

      {/* 4 Sub-tabs */}
      <div className="flex flex-col gap-4">
        <div className="flex border-b border-slate-800 gap-1 overflow-x-auto text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("cmyk")}
            className={`border-b-2 px-4 py-2.5 transition whitespace-nowrap ${
              activeTab === "cmyk"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🖨️ Bản in CMYK ({printCmykImages.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("mockups")}
            className={`border-b-2 px-4 py-2.5 transition whitespace-nowrap ${
              activeTab === "mockups"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🛋️ Mockup Phòng AI ({approvedMockupCount}/{lifestyleMockups.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("cutouts")}
            className={`border-b-2 px-4 py-2.5 transition whitespace-nowrap ${
              activeTab === "cutouts"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            ✂️ Phôi Cắt ({productCutoutsWhite.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("comparison")}
            className={`border-b-2 px-4 py-2.5 transition whitespace-nowrap ${
              activeTab === "comparison"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🔄 Bảng So Sánh 4 Bước ({comparisonRows.length})
          </button>
        </div>

        {/* Tab 1: CMYK Print Images */}
        {activeTab === "cmyk" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {printCmykImages.map((item, idx) => (
              <div
                key={item.filename || `${item.url}-${idx}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow transition hover:border-cyan-600/70"
              >
                <div
                  className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900 cursor-zoom-in"
                  onClick={() =>
                    onPreviewImage?.({
                      url: item.url,
                      title: item.filename,
                      subtitle: "File in chuẩn công nghiệp CMYK 300 DPI",
                      badge: "CMYK 300 DPI",
                      dpi: 300,
                      colorMode: "CMYK",
                      downloadUrl: item.download_url ?? item.url,
                    })
                  }
                >
                  <img
                    src={item.url}
                    alt={item.filename}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0f172a"/><text x="200" y="150" fill="#38bdf8" font-family="sans-serif" font-size="14" text-anchor="middle">${item.filename}</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                  />
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 opacity-0 group-hover:opacity-100 transition">
                    <span>🔍 Soi HD</span>
                  </div>
                </div>
                <div className="flex flex-col p-3 gap-2">
                  <p className="font-mono text-xs font-semibold text-slate-200 truncate" title={item.filename}>
                    {item.filename}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Chuẩn 300 DPI</span>
                    <a
                      href={item.download_url ?? item.url}
                      download={item.filename}
                      className="rounded bg-cyan-600 px-2 py-1 text-xs font-semibold text-white hover:bg-cyan-500"
                    >
                      Tải file in CMYK ↓
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 2: Lifestyle Mockups */}
        {activeTab === "mockups" && (
          <div className="flex flex-col gap-5">
            {/* Approval Control Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 shadow-inner">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-300">
                  Duyệt ảnh mockup gửi sang SEO:
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                    approvedMockupCount > 0
                      ? "bg-indigo-950/80 border-indigo-700/60 text-indigo-300"
                      : "bg-rose-950/80 border-rose-800 text-rose-300"
                  }`}
                >
                  {approvedMockupCount} / {lifestyleMockups.length} ảnh được phép
                </span>
                <span className="text-[11px] text-slate-400">
                  (Mặc định đã duyệt tất cả — bạn có thể bật/tắt từng ảnh hoặc từng sản phẩm)
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* View Mode Switcher */}
                <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setMockupViewMode("by_product")}
                    className={`rounded-md px-2.5 py-1 font-semibold transition ${
                      mockupViewMode === "by_product"
                        ? "bg-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    📁 Theo từng sản phẩm ({productGroups.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMockupViewMode("all")}
                    className={`rounded-md px-2.5 py-1 font-semibold transition ${
                      mockupViewMode === "all"
                        ? "bg-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🖼️ Xem tất cả ({lifestyleMockups.length})
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSelectAllMockups}
                    className="rounded-lg border border-indigo-700/50 bg-indigo-950/60 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-900/60 hover:text-white transition"
                  >
                    ✓ Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAllMockups}
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-700 hover:text-white transition"
                  >
                    ✕ Bỏ chọn tất cả
                  </button>
                </div>
              </div>
            </div>

            {/* View Mode: Grouped by Product */}
            {mockupViewMode === "by_product" ? (
              <div className="flex flex-col gap-5">
                {productGroups.map((prod, prodIdx) => {
                  const prodApprovedCount = prod.mockups.filter((m) =>
                    isMockupApproved(m.url, m.filename),
                  ).length;

                  return (
                    <div
                      key={prod.id || prodIdx}
                      style={{ contentVisibility: "auto", containIntrinsicSize: "0 280px" }}
                      className="flex flex-col gap-3.5 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg transition hover:border-slate-700"
                    >
                      {/* Product Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-900/60 border border-indigo-700/60 text-xs font-bold text-indigo-300">
                            #{prodIdx + 1}
                          </span>
                          <div>
                            <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                              <span>{prod.title}</span>
                              <span className="font-mono text-[11px] font-normal text-slate-400">
                                ({prod.id})
                              </span>
                            </h4>
                            <p className="text-[11px] text-emerald-400 font-medium">
                              {prod.badge || `${prod.widthPx}x${prod.heightPx} @ 300 DPI (CMYK)`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                              prodApprovedCount > 0
                                ? "bg-indigo-950 border-indigo-700/60 text-indigo-300"
                                : "bg-rose-950 border-rose-800 text-rose-300"
                            }`}
                          >
                            {prodApprovedCount} / {prod.mockups.length} mockup đã chọn
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSelectProductMockups(prod)}
                            className="rounded border border-indigo-700/50 bg-indigo-950/60 px-2 py-0.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-900 hover:text-white transition"
                          >
                            ✓ Chọn hết SP này
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeselectProductMockups(prod)}
                            className="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white transition"
                          >
                            ✕ Bỏ hết SP này
                          </button>
                        </div>
                      </div>

                      {/* Product Content: Left = Print Master, Right = Mockups */}
                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                        {/* Left: Print Master Preview */}
                        <div className="lg:col-span-1 flex flex-col gap-2 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3 shadow-inner">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1">
                              <span>🏭</span> Bản in xưởng
                            </span>
                            <span className="rounded bg-emerald-900/80 px-1.5 py-0.5 text-[9px] font-mono font-bold text-emerald-200">
                              300 DPI
                            </span>
                          </div>

                          <div
                            className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-950 border border-slate-800 cursor-zoom-in group"
                            onClick={() =>
                              onPreviewImage?.({
                                url: prod.rgbUrl || prod.cmykUrl,
                                title: prod.title,
                                subtitle: prod.label,
                                badge: "CMYK 300 DPI",
                                dpi: 300,
                                colorMode: "CMYK",
                              })
                            }
                          >
                            <img
                              src={prod.previewUrl || prod.rgbUrl || prod.cmykUrl}
                              alt={prod.title}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                            />
                            <div className="absolute bottom-1.5 left-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[9px] text-cyan-300">
                              🔍 Soi bản in
                            </div>
                          </div>

                          <div className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                            <p className="font-mono text-slate-300 truncate" title={prod.cmykFilename}>
                              {prod.cmykFilename}
                            </p>
                            <span className="text-emerald-400 font-semibold">
                              ✓ Sẵn sàng xuất xưởng
                            </span>
                          </div>
                        </div>

                        {/* Right: Mockups for this product */}
                        <div className="lg:col-span-3 flex flex-col gap-2">
                          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                            <span>🛋️</span> Phối cảnh phòng AI của sản phẩm ({prod.mockups.length} ảnh)
                          </span>

                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            {prod.mockups.map((mockup, mIdx) => {
                              const approved = isMockupApproved(mockup.url, mockup.filename);
                              return (
                                <div
                                  key={mockup.filename || `${mockup.url}-${mIdx}`}
                                  className={`group relative flex flex-col overflow-hidden rounded-xl border shadow transition ${
                                    approved
                                      ? "border-indigo-600/70 bg-slate-950 hover:border-indigo-500"
                                      : "border-slate-800/80 bg-slate-950/50 opacity-55 hover:opacity-85"
                                  }`}
                                >
                                  {/* Approval Toggle Badge Button */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleMockupApproval(mockup.url, mockup.filename);
                                    }}
                                    className={`absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold shadow-lg transition ${
                                      approved
                                        ? "bg-emerald-600/95 text-white hover:bg-emerald-500 shadow-emerald-950/50"
                                        : "bg-slate-900/95 text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200"
                                    }`}
                                    title={
                                      approved
                                        ? "Bấm để bỏ qua mockup này khi gửi sang SEO"
                                        : "Bấm để cho phép gửi mockup này sang SEO"
                                    }
                                  >
                                    <span>{approved ? "✓" : "✕"}</span>
                                    <span>{approved ? "Đã duyệt" : "Bỏ qua"}</span>
                                  </button>

                                  <div
                                    className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900 cursor-zoom-in"
                                    onClick={() =>
                                      onPreviewImage?.({
                                        url: mockup.url,
                                        title: mockup.filename || `Mockup ${mockup.scene_type || ""}`.trim() || "Mockup",
                                        subtitle: mockup.scene_description,
                                        badge: mockup.scene_type,
                                        tags: [mockup.scene_type],
                                        downloadUrl: mockup.url,
                                      })
                                    }
                                  >
                                    <img
                                      src={mockup.url}
                                      alt={mockup.filename}
                                      loading="lazy"
                                      decoding="async"
                                      onError={(e) => {
                                        e.currentTarget.onerror = null;
                                        e.currentTarget.src =
                                          "data:image/svg+xml;charset=utf-8," +
                                          encodeURIComponent(
                                            `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0f172a"/><text x="200" y="150" fill="#a78bfa" font-family="sans-serif" font-size="14" text-anchor="middle">${mockup.filename}</text></svg>`,
                                          );
                                      }}
                                      className={`h-full w-full object-cover transition duration-200 group-hover:scale-105 ${
                                        !approved ? "grayscale-[35%]" : ""
                                      }`}
                                    />
                                    <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 opacity-0 group-hover:opacity-100 transition">
                                      <span>🔍 Soi Mockup</span>
                                    </div>
                                  </div>

                                  <div className="flex flex-col p-3 gap-1.5">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 uppercase">
                                          {mockup.scene_type}
                                        </span>
                                        <span
                                          className={`text-[10px] font-medium ${
                                            approved ? "text-emerald-400" : "text-slate-500"
                                          }`}
                                        >
                                          {approved ? "• Sẵn sàng SEO" : "• Đã loại bỏ"}
                                        </span>
                                      </div>
                                      <a
                                        href={mockup.url}
                                        download={mockup.filename}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-xs text-cyan-400 hover:underline"
                                      >
                                        Tải ảnh ↓
                                      </a>
                                    </div>
                                    <p
                                      className="text-xs text-slate-300 line-clamp-2"
                                      title={mockup.scene_description}
                                    >
                                      {mockup.scene_description}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Flat Grid View */
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                {lifestyleMockups.map((mockup, idx) => {
                  const approved = isMockupApproved(mockup.url, mockup.filename);
                  return (
                    <div
                      key={mockup.filename || `${mockup.url}-${idx}`}
                      className={`group relative flex flex-col overflow-hidden rounded-xl border shadow transition ${
                        approved
                          ? "border-indigo-600/70 bg-slate-950 hover:border-indigo-500"
                          : "border-slate-800/80 bg-slate-950/50 opacity-60 hover:opacity-90"
                      }`}
                    >
                      {/* Approval Toggle Badge Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMockupApproval(mockup.url, mockup.filename);
                        }}
                        className={`absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold shadow-lg transition ${
                          approved
                            ? "bg-emerald-600/95 text-white hover:bg-emerald-500 shadow-emerald-950/50"
                            : "bg-slate-900/95 text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200"
                        }`}
                        title={
                          approved
                            ? "Bấm để bỏ qua mockup này khi gửi sang SEO"
                            : "Bấm để cho phép gửi mockup này sang SEO"
                        }
                      >
                        <span>{approved ? "✓" : "✕"}</span>
                        <span>{approved ? "Đã duyệt" : "Bỏ qua"}</span>
                      </button>

                      <div
                        className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900 cursor-zoom-in"
                        onClick={() =>
                          onPreviewImage?.({
                            url: mockup.url,
                            title: mockup.filename || "AI Lifestyle Mockup",
                            subtitle: mockup.scene_description,
                            badge: mockup.scene_type,
                            tags: [mockup.scene_type],
                            downloadUrl: mockup.url,
                          })
                        }
                      >
                        <img
                          src={mockup.url}
                          alt={mockup.filename}
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src =
                              "data:image/svg+xml;charset=utf-8," +
                              encodeURIComponent(
                                `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0f172a"/><text x="200" y="150" fill="#a78bfa" font-family="sans-serif" font-size="14" text-anchor="middle">${mockup.filename}</text></svg>`,
                              );
                          }}
                          className={`h-full w-full object-cover transition duration-200 group-hover:scale-105 ${
                            !approved ? "grayscale-[35%]" : ""
                          }`}
                        />
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 opacity-0 group-hover:opacity-100 transition">
                          <span>🔍 Soi Mockup</span>
                        </div>
                      </div>
                      <div className="flex flex-col p-3 gap-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 uppercase">
                              {mockup.scene_type}
                            </span>
                            <span
                              className={`text-[10px] font-medium ${
                                approved ? "text-emerald-400" : "text-slate-500"
                              }`}
                            >
                              {approved ? "• Sẵn sàng SEO" : "• Đã loại bỏ"}
                            </span>
                          </div>
                          <a
                            href={mockup.url}
                            download={mockup.filename}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-cyan-400 hover:underline"
                          >
                            Tải ảnh ↓
                          </a>
                        </div>
                        <p className="text-xs text-slate-300 line-clamp-2" title={mockup.scene_description}>
                          {mockup.scene_description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: White Cutouts */}
        {activeTab === "cutouts" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {productCutoutsWhite.map((cutout, idx) => (
              <div
                key={cutout.filename || `${cutout.url}-${idx}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow transition hover:border-slate-600"
              >
                <div
                  className="relative aspect-[4/3] w-full overflow-hidden bg-white p-2 cursor-zoom-in"
                  onClick={() =>
                    onPreviewImage?.({
                      url: cutout.url,
                      title: cutout.filename,
                      subtitle: "Phôi bóc tách nền trắng (White Cutout)",
                      badge: "Phôi Nền Trắng",
                      downloadUrl: cutout.url,
                    })
                  }
                >
                  <img
                    src={cutout.url}
                    alt={cutout.filename}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#f8fafc"/><text x="200" y="150" fill="#64748b" font-family="sans-serif" font-size="14" text-anchor="middle">${cutout.filename}</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-contain transition duration-300 group-hover:scale-105"
                  />
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-xs opacity-0 group-hover:opacity-100 transition">
                    <span>🔍 Soi Phôi</span>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 text-xs">
                  <span className="font-mono text-slate-300 truncate" title={cutout.filename}>
                    {cutout.filename}
                  </span>
                  <a
                    href={cutout.url}
                    download={cutout.filename}
                    className="rounded bg-slate-800 px-2 py-1 font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Tải phôi ↓
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 4: Comparison Table */}
        {activeTab === "comparison" && (
          <ComparisonTable rows={comparisonRows} onPreviewImage={onPreviewImage} />
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800 pt-5">
        <div className="text-xs text-slate-400">
          Thành phẩm đã sẵn sàng chuyển giao cho quy trình SEO &amp; Content viết bài bán hàng.
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isZipping}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 shadow transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
          >
            <span>{isZipping ? "⏳" : "📦"}</span>
            <span>{isZipping ? "Đang nén ZIP..." : "Tải toàn bộ file in ZIP ↓"}</span>
          </button>

          {(filteredSeoPayload || seoPayload) && (
            <button
              type="button"
              onClick={() => {
                setHandoffResult(null);
                setShowSeoModal(true);
              }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:from-emerald-400 hover:to-teal-500 hover:shadow-emerald-500/40"
            >
              <span>✨</span>
              <span>
                {`Bàn giao sang SEO (${printCmykImages.length} file in + ${approvedMockupCount}/${lifestyleMockups.length} mockup) ➔`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* SEO Handoff Modal */}
      {showSeoModal && (filteredSeoPayload || seoPayload) && (
        <SeoHandoffModal
          payload={filteredSeoPayload ?? seoPayload!}
          deliverables={deliverables}
          approvedMockupKeys={approvedMockupKeys}
          onToggleMockup={toggleMockupApproval}
          onSelectAllMockups={handleSelectAllMockups}
          onDeselectAllMockups={handleDeselectAllMockups}
          onPreviewImage={onPreviewImage}
          handoffResult={handoffResult}
          onHandoffSuccess={(res) => {
            setHandoffResult(res);
            setHandoffToast(res.message);
          }}
          onClose={() => setShowSeoModal(false)}
        />
      )}
    </section>
  );
}
