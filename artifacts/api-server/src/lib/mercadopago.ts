import { getMlAccessToken, ml, type MlOrder } from "./mercadolivre";
import { getDb } from "./db";
import { accountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const MP_BASE_URL = "https://api.mercadopago.com";
const MP_TIMEOUT_MS = 30_000;

export class MercadoPagoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "MercadoPagoApiError";
  }
}

function normalizePaymentId(paymentId: string | number): string {
  const id = String(paymentId).trim();
  if (!/^\d+$/.test(id)) {
    throw new MercadoPagoApiError("Invalid payment ID", 400);
  }
  return id;
}

/**
 * Resolve the best access token for a Mercado Pago API call.
 * Priority: dedicated MP access_token > ML OAuth token (fallback).
 */
async function getMpToken(accountId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ mpAccessToken: accountsTable.mpAccessToken })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId))
    .limit(1);

  if (row?.mpAccessToken) {
    return row.mpAccessToken;
  }

  return getMlAccessToken(accountId);
}

/**
 * GET https://api.mercadopago.com/v1/payments/{id}
 * Uses the dedicated MP app token when configured, falls back to ML OAuth token.
 */
export async function fetchMpPayment(
  accountId: string,
  paymentId: string | number,
): Promise<Record<string, unknown>> {
  const id = normalizePaymentId(paymentId);
  const token = await getMpToken(accountId);
  const url = `${MP_BASE_URL}/v1/payments/${id}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MP_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await res.text();
    if (!res.ok) {
      logger.warn({ accountId, paymentId: id, status: res.status }, "Mercado Pago payment fetch failed");
      throw new MercadoPagoApiError(`Mercado Pago API ${res.status}`, res.status, text);
    }

    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof MercadoPagoApiError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new MercadoPagoApiError("Mercado Pago API request timed out", 504);
    }
    throw err;
  }
}

export function extractNetReceivedAmount(payment: Record<string, unknown>): number | null {
  const td = payment.transaction_details;
  if (!td || typeof td !== "object") return null;
  const n = Number((td as Record<string, unknown>).net_received_amount);
  return Number.isFinite(n) ? roundMoney(n) : null;
}

export async function fetchMpPaymentNetReceivedAmount(
  accountId: string,
  paymentId: string | number,
): Promise<number | null> {
  try {
    const payment = await fetchMpPayment(accountId, paymentId);
    return extractNetReceivedAmount(payment);
  } catch (err) {
    logger.warn({ err, accountId, paymentId }, "Failed to fetch MP net_received_amount");
    return null;
  }
}

function paymentIdsFromOrder(order: MlOrder): number[] {
  return (order.payments ?? [])
    .map((p) => p.id)
    .filter((id): id is number => id != null && Number.isFinite(id));
}

/**
 * Soma `transaction_details.net_received_amount` de cada pagamento do pedido
 * via GET https://api.mercadopago.com/v1/payments/{id}.
 */
export async function resolveOrderNetReceivedAmount(
  accountId: string,
  mlOrderId: number | bigint,
  knownPaymentIds?: Array<number | null | undefined>,
): Promise<number | null> {
  let paymentIds = (knownPaymentIds ?? []).filter(
    (id): id is number => id != null && Number.isFinite(id),
  );

  if (paymentIds.length === 0) {
    try {
      const sid = typeof mlOrderId === "bigint" ? Number(mlOrderId) : mlOrderId;
      const order = await ml.get<MlOrder>(accountId, `/orders/${sid}`);
      paymentIds = paymentIdsFromOrder(order);
    } catch (err) {
      logger.warn({ err, accountId, mlOrderId }, "ML fetch order for MP payment ids failed");
      return null;
    }
  }

  if (paymentIds.length === 0) return null;

  const amounts = await Promise.all(
    paymentIds.map((id) => fetchMpPaymentNetReceivedAmount(accountId, id)),
  );
  const valid = amounts.filter((a): a is number => a != null);
  if (valid.length === 0) return null;
  return roundMoney(valid.reduce((sum, amount) => sum + amount, 0));
}
