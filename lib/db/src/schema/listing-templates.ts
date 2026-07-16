import { pgTable, text, timestamp, uuid, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";
import { accountsTable } from "./accounts";
import { productsTable } from "./products";

/**
 * Snapshot completo de anúncios ML para reutilizar como modelo ao criar novos anúncios.
 * `payloadJson` guarda título, fotos, atributos, descrição, sale_terms, shipping e variações.
 */
export const listingTemplatesTable = pgTable(
  "listing_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    sourceAccountId: uuid("source_account_id").references(() => accountsTable.id, {
      onDelete: "set null",
    }),
    sourceProductId: uuid("source_product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),
    sourceMlItemId: text("source_ml_item_id").notNull(),
    name: text("name").notNull(),
    thumbnail: text("thumbnail"),
    categoryId: text("category_id"),
    listingTypeId: text("listing_type_id"),
    condition: text("condition"),
    sourceStatus: text("source_status"),
    isFull: boolean("is_full").default(false).notNull(),
    isCatalog: boolean("is_catalog").default(false).notNull(),
    hasVariations: boolean("has_variations").default(false).notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("listing_templates_user_account_ml_item_unique").on(
      t.userId,
      t.sourceAccountId,
      t.sourceMlItemId,
    ),
    index("listing_templates_user_id_idx").on(t.userId),
    index("listing_templates_source_account_id_idx").on(t.sourceAccountId),
  ],
);

export const insertListingTemplateSchema = createInsertSchema(listingTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectListingTemplateSchema = createSelectSchema(listingTemplatesTable);

export type InsertListingTemplate = z.infer<typeof insertListingTemplateSchema>;
export type ListingTemplate = typeof listingTemplatesTable.$inferSelect;
