import { useId, useState } from "react";

interface CrawlerCollection {
  readonly id: string;
  readonly title: string;
  readonly productsCount?: number;
}

interface CrawlerCollectionPickerProps {
  readonly collections: readonly CrawlerCollection[];
  readonly selectedIds: readonly string[];
  readonly isLoading: boolean;
  readonly onToggle: (collectionId: string) => void;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
}

export function CrawlerCollectionPicker({ collections, selectedIds, isLoading, onToggle, onSelectAll, onClear }: CrawlerCollectionPickerProps) {
  const searchId = useId();
  const [searchText, setSearchText] = useState("");
  const query = searchText.trim().toLocaleLowerCase("vi-VN");
  const visibleCollections = collections.filter((collection) => collection.title.toLocaleLowerCase("vi-VN").includes(query));
  const selectedCollections = collections.filter((collection) => selectedIds.includes(collection.id));

  return (
    <section aria-label="Chọn collections" className="min-w-0 space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-200">Collections <span className="text-xs font-normal text-slate-400">· {selectedIds.length} đã chọn</span></h3>
        <div className="flex flex-wrap gap-3 text-xs">
          <button type="button" disabled={isLoading || collections.length === 0} onClick={onSelectAll} className="text-cyan-300 hover:text-cyan-200 disabled:opacity-50">Chọn tất cả ({collections.length})</button>
          <button type="button" disabled={isLoading || selectedIds.length === 0} onClick={onClear} className="text-slate-400 hover:text-rose-300 disabled:opacity-50">Bỏ chọn hết</button>
        </div>
      </div>
      {selectedCollections.length > 0 && !isLoading ? (
        <div aria-label="Collections đã chọn" className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
          {selectedCollections.map((collection) => (
            <button key={collection.id} type="button" aria-label={`Bỏ collection ${collection.title}`} onClick={() => onToggle(collection.id)}
              className="inline-flex max-w-full items-start gap-2 rounded-lg border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-left text-xs text-cyan-200 hover:border-cyan-500">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{collection.title}</span><span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
      <label htmlFor={searchId} className="grid gap-1.5 text-xs text-slate-400">Tìm collection
        <input id={searchId} type="search" value={searchText} disabled={isLoading} onChange={(event) => setSearchText(event.target.value)}
          placeholder="Nhập tên collection…" className="w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500 disabled:opacity-50" />
      </label>
      {isLoading ? <p role="status" className="text-sm text-slate-400">Đang tải collections…</p> : collections.length === 0 ? (
        <p role="status" className="text-sm text-slate-400">Chưa có collection để chọn. Kiểm tra collection và kết nối của store.</p>
      ) : visibleCollections.length === 0 ? (
        <p role="status" className="text-sm text-slate-400">Không tìm thấy collection phù hợp.</p>
      ) : (
        <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50 p-1">
          {visibleCollections.map((collection) => (
            <label key={collection.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 text-sm text-slate-300 hover:bg-slate-800/70">
              <input type="checkbox" aria-label={collection.title} checked={selectedIds.includes(collection.id)} onChange={() => onToggle(collection.id)} className="mt-0.5 shrink-0 accent-cyan-400" />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{collection.title}</span>
              {collection.productsCount !== undefined ? <span aria-hidden="true" className="shrink-0 text-xs text-slate-500">{collection.productsCount} SP</span> : null}
            </label>
          ))}
        </div>
      )}
      {query && collections.length > 0 && !isLoading ? <p className="text-xs text-slate-500">Hiển thị {visibleCollections.length}/{collections.length}. Tìm kiếm không thay đổi collection đã chọn; “Chọn tất cả” áp dụng toàn bộ danh sách.</p> : null}
    </section>
  );
}
