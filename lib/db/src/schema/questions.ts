import { pgTable, text, timestamp, uuid, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";

export const questionsTable = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id, { onDelete: "cascade" }),
  mlQuestionId: bigint("ml_question_id", { mode: "bigint" }).notNull(),
  mlItemId: text("ml_item_id"),
  text: text("text"),
  status: text("status").default("unanswered").notNull(),
  fromUserId: bigint("from_user_id", { mode: "bigint" }),
  fromUserNickname: text("from_user_nickname"),
  answerText: text("answer_text"),
  answerDate: timestamp("answer_date", { withTimezone: true }),
  dateCreated: timestamp("date_created", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("questions_account_id_ml_question_id_unique").on(t.accountId, t.mlQuestionId),
]);

export const insertQuestionSchema = createInsertSchema(questionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectQuestionSchema = createSelectSchema(questionsTable);

export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;
