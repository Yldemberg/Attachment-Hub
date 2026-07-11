import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { mlDiagnosticoCriticoTable } from "@workspace/db/schema";
import { desc, ilike, or, sql } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requireActivePlan];

function formatProblemas(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join("\n");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => `${key}: ${String(v)}`)
      .join("\n");
  }
  return String(value);
}

router.get("/critical-ads", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const searchTerm = search?.trim();
    const where = searchTerm
      ? or(
          ilike(mlDiagnosticoCriticoTable.nomeLoja, `%${searchTerm}%`),
          ilike(mlDiagnosticoCriticoTable.titulo, `%${searchTerm}%`),
          ilike(mlDiagnosticoCriticoTable.faltasRelevancia, `%${searchTerm}%`),
          sql`${mlDiagnosticoCriticoTable.problemas}::text ILIKE ${`%${searchTerm}%`}`,
        )
      : undefined;

    const [countResult, rows] = await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(mlDiagnosticoCriticoTable)
        .where(where),
      db
        .select()
        .from(mlDiagnosticoCriticoTable)
        .where(where)
        .orderBy(
          desc(mlDiagnosticoCriticoTable.updatedAt),
          desc(mlDiagnosticoCriticoTable.itemId),
        )
        .limit(limitNum)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    res.json({
      data: rows.map((row) => ({
        itemId: row.itemId,
        nomeLoja: row.nomeLoja,
        titulo: row.titulo,
        problemas: formatProblemas(row.problemas),
        permalink: row.permalink,
        status: row.statusMl,
        tipoEnvio: row.tipoEnvio,
        faltasRelevancia: row.faltasRelevancia,
        diasSemVend: row.diasSemVenda,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /critical-ads error:", err);
    res.status(500).json({ error: "Failed to load critical ads" });
  }
});

export default router;
