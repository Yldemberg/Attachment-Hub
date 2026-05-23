import type { StoredMlOrderItemsJsonRow, OrderReportFinancials } from "./ml-order-payload";
import type { SalesReportExportRow } from "./sales-report-export";

export type SkuFinancialsMap = Map<string, { taxPercent: number | null; purchasePrice: number | null }>;

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
  return { itemsSubtotal, marketplaceFeesTotal, shippingTotal, netReceivedAmount };
}

export function itemsSubtotalFromStoredItems(items: StoredMlOrderItemsJsonRow[]): number {
  return Math.round(items.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;
}

export type SalesReportDbDetailRow = {
  referenceDate: string;
  accountId: string;
  mlOrderId: bigint | null;
  totalAmount: string | null;
  accountNickname: string | null;
  itemsJson: unknown;
  reportFinancials: unknown;
};

export function buildSalesReportExportRow(r: SalesReportDbDetailRow, finMap: SkuFinancialsMap): SalesReportExportRow {
  const items: StoredMlOrderItemsJsonRow[] = Array.isArray(r.itemsJson)
    ? (r.itemsJson as StoredMlOrderItemsJsonRow[])
    : [];
  const snap = parseReportFinancialsDb(r.reportFinancials);
  const fallbackSubtotal = itemsSubtotalFromStoredItems(items);
  const itemsSubtotal = snap?.itemsSubtotal ?? fallbackSubtotal;
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

  const profit = Math.round((itemsSubtotal - marketplaceFeesTotal - taxTotal - productPurchaseTotal) * 100) / 100;

  return {
    referenceDate: r.referenceDate,
    mlOrderId: r.mlOrderId !== null ? String(r.mlOrderId) : "",
    accountNickname: r.accountNickname,
    orderTotal: r.totalAmount !== null ? Number(r.totalAmount) : null,
    productPurchaseTotal,
    marketplaceFeesTotal,
    shippingTotal,
    taxTotal,
    netReceivedAmount: snap?.netReceivedAmount ?? null,
    profit,
  };
}
