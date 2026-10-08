import React, { useEffect, useMemo, useState } from "react";

import type { ShopifyProduct } from "../../../module-api";
import {
  groupBulkCustomizations,
  removeBulkCustomizationFields,
} from "../../bulk-edit";
import { readCustomization, updateCustomization } from "../../service";
import type { CustomizationGateway } from "../../types";

import type { BulkCustomizationEntry } from "../../bulk-edit";

export interface BulkCustomizerEditorProps {
  readonly products: readonly ShopifyProduct[];
  readonly gateway: CustomizationGateway;
  readonly onClose: () => void;
  readonly onComplete: (updatedCount: number) => void;
}

const READ_CONCURRENCY = 6;
const WRITE_CONCURRENCY = 4;

async function processChunks<Item>(
  items: readonly Item[],
  chunkSize: number,
  processItem: (item: Item) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += chunkSize) {
    await Promise.all(items.slice(index, index + chunkSize).map(processItem));
  }
}

export function BulkCustomizerEditor({
  products,
  gateway,
  onClose,
  onComplete,
}: BulkCustomizerEditorProps): React.JSX.Element {
  const [entries, setEntries] = useState<readonly BulkCustomizationEntry<ShopifyProduct>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [failedReads, setFailedReads] = useState(0);
  const [selectedSchemaKey, setSelectedSchemaKey] = useState<string | null>(null);
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadConfigurations(): Promise<void> {
      const loadedEntries: BulkCustomizationEntry<ShopifyProduct>[] = [];
      let readFailures = 0;

      await processChunks(products, READ_CONCURRENCY, async (product) => {
        try {
          const result = await readCustomization(gateway, { productId: product.id });
          if (result.exists && result.customization) {
            loadedEntries.push({ product, customization: result.customization });
          }
        } catch {
          readFailures += 1;
        }
      });

      if (!isActive) return;
      setEntries(loadedEntries);
      setFailedReads(readFailures);
      setIsLoading(false);
    }

    void loadConfigurations();
    return () => {
      isActive = false;
    };
  }, [gateway, products]);

  const groups = useMemo(() => groupBulkCustomizations(entries), [entries]);
  const selectedGroup = groups.find((group) => group.schemaKey === selectedSchemaKey) ?? groups[0];

  useEffect(() => {
    if (!selectedGroup) {
      setSelectedSchemaKey(null);
      return;
    }
    if (selectedSchemaKey !== selectedGroup.schemaKey) {
      setSelectedSchemaKey(selectedGroup.schemaKey);
      setSelectedFieldKeys(new Set());
    }
  }, [selectedGroup, selectedSchemaKey]);

  const handleToggleField = (fieldKey: string): void => {
    setSelectedFieldKeys((current) => {
      const next = new Set(current);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  };

  const handleApply = async (): Promise<void> => {
    if (!selectedGroup || selectedFieldKeys.size === 0 || isSaving) return;
    const productCount = selectedGroup.entries.length;
    const fieldCount = selectedFieldKeys.size;
    const shouldApply = window.confirm(
      `Xóa ${fieldCount} trường khỏi ${productCount} sản phẩm trong nhóm này?`,
    );
    if (!shouldApply) return;

    setIsSaving(true);
    setMessage(null);
    setProgress({ completed: 0, total: productCount });
    const successfulUpdates = new Map<string, BulkCustomizationEntry<ShopifyProduct>>();
    let failureCount = 0;

    await processChunks(selectedGroup.entries, WRITE_CONCURRENCY, async (entry) => {
      const updatedCustomization = removeBulkCustomizationFields(
        entry.customization,
        selectedFieldKeys,
      );
      try {
        await updateCustomization(gateway, {
          productId: entry.product.id,
          customization: updatedCustomization,
        });
        successfulUpdates.set(entry.product.id, {
          product: entry.product,
          customization: updatedCustomization,
        });
      } catch {
        failureCount += 1;
      } finally {
        setProgress((current) => ({ ...current, completed: current.completed + 1 }));
      }
    });

    setEntries((current) =>
      current.map((entry) => successfulUpdates.get(entry.product.id) ?? entry),
    );
    setSelectedFieldKeys(new Set());
    setIsSaving(false);
    const successCount = successfulUpdates.size;
    setMessage(
      failureCount > 0
        ? `Đã cập nhật ${successCount}/${productCount} sản phẩm; ${failureCount} sản phẩm lỗi chưa bị thay đổi.`
        : `Đã xóa trường khỏi ${successCount} sản phẩm.`,
    );
    if (successCount > 0) onComplete(successCount);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Xóa trường hàng loạt</h2>
            <p className="mt-1 text-xs text-slate-400">
              Chọn một nhóm sản phẩm giống nhau, sau đó chọn các trường cần xóa.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            aria-label="Đóng chỉnh sửa hàng loạt"
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div className="p-16 text-center">
            <div className="text-2xl">⏳</div>
            <p className="mt-3 text-sm text-slate-300">
              Đang đọc cấu hình của {products.length} sản phẩm…
            </p>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[320px_1fr]">
            <aside className="overflow-y-auto border-b border-slate-800 p-4 md:border-b-0 md:border-r">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {groups.length} nhóm cấu hình
              </div>
              <div className="space-y-2">
                {groups.map((group, index) => (
                  <button
                    key={group.schemaKey || `empty-${index}`}
                    type="button"
                    onClick={() => {
                      setSelectedSchemaKey(group.schemaKey);
                      setSelectedFieldKeys(new Set());
                      setMessage(null);
                    }}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      selectedGroup?.schemaKey === group.schemaKey
                        ? "border-cyan-500 bg-cyan-950/40"
                        : "border-slate-800 bg-slate-900/60 hover:border-slate-600"
                    }`}
                  >
                    <div className="font-bold text-slate-100">Nhóm {index + 1}</div>
                    <div className="mt-1 text-xs text-cyan-300">
                      {group.entries.length} sản phẩm · {group.fields.length} trường
                    </div>
                    <div className="mt-2 line-clamp-2 text-[11px] text-slate-400">
                      {group.fields.map((field) => field.label).join(" · ") || "Không còn trường"}
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-5">
              {failedReads > 0 && (
                <div className="mb-4 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-300">
                  Không đọc được {failedReads} sản phẩm; các sản phẩm này sẽ không được cập nhật.
                </div>
              )}
              {message && (
                <div className="mb-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-xs text-emerald-300">
                  {message}
                </div>
              )}

              {!selectedGroup ? (
                <div className="py-16 text-center text-sm text-slate-400">
                  Không tìm thấy sản phẩm có Customizer.
                </div>
              ) : (
                <>
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-slate-100">
                        {selectedGroup.entries.length} sản phẩm cùng cấu hình
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Đánh dấu trường cần xóa khỏi toàn bộ nhóm.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleApply()}
                      disabled={selectedFieldKeys.size === 0 || isSaving}
                      className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isSaving
                        ? `Đang lưu ${progress.completed}/${progress.total}`
                        : `Xóa ${selectedFieldKeys.size} trường khỏi ${selectedGroup.entries.length} sản phẩm`}
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedGroup.fields.map((field) => (
                      <label
                        key={field.key}
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 ${
                          selectedFieldKeys.has(field.key)
                            ? "border-rose-600 bg-rose-950/30"
                            : "border-slate-800 bg-slate-900/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFieldKeys.has(field.key)}
                          onChange={() => handleToggleField(field.key)}
                          disabled={isSaving}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold text-slate-100">{field.label}</span>
                          <span className="mt-0.5 block text-xs text-slate-400">
                            {field.kind === "text" ? "Trường nhập chữ" : "Nhóm lựa chọn"} · {field.detail}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <details className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                    <summary className="cursor-pointer text-xs font-semibold text-cyan-300">
                      Xem sản phẩm trong nhóm
                    </summary>
                    <div className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-400">
                      {selectedGroup.entries.map((entry) => (
                        <div key={entry.product.id}>{entry.product.title}</div>
                      ))}
                    </div>
                  </details>
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
