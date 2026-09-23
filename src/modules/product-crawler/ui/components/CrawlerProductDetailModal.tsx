import { useState } from "react";

import type { CrawlerProduct } from "../../types";

interface CrawlerProductDetailModalProps {
  product: CrawlerProduct | null;
  onClose(): void;
}

type DetailTab = "overview" | "media" | "variants" | "customize" | "details" | "json";

export function CrawlerProductDetailModal({
  product,
  onClose,
}: CrawlerProductDetailModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [copied, setCopied] = useState(false);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);

  if (!product) {
    return null;
  }

  const handleCopyJson = (): void => {
    navigator.clipboard.writeText(JSON.stringify(product, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const images = product.media.filter((m) => m.kind === "image");
  const videos = product.media.filter((m) => m.kind === "video");
  const asin = product.productDetails?.ASIN || product.parentAsin || product.id.replace(/^prod_/, "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-800 p-5 bg-slate-900/95">
          <div className="pr-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-[10px] font-mono font-semibold text-cyan-300">
                ASIN: {asin}
              </span>
              {product.customization ? (
                <span className="rounded bg-emerald-950 border border-emerald-800 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  🟢 Có Customize
                </span>
              ) : (
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                  ⚪ Không Customize
                </span>
              )}
              {product.warnings && product.warnings.length > 0 && (
                <span className="rounded bg-amber-950 border border-amber-800 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  ⚠️ {product.warnings.length} Cảnh báo
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-1.5 line-clamp-1">{product.title}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            aria-label="Đóng chi tiết"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-5 text-xs font-medium">
          {[
            { id: "overview", label: "Tổng quan", icon: "📋" },
            { id: "media", label: `Hình ảnh (${images.length})`, icon: "🖼️" },
            { id: "variants", label: `Biến thể (${product.variants.length})`, icon: "🔀" },
            { id: "customize", label: "Tùy biến (Customization)", icon: "✨" },
            { id: "details", label: "Thuộc tính chi tiết", icon: "📑" },
            { id: "json", label: "Raw JSON", icon: "💻" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as DetailTab)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-3 transition ${
                activeTab === tab.id
                  ? "border-cyan-400 text-cyan-300 font-semibold bg-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 text-slate-300">
          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Tiêu đề sản phẩm
                    </h3>
                    <p className="text-sm font-medium text-slate-100">{product.title}</p>
                    {product.sourceTitle && product.sourceTitle !== product.title && (
                      <p className="text-xs text-slate-400 mt-1 italic">
                        Tiêu đề gốc Amazon: {product.sourceTitle}
                      </p>
                    )}
                  </div>

                  {product.description && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Mô tả tóm tắt
                      </h3>
                      <p className="text-xs leading-relaxed text-slate-300 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                        {product.description}
                      </p>
                    </div>
                  )}

                  {product.bulletPoints && product.bulletPoints.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Đặc điểm nổi bật (Bullet Points)
                      </h3>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {product.bulletPoints.map((bp, i) => (
                          <li key={i} className="flex items-start gap-2 bg-slate-950/40 p-2 rounded border border-slate-800/60">
                            <span className="text-cyan-400 mt-0.5">•</span>
                            <span>{bp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {images[0] && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-2 overflow-hidden text-center">
                      <img
                        src={images[0].url}
                        alt={product.title}
                        className="mx-auto h-48 w-full object-cover rounded-lg"
                      />
                      <span className="text-[11px] text-slate-500 block mt-1">Ảnh đại diện chính</span>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs space-y-2.5">
                    <h4 className="font-bold text-slate-200 border-b border-slate-800 pb-2">Thông tin nguồn</h4>
                    <div className="flex justify-between">
                      <span className="text-slate-400">ASIN Gốc:</span>
                      <span className="font-mono font-semibold text-slate-200">{asin}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Biến thể:</span>
                      <span className="font-semibold text-cyan-400">{product.variants.length} SKU</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Nguồn dữ liệu:</span>
                      <span className="text-amber-400 font-semibold">Amazon US</span>
                    </div>
                    <div className="pt-2 border-t border-slate-800">
                      <a
                        href={product.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-1.5 rounded bg-slate-800 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-slate-700 transition"
                      >
                        <span>🔗 Mở trang Amazon gốc</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MEDIA TAB */}
          {activeTab === "media" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Danh sách hình ảnh ({images.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {images.map((img, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedPreviewImage(img.url)}
                      className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-950 p-2 transition hover:border-cyan-500"
                    >
                      <div className="aspect-square w-full overflow-hidden rounded-lg bg-slate-900 flex items-center justify-center">
                        <img
                          src={img.url}
                          alt={`Media ${idx + 1}`}
                          className="h-full w-full object-cover group-hover:scale-105 transition"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Ảnh #{idx + 1}</span>
                        <span className="text-cyan-400 opacity-0 group-hover:opacity-100 transition">🔍 Phóng to</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {videos.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Video sản phẩm ({videos.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {videos.map((vid, idx) => (
                      <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                        <span className="text-xs font-mono text-slate-300">{vid.url}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VARIANTS TAB */}
          {activeTab === "variants" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Tổng hợp {product.variants.length} biến thể (Variants)
                </h3>
                {product.variantMatrix && (
                  <span className="text-xs text-slate-400 font-mono">
                    Ma trận {product.variantMatrix.combinationsCount} tổ hợp
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-900/80 font-semibold text-slate-300">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">SKU</th>
                      <th className="p-3">Thuộc tính (Options)</th>
                      <th className="p-3">Giá bán</th>
                      <th className="p-3">Phụ phí (Surcharge)</th>
                      <th className="p-3">Source ASIN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {product.variants.map((v, i) => (
                      <tr key={v.id || i} className="hover:bg-slate-900/40 transition">
                        <td className="p-3 text-slate-500">{i + 1}</td>
                        <td className="p-3 text-slate-200 font-semibold">{v.sku}</td>
                        <td className="p-3 font-sans text-slate-300">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(v.options).map(([k, val]) => (
                              <span
                                key={k}
                                className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300"
                              >
                                {k}: <strong className="text-slate-100">{val}</strong>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-emerald-400 font-semibold">
                          {v.price ? `$${v.price.amount.toFixed(2)}` : "—"}
                        </td>
                        <td className="p-3 text-amber-300">
                          {v.surcharge && v.surcharge.amount > 0
                            ? `+$${v.surcharge.amount.toFixed(2)}`
                            : "—"}
                        </td>
                        <td className="p-3 text-slate-400">{v.sourceAsin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CUSTOMIZE TAB */}
          {activeTab === "customize" && (
            <div className="space-y-6">
              {!product.customization ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center">
                  <span className="text-3xl mb-2 block">⚪</span>
                  <h4 className="text-sm font-semibold text-slate-300">Sản phẩm không có tùy biến (No Customization)</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Đây là sản phẩm standard tiêu chuẩn hoặc widget tùy biến không được cung cấp.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Text inputs */}
                  {product.customization.textInputs && product.customization.textInputs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Trường nhập văn bản (Text Inputs)
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {product.customization.textInputs.map((ti) => (
                          <div key={ti.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-200">{ti.label}</span>
                              {ti.required && (
                                <span className="text-[10px] text-rose-400 font-semibold">Bắt buộc</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 font-mono italic">
                              Ví dụ mẫu: {ti.placeholder || "(Không có)"}
                            </p>
                            {ti.maxLength && (
                              <span className="text-[10px] text-slate-500 block">Tối đa {ti.maxLength} ký tự</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Option groups */}
                  {product.customization.optionGroups && product.customization.optionGroups.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Nhóm lựa chọn tùy chỉnh (Option Groups)
                      </h4>
                      <div className="space-y-3">
                        {product.customization.optionGroups.map((og) => (
                          <div key={og.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-slate-200">{og.name}</span>
                              <span className="text-[10px] font-mono text-slate-400">Kiểu: {og.type}</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                              {og.options.map((opt, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between rounded-lg bg-slate-900 px-3 py-2 text-xs border border-slate-800/80"
                                >
                                  <span className="text-slate-300">{opt.label}</span>
                                  {opt.priceDelta !== undefined && opt.priceDelta > 0 && (
                                    <span className="font-mono text-emerald-400 font-semibold">
                                      +${opt.priceDelta.toFixed(2)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Surfaces */}
                  {product.customization.surfaces && product.customization.surfaces.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Bề mặt tùy biến (Customization Surfaces)
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {product.customization.surfaces.map((s, i) => (
                          <div key={i} className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex items-center gap-3">
                            {s.previewUrl ? (
                              <img
                                src={s.previewUrl}
                                alt={s.name}
                                className="h-12 w-12 rounded-lg object-cover border border-slate-800"
                              />
                            ) : (
                              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-xs">
                                🎨
                              </span>
                            )}
                            <div>
                              <span className="text-xs font-semibold text-slate-200 block">{s.name}</span>
                              <span className="text-[11px] text-cyan-400">Bề mặt in / khắc laser</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Image inputs */}
                  {product.customization.imageInputs && product.customization.imageInputs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Tải lên hình ảnh tùy biến (Image Uploads)
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {product.customization.imageInputs.map((imgIn) => (
                          <div key={imgIn.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-200">{imgIn.label}</span>
                              {imgIn.required && (
                                <span className="text-[10px] text-rose-400 font-semibold">Bắt buộc</span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 block">Hỗ trợ PNG/JPG chuẩn nét cao</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Color groups */}
                  {product.customization.colorGroups && product.customization.colorGroups.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Bảng màu tùy chọn (Color Palettes)
                      </h4>
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                        {product.customization.colorGroups.map((cg) => (
                          <div key={cg.id} className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-300">{cg.name}</span>
                            <div className="flex flex-wrap gap-2 pt-1">
                              {cg.colors.map((c, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-200 border border-slate-700 font-mono"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Font groups */}
                  {product.customization.fontGroups && product.customization.fontGroups.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Kiểu chữ cho phép (Typography / Fonts)
                      </h4>
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                        {product.customization.fontGroups.map((fg) => (
                          <div key={fg.id} className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-300">{fg.name}</span>
                            <div className="flex flex-wrap gap-2 pt-1">
                              {fg.fonts.map((f, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-200 border border-slate-700 font-serif"
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* DETAILS TAB */}
          {activeTab === "details" && (
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Bảng thông số kỹ thuật (Product Details)
              </h3>

              {product.productDetails && Object.keys(product.productDetails).length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <tbody className="divide-y divide-slate-800/70">
                      {Object.entries(product.productDetails).map(([key, value]) => (
                        <tr key={key} className="hover:bg-slate-900/50">
                          <td className="w-1/3 p-3 font-medium text-slate-400 bg-slate-900/40">{key}</td>
                          <td className="p-3 text-slate-200 font-mono">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                  Không có thông số kỹ thuật chi tiết.
                </div>
              )}
            </div>
          )}

          {/* JSON TAB */}
          {activeTab === "json" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">Full CrawlerProduct JSON Structure</span>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
                >
                  {copied ? "✓ Đã sao chép!" : "📋 Sao chép JSON"}
                </button>
              </div>

              <pre className="max-h-[55vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[11px] text-cyan-300">
                {JSON.stringify(product, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-slate-800 bg-slate-900/90 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Image Preview Overlay */}
      {selectedPreviewImage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4 cursor-pointer"
          onClick={() => setSelectedPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={selectedPreviewImage} alt="Preview" className="max-h-[85vh] rounded-lg shadow-2xl" />
            <button
              type="button"
              onClick={() => setSelectedPreviewImage(null)}
              className="absolute -top-10 right-0 text-white text-sm font-semibold hover:text-cyan-400"
            >
              ✕ Đóng xem ảnh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
