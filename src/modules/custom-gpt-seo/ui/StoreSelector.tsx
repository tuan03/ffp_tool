import type { SeoQueueStore } from "../service";

interface StoreSelectorProps {
  readonly stores: readonly SeoQueueStore[];
  readonly selectedStoreId: string;
  readonly isLoading: boolean;
  readonly onChange: (storeId: string) => void;
}

const SELECT_CLASS_NAME = "w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600/30 transition focus:border-blue-300 dark:focus:border-blue-800 focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-400 disabled:cursor-wait disabled:opacity-60";

export function StoreSelector({ stores, selectedStoreId, isLoading, onChange }: StoreSelectorProps): React.JSX.Element {
  return (
    <label className="relative">
      <span className="sr-only">Chọn cửa hàng</span>
      <select
        id="seo-store"
        className={SELECT_CLASS_NAME}
        value={selectedStoreId}
        disabled={isLoading}
        onChange={event => onChange(event.target.value)}
      >
        {stores.map(store => (
          <option key={store.storeId} value={store.storeId}>
            {store.shopDomain ? `${store.storeId} (${store.shopDomain})` : store.storeId}
          </option>
        ))}
      </select>
    </label>
  );
}
