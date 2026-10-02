import type { SeoQueueStore } from "../service";

interface StoreSelectorProps {
  readonly stores: readonly SeoQueueStore[];
  readonly selectedStoreId: string;
  readonly isLoading: boolean;
  readonly onChange: (storeId: string) => void;
}

const SELECT_CLASS_NAME = "w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-wait disabled:opacity-60";

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
