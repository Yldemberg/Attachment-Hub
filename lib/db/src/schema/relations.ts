import { relations } from "drizzle-orm";
import { profilesTable } from "./profiles";
import { accountsTable } from "./accounts";
import { productsTable } from "./products";
import { ordersTable } from "./orders";
import { questionsTable } from "./questions";
import { notificationsTable } from "./notifications";

export const profilesRelations = relations(profilesTable, ({ many }) => ({
  accounts: many(accountsTable),
  notifications: many(notificationsTable),
}));

export const accountsRelations = relations(accountsTable, ({ one, many }) => ({
  profile: one(profilesTable, {
    fields: [accountsTable.userId],
    references: [profilesTable.id],
  }),
  products: many(productsTable),
  orders: many(ordersTable),
  questions: many(questionsTable),
}));

export const productsRelations = relations(productsTable, ({ one }) => ({
  account: one(accountsTable, {
    fields: [productsTable.accountId],
    references: [accountsTable.id],
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
