import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { ordersTable, questionsTable, productsTable, accountsTable } from "@workspace/db/schema";
import { eq, and, inArray, lt, sql, gte } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requireActivePlan];

async function getUserAccountIds(userId: string): Promise<string[]> {
  const db = getDb();
  const accounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.userId, userId), eq(accountsTable.isActive, true)));
  return accounts.map((a) => a.id);
}

router.get("/dashboard/summary", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id } = req.query as Record<string, string>;
    const accountIds = account_id ? [account_id] : await getUserAccountIds(req.user!.id);

    if (accountIds.length === 0) {
      res.json({
        salesToday: 0,
        salesMonth: 0,
        pendingOrders: 0,
        unansweredQuestions: 0,
        criticalStockCount: 0,
        activeAccounts: 0,
      });
      return;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [todaySales, monthSales, pendingOrders, unansweredQ, criticalStock] = await Promise.all([
      db
        .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          gte(ordersTable.dateCreated, todayStart),
          eq(ordersTable.status, "paid"),
        )),
      db
        .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          gte(ordersTable.dateCreated, monthStart),
          eq(ordersTable.status, "paid"),
        )),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          eq(ordersTable.status, "confirmed"),
        )),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(questionsTable)
        .where(and(
          inArray(questionsTable.accountId, accountIds),
          eq(questionsTable.status, "unanswered"),
        )),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(productsTable)
        .where(and(
          inArray(productsTable.accountId, accountIds),
          lt(productsTable.availableQuantity, 5),
        )),
    ]);

    res.json({
      salesToday: Number(todaySales[0]?.total ?? 0),
      salesMonth: Number(monthSales[0]?.total ?? 0),
      pendingOrders: pendingOrders[0]?.count ?? 0,
      unansweredQuestions: unansweredQ[0]?.count ?? 0,
      criticalStockCount: criticalStock[0]?.count ?? 0,
      activeAccounts: accountIds.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/dashboard/sales-chart", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id, period = "30d" } = req.query as Record<string, string>;
    const accountIds = account_id ? [account_id] : await getUserAccountIds(req.user!.id);

    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    if (accountIds.length === 0) {
      res.json({ period, data: [] });
      return;
    }

    const rows = await db
      .select({
        date: sql<string>`cast(${ordersTable.dateCreated} as date)`,
        revenue: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)`,
        orders: sql<number>`cast(count(*) as int)`,
      })
      .from(ordersTable)
      .where(and(
        inArray(ordersTable.accountId, accountIds),
        gte(ordersTable.dateCreated, startDate),
        eq(ordersTable.status, "paid"),
      ))
      .groupBy(sql`cast(${ordersTable.dateCreated} as date)`)
      .orderBy(sql`cast(${ordersTable.dateCreated} as date) asc`);

    const dataMap = Object.fromEntries(rows.map((r) => [r.date, r]));
    const data = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      data.push({
        date: dateStr,
        revenue: Number(dataMap[dateStr]?.revenue ?? 0),
        orders: dataMap[dateStr]?.orders ?? 0,
      });
    }

    res.json({ period, data });
  } catch (err) {
    req.log.error({ err }, "Failed to get sales chart");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
