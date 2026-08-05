import { getDb } from "./db";
import {
  productsTable,
  fullStockSnapshotTable,
  ordersTable,
} from "@workspace/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  ml,
  fetchMlFulfillmentStock,
  getMlItemRepresentativeSku,
  type MlItem,
  type MlVariation,
} from "./mercadolivre";
import { logger } from "./logger";
import type { StoredMlOrderItemsJsonRow } from "./ml-order-payload";

function trimSku(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function variationSku(v: MlVariation): string | null {
  const fromSeller = trimSku(v.seller_sku) ?? trimSku(v.seller_custom_field ?? null);
  if (fromSeller) return fromSeller;
  const attrs = v.attributes ?? [];
  for (const a of attrs) {
    if (a.id === "SELLER_SKU" && a.value_name) {
      const s = trimSku(a.value_name);
      if (s) return s;
    }
  }
  return null;
}

type InventoryTarget = {
  productId: string;
  mlItemId: string;
  sku: string;
  inventoryId: string;
};

function collectInventoryTargets(productId: string, item: MlItem, fallbackSku: string | null): InventoryTarget[] {
  const out: InventoryTarget[] = [];
  const variations = item.variations ?? [];

  if (variations.length > 0) {
    for (const v of variations) {
      const inv = trimSku(v.inventory_id ?? null);
      if (!inv) continue;
      const sku =
        variationSku(v) ??
        fallbackSku ??
        getMlItemRepresentativeSku(item) ??
        `${item.id}:${v.id}`;
      out.push({
        productId,
        mlItemId: item.id,
        sku,
        inventoryId: inv,
      });
    }
  }

  const rootInv = trimSku(item.inventory_id ?? null);
  if (rootInv && out.length === 0) {
    const sku = fallbackSku ?? getMlItemRepresentativeSku(item) ?? item.id;
    out.push({
      productId,
      mlItemId: item.id,
      sku,
      inventoryId: rootInv,
    });
  }

  return out;
}

export type FullStockSyncResult = {
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
};

const emptyResult = (): FullStockSyncResult => ({
  synced: 0,
  skipped: 0,
  failed: 0,
  errors: [],
});

function mergeResults(into: FullStockSyncResult, part: FullStockSyncResult): void {
  into.synced += part.synced;
  into.skipped += part.skipped;
  into.failed += part.failed;
  into.errors.push(...part.errors);
}

type ProductStockRow = {
  id: string;
  mlItemId: string | null;
  sku: string | null;
  availableQuantity: number | null;
};

/**
 * Atualiza full_stock_snapshot para um anúncio Full via API ML fulfillment.
 */
export async function syncFullStockForMlItem(
  accountId: string,
  mlItemId: string,
  productHint?: ProductStockRow | null,
): Promise<FullStockSyncResult> {
  const result = emptyResult();
  const db = getDb();
  const now = new Date();

  let product = productHint ?? null;
  if (!product || product.mlItemId !== mlItemId) {
    const [row] = await db
      .select({
        id: productsTable.id,
        mlItemId: productsTable.mlItemId,
        sku: productsTable.sku,
        availableQuantity: productsTable.availableQuantity,
      })
      .from(productsTable)
      .where(and(eq(productsTable.accountId, accountId), eq(productsTable.mlItemId, mlItemId)))
      .limit(1);
    product = row ?? null;
  }

  if (!product?.mlItemId) {
    result.skipped += 1;
    return result;
  }

  try {
    const item = await ml.get<MlItem>(accountId, `/items/${encodeURIComponent(product.mlItemId)}`);
    const targets = collectInventoryTargets(product.id, item, trimSku(product.sku));

    if (targets.length === 0) {
      const sku = trimSku(product.sku) ?? product.mlItemId;
      await db
        .insert(fullStockSnapshotTable)
        .values({
          accountId,
          productId: product.id,
          mlItemId: product.mlItemId,
          sku,
          inventoryId: `local:${product.mlItemId}`,
          availableQuantity: product.availableQuantity ?? 0,
          notAvailableQuantity: 0,
          syncedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [fullStockSnapshotTable.accountId, fullStockSnapshotTable.inventoryId],
          set: {
            productId: product.id,
            mlItemId: product.mlItemId,
            sku,
            availableQuantity: product.availableQuantity ?? 0,
            notAvailableQuantity: 0,
            syncedAt: now,
            updatedAt: now,
          },
        });
      result.synced += 1;
      return result;
    }

    for (const t of targets) {
      try {
        let available = 0;
        let notAvailable = 0;
        if (t.inventoryId.startsWith("local:")) {
          available = product.availableQuantity ?? 0;
        } else {
          const stock = await fetchMlFulfillmentStock(accountId, t.inventoryId);
          available = Number(stock.available_quantity ?? 0);
          notAvailable = Number(stock.not_available_quantity ?? 0);
        }

        await db
          .insert(fullStockSnapshotTable)
          .values({
            accountId,
            productId: t.productId,
            mlItemId: t.mlItemId,
            sku: t.sku,
            inventoryId: t.inventoryId,
            availableQuantity: available,
            notAvailableQuantity: notAvailable,
            syncedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [fullStockSnapshotTable.accountId, fullStockSnapshotTable.inventoryId],
            set: {
              productId: t.productId,
              mlItemId: t.mlItemId,
              sku: t.sku,
              availableQuantity: available,
              notAvailableQuantity: notAvailable,
              syncedAt: now,
              updatedAt: now,
            },
          });
        result.synced += 1;
      } catch (err) {
        result.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${t.mlItemId}/${t.inventoryId}: ${msg}`);
        logger.warn({ err, accountId, inventoryId: t.inventoryId }, "Full stock fetch failed");
      }
    }
  } catch (err) {
    result.failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`${product.mlItemId}: ${msg}`);
    logger.warn({ err, accountId, mlItemId: product.mlItemId }, "Full item fetch failed");
  }

  return result;
}

/**
 * Atualiza full_stock_snapshot para anúncios Full da conta via API ML.
 */
export async function syncFullStockForAccount(accountId: string): Promise<FullStockSyncResult> {
  const db = getDb();
  const products = await db
    .select({
      id: productsTable.id,
      mlItemId: productsTable.mlItemId,
      sku: productsTable.sku,
      availableQuantity: productsTable.availableQuantity,
    })
    .from(productsTable)
    .where(and(eq(productsTable.accountId, accountId), eq(productsTable.isFull, true)));

  const result = emptyResult();

  for (const product of products) {
    if (!product.mlItemId) {
      result.skipped += 1;
      continue;
    }
    const part = await syncFullStockForMlItem(accountId, product.mlItemId, product);
    mergeResults(result, part);
  }

  return {
    ...result,
    errors: result.errors.slice(0, 20),
  };
}

const ITEM_SYNC_DEBOUNCE_MS = 12_000;
const pendingItemSync = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Agenda sync de estoque Full por item com debounce (coalesce rajadas de webhook).
 */
export function scheduleFullStockItemSync(accountId: string, mlItemId: string): void {
  const id = trimSku(mlItemId);
  if (!id) return;
  const key = `${accountId}:${id}`;
  const existing = pendingItemSync.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingItemSync.delete(key);
    void syncFullStockForMlItem(accountId, id)
      .then((r) => {
        if (r.failed > 0 || r.synced > 0) {
          logger.info(
            { accountId, mlItemId: id, synced: r.synced, failed: r.failed, skipped: r.skipped },
            "Debounced Full stock item sync done",
          );
        }
      })
      .catch((err) => {
        logger.warn({ err, accountId, mlItemId: id }, "Debounced Full stock item sync failed");
      });
  }, ITEM_SYNC_DEBOUNCE_MS);
  timer.unref?.();
  pendingItemSync.set(key, timer);
}

export function isFullLogistic(logistic: string | null | undefined): boolean {
  if (!logistic) return false;
  return logistic
    .split(",")
    .map((s) => s.trim())
    .some((s) => s === "fulfillment");
}

/**
 * Soma unidades vendidas no Full por SKU e por item_id no período.
 * Também retorna a data da última venda Full (lookback max(period, 90) dias).
 */
export async function sumFullSalesBySku(
  accountIds: string[],
  periodDays: number,
): Promise<Map<string, number>> {
  const { bySku } = await sumFullSalesMaps(accountIds, periodDays);
  return bySku;
}

export type FullSalesMaps = {
  bySku: Map<string, number>;
  byItemId: Map<string, number>;
  lastSaleAtBySku: Map<string, Date>;
  lastSaleAtByItemId: Map<string, Date>;
  /** Janela usada para lastSaleAt (dias). */
  lastSaleLookbackDays: number;
};

export async function sumFullSalesMaps(
  accountIds: string[],
  periodDays: number,
): Promise<FullSalesMaps> {
  const bySku = new Map<string, number>();
  const byItemId = new Map<string, number>();
  const lastSaleAtBySku = new Map<string, Date>();
  const lastSaleAtByItemId = new Map<string, Date>();
  const period = Math.max(1, periodDays);
  const lastSaleLookbackDays = Math.max(period, 90);
  if (accountIds.length === 0) {
    return { bySku, byItemId, lastSaleAtBySku, lastSaleAtByItemId, lastSaleLookbackDays };
  }

  const now = new Date();
  const periodSince = new Date(now);
  periodSince.setDate(periodSince.getDate() - period);
  const lookbackSince = new Date(now);
  lookbackSince.setDate(lookbackSince.getDate() - lastSaleLookbackDays);

  const db = getDb();
  const rows = await db
    .select({
      itemsJson: ordersTable.itemsJson,
      status: ordersTable.status,
      dateCreated: ordersTable.dateCreated,
    })
    .from(ordersTable)
    .where(
      and(
        inArray(ordersTable.accountId, accountIds),
        gte(ordersTable.dateCreated, lookbackSince),
      ),
    );

  const bumpLast = (map: Map<string, Date>, key: string, at: Date) => {
    const prev = map.get(key);
    if (!prev || at > prev) map.set(key, at);
  };

  for (const row of rows) {
    const status = (row.status ?? "").toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;
    if (!Array.isArray(row.itemsJson)) continue;
    const orderAt = row.dateCreated;
    if (!orderAt) continue;
    const inPeriod = orderAt >= periodSince;
    const items = row.itemsJson as StoredMlOrderItemsJsonRow[];
    for (const it of items) {
      const logistic = it.sale_logistic_type ?? it.logistic_type;
      if (!isFullLogistic(logistic)) continue;
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const sku = trimSku(it.sku);
      if (sku) {
        bumpLast(lastSaleAtBySku, sku, orderAt);
        if (inPeriod) bySku.set(sku, (bySku.get(sku) ?? 0) + qty);
      }
      const itemId = trimSku(it.item_id);
      if (itemId) {
        bumpLast(lastSaleAtByItemId, itemId, orderAt);
        if (inPeriod) byItemId.set(itemId, (byItemId.get(itemId) ?? 0) + qty);
      }
    }
  }

  return { bySku, byItemId, lastSaleAtBySku, lastSaleAtByItemId, lastSaleLookbackDays };
}
