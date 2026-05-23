import { getMlAccessToken } from "./mercadolivre";
import { logger } from "./logger";

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
 * GET https://api.mercadopago.com/v1/payments/{id}
 * Uses the seller OAuth token stored for the connected ML account.
 */
export async function fetchMpPayment(
  accountId: string,
  paymentId: string | number,
): Promise<Record<string, unknown>> {
  const id = normalizePaymentId(paymentId);
  const token = await getMlAccessToken(accountId);
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
