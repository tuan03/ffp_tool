import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { CustomizationGateway } from "../../types";
import { cloneCustomization } from "../../service";

export interface CloneCustomizationModalProps {
  readonly isOpen: boolean;
  readonly sourceProductId: string;
  readonly gateway: CustomizationGateway;
  readonly onClose: () => void;
  readonly onCloned?: (targetProductId: string) => void;
}

export function CloneCustomizationModal({
  isOpen,
  sourceProductId,
  gateway,
  onClose,
  onCloned,
}: CloneCustomizationModalProps): React.JSX.Element | null {
  const [targetProductId, setTargetProductId] = useState("");
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleClone = async () => {
    const trimmedTarget = targetProductId.trim();
    if (!trimmedTarget) {
      setError("Vui lòng nhập Product GID đích.");
      return;
    }

    if (trimmedTarget === sourceProductId.trim()) {
      setError("Product đích không được trùng với Product nguồn.");
      return;
    }

    setIsCloning(true);
    setError(null);
    try {
      const result = await cloneCustomization(gateway, {
        sourceProductId: sourceProductId.trim(),
        targetProductId: trimmedTarget,
        allowOverwrite,
      });

      if (result.success) {
        alert(`Đã nhân bản cấu hình sang ${trimmedTarget} thành công! (Dung lượng: ${result.byteSize} bytes)`);
        onCloned?.(trimmedTarget);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-50 dark:bg-slate-800 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm">
                <AppIcon name="queue" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Nhân Bản Cấu Hình (Clone Customizer)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Sao chép toàn bộ Surface, Options và Placements sang SP khác
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="py-4 space-y-4 text-xs">
            <div>
              <span className="text-slate-600 dark:text-slate-400 block mb-1">Product Nguồn (Source):</span>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono text-blue-700 dark:text-blue-300 truncate">
                {sourceProductId}
              </div>
            </div>

            <div>
              <label className="text-slate-700 dark:text-slate-300 font-medium block mb-1">
                Product Đích (Target Product GID hoặc ID):
              </label>
              <input
                type="text"
                value={targetProductId}
                onChange={(e) => setTargetProductId(e.target.value)}
                placeholder="gid://shopify/Product/987654321..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-slate-100 font-mono focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={allowOverwrite}
                onChange={(e) => setAllowOverwrite(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 focus:ring-0"
              />
              <span className="text-slate-700 dark:text-slate-300">
                Ghi đè nếu sản phẩm đích đã có sẵn cấu hình Customizer
              </span>
            </label>

            {error && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 p-2.5 text-rose-700 dark:text-rose-300">
                {error}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleClone}
              disabled={isCloning || !targetProductId.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
            >
              {isCloning ? "Đang nhân bản..." : "Xác nhận nhân bản"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
