import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { getDb } from "../lib/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const { is_read, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(notificationsTable.userId, req.user!.id)];
    if (is_read !== undefined && is_read !== "") {
      conditions.push(eq(notificationsTable.isRead, is_read === "true"));
    }

    const where = and(...conditions);

    const [countResult, unreadResult, rows] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(notificationsTable).where(where),
      db.select({ count: sql<number>`cast(count(*) as int)` })
        .from(notificationsTable)
        .where(and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.isRead, false))),
      db.select().from(notificationsTable).where(where)
        .orderBy(sql`${notificationsTable.createdAt} desc`)
        .limit(limitNum).offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;
    const unreadCount = unreadResult[0]?.count ?? 0;

    res.json({
      data: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      unreadCount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list notifications");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const [updated] = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.id, req.params.id as string), eq(notificationsTable.userId, req.user!.id)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found" } });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to mark notification read");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.patch("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const updated = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.isRead, false)))
      .returning({ id: notificationsTable.id });

    res.json({ updated: updated.length });
  } catch (err) {
    req.log.error({ err }, "Failed to mark all notifications read");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
