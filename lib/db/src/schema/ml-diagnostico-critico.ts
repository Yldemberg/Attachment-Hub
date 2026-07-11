import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mlDiagnosticoCriticoTable = pgTable("ml_diagnostico_critico", {
  itemId: text("item_id").primaryKey(),
  nomeLoja: text("nome_loja"),
  titulo: text("titulo"),
  problemas: jsonb("problemas"),
  permalink: text("permalink"),
  statusMl: text("status_ml"),
  tipoEnvio: text("tipo_envio"),
  faltasRelevancia: text("faltas_relevancia"),
  diasSemVenda: text("dias_sem_venda"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const insertMlDiagnosticoCriticoSchema = createInsertSchema(mlDiagnosticoCriticoTable);

export const selectMlDiagnosticoCriticoSchema = createSelectSchema(mlDiagnosticoCriticoTable);

export type InsertMlDiagnosticoCritico = z.infer<typeof insertMlDiagnosticoCriticoSchema>;
export type MlDiagnosticoCritico = typeof mlDiagnosticoCriticoTable.$inferSelect;
