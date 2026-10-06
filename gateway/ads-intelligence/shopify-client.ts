import { z } from "zod";
import { getAdsGateway, getAdsGatewayStore } from "./gateway-connection";

export interface ShopifyOrderSummary {
  readonly status: "CONNECTED" | "NOT_CONFIGURED" | "ESTIMATED";
  readonly totalOrders: number;
  readonly grossSales: string;
  readonly totalRefunds: string;
  readonly netSales: string;
  readonly averageOrderValue: string;
  readonly currency: string;
  readonly source: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}
const money = z.object({ shopMoney: z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/), currencyCode: z.string() }) });
const responseSchema = z.object({
  shop: z.object({ currencyCode: z.string() }),
  orders: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    edges: z.array(z.object({ node: z.object({
      id: z.string(), createdAt: z.string(), test: z.boolean(), cancelledAt: z.string().nullable(), displayFinancialStatus: z.string(),
      totalPriceSet: money, totalRefundedSet: money,
    }) })),
  }),
});
const query = `query AdsStoreOrders($cursor: String, $filter: String!) {
  shop { currencyCode }
  orders(first: 100, after: $cursor, query: $filter, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node { id createdAt test cancelledAt displayFinancialStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
    } }
  }
}`;

export class ShopifyOrdersClient {
  async getOrderSummary(storeId: string, period?: { since: string; until: string; timezone?: string }): Promise<ShopifyOrderSummary> {
    const { graphqlClient } = getAdsGateway();
    const store = await getAdsGatewayStore(storeId);
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    let historyStart: string | undefined;
    if (!period || Date.parse(period.since) < end.getTime() - 60 * 86400000) {
      const accessPayload: unknown = await graphqlClient.query(store,
        "query AdsHistoryAccess { currentAppInstallation { accessScopes { handle } } shop { createdAt } }", {}, {isWrite:false});
      const access = z.object({ currentAppInstallation: z.object({ accessScopes: z.array(z.object({handle:z.string()})) }), shop: z.object({createdAt:z.string().datetime()}) }).parse(accessPayload);
      historyStart = access.shop.createdAt.slice(0, 10);
      const requestedStart = period?.since ?? historyStart;
      if (Date.parse(requestedStart) < end.getTime() - 60 * 86400000 && !access.currentAppInstallation.accessScopes.some(scope => scope.handle === "read_all_orders")) {
        throw new Error("SHOPIFY_HISTORY_ACCESS_REQUIRED");
      }
    }
    const periodStart = period?.since ?? historyStart ?? end.toISOString().slice(0, 10);
    const periodEnd = period?.until ?? end.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) throw new Error("SHOPIFY_REPORT_PERIOD_INVALID");
    const timezone = period?.timezone ?? "UTC";
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const upperBound = new Date(Date.parse(periodEnd) + 2 * 86400000).toISOString();
    const filter = `created_at:>=${new Date(Date.parse(periodStart) - 86400000).toISOString()} created_at:<${upperBound}`;
    let cursor: string | null = null;
    let gross = 0; let refunds = 0; let count = 0;
    const seenCursors = new Set<string>(); const seenOrders = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const payload: unknown = await graphqlClient.query(store, query, { cursor, filter }, { isWrite: false });
      const response = responseSchema.parse(payload);
      const currency = response.shop.currencyCode;
      for (const { node } of response.orders.edges) {
        if (seenOrders.has(node.id)) continue;
        seenOrders.add(node.id);
        const date = localDate.format(new Date(node.createdAt));
        if (date < periodStart || date > periodEnd || node.test || node.cancelledAt || !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(node.displayFinancialStatus)) continue;
        if (node.totalPriceSet.shopMoney.currencyCode !== currency || node.totalRefundedSet.shopMoney.currencyCode !== currency) throw new Error("SHOPIFY_CURRENCY_MISMATCH");
        gross += Number(node.totalPriceSet.shopMoney.amount); refunds += Number(node.totalRefundedSet.shopMoney.amount); count++;
      }
      if (!response.orders.pageInfo.hasNextPage) {
        const net = gross - refunds;
        return { status: "CONNECTED", totalOrders: count, grossSales: gross.toFixed(2), totalRefunds: refunds.toFixed(2), netSales: net.toFixed(2), averageOrderValue: count ? (net / count).toFixed(2) : "0.00", currency, periodStart, periodEnd,
          source: `Gateway Shopify (${store.shopDomain}); ${periodStart}–${periodEnd} ${timezone}; paid/refunded orders, excluding test/cancelled; totals include tax/shipping, less current refunds. Not Shopify Analytics Net Sales.`,
        };
      }
      cursor = response.orders.pageInfo.endCursor;
      if (!cursor || seenCursors.has(cursor)) throw new Error("SHOPIFY_PAGINATION_INCOMPLETE");
      seenCursors.add(cursor);
    }
    throw new Error("SHOPIFY_PAGINATION_INCOMPLETE");
  }
}
