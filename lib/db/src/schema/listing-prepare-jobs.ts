import { pgTable, text, timestamp, uuid, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { profilesTable } from "./profiles";
import { accountsTable } from "./accounts";

export const listingPrepareJobStatusEnum = pgEnum("listing_prepare_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const listingPrepareJobsTable = pgTable("listing_prepare_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id, { onDelete: "cascade" }),
  productUrl: text("product_url").notNull(),
  status: listingPrepareJobStatusEnum("status").notNull().default("pending"),
  draftJson: jsonb("draft_json"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type ListingPrepareJob = typeof listingPrepareJobsTable.$inferSelect;
