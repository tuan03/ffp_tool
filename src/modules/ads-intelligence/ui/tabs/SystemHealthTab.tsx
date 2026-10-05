import React from "react";
import type { AdsDataHealth, AdsShopifySummary } from "../../types";

export function SystemHealthTab({ health, shopifySummary, onSync }: { readonly health: AdsDataHealth | null; readonly shopifySummary: AdsShopifySummary | null; readonly onSync: () => void }): React.JSX.Element {
  return <div className="space-y-4 p-4 text-sm text-slate-300">
    <h3 className="font-semibold">Kết nối của store đang chọn</h3>
    <p>Shopify Gateway: {shopifySummary?.status ?? "Chưa lấy được dữ liệu"}</p>
    {shopifySummary && <p>{shopifySummary.source}</p>}
    <p>Meta: {health?.metaConnection.status ?? "Chưa xác minh"}</p>
    <p>GA4: {health?.ga4Connection.status ?? "Chưa xác minh"}</p>
    <p>Store và proxy Shopify được quản lý tại Gateway. Meta và GA4 cần cấu hình tài khoản riêng cho từng store.</p>
    <button type="button" onClick={onSync} className="rounded border border-slate-600 px-3 py-2">Tải lại dữ liệu</button>
  </div>;
}
