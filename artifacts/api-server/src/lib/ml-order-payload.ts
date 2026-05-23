import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { productsTable } from "@workspace/db/schema";
import type { MlOrder } from "./mercadolivre";
import { fetchMlShipmentOrderDetails, ml } from "./mercadolivre";
import { resolveOrderNetReceivedAmount } from "./mercadopago";

export type OrderReportFinancials = {
  /** Soma unit_price × quantity dos itens (base para imposto estimado e lucro). */
  itemsSubtotal: number;
  /** Soma de marketplace_fee dos pagamentos. */
  marketplaceFeesTotal: number;
  /** Soma de shipping_cost dos pagamentos. */
  shippingTotal: number;
  /** Soma de transaction_details.net_received_amount (Mercado Pago) por pagamento. */
  netReceivedAmount?: number | null;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeOrderReportFinancials(order: MlOrder): OrderReportFinancials {
  const itemsSubtotal = order.order_items.reduce((s, oi) => s + oi.unit_price * oi.quantity, 0);
  const payments = order.payments ?? [];
  let marketplaceFeesTotal = 0;
  let shippingTotal = 0;
  for (const p of payments) {
    marketplaceFeesTotal += Number(p.marketplace_fee ?? 0);
    shippingTotal += Number(p.shipping_cost ?? 0);
  }
  return {
    itemsSubtotal: roundMoney(itemsSubtotal),
    marketplaceFeesTotal: roundMoney(marketplaceFeesTotal),
    shippingTotal: roundMoney(shippingTotal),
  };
}

export type StoredMlOrderItemsJsonRow = {
  item_id: string;
  title: string;
  quantity: number;
  price: number;
  thumbnail: string | null;
  sku: string | null;
  /** Modalidades do anúncio / envio cotado no item. */
  logistic_type: string | null;
  /** Modalidade concretizada na venda (`GET /shipments/:id`). */
  sale_logistic_type: string | null;
};

/**
 * Monta `items_json` e resolve status/substatus do envio.
 * Preferimos `GET /shipments/:id` porque em `GET /orders` o `shipping` frequentemente vem só com `id`.
 */
export async function buildMlOrderStoredPayload(
  accountId: string,
  order: MlOrder,
): Promise<{
  itemsJson: StoredMlOrderItemsJsonRow[];
  shippingStatus: string | null;
  shippingSubstatus: string | null;
  reportFinancials: OrderReportFinancials;
}> {
  const db = getDb();
  const shipDetails = await fetchMlShipmentOrderDetails(accountId, order.shipping?.id);
  const fromOrderRaw = order.shipping?.status?.trim();
  const fromOrder = fromOrderRaw && fromOrderRaw.length > 0 ? fromOrderRaw : null;
  const shippingStatus = shipDetails.status ?? fromOrder;
  const shippingSubstatus = shipDetails.substatus;

  const itemsJson = await Promise.all(
    order.order_items.map(async (oi) => {
      const [product] = await db
        .select({
          thumbnail: productsTable.thumbnail,
          sku: productsTable.sku,
          logisticType: productsTable.logisticType,
        })
        .from(productsTable)
        .where(and(eq(productsTable.accountId, accountId), eq(productsTable.mlItemId, oi.item.id)))
        .limit(1);

      return {
        item_id: oi.item.id,
        title: oi.item.title,
        quantity: oi.quantity,
        price: oi.unit_price,
        thumbnail: product?.thumbnail ?? null,
        sku: product?.sku ?? null,
        logistic_type: product?.logisticType ?? null,
        sale_logistic_type: shipDetails.saleLogisticType,
      };
    }),
  );

  let orderForFinancials = order;
  const hasPaymentIds = (order.payments ?? []).some((p) => p.id != null);
  if (!hasPaymentIds) {
    try {
      orderForFinancials = await ml.get<MlOrder>(accountId, `/orders/${order.id}`);
    } catch {
      orderForFinancials = order;
    }
  }

  const reportFinancials = computeOrderReportFinancials(orderForFinancials);
  reportFinancials.netReceivedAmount = await resolveOrderNetReceivedAmount(
    accountId,
    order.id,
    orderForFinancials.payments?.map((p) => p.id),
  );

  return { itemsJson, shippingStatus, shippingSubstatus, reportFinancials };
}
