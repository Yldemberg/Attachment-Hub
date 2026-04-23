import { getDb } from "./db";
import { skuMandateInventoryTable } from "@workspace/db/schema";

/**
 * Persiste a quantidade mandatária do SKU para o usuário (espelho lógico nos anúncios).
 */
export async function upsertSkuMandateQuantity(userId: string, sku: string, quantity: number): Promise<void> {
  const db = getDb();
  const q = Math.max(0, Math.floor(quantity));
  await db
    .insert(skuMandateInventoryTable)
    .values({ userId, sku, quantity: q })
    .onConflictDoUpdate({
      target: [skuMandateInventoryTable.userId, skuMandateInventoryTable.sku],
      set: { quantity: q, updatedAt: new Date() },
    });
}
