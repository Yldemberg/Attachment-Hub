import { pgTable, text, timestamp, uuid, decimal, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

/**
 * Imposto (%) e preço de compra por SKU no escopo do usuário — inventário geral / relatórios.
 * Independente de sku_mandate_inventory (pode existir antes do primeiro ajuste mandatário).
 */
export const inventorySkuFinancialsTable = pgTable(
  "inventory_sku_financials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    taxPercent: decimal("tax_percent", { precision: 6, scale: 3 }),
    purchasePrice: decimal("purchase_price", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("inventory_sku_financials_user_id_sku_unique").on(t.userId, t.sku)],
);

export const insertInventorySkuFinancialsSchema = createInsertSchema(inventorySkuFinancialsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectInventorySkuFinancialsSchema = createSelectSchema(inventorySkuFinancialsTable);

export type InsertInventorySkuFinancials = z.infer<typeof insertInventorySkuFinancialsSchema>;
export type InventorySkuFinancials = typeof inventorySkuFinancialsTable.$inferSelect;
