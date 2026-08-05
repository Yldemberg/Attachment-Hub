import {
  pgTable,
  text,
  timestamp,
  date,
  uuid,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";
import { accountsTable } from "./accounts";
import { productsTable } from "./products";

/**
 * Configuração de Gestão Full por conta ML (meta de cobertura, lead time, WhatsApp).
 */
export const fullSettingsTable = pgTable(
  "full_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** Dias de estoque desejados no Full (recomendado: 25). */
    coverageTargetDays: integer("coverage_target_days").notNull().default(25),
    /** Lead time até estoque vendável no CD, com folga de agenda (recomendado: 12). */
    leadTimeDays: integer("lead_time_days").notNull().default(12),
    /** Janela de vendas para calcular velocidade (7/15/30/60; recomendado: 15). */
    salesPeriodDays: integer("sales_period_days").notNull().default(15),
    /**
     * Multiplicador da meta: cobertura > target * multiplier ⇒ parado
     * (além de 0 vendas no período).
     */
    stuckMultiplier: integer("stuck_multiplier").notNull().default(2),
    whatsappPhone: text("whatsapp_phone"),
    alertsEnabled: boolean("alerts_enabled").notNull().default(false),
    alertRuptura: boolean("alert_ruptura").notNull().default(true),
    alertCritico: boolean("alert_critico").notNull().default(true),
    /** Recomendado false no WhatsApp — revise parado na tela. */
    alertParado: boolean("alert_parado").notNull().default(false),
    /** Nova pergunta (webhook ML) → WhatsApp via mesmo N8N da Gestão Full. */
    alertQuestions: boolean("alert_questions").notNull().default(true),
    alertCooldownHours: integer("alert_cooldown_hours").notNull().default(24),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("full_settings_user_account_unique").on(t.userId, t.accountId)],
);

/**
 * Snapshot de estoque Full (API inventories/.../stock/fulfillment).
 */
export const fullStockSnapshotTable = pgTable(
  "full_stock_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => productsTable.id, { onDelete: "set null" }),
    mlItemId: text("ml_item_id").notNull(),
    sku: text("sku").notNull(),
    inventoryId: text("inventory_id").notNull(),
    availableQuantity: integer("available_quantity").notNull().default(0),
    notAvailableQuantity: integer("not_available_quantity").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("full_stock_snapshot_account_inventory_unique").on(t.accountId, t.inventoryId),
    index("full_stock_snapshot_account_sku_idx").on(t.accountId, t.sku),
  ],
);

/**
 * Log de alertas WhatsApp para cooldown / anti-spam.
 */
export const fullAlertLogTable = pgTable(
  "full_alert_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    alertType: text("alert_type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("full_alert_log_lookup_idx").on(t.userId, t.accountId, t.sku, t.alertType, t.sentAt),
  ],
);

export const insertFullSettingsSchema = createInsertSchema(fullSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectFullSettingsSchema = createSelectSchema(fullSettingsTable);
export type InsertFullSettings = z.infer<typeof insertFullSettingsSchema>;
export type FullSettings = typeof fullSettingsTable.$inferSelect;

export const insertFullStockSnapshotSchema = createInsertSchema(fullStockSnapshotTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectFullStockSnapshotSchema = createSelectSchema(fullStockSnapshotTable);
export type InsertFullStockSnapshot = z.infer<typeof insertFullStockSnapshotSchema>;
export type FullStockSnapshot = typeof fullStockSnapshotTable.$inferSelect;

export const insertFullAlertLogSchema = createInsertSchema(fullAlertLogTable).omit({
  id: true,
});
export const selectFullAlertLogSchema = createSelectSchema(fullAlertLogTable);
export type InsertFullAlertLog = z.infer<typeof insertFullAlertLogSchema>;
export type FullAlertLog = typeof fullAlertLogTable.$inferSelect;

export const FULL_INBOUND_STATUSES = ["planned", "in_transit", "received", "cancelled"] as const;
export type FullInboundStatus = (typeof FULL_INBOUND_STATUSES)[number];

/**
 * Envio Full planejado (registro manual): data de agendamento + itens.
 * Usado como em_transito e para silenciar WhatsApp enquanto aberto.
 */
export const fullInboundShipmentTable = pgTable(
  "full_inbound_shipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    scheduledDate: date("scheduled_date").notNull(),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("full_inbound_shipment_account_status_idx").on(t.accountId, t.status),
    index("full_inbound_shipment_user_account_idx").on(t.userId, t.accountId, t.createdAt),
  ],
);

export const fullInboundShipmentItemTable = pgTable(
  "full_inbound_shipment_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => fullInboundShipmentTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => productsTable.id, { onDelete: "set null" }),
    mlItemId: text("ml_item_id"),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    quantityRemaining: integer("quantity_remaining").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("full_inbound_shipment_item_shipment_idx").on(t.shipmentId),
    index("full_inbound_shipment_item_sku_idx").on(t.sku),
  ],
);

export type FullInboundShipment = typeof fullInboundShipmentTable.$inferSelect;
export type FullInboundShipmentItem = typeof fullInboundShipmentItemTable.$inferSelect;
