import { eq, or, and, sql, gt } from "drizzle-orm";
import { productsTable, type Product } from "@workspace/db/schema";
import { getDb } from "./db";
import { ml } from "./mercadolivre";

export type ListingStatus = "active" | "paused";

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

/** Pausados, com estoque e cross-docking — elegíveis para reativação ao desligar Modo Férias. */
export function crossDockingReactivatableSqlCondition() {
  return and(
    crossDockingSqlCondition(),
    eq(productsTable.status, "paused"),
    gt(productsTable.availableQuantity, 0),
  );
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
