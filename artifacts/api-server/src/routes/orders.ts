import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { ordersTable, accountsTable } from "@workspace/db/schema";
import { eq, and, inArray, gte, lte, sql } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requireActivePlan];

async function getUserAccountIds(userId: string, filterAccountId?: string): Promise<string[]> {
  const db = getDb();
  const conditions = [eq(accountsTable.userId, userId), eq(accountsTable.isActive, true)];
  if (filterAccountId) conditions.push(eq(accountsTable.id, filterAccountId));
  const accounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(...conditions));
  return accounts.map((a) => a.id);
}

router.get("/orders", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id, status, date_from, date_to, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const accountIds = await getUserAccountIds(req.user!.id, account_id);
    if (accountIds.length === 0) {
      res.json({ data: [], pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 } });
      return;
    }

    const conditions = [inArray(ordersTable.accountId, accountIds)];
    if (status) conditions.push(eq(ordersTable.status, status));
    if (date_from) conditions.push(gte(ordersTable.dateCreated, new Date(date_from)));
    if (date_to) conditions.push(lte(ordersTable.dateCreated, new Date(date_to)));

    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(ordersTable).where(where),
      db.select().from(ordersTable).where(where)
        .orderBy(sql`${ordersTable.dateCreated} desc nulls last`)
        .limit(limitNum).offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    const accounts = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(inArray(accountsTable.id, accountIds));
    const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

    res.json({
      data: rows.map((o) => ({ ...o, account: accountMap[o.accountId] ?? null })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list orders");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/orders/:id", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found" } });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, req.params.id as string), inArray(ordersTable.accountId, accountIds)));

    if (!order) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found" } });
      return;
    }

    res.json(order);
  } catch (err) {
    req.log.error({ err }, "Failed to get order");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
