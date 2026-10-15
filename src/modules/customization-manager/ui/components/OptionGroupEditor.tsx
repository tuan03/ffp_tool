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
}: OptionGroupEditorProps): React.JSX.Element | null {
  if (groups.length === 0) return null;

  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(
    groups[0]?.id ?? null,
  );

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
    <div className="space-y-3">
      {groups.map((group, groupIndex) => {
            const isExpanded = expandedGroupId === group.id;
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm"
              >
                {/* Group Accordion Header */}
                <div
                  className="flex items-center justify-between px-4 py-3 bg-slate-50 cursor-pointer select-none hover:bg-slate-50 transition"
                  onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs text-slate-500 font-mono">
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    <span className="font-bold text-xs text-slate-900">
                      {group.label || group.id}
                    </span>
                    {group.required && (
                      <span className="rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-xs text-rose-700 font-medium">
                        Bắt buộc
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      ({group.options?.length ?? 0} tùy chọn)
                    </span>
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => handleRemoveGroup(group.id)}
                      className="rounded p-1 text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition cursor-pointer"
                      title="Xóa nhóm này"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Group Content Body */}
                {isExpanded && (
                  <div className="border-t border-slate-200 p-4 space-y-4">
                    {/* Basic Group Settings */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Tên nhóm
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
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                          placeholder="Ví dụ: Màu sắc, Kích cỡ..."
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Kiểu hiển thị
                        </label>
                        <select
                          value={group.type || "select"}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              type: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                        >
                          <option value="select">Hộp chọn (Dropdown)</option>
                          <option value="radio">Nút chọn (Radio)</option>
                          <option value="color">Mẫu màu sắc (Color Swatches)</option>
                          <option value="font">Font chữ</option>
                          <option value="clipart">Hình ảnh (Clipart)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(group.required)}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              required: e.target.checked,
                            }))
                          }
                          className="rounded border-slate-300 bg-white text-blue-700 focus:ring-0"
                        />
                        <span>Bắt buộc chọn</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-600">Mặc định:</span>
                        <select
                          value={group.defaultOptionId || ""}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              defaultOptionId: e.target.value || undefined,
                            }))
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                        >
                          <option value="">-- Không có --</option>
                          {(group.options || []).map((opt: CustomizationOption) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label || opt.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Options Table */}
                    <div className="mt-4 pt-3 border-t border-slate-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-700">
                          Danh sách lựa chọn ({group.options?.length ?? 0})
                        </span>
                      </div>

                      <div className="space-y-2">
                        {(group.options || []).map((option: CustomizationOption, optIdx: number) => (
                          <div
                            key={option.id || optIdx}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs"
                          >
                            {/* Thumbnail preview if any */}
                            {option.thumbnailImage?.url ? (
                              <img
                                src={option.thumbnailImage.url}
                                alt={option.label}
                                className="h-7 w-7 rounded-lg object-cover border border-slate-300 bg-white"
                              />
                            ) : null}

                            {/* Label */}
                            <div className="flex-1 min-w-[140px]">
                              <input
                                type="text"
                                value={option.label || ""}
                                onChange={(e) =>
                                  handleUpdateOption(groupIndex, optIdx, (prev) => ({
                                    ...prev,
                                    label: e.target.value,
                                  }))
                                }
                                placeholder="Tên lựa chọn"
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
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
                                placeholder="Link ảnh (nếu có)"
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                              />
                            </div>

                            {/* Price adjustment */}
                            <div className="w-28">
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
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-emerald-700 focus:border-emerald-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                              />
                            </div>

                            {/* Remove button */}
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(groupIndex, optIdx)}
                              className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition cursor-pointer"
                              title="Xóa lựa chọn này"
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
  );
}
