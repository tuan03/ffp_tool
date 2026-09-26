import React, { useState, useMemo } from "react";
import type {
  CustomizationOption,
  CustomizationOptionGroup,
  ProductCustomization,
} from "../../../customization-normalizer";

export interface CustomerLivePreviewModalProps {
  readonly isOpen: boolean;
  readonly productName: string;
  readonly productBasePrice?: number;
  readonly customization: ProductCustomization;
  readonly onClose: () => void;
}

export function CustomerLivePreviewModal({
  isOpen,
  productName,
  productBasePrice = 24.99,
  customization,
  onClose,
}: CustomerLivePreviewModalProps): React.JSX.Element | null {
  const surfaces = (customization.surfaces as any[]) || [];
  const optionGroups = customization.optionGroups || [];

  const [activeSurfaceIndex, setActiveSurfaceIndex] = useState(0);
  const activeSurface = surfaces[activeSurfaceIndex] || surfaces[0] || null;

  // Selected options state: group.id -> option.id
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const group of optionGroups) {
      if (group.defaultOptionId) {
        initial[group.id] = group.defaultOptionId;
      } else if (group.options && group.options.length > 0) {
        initial[group.id] = group.options[0].id;
      }
    }
    return initial;
  });

  // Customer custom text inputs
  const [customText, setCustomText] = useState("Your Name Here");
  const [selectedFont, setSelectedFont] = useState("sans-serif");
  const [textColor, setTextColor] = useState("#ffffff");

  if (!isOpen) return null;

  // Calculate total price based on selected options
  const calculateTotal = () => {
    let total = productBasePrice;
    for (const group of optionGroups) {
      const selectedId = selectedOptions[group.id];
      if (selectedId) {
        const option = (group.options || []).find((o) => o.id === selectedId);
        if (option?.price?.amount) {
          total += option.price.amount;
        }
      }
    }
    return total;
  };

  const totalPrice = calculateTotal();

  // Active mockup preview image URL (supports standard previewUrl or Amazon Customizer baseImage.url)
  const previewImageUrl =
    activeSurface?.previewUrl ||
    activeSurface?.baseImage?.url ||
    (customization.product as { productImageUrl?: string } | undefined)?.productImageUrl ||
    "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      <div className="flex min-h-screen items-center justify-center p-3 md:p-6">
        <div className="relative w-full max-w-5xl rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900/90">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-base">
                👁️
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-100">
                    Live Storefront Preview (Góc nhìn Khách hàng)
                  </h3>
                  <span className="rounded-full bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase">
                    Interactive
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Xem và tương tác chính xác như khách hàng trên trang sản phẩm Shopify
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition cursor-pointer"
            >
              ✕ Đóng
            </button>
          </div>

          {/* Main Grid: Left Mockup Canvas, Right Customizer Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-12 flex-1">
            {/* Left: Mockup Interactive Canvas */}
            <div className="lg:col-span-7 bg-slate-950 p-6 flex flex-col items-center justify-between border-b lg:border-b-0 lg:border-r border-slate-800">
              {/* Surface Switcher Pills */}
              {surfaces.length > 1 && (
                <div className="flex items-center gap-2 mb-4 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800">
                  {surfaces.map((s, idx) => (
                    <button
                      key={s.surfaceId || idx}
                      type="button"
                      onClick={() => setActiveSurfaceIndex(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeSurfaceIndex === idx
                          ? "bg-cyan-600 text-white shadow-md shadow-cyan-900/40"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {s.name || `Mặt in ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}

              {/* Product Mockup with Overlay */}
              <div className="relative w-full max-w-md aspect-square rounded-2xl overflow-hidden border border-slate-800/80 bg-slate-900 flex items-center justify-center shadow-inner group">
                <img
                  src={previewImageUrl}
                  alt={activeSurface?.name || "Product Mockup"}
                  className="w-full h-full object-contain select-none"
                  onError={(e) => {
                    // Fallback to placeholder if url invalid
                    (e.target as HTMLImageElement).src =
                      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80";
                  }}
                />

                {/* Simulated Placement Area Overlay */}
                <div className="absolute inset-x-1/4 top-1/4 bottom-1/3 border-2 border-dashed border-cyan-400/50 rounded-xl flex items-center justify-center p-3 pointer-events-none group-hover:border-cyan-400/80 transition">
                  <div
                    className="text-center font-bold break-words max-w-full drop-shadow-md select-none transition-all duration-200"
                    style={{
                      fontFamily: selectedFont,
                      color: textColor,
                      fontSize: customText.length > 20 ? "14px" : customText.length > 10 ? "18px" : "24px",
                    }}
                  >
                    {customText || "Nhập tên của bạn"}
                  </div>
                  <span className="absolute top-1 left-1.5 text-[9px] font-mono text-cyan-300/70 bg-slate-950/60 px-1 rounded">
                    Print Area
                  </span>
                </div>
              </div>

              {/* Live Status Hint */}
              <div className="mt-4 text-center">
                <span className="text-[11px] text-slate-500 font-mono">
                  Đang hiển thị mặt: <strong className="text-slate-300">{activeSurface?.name || "Front"}</strong> • Phôi in chuẩn vector
                </span>
              </div>
            </div>

            {/* Right: Customer Options & Add to Cart */}
            <div className="lg:col-span-5 p-6 flex flex-col justify-between space-y-6 overflow-y-auto max-h-[600px]">
              <div className="space-y-5">
                {/* Product Title & Price Badge */}
                <div>
                  <h2 className="text-base font-bold text-slate-100">{productName}</h2>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-xl font-bold text-emerald-400">
                      ${totalPrice.toFixed(2)}
                    </span>
                    {totalPrice > productBasePrice && (
                      <span className="text-xs text-slate-500">
                        (Giá gốc ${productBasePrice.toFixed(2)} + ${(totalPrice - productBasePrice).toFixed(2)} phụ phí)
                      </span>
                    )}
                  </div>
                </div>

                {/* Custom Text Input Section */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <label className="block text-xs font-semibold text-slate-200">
                    ✍️ Nhập chữ cá nhân hóa (Custom Text):
                  </label>
                  <input
                    type="text"
                    value={customText}
                    maxLength={30}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="ví dụ: Happy Birthday Anna"
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />

                  {/* Font picker */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <span className="text-[11px] text-slate-400 block mb-1">Kiểu chữ:</span>
                      <select
                        value={selectedFont}
                        onChange={(e) => setSelectedFont(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="sans-serif">Mặc định (Sans-serif)</option>
                        <option value="'Playfair Display', serif">Quý phái (Playfair Serif)</option>
                        <option value="'Pacifico', cursive">Viết tay mềm mại (Pacifico)</option>
                        <option value="'Impact', fantasy">Đậm nét (Impact / Bold)</option>
                        <option value="monospace">Máy tính (Monospace)</option>
                      </select>
                    </div>

                    <div>
                      <span className="text-[11px] text-slate-400 block mb-1">Màu chữ in:</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={textColor}
                          onChange={(e) => setTextColor(e.target.value)}
                          className="h-8 w-10 cursor-pointer rounded border border-slate-800 bg-slate-900 p-0.5"
                        />
                        <span className="text-xs font-mono text-slate-400 uppercase">
                          {textColor}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Option Groups (Colors, Sizes, Clipart, etc.) */}
                {optionGroups.map((group) => {
                  const currentSelected = selectedOptions[group.id];
                  return (
                    <div key={group.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-200">
                          {group.label || group.id}
                        </label>
                        {group.required && (
                          <span className="text-[10px] text-rose-400 font-medium">Bắt buộc</span>
                        )}
                      </div>

                      {/* Swatches / Buttons */}
                      <div className="flex flex-wrap gap-2">
                        {(group.options || []).map((opt) => {
                          const isSelected = currentSelected === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                setSelectedOptions((prev) => ({
                                  ...prev,
                                  [group.id]: opt.id,
                                }))
                              }
                              className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                                isSelected
                                  ? "border-cyan-500 bg-cyan-950/70 text-cyan-200 ring-1 ring-cyan-500 shadow-sm"
                                  : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700"
                              }`}
                            >
                              {opt.thumbnailImage?.url && (
                                <img
                                  src={opt.thumbnailImage.url}
                                  alt={opt.label}
                                  className="h-4 w-4 rounded-full object-cover border border-slate-700"
                                />
                              )}
                              <span>{opt.label || opt.id}</span>
                              {opt.price?.amount ? (
                                <span className="text-[10px] text-emerald-400 font-semibold">
                                  +${opt.price.amount}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add to Cart Simulation */}
              <div className="pt-4 border-t border-slate-800 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    alert(
                      `[Giả lập Khách hàng Thành công!]\n\nĐã thêm vào giỏ hàng:\n- Sản phẩm: ${productName}\n- Mặt in: ${activeSurface?.name || "Front"}\n- Chữ cá nhân hóa: "${customText}"\n- Màu chữ: ${textColor}\n- Tổng tiền: $${totalPrice.toFixed(2)}\n\nPayload này sẽ được đính kèm vào Shopify Cart Item Properties khi khách đặt hàng!`
                    );
                  }}
                  className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-950/50 hover:from-emerald-500 hover:to-teal-400 transition cursor-pointer"
                >
                  🛒 Thêm vào Giỏ hàng (${totalPrice.toFixed(2)})
                </button>
                <p className="text-[10px] text-center text-slate-500">
                  Đây là màn hình xem trước. Dữ liệu khi khách bấm mua sẽ được đính kèm vào Line Item Properties của Shopify Order.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
