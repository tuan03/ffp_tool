import { useEffect, useState } from "react";
import { z } from "zod";

const collectionPage = z.object({ success: z.literal(true), data: z.object({ collections: z.array(z.object({ id: z.string(), title: z.string() })),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().optional().nullable() }) }) });

export function ClassificationFields({ storeId, collectionId, productType, reason, onChange }: {
  readonly storeId: string; readonly collectionId: string; readonly productType: string; readonly reason?: string;
  readonly onChange: (value: { collectionId: string; productType: string }) => void;
}): React.JSX.Element {
  const [collections, setCollections] = useState<readonly { id: string; title: string }[]>([]);
  const [status, setStatus] = useState("Đang tải collections…");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const loaded: { id: string; title: string }[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const response = await fetch("/api/shopify", { method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, operation: "collections.list",
              payload: { limit: 250, cursor, query: "collection_type:custom" } }) });
          if (!response.ok) throw new Error("Catalog unavailable");
          const page = collectionPage.parse(await response.json()).data;
          loaded.push(...page.collections);
          cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined;
          if (page.pageInfo.hasNextPage && (!cursor || seen.has(cursor))) throw new Error("Incomplete catalog");
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (!controller.signal.aborted) { setCollections(loaded); setStatus(loaded.length ? "" : "Store chưa có collection có thể gán trực tiếp."); }
      } catch { if (!controller.signal.aborted) setStatus("Không tải được collections. Đóng và mở lại để thử lại."); }
    })();
    return () => controller.abort();
  }, [storeId]);
  return <fieldset className="space-y-3 rounded-lg border border-cyan-600 p-3">
    <legend className="px-2 font-medium">Phân loại Shopify</legend>
    {reason && <p className="text-sm text-amber-500">{reason}</p>}
    <label className="block text-sm">Collection
      <select className="mt-1 w-full rounded border border-slate-600 bg-white dark:bg-slate-900 p-2" value={collectionId}
        onChange={event => onChange({ collectionId: event.target.value, productType })}>
        <option value="">Chọn collection</option>
        {collectionId && !collections.some(collection => collection.id === collectionId) && <option value={collectionId} disabled>Collection đã chọn — đang kiểm tra</option>}
        {collections.map(collection => <option key={collection.id} value={collection.id}>{collection.title}</option>)}
      </select>
    </label>
    {status && <p role="status" className="text-sm">{status}</p>}
    <label className="block text-sm">Loại sản phẩm
      <input className="mt-1 w-full rounded border border-slate-600 bg-white dark:bg-slate-900 p-2" maxLength={255} value={productType}
        onChange={event => onChange({ collectionId, productType: event.target.value })} />
    </label>
  </fieldset>;
}
