import { pgTable, text, timestamp, uuid, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const SKU_INVENTORY_MOVEMENT_SOURCES = ["manual", "product", "sale", "cancel", "sync"] as const;
export type SkuInventoryMovementSource = (typeof SKU_INVENTORY_MOVEMENT_SOURCES)[number];

export const SKU_INVENTORY_MOVEMENT_OPERATIONS = [
  "add",
  "subtract",
  "set",
  "decrement",
  "increment",
  "sync",
] as const;
export type SkuInventoryMovementOperation = (typeof SKU_INVENTORY_MOVEMENT_OPERATIONS)[number];

/**
 * Livro de movimentações de estoque por SKU (append-only).
 * Uma linha por evento (não por anúncio irmão).
 */
export const skuInventoryMovementsTable = pgTable(
  "sku_inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    source: text("source").notNull(),
    operation: text("operation").notNull(),
    quantityBefore: integer("quantity_before").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    actorUserId: uuid("actor_user_id").references(() => profilesTable.id, { onDelete: "set null" }),
    relatedOrderId: text("related_order_id"),
    relatedProductId: uuid("related_product_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sku_inventory_movements_user_sku_created_idx").on(t.userId, t.sku, t.createdAt),
    index("sku_inventory_movements_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const insertSkuInventoryMovementSchema = createInsertSchema(skuInventoryMovementsTable).omit({
  id: true,
  createdAt: true,
});
export const selectSkuInventoryMovementSchema = createSelectSchema(skuInventoryMovementsTable);

export type InsertSkuInventoryMovement = z.infer<typeof insertSkuInventoryMovementSchema>;
export type SkuInventoryMovement = typeof skuInventoryMovementsTable.$inferSelect;
