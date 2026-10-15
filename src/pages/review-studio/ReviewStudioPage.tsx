import { useEffect, useState } from "react";

import { PageHeader } from "../../shared/components/PageHeader";
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
  const [activeWorkflow, setActiveWorkflow] = useState<"images" | "reviews">("images");

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

  return <div className="w-full min-w-0 space-y-5">
    <PageHeader title="Review Studio" description="Chuẩn bị ảnh review, lưu vào Shopify Files và tạo review để xuất XLSX." />
    <nav aria-label="Quy trình Review Studio" className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700 pb-2">
      {(["images", "reviews"] as const).map(workflow => <button key={workflow} type="button" aria-pressed={activeWorkflow === workflow} aria-controls={`review-studio-${workflow}`} onClick={() => setActiveWorkflow(workflow)} className={`min-h-9 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeWorkflow === workflow ? "bg-blue-600 text-white" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"}`}>{workflow === "images" ? `1. Chuẩn bị ảnh${isImageBusy ? " · Đang xử lý" : ""}` : "2. Tạo review & xuất XLSX"}</button>)}
    </nav>
    {/* Keep both workflows mounted: tab changes must not interrupt image or review jobs. */}
    <section id="review-studio-images" aria-label="Chuẩn bị ảnh review" hidden={activeWorkflow !== "images"} className="space-y-5">
    <header className="space-y-3">
      <section className="max-w-xl rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <label className="block text-sm font-semibold text-blue-700 dark:text-blue-300">1. Chọn store và loại sản phẩm<select className="mt-2 w-full rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 dark:focus:border-blue-800 disabled:opacity-50" disabled={isImageBusy || stores.length === 0} value={imageStoreId} onChange={(event) => setImageStoreId(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{getStoreLabel(store)}</option>)}</select></label>
        <p className="mt-2 text-xs leading-5 text-blue-700 dark:text-blue-300">Chọn đúng store để hệ thống tự dùng kho ảnh nền và prompt phù hợp. Ảnh đã duyệt cũng sẽ được lưu vào Shopify Files của store này.</p>
      </section>
      {storeError ? <p role="alert" className="text-rose-700 dark:text-rose-300">{storeError}</p> : null}
    </header>
    {imageStoreId ? <section className="space-y-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">Tạo ảnh review</p><h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Chuẩn bị ảnh nền và ảnh sản phẩm</h2></div><ReviewImagePage client={imageClient} storeId={imageStoreId} stores={stores} onStoreIdChange={setImageStoreId} onShopifyFile={handleShopifyFile} onBusyChange={setIsImageBusy} embedded showStoreSelector={false} /></section> : <p className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-4 text-amber-700 dark:text-amber-300">Chưa có Shopify store khả dụng để lưu ảnh.</p>}
    </section>
    <section id="review-studio-reviews" aria-label="Tạo review và xuất XLSX" hidden={activeWorkflow !== "reviews"} className="space-y-3">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">Amazon Reviews</p><h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Tạo review và xuất XLSX</h2></div>
      <label className="block max-w-sm text-sm font-medium text-slate-900 dark:text-slate-100">Store sản phẩm nhận review/XLSX<select className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 disabled:opacity-50" disabled={stores.length === 0} value={reviewStoreId} onChange={(event) => setReviewStoreId(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
      <p className="text-xs text-slate-500 dark:text-slate-400">Store này được dùng để tìm Shopify product và gắn dữ liệu khi xuất XLSX; không thay đổi nơi lưu ảnh.</p>
      {reviewStoreId ? <AmazonReviewsPage client={reviewClient} shopify={reviewShopify} selectedStoreId={reviewStoreId} onSelectedStoreIdChange={setReviewStoreId} generatedPictureUrls={pictureUrlsByStore[imageStoreId] ?? []} embedded showStoreSelector={false} /> : <p className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-4 text-amber-700 dark:text-amber-300">Chưa có Shopify store khả dụng để nhận review.</p>}
    </section>
  </div>;
}
