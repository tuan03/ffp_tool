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
  preaureum: "Preaureum - Túi và ví",
  capozen: "Capozen - Thảm",
  jeminise: "Jeminise - Chăn ga",
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

  return (
    <div className="w-full min-w-0 space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Review Studio</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
            Tạo review sản phẩm
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Chuẩn bị hình ảnh, lựa chọn template và tạo review để xuất ra file XLSX cho Shopify.
          </p>
        </div>

        <nav aria-label="Quy trình Review Studio" className="flex shrink-0 items-start gap-2 sm:gap-3">
          {(["images", "reviews"] as const).map((workflow, index) => {
            const isActive = activeWorkflow === workflow;
            const stepNumber = index + 1;
            const label =
              workflow === "images"
                ? `Chuẩn bị ảnh${isImageBusy ? " · Đang xử lý" : ""}`
                : "Tạo review & xuất XLSX";

            return (
              <div key={workflow} className="flex items-start gap-2 sm:gap-3">
                {index > 0 ? (
                  <div
                    aria-hidden="true"
                    className="mt-4 w-12 border-t border-dashed border-slate-300 dark:border-slate-700 sm:w-20"
                  />
                ) : null}
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-controls={`review-studio-${workflow}`}
                  onClick={() => setActiveWorkflow(workflow)}
                  className="group flex flex-col items-center gap-1.5 rounded-xl px-2 py-1 text-center transition"
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition ${
                      isActive
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                        : "bg-slate-400 text-white group-hover:bg-slate-500 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {stepNumber}
                  </span>
                  <span
                    className={`text-xs font-semibold transition sm:text-sm ${
                      isActive
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              </div>
            );
          })}
        </nav>
      </header>

      {/* Keep both workflows mounted: tab changes must not interrupt image or review jobs. */}
      <section
        id="review-studio-images"
        aria-label="Chuẩn bị ảnh review"
        hidden={activeWorkflow !== "images"}
        className="space-y-5"
      >
        <section className="rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xs sm:p-5">
          <div className="grid gap-4 lg:grid-cols-12 lg:items-center">
            <div className="flex items-center gap-3.5 lg:col-span-6">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M6 8h12l-1 12H7L6 8Z" />
                  <path d="M9 8V6a3 3 0 0 1 6 0v2" />
                </svg>
              </span>
              <label className="min-w-0 flex-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                <span className="sr-only">1. </span>Chọn store và loại sản phẩm
                <select
                  className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 dark:focus:border-blue-800 disabled:opacity-50"
                  disabled={isImageBusy || stores.length === 0}
                  value={imageStoreId}
                  onChange={(event) => setImageStoreId(event.target.value)}
                >
                  {stores.map((store) => (
                    <option key={store} value={store}>
                      {getStoreLabel(store)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 px-4 py-3 text-xs leading-5 text-blue-700 dark:text-blue-300 lg:col-span-6">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <p>
                Chọn đúng store để hệ thống sử dụng kho ảnh nền và prompt phù hợp. Ảnh đã duyệt cũng sẽ được lưu vào Shopify Files của store này.
              </p>
            </div>
          </div>
          {storeError ? (
            <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
              {storeError}
            </p>
          ) : null}
        </section>

        {imageStoreId ? (
          <ReviewImagePage
            client={imageClient}
            storeId={imageStoreId}
            stores={stores}
            onStoreIdChange={setImageStoreId}
            onShopifyFile={handleShopifyFile}
            onBusyChange={setIsImageBusy}
            embedded
            showStoreSelector={false}
          />
        ) : (
          <p className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-4 text-sm text-amber-700 dark:text-amber-300">
            Chưa có Shopify store khả dụng để lưu ảnh.
          </p>
        )}
      </section>

      <section
        id="review-studio-reviews"
        aria-label="Tạo review và xuất XLSX"
        hidden={activeWorkflow !== "reviews"}
        className="space-y-4"
      >
        <section className="rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xs sm:p-5">
          <div className="grid gap-4 lg:grid-cols-12 lg:items-center">
            <div className="flex items-center gap-3.5 lg:col-span-6">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M6 8h12l-1 12H7L6 8Z" />
                  <path d="M9 8V6a3 3 0 0 1 6 0v2" />
                </svg>
              </span>
              <label className="min-w-0 flex-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                Store sản phẩm nhận review/XLSX
                <select
                  className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 disabled:opacity-50"
                  disabled={stores.length === 0}
                  value={reviewStoreId}
                  onChange={(event) => setReviewStoreId(event.target.value)}
                >
                  {stores.map((store) => (
                    <option key={store} value={store}>
                      {getStoreLabel(store)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 px-4 py-3 text-xs leading-5 text-blue-700 dark:text-blue-300 lg:col-span-6">
              <p>
                Store này được dùng để tìm Shopify product và gắn dữ liệu khi xuất XLSX; không thay đổi nơi lưu ảnh.
              </p>
            </div>
          </div>
        </section>

        {reviewStoreId ? (
          <AmazonReviewsPage
            client={reviewClient}
            shopify={reviewShopify}
            selectedStoreId={reviewStoreId}
            onSelectedStoreIdChange={setReviewStoreId}
            generatedPictureUrls={pictureUrlsByStore[imageStoreId] ?? []}
            embedded
            showStoreSelector={false}
          />
        ) : (
          <p className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-4 text-sm text-amber-700 dark:text-amber-300">
            Chưa có Shopify store khả dụng để nhận review.
          </p>
        )}
      </section>
    </div>
  );
}

