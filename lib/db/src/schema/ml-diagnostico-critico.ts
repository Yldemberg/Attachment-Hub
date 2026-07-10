import { pgTable, text, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mlDiagnosticoCriticoTable = pgTable("ml_diagnostico_critico", {
  id: uuid("id").primaryKey().defaultRandom(),
  nomeLoja: text("nome_loja"),
  titulo: text("titulo"),
  problemas: text("problemas"),
  permalink: text("permalink"),
  status: text("status"),
  tipoEnvio: text("tipo_envio"),
  faltasRelevancia: integer("faltas_relevancia"),
  diasSemVend: integer("dias_sem_vend"),
});

export const insertMlDiagnosticoCriticoSchema = createInsertSchema(mlDiagnosticoCriticoTable).omit({
  id: true,
});

export const selectMlDiagnosticoCriticoSchema = createSelectSchema(mlDiagnosticoCriticoTable);

export type InsertMlDiagnosticoCritico = z.infer<typeof insertMlDiagnosticoCriticoSchema>;
export type MlDiagnosticoCritico = typeof mlDiagnosticoCriticoTable.$inferSelect;
