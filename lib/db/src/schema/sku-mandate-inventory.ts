import { pgTable, text, timestamp, uuid, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

/**
 * Estoque mandatário por SKU no escopo do usuário (todas as contas ML integradas).
 * A quantidade aqui é a fonte da verdade lógica espelhada nos anúncios filhos (não Full).
 */
export const skuMandateInventoryTable = pgTable(
  "sku_mandate_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sku_mandate_inventory_user_id_sku_unique").on(t.userId, t.sku)],
);

export const insertSkuMandateInventorySchema = createInsertSchema(skuMandateInventoryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectSkuMandateInventorySchema = createSelectSchema(skuMandateInventoryTable);

export type InsertSkuMandateInventory = z.infer<typeof insertSkuMandateInventorySchema>;
export type SkuMandateInventory = typeof skuMandateInventoryTable.$inferSelect;
