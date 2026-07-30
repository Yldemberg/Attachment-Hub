import type { StoredMlOrderItemsJsonRow, OrderReportFinancials } from "./ml-order-payload";
import type { SalesReportExportRow } from "./sales-report-export";

export type SkuFinancialsMap = Map<string, { taxPercent: number | null; purchasePrice: number | null }>;

/** listing_type_id do produto → rótulo Clássico/Premium. */
export type ListingTypeByItemId = Map<string, string | null>;

const LISTING_TYPE_LABELS: Record<string, string> = {
  gold_special: "Clássico",
  gold_pro: "Premium",
  gold_premium: "Premium",
  free: "Grátis",
};

const LOGISTIC_LABELS: Record<string, string> = {
  fulfillment: "Full",
  cross_docking: "Coleta",
  xd_drop_off: "Places",
  drop_off: "Padrão",
  self_service: "Flex",
  self_service_in: "Flex",
  turbo: "Turbo",
  default: "Padrão",
  custom: "Custom",
  not_specified: "N/D",
};

export function parseReportFinancialsDb(raw: unknown): OrderReportFinancials | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const itemsSubtotal = Number(o.itemsSubtotal);
  const marketplaceFeesTotal = Number(o.marketplaceFeesTotal);
  const shippingTotal = Number(o.shippingTotal);
  if (!Number.isFinite(itemsSubtotal) || !Number.isFinite(marketplaceFeesTotal) || !Number.isFinite(shippingTotal)) {
    return null;
  }
  const netRaw = o.netReceivedAmount;
  const netReceivedAmount =
    netRaw != null && Number.isFinite(Number(netRaw)) ? Number(netRaw) : null;
  const src = o.shippingCostSource;
  const shippingCostSource =
    src === "shipment_costs" || src === "payments" ? src : null;
  return {
    itemsSubtotal,
    marketplaceFeesTotal,
    shippingTotal,
    shippingCostSource,
    netReceivedAmount,
  };
}

export function itemsSubtotalFromStoredItems(items: StoredMlOrderItemsJsonRow[]): number {
  return Math.round(items.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
}

export function shortTitle(title: string | null | undefined, max = 40): string {
  if (!title) return "";
  const t = title.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function labelListingType(listingTypeId: string | null | undefined): string | null {
  if (!listingTypeId) return null;
  const key = listingTypeId.trim();
  return LISTING_TYPE_LABELS[key] ?? key;
}

export function labelLogisticType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const primary = raw.split(",")[0]?.trim() ?? "";
  if (!primary) return null;
  return LOGISTIC_LABELS[primary] ?? primary;
}

function uniqueJoin(values: Array<string | null | undefined>): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = v?.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length > 0 ? out.join(", ") : null;
}

export type SalesReportDbDetailRow = {
  referenceDate: string;
  accountId: string;
  mlOrderId: bigint | null;
  totalAmount: string | null;
  accountNickname: string | null;
  itemsJson: unknown;
  reportFinancials: unknown;
  shippingId?: bigint | number | null;
};

export function buildSalesReportExportRow(
  r: SalesReportDbDetailRow,
  finMap: SkuFinancialsMap,
  listingTypeByItemId?: ListingTypeByItemId,
  options?: { adsFee?: number | null },
): SalesReportExportRow {
  const items: StoredMlOrderItemsJsonRow[] = Array.isArray(r.itemsJson)
    ? (r.itemsJson as StoredMlOrderItemsJsonRow[])
    : [];
  const snap = parseReportFinancialsDb(r.reportFinancials);
  const marketplaceFeesTotal = snap?.marketplaceFeesTotal ?? 0;
  const shippingTotal = snap?.shippingTotal ?? 0;

  let productPurchaseTotal = 0;
  let taxTotal = 0;
  for (const it of items) {
    const qty = it.quantity;
    const lineVal = it.price * qty;
    const fin = it.sku ? finMap.get(it.sku) : undefined;
    const pp = fin?.purchasePrice != null ? fin.purchasePrice : 0;
    productPurchaseTotal += pp * qty;
    const tx = fin?.taxPercent != null ? fin.taxPercent : 0;
    taxTotal += lineVal * (tx / 100);
  }
  productPurchaseTotal = Math.round(productPurchaseTotal * 100) / 100;
  taxTotal = Math.round(taxTotal * 100) / 100;

  const netReceivedAmount = snap?.netReceivedAmount ?? null;
  const adsFee =
    options?.adsFee != null && Number.isFinite(options.adsFee) ? Math.round(options.adsFee * 100) / 100 : null;
  const profit =
    netReceivedAmount != null
      ? Math.round((netReceivedAmount - taxTotal - productPurchaseTotal - (adsFee ?? 0)) * 100) / 100
      : null;

  const first = items[0];
  const sku = uniqueJoin(items.map((it) => it.sku));
  let titleShort: string | null = null;
  if (first?.title) {
    titleShort = shortTitle(first.title, 40);
    if (items.length > 1) titleShort = `${titleShort} (+${items.length - 1})`;
  }

  const listingTypeLabel = uniqueJoin(
    items.map((it) => {
      const fromMap = listingTypeByItemId?.get(it.item_id);
      const fromItem = (it as StoredMlOrderItemsJsonRow & { listing_type?: string | null }).listing_type;
      return labelListingType(fromMap ?? fromItem ?? null);
    }),
  );

  const logisticLabel = uniqueJoin(
    items.map((it) => labelLogisticType(it.sale_logistic_type ?? it.logistic_type)),
  );

  return {
    referenceDate: r.referenceDate,
    mlOrderId: r.mlOrderId !== null ? String(r.mlOrderId) : "",
    accountNickname: r.accountNickname,
    listingTypeLabel,
    sku,
    titleShort,
    logisticLabel,
    orderTotal: r.totalAmount !== null ? Number(r.totalAmount) : null,
    productPurchaseTotal,
    marketplaceFeesTotal,
    shippingTotal,
    taxTotal,
    netReceivedAmount,
    adsFee,
    profit,
  };
}

/** Rateio de Product Ads do mês pela receita dos pedidos (mesma conta + mês). @deprecated */
export function allocateAdsByRevenue(
  orderTotal: number | null,
  monthRevenue: number,
  monthAdsTotal: number,
): number | null {
  if (!(monthAdsTotal > 0) || !(monthRevenue > 0) || orderTotal == null || !(orderTotal > 0)) {
    return monthAdsTotal > 0 ? 0 : null;
  }
  return Math.round(monthAdsTotal * (orderTotal / monthRevenue) * 100) / 100;
}

/**
 * Ads do pedido a partir do custo Product Ads por item no período.
 * Só atribui quando o item teve gasto de Ads; senão retorna null (coluna vazia).
 */
export function allocateOrderAdsFromItemCosts(
  items: Array<{ item_id: string; price: number; quantity: number }>,
  itemAdsCost: Map<string, number>,
  itemRevenueInPeriod: Map<string, number>,
): number | null {
  let ads = 0;
  let hasAdsItem = false;
  for (const it of items) {
    const cost = itemAdsCost.get(it.item_id) ?? 0;
    if (!(cost > 0)) continue;
    hasAdsItem = true;
    const lineRev = it.price * it.quantity;
    const denom = itemRevenueInPeriod.get(it.item_id) ?? 0;
    if (denom > 0 && lineRev > 0) {
      ads += cost * (lineRev / denom);
    }
  }
  if (!hasAdsItem) return null;
  return Math.round(ads * 100) / 100;
}
