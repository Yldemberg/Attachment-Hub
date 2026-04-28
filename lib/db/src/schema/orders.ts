import { pgTable, text, timestamp, uuid, bigint, decimal, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
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
  /** True quando a baixa no mandate para venda nova (paid) já foi aplicada com sucesso. */
  mandateSaleApplied: boolean("mandate_sale_applied").default(false).notNull(),
  /** True quando o estorno no mandate por cancelamento pós-pago já foi aplicado com sucesso. */
  mandateCancelApplied: boolean("mandate_cancel_applied").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("orders_account_id_ml_order_id_unique").on(t.accountId, t.mlOrderId),
]);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectOrderSchema = createSelectSchema(ordersTable);

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
