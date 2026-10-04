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

const STORE_LABELS: Readonly<Record<string, string>> = {
  preaureum: "Preaureum · Túi và ví",
  capozen: "Capozen · Thảm",
  jeminise: "Jeminise · Chăn ga",
};

function getStoreLabel(storeId: string): string {
  return STORE_LABELS[storeId] ?? storeId;
}

export function ReviewStudioPage({ reviewClient, reviewShopify, imageClient }: ReviewStudioPageProps): React.JSX.Element {
  const [stores, setStores] = useState<readonly string[]>([]);
  const [imageStoreId, setImageStoreId] = useState("");
  const [reviewStoreId, setReviewStoreId] = useState("");
  const [pictureUrlsByStore, setPictureUrlsByStore] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [storeError, setStoreError] = useState("");
  const [isImageBusy, setIsImageBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void reviewShopify.listStores().then((items) => {
      if (!active) return;
      setStores(items);
      setImageStoreId((current) => current && items.includes(current) ? current : items[0] ?? "");
      setReviewStoreId((current) => current && items.includes(current) ? current : items[0] ?? "");
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
      <section className="max-w-xl rounded-2xl border border-cyan-500/40 bg-cyan-500/10 p-4">
        <label className="block text-sm font-semibold text-cyan-100">1. Chọn store và loại sản phẩm<select className="mt-2 w-full rounded-xl border border-cyan-700/70 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400 disabled:opacity-50" disabled={isImageBusy || stores.length === 0} value={imageStoreId} onChange={(event) => setImageStoreId(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{getStoreLabel(store)}</option>)}</select></label>
        <p className="mt-2 text-xs leading-5 text-cyan-200/80">Chọn đúng store để hệ thống tự dùng kho ảnh nền và prompt phù hợp. Ảnh đã duyệt cũng sẽ được lưu vào Shopify Files của store này.</p>
      </section>
      {storeError ? <p role="alert" className="text-rose-300">{storeError}</p> : null}
    </header>
    {imageStoreId ? <section className="space-y-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Tạo ảnh review</p><h2 className="text-2xl font-semibold text-slate-100">Chuẩn bị ảnh nền và ảnh sản phẩm</h2></div><ReviewImagePage client={imageClient} storeId={imageStoreId} stores={stores} onStoreIdChange={setImageStoreId} onShopifyFile={handleShopifyFile} onBusyChange={setIsImageBusy} embedded showStoreSelector={false} /></section> : <p className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-amber-200">Chưa có Shopify store khả dụng để lưu ảnh.</p>}
    <section className="space-y-3 border-t border-slate-800 pt-8">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Amazon Reviews</p><h2 className="text-2xl font-semibold text-slate-100">Tạo review và xuất XLSX</h2></div>
      <label className="block max-w-sm text-sm font-medium text-slate-200">Store sản phẩm nhận review/XLSX<select className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-50" disabled={stores.length === 0} value={reviewStoreId} onChange={(event) => setReviewStoreId(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
      <p className="text-xs text-slate-500">Store này được dùng để tìm Shopify product và gắn dữ liệu khi xuất XLSX; không thay đổi nơi lưu ảnh.</p>
      {reviewStoreId ? <AmazonReviewsPage client={reviewClient} shopify={reviewShopify} selectedStoreId={reviewStoreId} onSelectedStoreIdChange={setReviewStoreId} generatedPictureUrls={pictureUrlsByStore[imageStoreId] ?? []} embedded showStoreSelector={false} /> : <p className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-amber-200">Chưa có Shopify store khả dụng để nhận review.</p>}
    </section>
  </main>;
}
