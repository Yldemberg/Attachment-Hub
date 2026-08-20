import { getDb } from "./db";
import {
  skuMandateInventoryTable,
  skuInventoryMovementsTable,
  type SkuInventoryMovementOperation,
  type SkuInventoryMovementSource,
} from "@workspace/db/schema";
import { logger } from "./logger";

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

export type RecordSkuInventoryMovementParams = {
  userId: string;
  sku: string;
  source: SkuInventoryMovementSource;
  operation: SkuInventoryMovementOperation;
  quantityBefore: number;
  quantityAfter: number;
  actorUserId?: string | null;
  relatedOrderId?: string | null;
  relatedProductId?: string | null;
};

/**
 * Grava uma linha no livro de movimentações. Delta 0 é ignorado.
 * Falha de insert não interrompe o fluxo de estoque.
 */
export async function recordSkuInventoryMovement(params: RecordSkuInventoryMovementParams): Promise<void> {
  const sku = params.sku.trim();
  if (!sku) return;

  const quantityBefore = Math.floor(params.quantityBefore);
  const quantityAfter = Math.max(0, Math.floor(params.quantityAfter));
  const quantityDelta = quantityAfter - quantityBefore;
  if (quantityDelta === 0) return;

  try {
    const db = getDb();
    await db.insert(skuInventoryMovementsTable).values({
      userId: params.userId,
      sku,
      source: params.source,
      operation: params.operation,
      quantityBefore,
      quantityDelta,
      quantityAfter,
      actorUserId: params.actorUserId ?? null,
      relatedOrderId: params.relatedOrderId ?? null,
      relatedProductId: params.relatedProductId ?? null,
    });
  } catch (err) {
    logger.warn(
      { err, sku, source: params.source, userId: params.userId },
      "failed to record sku inventory movement",
    );
  }
}
