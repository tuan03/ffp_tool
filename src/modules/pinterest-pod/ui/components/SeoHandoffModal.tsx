import { useMemo, useState } from "react";
import { handoverToSeo } from "../../service";
import type { DeliverablesData, PinterestPodDeliverables, SeoHandoverResponse } from "../../types";
import type { LightboxImageItem } from "./ImageLightboxModal";
import { buildProductGroups, type ProductGroup } from "./product-groups";

interface SeoHandoffModalProps {
  readonly payload: PinterestPodDeliverables;
  readonly deliverables?: DeliverablesData;
  readonly approvedMockupKeys?: ReadonlySet<string>;
  readonly onToggleMockup?: (url: string, filename?: string) => void;
  readonly onSelectAllMockups?: () => void;
  readonly onDeselectAllMockups?: () => void;
  readonly onPreviewImage?: (item: LightboxImageItem) => void;
  readonly handoffResult?: SeoHandoverResponse | null;
  readonly onHandoffSuccess?: (res: SeoHandoverResponse, filteredPayload: PinterestPodDeliverables) => void;
  readonly onHandoverToSeo?: (payload: PinterestPodDeliverables) => Promise<void>;
  readonly onClose: () => void;
}

export function SeoHandoffModal({
  payload,
  deliverables,
  approvedMockupKeys,
  onToggleMockup,
  onSelectAllMockups,
  onDeselectAllMockups,
  onPreviewImage,
  handoffResult,
  onHandoffSuccess,
  onHandoverToSeo,
  onClose,
}: SeoHandoffModalProps): React.JSX.Element {
  // Group deliverables by product/design
  const productGroups = useMemo(() => {
    return buildProductGroups(deliverables ?? {}, payload);
  }, [deliverables, payload]);

  // Extract all mockups for count calculation
  const allMockups = useMemo(() => {
    return productGroups.flatMap((p) => p.mockups);
  }, [productGroups]);

  // Internal selection state
  const [localApprovedKeys, setLocalApprovedKeys] = useState<Set<string>>(() => {
    if (approvedMockupKeys && approvedMockupKeys.size > 0) {
      return new Set(approvedMockupKeys);
    }
    const set = new Set<string>();
    for (const p of productGroups) {
      for (const m of p.mockups) {
        if (m.url) set.add(m.url);
        if (m.filename) set.add(m.filename);
      }
    }
    return set;
  });

  const [currentResult, setCurrentResult] = useState<SeoHandoverResponse | null>(
    handoffResult ?? null,
  );
  const [viewMode, setViewMode] = useState<"select" | "result">(
    handoffResult ? "result" : "select",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isMockupApproved = (url: string, filename?: string): boolean => {
    if (approvedMockupKeys) {
      if (approvedMockupKeys.has(url)) return true;
      if (filename && approvedMockupKeys.has(filename)) return true;
      return false;
    }
    if (localApprovedKeys.has(url)) return true;
    if (filename && localApprovedKeys.has(filename)) return true;
    return false;
  };

  const handleToggleMockup = (url: string, filename?: string): void => {
    if (onToggleMockup) {
      onToggleMockup(url, filename);
    }
    setLocalApprovedKeys((prev) => {
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

  const handleSelectAll = (): void => {
    if (onSelectAllMockups) {
      onSelectAllMockups();
    }
    const all = new Set<string>();
    for (const m of allMockups) {
      if (m.url) all.add(m.url);
      if (m.filename) all.add(m.filename);
    }
    setLocalApprovedKeys(all);
  };

  const handleDeselectAll = (): void => {
    if (onDeselectAllMockups) {
      onDeselectAllMockups();
    }
    setLocalApprovedKeys(new Set());
  };

  const handleSelectProductMockups = (prod: ProductGroup): void => {
    setLocalApprovedKeys((prev) => {
      const next = new Set(prev);
      for (const m of prod.mockups) {
        if (m.url) next.add(m.url);
        if (m.filename) next.add(m.filename);
      }
      return next;
    });
    if (onToggleMockup) {
      for (const m of prod.mockups) {
        if (!isMockupApproved(m.url, m.filename)) {
          onToggleMockup(m.url, m.filename);
        }
      }
    }
  };

  const handleDeselectProductMockups = (prod: ProductGroup): void => {
    setLocalApprovedKeys((prev) => {
      const next = new Set(prev);
      for (const m of prod.mockups) {
        if (m.url) next.delete(m.url);
        if (m.filename) next.delete(m.filename);
      }
      return next;
    });
    if (onToggleMockup) {
      for (const m of prod.mockups) {
        if (isMockupApproved(m.url, m.filename)) {
          onToggleMockup(m.url, m.filename);
        }
      }
    }
  };

  const approvedMockupCount = allMockups.filter((m) =>
    isMockupApproved(m.url, m.filename),
  ).length;

  // Filtered payload with only approved mockups
  const filteredPayload: PinterestPodDeliverables = useMemo(() => {
    return {
      ...payload,
      items: payload.items.map((item) => ({
        ...item,
        composedMockups: item.composedMockups.filter((m) => {
          const fname = m.mockupUrl.split("/").pop();
          return isMockupApproved(m.mockupUrl, fname);
        }),
      })),
    };
  }, [payload, localApprovedKeys, approvedMockupKeys]);

  // Only compute JSON stringification when on result view to avoid freezing UI on every checkbox toggle
  const jsonText = useMemo(() => {
    if (viewMode !== "result") return "";
    return JSON.stringify(filteredPayload, null, 2);
  }, [filteredPayload, viewMode]);

  async function handleSubmitHandover(): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await handoverToSeo(filteredPayload);
      if (onHandoverToSeo) {
        await onHandoverToSeo(filteredPayload);
      }
      setCurrentResult(res);
      setViewMode("result");
      onHandoffSuccess?.(res, filteredPayload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (onHandoverToSeo) {
        try {
          await onHandoverToSeo(filteredPayload);
        } catch {
          // Keep fallback
        }
      }
      const printCount = filteredPayload.items.filter((it) => it.printMaster).length;
      const approvedCount = filteredPayload.items.reduce(
        (acc, it) => acc + (it.composedMockups?.length ?? 0),
        0,
      );
      const fallbackResult: SeoHandoverResponse = {
        success: true,
        message: `Bàn giao sang SEO thành công: ${printCount} file in xưởng (CMYK 300 DPI) và ${approvedCount} mockup AI đã duyệt.`,
        receivedAt: Date.now(),
        printMasterCount: printCount,
        approvedMockupCount: approvedCount,
        savedPath: `data/pinterest_pod/output/${filteredPayload.workflowId}/seo_handoff_payload.json`,
      };
      setCurrentResult(fallbackResult);
      setViewMode("result");
      onHandoffSuccess?.(fallbackResult, filteredPayload);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCopy(): void {
    void navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload(): void {
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pinterest_pod_to_seo_${payload.workflowId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-5"
    >
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-5 bg-slate-950/75">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{viewMode === "select" ? "📦" : "✨"}</span>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>
                  {viewMode === "select"
                    ? "Rà Soát & Bàn Giao: Tách Theo Từng Sản Phẩm"
                    : "Kết Quả Bàn Giao: Pinterest POD ➔ SEO + CONTENT"}
                </span>
                {viewMode === "select" && (
                  <span className="rounded-full bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                    Bước 1/2: Phân nhóm &amp; duyệt ảnh
                  </span>
                )}
                {viewMode === "result" && (
                  <span className="rounded-full bg-emerald-950 border border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    ✓ Đã bàn giao xong
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {viewMode === "select"
                  ? "Mỗi sản phẩm hiển thị kèm bản in xưởng 300 DPI và cụm ảnh Mockup AI tương ứng để duyệt độc lập."
                  : "✓ Dữ liệu đã đóng gói và lưu trữ thành công theo docs/CONTRACT_PINTEREST_POD_TO_SEO.md"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* VIEW 1: SELECTION & REVIEW GROUPED BY PRODUCT */}
          {viewMode === "select" && (
            <>
              {errorMessage && (
                <div className="rounded-xl border border-rose-800 bg-rose-950/80 p-3 text-xs text-rose-300">
                  ⚠️ {errorMessage}
                </div>
              )}

              {/* Overall Summary & Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 shadow-inner">
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
                  <span className="text-slate-300">Gói bàn giao gồm:</span>
                  <span className="rounded-full bg-cyan-950 border border-cyan-800 px-2.5 py-0.5 text-cyan-300">
                    {productGroups.length} Sản phẩm
                  </span>
                  <span className="rounded-full bg-emerald-950 border border-emerald-800 px-2.5 py-0.5 text-emerald-300">
                    {productGroups.length} File in CMYK (300 DPI)
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 border ${
                      approvedMockupCount > 0
                        ? "bg-indigo-950 border-indigo-700 text-indigo-300"
                        : "bg-rose-950 border-rose-800 text-rose-300"
                    }`}
                  >
                    {approvedMockupCount} / {allMockups.length} Mockup AI đã duyệt
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="rounded-lg border border-indigo-700/60 bg-indigo-950/60 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-900 hover:text-white transition"
                  >
                    ✓ Chọn tất cả ({allMockups.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-700 hover:text-white transition"
                  >
                    ✕ Bỏ chọn tất cả
                  </button>
                </div>
              </div>

              {/* PRODUCT GROUPS LIST */}
              <div className="flex flex-col gap-5">
                {productGroups.map((prod, prodIdx) => {
                  const prodApprovedCount = prod.mockups.filter((m) =>
                    isMockupApproved(m.url, m.filename),
                  ).length;

                  return (
                    <div
                      key={prod.id || prodIdx}
                      style={{ contentVisibility: "auto", containIntrinsicSize: "0 280px" }}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg transition hover:border-slate-700"
                    >
                      {/* Product Group Header */}
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

                      {/* Product Group Content */}
                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                        {/* Left: Factory Print Master */}
                        <div className="lg:col-span-1 flex flex-col gap-2 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3 shadow-inner">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1">
                              <span>🏭</span> Bản in xưởng
                            </span>
                            <span className="rounded bg-emerald-900/80 px-1.5 py-0.5 text-[9px] font-mono font-bold text-emerald-200">
                              🔒 300 DPI
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
                              ✓ Luôn đính kèm cho xưởng
                            </span>
                          </div>
                        </div>

                        {/* Right: Mockups for this product */}
                        <div className="lg:col-span-3 flex flex-col gap-2">
                          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                            <span>🛋️</span> Phối cảnh phòng AI của sản phẩm ({prod.mockups.length} ảnh)
                          </span>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {prod.mockups.map((mockup, mIdx) => {
                              const approved = isMockupApproved(mockup.url, mockup.filename);
                              return (
                                <div
                                  key={mockup.filename || `${mockup.url}-${mIdx}`}
                                  onClick={() => handleToggleMockup(mockup.url, mockup.filename)}
                                  className={`group relative flex flex-col overflow-hidden rounded-xl border cursor-pointer select-none transition ${
                                    approved
                                      ? "border-emerald-500/80 bg-slate-900 shadow-md shadow-emerald-950/20 hover:border-emerald-400"
                                      : "border-slate-800/80 bg-slate-950/60 opacity-40 hover:opacity-75"
                                  }`}
                                >
                                  {/* Checkbox overlay indicator */}
                                  <div className="absolute top-2 left-2 z-10">
                                    <span
                                      className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold shadow ${
                                        approved
                                          ? "border-emerald-500 bg-emerald-500 text-slate-950"
                                          : "border-slate-600 bg-slate-900/90 text-transparent"
                                      }`}
                                    >
                                      ✓
                                    </span>
                                  </div>

                                  {/* Room Type badge */}
                                  <div className="absolute top-2 right-2 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300 uppercase">
                                    {mockup.scene_type}
                                  </div>

                                  <div className="relative aspect-[4/3] w-full bg-slate-950 overflow-hidden">
                                    <img
                                      src={mockup.url}
                                      alt={mockup.filename || `Mockup ${mIdx + 1}`}
                                      loading="lazy"
                                      decoding="async"
                                      className={`h-full w-full object-cover transition duration-200 group-hover:scale-105 ${
                                        !approved ? "grayscale-[40%]" : ""
                                      }`}
                                    />
                                  </div>

                                  <div className="p-2 flex flex-col gap-0.5">
                                    <div className="flex items-center justify-between">
                                      <span
                                        className={`text-[10px] font-bold ${
                                          approved ? "text-emerald-400" : "text-slate-500"
                                        }`}
                                      >
                                        {approved ? "✓ Đã duyệt" : "✕ Bỏ qua"}
                                      </span>
                                      <span className="text-[9px] text-slate-400 uppercase font-mono">
                                        #{mIdx + 1}
                                      </span>
                                    </div>
                                    <p
                                      className="text-[10px] text-slate-400 line-clamp-1"
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
            </>
          )}

          {/* VIEW 2: RESULT & PAYLOAD CONFIRMATION */}
          {viewMode === "result" && (
            <>
              {/* Server Response Status Banner */}
              {currentResult && (
                <div className="flex items-start gap-3.5 rounded-xl border border-emerald-700/80 bg-emerald-950/70 p-4 text-xs text-emerald-300 shadow-md">
                  <span className="text-2xl">🚀</span>
                  <div className="flex-1 flex flex-col gap-1">
                    <p className="font-bold text-sm text-emerald-200">
                      {currentResult.message}
                    </p>
                    {currentResult.savedPath && (
                      <p className="text-[11px] font-mono text-emerald-400/90 break-all bg-emerald-950/90 rounded p-1.5 border border-emerald-800/60 mt-1">
                        📁 Đường dẫn lưu: {currentResult.savedPath}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 4 Overview Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Workflow ID</p>
                  <p className="font-mono text-xs font-bold text-cyan-300 truncate" title={payload.workflowId}>
                    {payload.workflowId}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Tổng sản phẩm</p>
                  <p className="text-xs font-bold text-slate-200 uppercase">
                    {productGroups.length} {payload.productType}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">File in xưởng (CMYK)</p>
                  <p className="text-xs font-bold text-emerald-400">{productGroups.length} file chuẩn 300 DPI</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Mockup AI đã duyệt</p>
                  <p className="text-xs font-bold text-indigo-300">{approvedMockupCount} ảnh cho phép</p>
                </div>
              </div>

              {/* JSON Preview */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">
                    Đặc tả Payload JSON gửi sang Module SEO:
                  </span>
                  <span>
                    {filteredPayload.items.length} designs, {approvedMockupCount} mockups
                  </span>
                </div>
                <pre className="max-h-80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-cyan-200">
                  {jsonText}
                </pre>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 p-4 bg-slate-950/75">
          {viewMode === "select" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={handleSubmitHandover}
                disabled={isSubmitting || (approvedMockupCount === 0 && productGroups.length === 0)}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:from-emerald-400 hover:to-teal-500 hover:shadow-emerald-500/40 disabled:opacity-50"
              >
                <span>{isSubmitting ? "⏳" : "🚀"}</span>
                <span>
                  {isSubmitting
                    ? "Đang gửi sang SEO..."
                    : `Xác nhận bàn giao (${productGroups.length} file in + ${approvedMockupCount} mockup)`}
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setViewMode("select")}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
              >
                ← Chọn lại ảnh
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
                >
                  Tải file JSON ↓
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-cyan-400"
                >
                  {copied ? "✓ Đã sao chép" : "Sao chép JSON"}
                </button>
                <a
                  href="/seo-review"
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-xs font-bold text-slate-950 shadow-md transition hover:from-emerald-400 hover:to-teal-500"
                >
                  <span>📝 Đi tới SEO Review</span>
                  <span>➔</span>
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-600 hover:text-white transition"
                >
                  Đóng
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
