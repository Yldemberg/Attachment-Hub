import { pgTable, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";
import { productsTable } from "./products";

export const vacationModePausesTable = pgTable(
  "vacation_mode_pauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    pausedAt: timestamp("paused_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("vacation_mode_pauses_user_product_unique").on(t.userId, t.productId)],
);

export const insertVacationModePauseSchema = createInsertSchema(vacationModePausesTable).omit({
  id: true,
  pausedAt: true,
});

export const selectVacationModePauseSchema = createSelectSchema(vacationModePausesTable);

export type InsertVacationModePause = z.infer<typeof insertVacationModePauseSchema>;
export type VacationModePause = typeof vacationModePausesTable.$inferSelect;
