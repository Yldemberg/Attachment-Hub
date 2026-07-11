import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { mlDiagnosticoCriticoTable } from "@workspace/db/schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let diagnosticoDb: ReturnType<typeof drizzle<{ mlDiagnosticoCriticoTable: typeof mlDiagnosticoCriticoTable }>> | null = null;

export function getDiagnosticoDb() {
  const url = process.env.ML_DIAGNOSTICO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "ML_DIAGNOSTICO_DATABASE_URL must be set to the Supabase connection string for ml_diagnostico_critico.",
    );
  }
  if (!diagnosticoDb) {
    pool = new Pool({ connectionString: url });
    diagnosticoDb = drizzle(pool, { schema: { mlDiagnosticoCriticoTable } });
  }
  return diagnosticoDb;
}

export async function closeDiagnosticoDb() {
  if (pool) {
    await pool.end();
    pool = null;
    diagnosticoDb = null;
  }
}
