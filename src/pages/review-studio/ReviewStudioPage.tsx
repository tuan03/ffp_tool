import { useEffect, useState } from "react";

import { AmazonReviewsPage } from "../../modules/amazon-reviews";
import type { ReviewClient, ReviewShopifyAccess } from "../../modules/amazon-reviews";
import { ReviewImagePage } from "../../modules/review-image";
import type { ReviewImageClient, ReviewImageShopifyFile } from "../../modules/review-image";

interface ReviewStudioPageProps {
  readonly reviewClient: ReviewClient;
  readonly reviewShopify: ReviewShopifyAccess;
  readonly imageClient: ReviewImageClient;
}

export function ReviewStudioPage({ reviewClient, reviewShopify, imageClient }: ReviewStudioPageProps): React.JSX.Element {
  const [stores, setStores] = useState<readonly string[]>([]);
  const [storeId, setStoreId] = useState("");
  const [pictureUrlsByStore, setPictureUrlsByStore] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [storeError, setStoreError] = useState("");
  const [isImageBusy, setIsImageBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void reviewShopify.listStores().then((items) => {
      if (!active) return;
      setStores(items);
      setStoreId((current) => current && items.includes(current) ? current : items[0] ?? "");
    }).catch(() => {
      if (active) setStoreError("Không tải được danh sách Shopify store.");
    });
    return () => { active = false; };
  }, [reviewShopify]);

  function handleShopifyFile(uploadStoreId: string, file: ReviewImageShopifyFile): void {
    setPictureUrlsByStore((current) => ({
      ...current,
      [uploadStoreId]: [...new Set([...(current[uploadStoreId] ?? []), file.shopifyCdnUrl])],
    }));
  }

  return <main className="mx-auto max-w-7xl space-y-8">
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">FFP Tool</p>
      <h1 className="text-3xl font-bold tracking-tight text-slate-100">Review Studio</h1>
      <p className="text-sm text-slate-400">Tạo ảnh review, lưu vào Shopify Files rồi dùng link ảnh khi xuất Amazon Reviews.</p>
      <label className="block max-w-sm text-sm font-medium text-slate-200">Store dùng cho toàn bộ quy trình<select className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-50" disabled={isImageBusy} value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
      {storeError ? <p role="alert" className="text-rose-300">{storeError}</p> : null}
    </header>
    {storeId ? <>
      <section className="space-y-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Bước 1</p><h2 className="text-2xl font-semibold text-slate-100">Tạo và upload ảnh review</h2></div><ReviewImagePage client={imageClient} storeId={storeId} stores={stores} onStoreIdChange={setStoreId} onShopifyFile={handleShopifyFile} onBusyChange={setIsImageBusy} embedded showStoreSelector={false} /></section>
      <section className="space-y-3 border-t border-slate-800 pt-8"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Bước 2</p><h2 className="text-2xl font-semibold text-slate-100">Amazon Reviews và xuất XLSX</h2></div><AmazonReviewsPage client={reviewClient} shopify={reviewShopify} selectedStoreId={storeId} onSelectedStoreIdChange={setStoreId} generatedPictureUrls={pictureUrlsByStore[storeId] ?? []} embedded showStoreSelector={false} /></section>
    </> : <p className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-amber-200">Chưa có Shopify store khả dụng.</p>}
  </main>;
}
