import { pgTable, text, timestamp, uuid, bigint, decimal, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";

export const ordersTable = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id, { onDelete: "cascade" }),
  mlOrderId: bigint("ml_order_id", { mode: "bigint" }).notNull(),
  status: text("status"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }),
  currencyId: text("currency_id").default("BRL"),
  buyerId: bigint("buyer_id", { mode: "bigint" }),
  buyerNickname: text("buyer_nickname"),
  shippingId: bigint("shipping_id", { mode: "bigint" }),
  shippingStatus: text("shipping_status"),
  dateCreated: timestamp("date_created", { withTimezone: true }),
  dateClosed: timestamp("date_closed", { withTimezone: true }),
  itemsJson: jsonb("items_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectOrderSchema = createSelectSchema(ordersTable);

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
