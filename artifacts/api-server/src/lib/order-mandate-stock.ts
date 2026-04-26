import { getDb } from "./db";
import { accountsTable, productsTable, skuMandateInventoryTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import { upsertSkuMandateQuantity } from "./sku-mandate";
import { ml, MlItem, MlOrder, putMlItemStockForSellerSku, resolveStockPropagationSource } from "./mercadolivre";

/**
 * Estados ML tratados como "venda que baixa estoque" (alinhado ao painel: `paid` / `confirmed`;
 * `partially_paid` compartilha a mesma família, sem rebater de novo em `partially_paid` → `paid`).
 */
const PAID_LIKE = new Set(["paid", "confirmed", "partially_paid"]);

function isPaidLike(status: string | null | undefined): boolean {
  return status != null && PAID_LIKE.has(status);
}

function isCancelled(status: string | null | undefined): boolean {
  return status === "cancelled";
}

export type MandateStockTransition = "decrement_sale" | "increment_cancel" | "none";

/**
 * Controle idempotente: aplica no máximo um débito por ordem ao entrar em estado pago e
 * no máximo um crédito ao cancelar após pago. Evita webhooks duplicados e transições só entre estados
 * pago (ex.: `confirmed` → `paid`, `partially_paid` → `paid`) que duplicariam a baixa; evita somar
 * no cancelado sem venda paga.
 */
export function getMandateStockTransition(
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined,
): MandateStockTransition {
  if (newStatus == null) return "none";
  if (oldStatus != null && oldStatus === newStatus) return "none";
  if (isPaidLike(oldStatus) && isPaidLike(newStatus)) return "none";
  if (!isPaidLike(oldStatus) && isPaidLike(newStatus)) return "decrement_sale";
  if (isPaidLike(oldStatus) && isCancelled(newStatus)) return "increment_cancel";
  return "none";
}

const SIBLING_UPDATE_CONCURRENCY = 4;
const SIBLING_PUT_RETRY_MAX = 4;
const SIBLING_PUT_RETRY_BASE_MS = 400;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** PUT no ML + leitura + persistência: retenta com backoff (rede, 429, indisponibilidade). */
async function withSiblingListingRetry(
  op: () => Promise<void>,
  logCtx: { mlItemId: string; accountId: string; sku: string; mandateQty: number },
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < SIBLING_PUT_RETRY_MAX; attempt++) {
    try {
      await op();
      return;
    } catch (err) {
      last = err;
      if (attempt === SIBLING_PUT_RETRY_MAX - 1) break;
      const nextDelayMs = SIBLING_PUT_RETRY_BASE_MS * 2 ** attempt;
      logger.warn(
        { err, ...logCtx, attempt: attempt + 1, of: SIBLING_PUT_RETRY_MAX, nextDelayMs },
        "Stock propagation: sibling listing update failed; retrying",
      );
      await sleepMs(nextDelayMs);
    }
  }
  throw last;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!);
    }
  };
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/**
 * Atualiza `sku_mandate_inventory` e aplica a mesma quantidade em todos os anúncios não Full
 * com o mesmo SKU (contas do mesmo usuário). Só chamar com transição != `none`.
 */
export async function applyMandateStockForOrder(
  sellingAccountId: string,
  orderItems: MlOrder["order_items"],
  transition: MandateStockTransition,
): Promise<void> {
  if (transition === "none") return;

  const db = getDb();
  const [sellingAccount] = await db
    .select({ userId: accountsTable.userId })
    .from(accountsTable)
    .where(eq(accountsTable.id, sellingAccountId))
    .limit(1);
  if (!sellingAccount) return;
  const { userId } = sellingAccount;

  for (const oi of orderItems) {
    const mlItemId = oi.item.id;

    const [soldProduct] = await db
      .select({
        id: productsTable.id,
        sku: productsTable.sku,
        isFull: productsTable.isFull,
      })
      .from(productsTable)
      .where(and(eq(productsTable.accountId, sellingAccountId), eq(productsTable.mlItemId, mlItemId)))
      .limit(1);

    if (!soldProduct || soldProduct.isFull) continue;

    let resolved: Awaited<ReturnType<typeof resolveStockPropagationSource>>;
    try {
      resolved = await resolveStockPropagationSource(sellingAccountId, mlItemId, oi.item, soldProduct.sku);
    } catch (err) {
      logger.warn({ err, mlItemId }, "Stock propagation: resolve SKU/stock; retrying");
      await sleepMs(400);
      try {
        resolved = await resolveStockPropagationSource(sellingAccountId, mlItemId, oi.item, soldProduct.sku);
      } catch (err2) {
        logger.warn({ err: err2, mlItemId }, "Stock propagation: failed to fetch post-sale stock from ML");
        continue;
      }
    }

    if (!resolved) {
      logger.warn(
        { mlItemId, accountId: sellingAccountId, dbSku: soldProduct.sku },
        "Stock propagation: could not resolve seller SKU / quantity for order line",
      );
      continue;
    }

    const { effectiveSku, newStock } = resolved;

    const [mandateRow] = await db
      .select({ quantity: skuMandateInventoryTable.quantity })
      .from(skuMandateInventoryTable)
      .where(
        and(eq(skuMandateInventoryTable.userId, userId), eq(skuMandateInventoryTable.sku, effectiveSku)),
      )
      .limit(1);

    let mandateQty: number;
    if (transition === "decrement_sale") {
      mandateQty = mandateRow ? Math.max(0, mandateRow.quantity - oi.quantity) : newStock;
    } else {
      mandateQty = mandateRow ? mandateRow.quantity + oi.quantity : newStock;
    }

    await upsertSkuMandateQuantity(userId, effectiveSku, mandateQty);

    logger.info(
      { sku: effectiveSku, mlItemId, mandateQty, transition },
      "Stock propagation: mandate updated; pushing to all listings for user",
    );

    const targets = await db
      .select({ product: productsTable })
      .from(productsTable)
      .innerJoin(accountsTable, eq(productsTable.accountId, accountsTable.id))
      .where(
        and(
          eq(accountsTable.userId, userId),
          eq(productsTable.sku, effectiveSku),
          eq(productsTable.isFull, false),
        ),
      );

    await runPool(
      targets.map((r) => r.product),
      SIBLING_UPDATE_CONCURRENCY,
      async (target) => {
        const logCtx = {
          mlItemId: target.mlItemId,
          accountId: target.accountId,
          sku: effectiveSku,
          mandateQty,
        };
        try {
          await withSiblingListingRetry(
            async () => {
              await putMlItemStockForSellerSku(target.accountId, target.mlItemId, effectiveSku, mandateQty);
              const after = await ml.get<MlItem>(
                target.accountId,
                `/items/${encodeURIComponent(target.mlItemId)}`,
              );
              await db
                .update(productsTable)
                .set({ availableQuantity: after.available_quantity })
                .where(eq(productsTable.id, target.id));
            },
            logCtx,
          );
          logger.info(
            { mlItemId: target.mlItemId, accountId: target.accountId, sku: effectiveSku, mandateQty },
            "Stock propagation: listing updated from mandate",
          );
        } catch (err) {
          logger.warn(
            { err, ...logCtx },
            "Stock propagation: failed to update listing from mandate after retries",
          );
        }
      },
    );
  }
}
