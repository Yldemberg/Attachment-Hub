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

/**
 * Atualiza full_stock_snapshot para anúncios Full da conta via API ML.
 */
export async function syncFullStockForAccount(accountId: string): Promise<FullStockSyncResult> {
  const db = getDb();
  const products = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.accountId, accountId),
        eq(productsTable.isFull, true),
      ),
    );

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const now = new Date();

  for (const product of products) {
    if (!product.mlItemId) {
      skipped += 1;
      continue;
    }

    try {
      const item = await ml.get<MlItem>(
        accountId,
        `/items/${encodeURIComponent(product.mlItemId)}`,
      );
      const targets = collectInventoryTargets(product.id, item, trimSku(product.sku));
      if (targets.length === 0) {
        // Fallback: grava snapshot com estoque do anúncio e inventory_id sintético
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
        synced += 1;
        continue;
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
          synced += 1;
        } catch (err) {
          failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${t.mlItemId}/${t.inventoryId}: ${msg}`);
          logger.warn({ err, accountId, inventoryId: t.inventoryId }, "Full stock fetch failed");
        }
      }
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${product.mlItemId}: ${msg}`);
      logger.warn({ err, accountId, mlItemId: product.mlItemId }, "Full item fetch failed");
    }
  }

  return { synced, skipped, failed, errors: errors.slice(0, 20) };
}

function isFullLogistic(logistic: string | null | undefined): boolean {
  if (!logistic) return false;
  return logistic
    .split(",")
    .map((s) => s.trim())
    .some((s) => s === "fulfillment");
}

/**
 * Soma unidades vendidas no Full por SKU e por item_id no período.
 */
export async function sumFullSalesBySku(
  accountIds: string[],
  periodDays: number,
): Promise<Map<string, number>> {
  const { bySku } = await sumFullSalesMaps(accountIds, periodDays);
  return bySku;
}

export async function sumFullSalesMaps(
  accountIds: string[],
  periodDays: number,
): Promise<{ bySku: Map<string, number>; byItemId: Map<string, number> }> {
  const bySku = new Map<string, number>();
  const byItemId = new Map<string, number>();
  if (accountIds.length === 0) return { bySku, byItemId };

  const since = new Date();
  since.setDate(since.getDate() - Math.max(1, periodDays));

  const db = getDb();
  const rows = await db
    .select({
      itemsJson: ordersTable.itemsJson,
      status: ordersTable.status,
    })
    .from(ordersTable)
    .where(
      and(
        inArray(ordersTable.accountId, accountIds),
        gte(ordersTable.dateCreated, since),
      ),
    );

  for (const row of rows) {
    const status = (row.status ?? "").toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;
    if (!Array.isArray(row.itemsJson)) continue;
    const items = row.itemsJson as StoredMlOrderItemsJsonRow[];
    for (const it of items) {
      const logistic = it.sale_logistic_type ?? it.logistic_type;
      if (!isFullLogistic(logistic)) continue;
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const sku = trimSku(it.sku);
      if (sku) bySku.set(sku, (bySku.get(sku) ?? 0) + qty);
      const itemId = trimSku(it.item_id);
      if (itemId) byItemId.set(itemId, (byItemId.get(itemId) ?? 0) + qty);
    }
  }

  return { bySku, byItemId };
}
