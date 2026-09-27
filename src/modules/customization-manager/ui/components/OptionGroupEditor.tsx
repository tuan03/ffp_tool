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
        <h3 className="text-sm font-bold text-slate-200">
          Nhóm Tùy Chọn
        </h3>
        <button
          type="button"
          onClick={handleAddGroup}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-cyan-500 transition cursor-pointer"
        >
          + Thêm Nhóm Tùy Chọn
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
          <p className="text-xs text-slate-400">Chưa có nhóm tùy chọn nào.</p>
          <button
            type="button"
            onClick={handleAddGroup}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-medium text-cyan-400 hover:bg-slate-700 transition cursor-pointer"
          >
            + Tạo Nhóm Tùy Chọn
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, groupIndex) => {
            const isExpanded = expandedGroupId === group.id;
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-sm"
              >
                {/* Group Accordion Header */}
                <div
                  className="flex items-center justify-between px-4 py-3 bg-slate-900/90 cursor-pointer select-none hover:bg-slate-800/80 transition"
                  onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs text-slate-500 font-mono">
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    <span className="font-bold text-xs text-slate-200">
                      {group.label || group.id}
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
                      className="rounded p-1 text-slate-400 hover:bg-rose-950 hover:text-rose-400 transition cursor-pointer"
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
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
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                          placeholder="Ví dụ: Màu sắc, Kích cỡ..."
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
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
                          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
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
                        <span>Bắt buộc chọn</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Mặc định:</span>
                        <select
                          value={group.defaultOptionId || ""}
                          onChange={(e) =>
                            handleUpdateGroup(groupIndex, (prev) => ({
                              ...prev,
                              defaultOptionId: e.target.value || undefined,
                            }))
                          }
                          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
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
                    <div className="mt-4 pt-3 border-t border-slate-800/80">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-300">
                          Danh sách lựa chọn ({group.options?.length ?? 0})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddOption(groupIndex)}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-cyan-400 hover:bg-slate-700 transition cursor-pointer"
                        >
                          + Thêm Lựa Chọn
                        </button>
                      </div>

                      <div className="space-y-2">
                        {(group.options || []).map((option: CustomizationOption, optIdx: number) => (
                          <div
                            key={option.id || optIdx}
                            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 text-xs"
                          >
                            {/* Thumbnail preview if any */}
                            {option.thumbnailImage?.url ? (
                              <img
                                src={option.thumbnailImage.url}
                                alt={option.label}
                                className="h-7 w-7 rounded-lg object-cover border border-slate-700 bg-slate-900"
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
                                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
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
                                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none"
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
                                className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-emerald-400 focus:border-emerald-500 focus:outline-none"
                              />
                            </div>

                            {/* Remove button */}
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(groupIndex, optIdx)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-950 hover:text-rose-400 transition cursor-pointer"
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
      )}
    </div>
  );
}
