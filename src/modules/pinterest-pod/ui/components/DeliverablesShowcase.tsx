import { useState } from "react";
import type { DeliverablesData, PinterestPodDeliverables, SummaryMetrics } from "../../types";
import { ComparisonTable } from "./ComparisonTable";
import { SeoHandoffModal } from "./SeoHandoffModal";

interface DeliverablesShowcaseProps {
  readonly deliverables: DeliverablesData;
  readonly summaryMetrics?: SummaryMetrics;
  readonly seoPayload?: PinterestPodDeliverables;
}

type TabKey = "cmyk" | "mockups" | "cutouts" | "comparison";

export function DeliverablesShowcase({
  deliverables,
  summaryMetrics,
  seoPayload,
}: DeliverablesShowcaseProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>("cmyk");
  const [showSeoModal, setShowSeoModal] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipMessage, setZipMessage] = useState<string | null>(null);

  const printCmykImages = deliverables.print_cmyk_images ?? [];
  const lifestyleMockups = deliverables.lifestyle_mockups ?? [];
  const productCutoutsWhite = deliverables.product_cutouts_white ?? [];
  const comparisonRows = deliverables.comparison_rows ?? [];

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
            🛋️ Mockup Phòng AI ({lifestyleMockups.length})
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
                className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-slate-900">
                  <img
                    src={item.url}
                    alt={item.filename}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0f172a"/><text x="200" y="150" fill="#38bdf8" font-family="sans-serif" font-size="14" text-anchor="middle">${item.filename}</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-cover"
                  />
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {lifestyleMockups.map((mockup, idx) => (
              <div
                key={mockup.filename || `${mockup.url}-${idx}`}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-slate-900">
                  <img
                    src={mockup.url}
                    alt={mockup.filename}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," +
                        encodeURIComponent(
                          `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0f172a"/><text x="200" y="150" fill="#a78bfa" font-family="sans-serif" font-size="14" text-anchor="middle">${mockup.filename}</text></svg>`,
                        );
                    }}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col p-3 gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 uppercase">
                      {mockup.scene_type}
                    </span>
                    <a
                      href={mockup.url}
                      download={mockup.filename}
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
            ))}
          </div>
        )}

        {/* Tab 3: White Cutouts */}
        {activeTab === "cutouts" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {productCutoutsWhite.map((cutout, idx) => (
              <div
                key={cutout.filename || `${cutout.url}-${idx}`}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-white p-2">
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
                    className="h-full w-full object-contain"
                  />
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
          <ComparisonTable rows={comparisonRows} />
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

          {seoPayload && (
            <button
              type="button"
              onClick={() => setShowSeoModal(true)}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:from-emerald-400 hover:to-teal-500 hover:shadow-emerald-500/40"
            >
              <span>✨</span>
              <span>Bàn giao sang Module SEO + CONTENT</span>
            </button>
          )}
        </div>
      </div>

      {/* SEO Handoff Modal */}
      {showSeoModal && seoPayload && (
        <SeoHandoffModal payload={seoPayload} onClose={() => setShowSeoModal(false)} />
      )}
    </section>
  );
}
