import React from "react";
import type { CustomizationTextInput } from "../../../customization-normalizer";

export interface TextInputEditorProps {
  readonly textInputs: readonly CustomizationTextInput[];
  readonly onChange: (updated: CustomizationTextInput[]) => void;
}

export function TextInputEditor({
  textInputs,
  onChange,
}: TextInputEditorProps): React.JSX.Element {
  const handleAddTextInput = () => {
    const newId = `text_${Date.now()}`;
    const newItem: CustomizationTextInput = {
      id: newId,
      type: "TextInputComponent",
      label: `Customize Text ${textInputs.length + 1}`,
      placeholder: "The Smiths Family",
      required: false,
      maxLength: 50,
    };
    onChange([...textInputs, newItem]);
  };

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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">
          Chữ Tùy Biến (Text)
        </h3>
        <button
          type="button"
          onClick={handleAddTextInput}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-cyan-500 transition cursor-pointer"
        >
          + Thêm Ô Nhập Chữ
        </button>
      </div>

      {textInputs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-6 text-center">
          <p className="text-xs text-slate-400">Không có trường nhập chữ nào.</p>
          <button
            type="button"
            onClick={handleAddTextInput}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-medium text-cyan-400 hover:bg-slate-700 transition cursor-pointer"
          >
            + Thêm Ô Nhập Chữ
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {textInputs.map((input, idx) => (
            <div
              key={input.id || idx}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-200">
                    {input.label || `Trường chữ ${idx + 1}`}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    input.required
                      ? "bg-rose-950/80 border border-rose-800 text-rose-300"
                      : "bg-slate-800 text-slate-400"
                  }`}>
                    {input.required ? "Bắt buộc" : "Không bắt buộc"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveTextInput(idx)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-rose-950 hover:text-rose-400 transition cursor-pointer"
                  title="Xóa trường này"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Tên trường hiển thị
                  </label>
                  <input
                    type="text"
                    value={input.label}
                    onChange={(e) => handleUpdateTextInput(idx, { label: e.target.value })}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                    placeholder="ví dụ: Customize Text"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Chữ gợi ý (Placeholder)
                  </label>
                  <input
                    type="text"
                    value={input.placeholder || ""}
                    onChange={(e) => handleUpdateTextInput(idx, { placeholder: e.target.value })}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                    placeholder="ví dụ: The Smiths Family"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
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
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(input.required)}
                      onChange={(e) => handleUpdateTextInput(idx, { required: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
                    />
                    <span>Bắt buộc khách hàng phải nhập</span>
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
