import { eq, or, and, sql } from "drizzle-orm";
import { productsTable, type Product } from "@workspace/db/schema";
import { getDb } from "./db";
import { ml } from "./mercadolivre";

export type ListingStatus = "active" | "paused";

type VariationStockRow = {
  available_quantity?: number | null;
};

export function isCrossDockingListing(product: {
  logisticType: string | null;
  isFull: boolean;
}): boolean {
  if (product.isFull) return false;
  const lt = product.logisticType ?? "";
  return lt.split(",").some((t) => {
    const trimmed = t.trim();
    return trimmed === "cross_docking" || trimmed === "xd_drop_off";
  });
}

export function crossDockingSqlCondition() {
  return and(
    eq(productsTable.isFull, false),
    or(
      eq(productsTable.logisticType, "cross_docking"),
      sql`${productsTable.logisticType} LIKE ${"%cross_docking%"}`,
      eq(productsTable.logisticType, "xd_drop_off"),
    )!,
  );
}

export function getEffectiveAvailableQuantity(product: {
  availableQuantity: number | null;
  variationsJson: unknown;
}): number {
  const direct = product.availableQuantity ?? 0;
  if (direct > 0) return direct;

  if (!Array.isArray(product.variationsJson)) return 0;

  return (product.variationsJson as VariationStockRow[]).reduce(
    (sum, v) => sum + Math.max(0, v.available_quantity ?? 0),
    0,
  );
}

export function isReactivatableListing(product: {
  status: string | null;
  availableQuantity: number | null;
  variationsJson: unknown;
}): boolean {
  return product.status === "paused" && getEffectiveAvailableQuantity(product) > 0;
}

export async function setProductListingStatus(
  product: Pick<Product, "id" | "accountId" | "mlItemId">,
  status: ListingStatus,
): Promise<void> {
  const db = getDb();
  await ml.put(product.accountId, `/items/${encodeURIComponent(product.mlItemId)}`, { status });
  await db
    .update(productsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(productsTable.id, product.id));
}
