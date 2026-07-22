import { getDb } from "./db";
import { accountsTable, ordersTable, productsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  buildMlItemProductRowSnapshot,
  fetchShipmentEligibleForSkuMandate,
  ml,
  MlItem,
  MlOrder,
  putMlItemStockForSellerSku,
  resolveStockPropagationSource,
} from "./mercadolivre";

/**
 * Estados ML tratados como pagamento confirmado (`paid`, `confirmed`, `partially_paid`).
 */
const PAID_LIKE = new Set(["paid", "confirmed", "partially_paid"]);

function isPaidLike(status: string | null | undefined): boolean {
  return status != null && PAID_LIKE.has(status);
}

export type MandateStockTransition = "decrement_sale" | "increment_cancel" | "none";

/**
 * Decide a ação a partir do status atual da order e das flags já persistidas.
 * Isso permite reprocessamento (sync) quando a primeira tentativa não tinha SKU/produto ainda,
 * sem depender apenas do par (status_antigo, status_novo).
 */
export function resolveMandateStockAction(
  status: string | null | undefined,
  mandateSaleApplied: boolean,
  mandateCancelApplied: boolean,
): MandateStockTransition {
  if (mandateSaleApplied && mandateCancelApplied) return "none";

  /** Cancelamento pós-pago: já propagamos estoque na venda; falta estorno entre anúncios. */
  if (status === "cancelled" && mandateSaleApplied && !mandateCancelApplied) return "increment_cancel";

  /** Venda paga reconhecida: ainda não propagamos estoque entre anúncios para este pedido. */
  if (status && isPaidLike(status) && !mandateSaleApplied) return "decrement_sale";

  return "none";
}

/**
 * Legado — idempotência por mudança de status (webhooks repetidos mesmo status paid→paid).
 * Mantido para testes; o fluxo preferido usa `resolveMandateStockAction` + flags no pedido.
 */
export function getMandateStockTransition(
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined,
): MandateStockTransition {
  if (newStatus == null) return "none";
  if (oldStatus != null && oldStatus === newStatus) return "none";
  if (oldStatus != null && isPaidLike(oldStatus) && isPaidLike(newStatus)) return "none";
  if (!isPaidLike(oldStatus) && isPaidLike(newStatus)) return "decrement_sale";
  if (oldStatus != null && isPaidLike(oldStatus) && newStatus === "cancelled") return "increment_cancel";
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
  logCtx: { mlItemId: string; accountId: string; sku: string; sourceListingStock: number },
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
 * Decide se este pedido entra na propagação de estoque com base no GET /shipments (rejeita só Fulfillment).
 * Sem shipping_id ainda (webhook inicial), usa lista local: produto não Full → elegível.
 */
async function logisticAllowsMandateForOrder(
  sellingAccountId: string,
  order: Pick<MlOrder, "id" | "shipping" | "order_items">,
): Promise<boolean> {
  const rawShipId = order.shipping?.id;
  if (rawShipId != null) {
    return fetchShipmentEligibleForSkuMandate(sellingAccountId, rawShipId as number | bigint);
  }

  logger.info(
    { mlOrderId: order.id, accountId: sellingAccountId },
    "Stock propagation: no shipping id yet — checking local listings for non Full",
  );

  const db = getDb();
  for (const oi of order.order_items) {
    const [soldProduct] = await db
      .select({ isFull: productsTable.isFull })
      .from(productsTable)
      .where(and(eq(productsTable.accountId, sellingAccountId), eq(productsTable.mlItemId, oi.item.id)))
      .limit(1);
    if (soldProduct && !soldProduct.isFull) return true;
  }

  return false;
}

export type PropagateStockResult = {
  synced: number;
  skipped: number;
};

/**
 * Propaga o estoque `sourceListingStock` para todos os anúncios não-Full do `userId`
 * com o mesmo `effectiveSku`, excluindo opcionalmente o anúncio de origem.
 *
 * Atualiza o ML (PUT /items) e o banco (`products.available_quantity`) para cada irmão.
 * Retorna contagens de anúncios sincronizados e ignorados (falha).
 */
export async function propagateStockBySku(params: {
  userId: string;
  effectiveSku: string;
  sourceListingStock: number;
  excludeMlItemId?: string;
  excludeAccountId?: string;
}): Promise<PropagateStockResult> {
  const { userId, effectiveSku, sourceListingStock, excludeMlItemId, excludeAccountId } = params;
  const db = getDb();

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

  const siblings = targets
    .map((r) => r.product)
    .filter(
      (product) =>
        !!product.mlItemId &&
        !(excludeMlItemId && product.mlItemId === excludeMlItemId && product.accountId === excludeAccountId),
    );

  let synced = 0;
  let skipped = 0;

  await runPool(
    siblings,
    SIBLING_UPDATE_CONCURRENCY,
    async (target) => {
      const mlItemId = target.mlItemId!;
      const logCtx = {
        mlItemId,
        accountId: target.accountId,
        sku: effectiveSku,
        sourceListingStock,
      };
      try {
        await withSiblingListingRetry(
          async () => {
            await putMlItemStockForSellerSku(
              target.accountId,
              mlItemId,
              effectiveSku,
              sourceListingStock,
            );
            const after = await ml.get<MlItem>(
              target.accountId,
              `/items/${encodeURIComponent(mlItemId)}`,
            );
            await db
              .update(productsTable)
              .set({ availableQuantity: after.available_quantity })
              .where(eq(productsTable.id, target.id));
          },
          logCtx,
        );
        logger.info(
          {
            mlItemId,
            accountId: target.accountId,
            sku: effectiveSku,
            sourceListingStock,
          },
          "Stock propagation: sibling listing aligned to source listing stock",
        );
        synced++;
      } catch (err) {
        logger.warn(
          { err, ...logCtx },
          "Stock propagation: failed to update sibling listing after retries",
        );
        skipped++;
      }
    },
  );

  return { synced, skipped };
}

/**
 * Fluxo: GET /orders (já feito antes), política de logística pelo GET /shipments (só descarta Fulfillment),
 * Lê o estoque no ML do anúncio que originou a venda/cancelamento e grava em `products` (origem + snapshot de variações),
 * propaga o mesmo valor no ML e em `products` para os demais anúncios não Full do mesmo SKU nas contas do usuário.
 * Não usa `sku_mandate_inventory`.
 *
 * Persiste mandate_sale_applied / mandate_cancel_applied no pedido só como idempotência deste fluxo.
 */
export async function applyMandateStockFromWebhookOrder(sellingAccountId: string, order: MlOrder): Promise<void> {
  const db = getDb();
  const mlOrderBig = BigInt(order.id);

  const [row] = await db
    .select({
      mandateSaleApplied: ordersTable.mandateSaleApplied,
      mandateCancelApplied: ordersTable.mandateCancelApplied,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.accountId, sellingAccountId), eq(ordersTable.mlOrderId, mlOrderBig)))
    .limit(1);

  const mandateSaleApplied = row?.mandateSaleApplied ?? false;
  const mandateCancelApplied = row?.mandateCancelApplied ?? false;

  const transition = resolveMandateStockAction(order.status, mandateSaleApplied, mandateCancelApplied);
  if (transition === "none") return;

  const logisticOk = await logisticAllowsMandateForOrder(sellingAccountId, order);
  if (!logisticOk) {
    logger.info(
      { mlOrderId: order.id, accountId: sellingAccountId },
      "Stock propagation: logistics not eligible — skip",
    );
    return;
  }

  const [sellingAccount] = await db
    .select({ userId: accountsTable.userId })
    .from(accountsTable)
    .where(eq(accountsTable.id, sellingAccountId))
    .limit(1);
  if (!sellingAccount) return;
  const { userId } = sellingAccount;

  let productsPropagationApplied = false;

  for (const oi of order.order_items) {
    const mlItemId = oi.item.id;

    const [soldProduct] = await db
      .select({
        id: productsTable.id,
        sku: productsTable.sku,
      })
      .from(productsTable)
      .where(and(eq(productsTable.accountId, sellingAccountId), eq(productsTable.mlItemId, mlItemId)))
      .limit(1);

    if (!soldProduct) {
      logger.warn(
        { mlItemId, accountId: sellingAccountId, mlOrderId: order.id },
        "Stock propagation: no local product row for order line — skip line",
      );
      continue;
    }

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

    const { effectiveSku, newStock: sourceListingStock, mlItem: originMlItem } = resolved;

    const { sku: refreshedSku, variationsJson } = await buildMlItemProductRowSnapshot(
      sellingAccountId,
      originMlItem,
    );

    await db
      .update(productsTable)
      .set({
        availableQuantity: originMlItem.available_quantity,
        soldQuantity: originMlItem.sold_quantity,
        sku: refreshedSku,
        variationsJson,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(productsTable.id, soldProduct.id));

    productsPropagationApplied = true;

    logger.info(
      {
        sku: effectiveSku,
        mlItemId,
        sourceListingStock,
        transition,
        qtySoldLine: oi.quantity,
      },
      "Stock propagation: source listing persisted; pushing to sibling listings",
    );

    await propagateStockBySku({
      userId,
      effectiveSku,
      sourceListingStock,
      excludeMlItemId: mlItemId,
      excludeAccountId: sellingAccountId,
    });
  }

  /** Marca flags só após propagar pelo menos uma linha de pedido; senão permite novo processamento quando houver produto. */
  if (transition === "decrement_sale" && productsPropagationApplied) {
    await db
      .update(ordersTable)
      .set({ mandateSaleApplied: true })
      .where(and(eq(ordersTable.accountId, sellingAccountId), eq(ordersTable.mlOrderId, mlOrderBig)));
  } else if (transition === "increment_cancel" && productsPropagationApplied) {
    await db
      .update(ordersTable)
      .set({ mandateCancelApplied: true })
      .where(and(eq(ordersTable.accountId, sellingAccountId), eq(ordersTable.mlOrderId, mlOrderBig)));
  }
}
