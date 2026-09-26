import React, { useState } from "react";
import type {
  CustomizationOption,
  CustomizationOptionGroup,
} from "../../../customization-normalizer";

export interface OptionGroupEditorProps {
  readonly groups: readonly CustomizationOptionGroup[];
  readonly onChange: (updatedGroups: CustomizationOptionGroup[]) => void;
}

export function OptionGroupEditor({
  groups,
  onChange,
}: OptionGroupEditorProps): React.JSX.Element {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(
    groups[0]?.id ?? null,
  );

  const handleAddGroup = () => {
    const timestamp = Date.now();
    const newGroup: CustomizationOptionGroup = {
      id: `group_${timestamp}`,
      label: `Tùy chọn mới ${groups.length + 1}`,
      type: "select",
      required: false,
      options: [
        {
          id: `opt_${timestamp}_1`,
          label: "Lựa chọn 1",
          isAvailable: true,
        },
      ],
    };
    onChange([...groups, newGroup]);
    setExpandedGroupId(newGroup.id);
  };

  const handleRemoveGroup = (groupId: string) => {
    const target = groups.find((g) => g.id === groupId);
    if (!window.confirm(`Bạn có chắc chắn muốn xóa nhóm tùy chọn "${target?.label || groupId}"?`)) {
      return;
    }
    const updated = groups.filter((g) => g.id !== groupId);
    onChange(updated);
    if (expandedGroupId === groupId) {
      setExpandedGroupId(updated[0]?.id ?? null);
    }
  };

  const handleUpdateGroup = (
    index: number,
    updater: (prev: CustomizationOptionGroup) => CustomizationOptionGroup,
  ) => {
    const next = [...groups];
    next[index] = updater(next[index]);
    onChange(next);
  };

  const handleAddOption = (groupIndex: number) => {
    const targetGroup = groups[groupIndex];
    const timestamp = Date.now();
    const newOption: CustomizationOption = {
      id: `opt_${timestamp}`,
      label: `Option ${(targetGroup.options?.length ?? 0) + 1}`,
      isAvailable: true,
    };
    handleUpdateGroup(groupIndex, (prev) => ({
      ...prev,
      options: [...(prev.options || []), newOption],
    }));
  };

  const handleRemoveOption = (groupIndex: number, optionIndex: number) => {
    handleUpdateGroup(groupIndex, (prev) => {
      const nextOpts = (prev.options || []).filter((_: unknown, i: number) => i !== optionIndex);
      return { ...prev, options: nextOpts };
    });
  };

  const handleUpdateOption = (
    groupIndex: number,
    optionIndex: number,
    updater: (prev: CustomizationOption) => CustomizationOption,
  ) => {
    handleUpdateGroup(groupIndex, (prev) => {
      const nextOpts = [...(prev.options || [])];
      nextOpts[optionIndex] = updater(nextOpts[optionIndex]);
      return { ...prev, options: nextOpts };
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Nhóm Tùy Chọn & Biến Thể (Option Groups & Choices)
          </h3>
          <p className="text-xs text-slate-400">
            Cấu hình các bộ chọn cho khách hàng: Màu sắc (Color Swatches), Font chữ, Kích cỡ phôi, Clipart, và phụ phí (Price Adjustments).
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddGroup}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-cyan-500 transition cursor-pointer"
        >
          <span>+</span> Thêm nhóm tùy chọn
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
          <p className="text-xs text-slate-400">Chưa có nhóm tùy chọn nào được định nghĩa.</p>
          <button
            type="button"
            onClick={handleAddGroup}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-slate-700 transition"
          >
            Tạo nhóm tùy chọn đầu tiên
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, groupIndex) => {
            const isExpanded = expandedGroupId === group.id;
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm"
              >
                {/* Group Accordion Header */}
                <div
                  className="flex items-center justify-between px-4 py-3 bg-slate-900/90 cursor-pointer select-none hover:bg-slate-850 transition"
                  onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 font-mono">
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    <span className="font-semibold text-xs text-slate-200">
                      {group.label || group.id}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyan-400">
                      ID: {group.id}
                    </span>
                    {group.required && (
                      <span className="rounded bg-rose-950/80 border border-rose-800 px-1.5 py-0.5 text-[10px] text-rose-300 font-medium">
                        Bắt buộc
                      </span>
                    )}
                    <span className="text-[11px] text-slate-500">
                      ({group.options?.length ?? 0} tùy chọn)
                    </span>
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => handleRemoveGroup(group.id)}
                      className="rounded p-1 text-slate-400 hover:bg-rose-950 hover:text-rose-400 transition"
                      title="Xóa nhóm này"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Group Content Body */}
                {isExpanded && (
                  <div className="border-t border-slate-800/80 p-4 space-y-4">
                    {/* Basic Group Settings */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Tên nhóm (Label)
                        </label>
                        <input
                          type="text"
                          value={group.label || ""}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              label: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                          placeholder="ví dụ: Màu sắc hoặc Font chữ"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Group ID (Định danh)
                        </label>
                        <input
                          type="text"
                          value={group.id}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              id: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Kiểu hiển thị (Type)
                        </label>
                        <select
                          value={group.type || "select"}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              type: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="select">Hộp chọn thả xuống (Dropdown Select)</option>
                          <option value="radio">Radio Buttons</option>
                          <option value="color">Mẫu màu sắc (Color Swatches)</option>
                          <option value="font">Lựa chọn Font chữ</option>
                          <option value="clipart">Mẫu clipart / icon</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={Boolean(group.required)}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              required: e.target.checked,
                            }))
                          }
                          className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
                        />
                        <span>Khách hàng bắt buộc phải chọn (Required)</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Tùy chọn mặc định:</span>
                        <select
                          value={group.defaultOptionId || ""}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              defaultOptionId: e.target.value || undefined,
                            }))
                          }
                          className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="">-- Không có mặc định --</option>
                          {(group.options || []).map((opt: CustomizationOption) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label || opt.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Options Table */}
                    <div className="mt-4 pt-3 border-t border-slate-800/80">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-300">
                          Danh sách giá trị ({group.options?.length ?? 0})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddOption(groupIndex)}
                          className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-cyan-400 hover:bg-slate-700 transition"
                        >
                          + Thêm Option
                        </button>
                      </div>

                      <div className="space-y-2">
                        {(group.options || []).map((option: CustomizationOption, optIdx: number) => (
                          <div
                            key={option.id || optIdx}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800/60 bg-slate-950/70 p-2.5 text-xs"
                          >
                            {/* Thumbnail preview if any */}
                            {option.thumbnailImage?.url ? (
                              <img
                                src={option.thumbnailImage.url}
                                alt={option.label}
                                className="h-7 w-7 rounded object-cover border border-slate-700 bg-slate-900"
                              />
                            ) : (
                              <div className="h-7 w-7 rounded border border-dashed border-slate-800 bg-slate-900/50 flex items-center justify-center text-[10px] text-slate-600">
                                🖼️
                              </div>
                            )}

                            {/* Label */}
                            <div className="flex-1 min-w-[130px]">
                              <input
                                type="text"
                                value={option.label || ""}
                                onChange={(e) =>
                                  handleUpdateOption(groupIndex, optIdx, (prev) => ({
                                    ...prev,
                                    label: e.target.value,
                                  }))
                                }
                                placeholder="Tên option (Label)"
                                className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                              />
                            </div>

                            {/* ID */}
                            <div className="w-28">
                              <input
                                type="text"
                                value={option.id}
                                onChange={(e) =>
                                  handleUpdateOption(groupIndex, optIdx, (prev) => ({
                                    ...prev,
                                    id: e.target.value,
                                  }))
                                }
                                placeholder="ID"
                                className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] font-mono text-cyan-400 focus:border-cyan-500 focus:outline-none"
                              />
                            </div>

                            {/* Thumbnail URL */}
                            <div className="flex-1 min-w-[180px]">
                              <input
                                type="text"
                                value={option.thumbnailImage?.url || ""}
                                onChange={(e) =>
                                  handleUpdateOption(groupIndex, optIdx, (prev) => ({
                                    ...prev,
                                    thumbnailImage: e.target.value
                                      ? { url: e.target.value, alt: prev.label }
                                      : null,
                                  }))
                                }
                                placeholder="Thumbnail CDN URL..."
                                className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 focus:border-cyan-500 focus:outline-none"
                              />
                            </div>

                            {/* Price adjustment */}
                            <div className="w-24">
                              <input
                                type="number"
                                step="0.5"
                                value={option.price?.amount ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? undefined : Number(e.target.value);
                                  handleUpdateOption(groupIndex, optIdx, (prev) => ({
                                    ...prev,
                                    price: val !== undefined
                                      ? { amount: val, currency: "USD" }
                                      : undefined,
                                  }));
                                }}
                                placeholder="+ Phụ phí $"
                                className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-emerald-400 focus:border-emerald-500 focus:outline-none"
                              />
                            </div>

                            {/* Remove button */}
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(groupIndex, optIdx)}
                              className="rounded p-1 text-slate-500 hover:bg-rose-950 hover:text-rose-400 transition"
                              title="Xóa option này"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
