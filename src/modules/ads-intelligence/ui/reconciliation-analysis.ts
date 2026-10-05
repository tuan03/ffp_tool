import type { AdsReconciliationReport, AdsStoreSummary } from "../types";

function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function describeReconciliation(reconciliation: AdsReconciliationReport | null, summary: AdsStoreSummary | null): Readonly<Record<string, string>> {
  const shop = reconciliation?.shopify;
  const paid = reconciliation?.ga4.metaPaid;
  const hasPaid = paid?.status === "AVAILABLE";
  const spend = numeric(reconciliation?.meta.spend ?? summary?.spend);
  const clicks = numeric(reconciliation?.meta.linkClicks ?? summary?.linkClicks);
  const purchases = numeric(reconciliation?.meta.purchases ?? summary?.purchases);
  const metaValue = numeric(reconciliation?.meta.purchaseValue ?? summary?.purchaseValue);
  const net = numeric(shop?.netSales);
  const orders = numeric(shop?.totalOrders);
  const sessions = hasPaid ? numeric(paid.sessions) : null;
  const ga4Orders = hasPaid ? numeric(paid.ecommercePurchases) : null;
  const ga4Value = hasPaid ? numeric(paid.purchaseRevenue) : null;
  const cpa = numeric(reconciliation?.meta.cpa ?? summary?.cpa);
  const blended = numeric(shop?.blendedCpa);
  const refunds = numeric(shop?.totalRefunds);
  const currency = summary?.currency ?? "";
  const money = (amount: number): string => `${currency} ${amount.toFixed(2)}`.trim();
  const count = (amount: number): string => new Intl.NumberFormat("vi-VN", {maximumFractionDigits: 2}).format(amount);
  const signed = (amount: number): string => `${amount > 0 ? "+" : ""}${count(amount)}`;
  const traffic = clicks !== null && sessions !== null
    ? `${count(clicks)} clicks − ${count(sessions)} sessions = ${signed(clicks - sessions)}. ${clicks > 0 ? `Sessions/clicks = ${count(sessions / clicks * 100)}%.` : "Không tính sessions/clicks khi clicks = 0."} So sánh tổng khác đơn vị/phạm vi và có thể khác múi giờ; không phải tỷ lệ chuyển đổi hay mất khách.`
    : "Chưa đủ clicks Meta và sessions GA4 Meta trả phí để tính chênh lệch.";
  const orderParts = [
    orders !== null && purchases !== null ? `Shopify − Meta: ${signed(orders - purchases)} đơn.` : "Chưa đủ đơn Shopify/Meta.",
    orders !== null && ga4Orders !== null ? `Shopify − GA4 Meta trả phí: ${signed(orders - ga4Orders)} đơn.` : "Chưa đủ purchases GA4 Meta trả phí.",
    "Khác cách ghi nhận; chưa xác định nguồn đơn hoặc nguyên nhân chênh lệch.",
  ];
  const revenueParts = [
    net !== null && metaValue !== null ? `Shopify − Meta: ${money(net - metaValue)}.` : "Chưa đủ giá trị Shopify/Meta.",
    net !== null && ga4Value !== null && paid?.currency === summary?.currency ? `Shopify − GA4 Meta trả phí: ${money(net - ga4Value)}.` : "Chưa đủ giá trị cùng tiền tệ để so với GA4.",
    "Khác cơ sở ghi nhận, không phải doanh thu bị thất thoát.",
  ];
  const cpaParts = [
    spend !== null && orders !== null && orders > 0 && blended !== null ? `Blended CPA = ${money(spend)} / ${count(orders)} đơn = ${money(blended)}/đơn.` : orders === 0 ? "Không tính Blended CPA: Shopify có 0 đơn." : "Chưa đủ dữ liệu Blended CPA.",
    cpa !== null && blended !== null ? `Blended − Meta CPA: ${money(blended - cpa)} (khác mẫu số).` : purchases === 0 ? "Không tính chênh lệch CPA: Meta có 0 purchases." : "Chưa đủ Meta CPA để so sánh.",
  ];
  return {
    spend: spend === null ? "Chưa có chi tiêu Meta." : `Chi tiêu Meta trong kỳ: ${money(spend)}. Không cộng lặp sang GA4 hoặc Shopify.`,
    traffic,
    orders: orderParts.join(" "),
    revenue: revenueParts.join(" "),
    refunds: refunds === null ? "Chưa có số hoàn tiền Shopify." : `Shopify hoàn tiền: ${money(refunds)}. Meta/GA4 chưa thu thập nên không tính chênh lệch.`,
    cpa: cpaParts.join(" "),
    ratio: net !== null && spend !== null && spend > 0
      ? `${money(net)} / ${money(spend)} = ${new Intl.NumberFormat("vi-VN", {minimumFractionDigits: 3, maximumFractionDigits: 3}).format(net / spend)}× Shopify / Meta. Không phải MER mọi kênh hoặc lợi nhuận ròng.`
      : spend === 0 ? "Không tính tỷ số: chi tiêu Meta bằng 0." : "Chưa đủ giá trị Shopify và chi tiêu Meta để tính tỷ số.",
  };
}
