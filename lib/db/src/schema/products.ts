import { pgTable, text, timestamp, uuid, boolean, integer, decimal, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";

export const productsTable = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id, { onDelete: "cascade" }),
  mlItemId: text("ml_item_id").notNull(),
  title: text("title"),
  sku: text("sku"),
  price: decimal("price", { precision: 10, scale: 2 }),
  availableQuantity: integer("available_quantity").default(0).notNull(),
  soldQuantity: integer("sold_quantity").default(0).notNull(),
  status: text("status"),
  listingType: text("listing_type"),
  logisticType: text("logistic_type"),
  isFull: boolean("is_full").default(false).notNull(),
  thumbnail: text("thumbnail"),
  permalink: text("permalink"),
  mlCategoryId: text("ml_category_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("products_account_id_ml_item_id_unique").on(t.accountId, t.mlItemId),
]);

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectProductSchema = createSelectSchema(productsTable);

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
