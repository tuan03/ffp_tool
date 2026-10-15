import React from "react";
import type { CustomizationTextInput } from "../../../customization-normalizer";

export interface TextInputEditorProps {
  readonly textInputs: readonly CustomizationTextInput[];
  readonly onChange: (updated: CustomizationTextInput[]) => void;
}

export function TextInputEditor({
  textInputs,
  onChange,
}: TextInputEditorProps): React.JSX.Element | null {
  if (textInputs.length === 0) return null;

  const handleRemoveTextInput = (index: number) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa trường chữ "${textInputs[index].label}" không?`)) {
      return;
    }
    const updated = textInputs.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleUpdateTextInput = (index: number, patch: Partial<CustomizationTextInput>) => {
    const updated = textInputs.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      {textInputs.map((input, idx) => (
        <div
          key={input.id || idx}
          className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                {input.label || `Trường chữ ${idx + 1}`}
              </span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  input.required
                    ? "bg-rose-50 border border-rose-200 text-rose-700"
                    : "bg-slate-50 text-slate-600"
                }`}
              >
                {input.required ? "Bắt buộc" : "Không bắt buộc"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleRemoveTextInput(idx)}
              className="rounded-lg p-1 text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition cursor-pointer"
              title="Xóa trường này"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Tên trường hiển thị
              </label>
              <input
                type="text"
                value={input.label}
                onChange={(e) => handleUpdateTextInput(idx, { label: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                placeholder="ví dụ: Customize Text"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Chữ gợi ý (Placeholder)
              </label>
              <input
                type="text"
                value={input.placeholder || ""}
                onChange={(e) => handleUpdateTextInput(idx, { placeholder: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                placeholder="ví dụ: The Smiths Family"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Giới hạn số ký tự tối đa
              </label>
              <input
                type="number"
                min={1}
                max={200}
                value={input.maxLength || 50}
                onChange={(e) =>
                  handleUpdateTextInput(idx, { maxLength: Number(e.target.value) || 50 })
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(input.required)}
                  onChange={(e) => handleUpdateTextInput(idx, { required: e.target.checked })}
                  className="rounded border-slate-300 bg-white text-blue-700 focus:ring-0"
                />
                <span>Bắt buộc khách hàng phải nhập</span>
              </label>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
