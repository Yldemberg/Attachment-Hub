import { relations } from "drizzle-orm";
import { profilesTable } from "./profiles";
import { accountsTable } from "./accounts";
import { skuMandateInventoryTable } from "./sku-mandate-inventory";
import { inventorySkuFinancialsTable } from "./inventory-sku-financials";
import { productsTable } from "./products";
import { ordersTable } from "./orders";
import { questionsTable } from "./questions";
import { notificationsTable } from "./notifications";
import { listingTemplatesTable } from "./listing-templates";

export const profilesRelations = relations(profilesTable, ({ many }) => ({
  accounts: many(accountsTable),
  notifications: many(notificationsTable),
  skuMandateInventories: many(skuMandateInventoryTable),
  inventorySkuFinancials: many(inventorySkuFinancialsTable),
  listingTemplates: many(listingTemplatesTable),
}));

export const accountsRelations = relations(accountsTable, ({ one, many }) => ({
  profile: one(profilesTable, {
    fields: [accountsTable.userId],
    references: [profilesTable.id],
  }),
  products: many(productsTable),
  orders: many(ordersTable),
  questions: many(questionsTable),
  listingTemplates: many(listingTemplatesTable),
}));

export const skuMandateInventoryRelations = relations(skuMandateInventoryTable, ({ one }) => ({
  profile: one(profilesTable, {
    fields: [skuMandateInventoryTable.userId],
    references: [profilesTable.id],
  }),
}));

export const inventorySkuFinancialsRelations = relations(inventorySkuFinancialsTable, ({ one }) => ({
  profile: one(profilesTable, {
    fields: [inventorySkuFinancialsTable.userId],
    references: [profilesTable.id],
  }),
}));

export const productsRelations = relations(productsTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [productsTable.accountId],
    references: [accountsTable.id],
  }),
  listingTemplates: many(listingTemplatesTable),
}));

export const listingTemplatesRelations = relations(listingTemplatesTable, ({ one }) => ({
  profile: one(profilesTable, {
    fields: [listingTemplatesTable.userId],
    references: [profilesTable.id],
  }),
  sourceAccount: one(accountsTable, {
    fields: [listingTemplatesTable.sourceAccountId],
    references: [accountsTable.id],
  }),
  sourceProduct: one(productsTable, {
    fields: [listingTemplatesTable.sourceProductId],
    references: [productsTable.id],
  }),
}));

export const ordersRelations = relations(ordersTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [ordersTable.accountId],
    references: [accountsTable.id],
  }),
}));

export const questionsRelations = relations(questionsTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [questionsTable.accountId],
    references: [accountsTable.id],
  }),
}));

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  profile: one(profilesTable, {
    fields: [notificationsTable.userId],
    references: [profilesTable.id],
  }),
}));
