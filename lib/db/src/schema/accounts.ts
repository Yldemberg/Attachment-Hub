import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const accountsTable = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  /** mercadolivre | amazon */
  platform: text("platform").notNull().default("mercadolivre"),
  mlUserId: text("ml_user_id").unique(),
  mlNickname: text("ml_nickname"),
  mlEmail: text("ml_email"),
  amazonSellerId: text("amazon_seller_id"),
  amazonMarketplaceId: text("amazon_marketplace_id"),
  amazonStoreName: text("amazon_store_name"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true).notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  mpClientId: text("mp_client_id"),
  mpClientSecret: text("mp_client_secret"),
  mpAccessToken: text("mp_access_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectAccountSchema = createSelectSchema(accountsTable);

export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
