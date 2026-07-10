import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { mlDiagnosticoCriticoTable } from "@workspace/db/schema";
import { desc, ilike, or, sql } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requireActivePlan];

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
          ilike(mlDiagnosticoCriticoTable.problemas, `%${searchTerm}%`),
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
        .orderBy(desc(mlDiagnosticoCriticoTable.diasSemVend))
        .limit(limitNum)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        nomeLoja: row.nomeLoja,
        titulo: row.titulo,
        problemas: row.problemas,
        permalink: row.permalink,
        status: row.status,
        tipoEnvio: row.tipoEnvio,
        faltasRelevancia: row.faltasRelevancia,
        diasSemVend: row.diasSemVend,
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
