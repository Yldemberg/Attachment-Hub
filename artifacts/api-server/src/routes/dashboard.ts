import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { ordersTable, questionsTable, productsTable, accountsTable } from "@workspace/db/schema";
import { eq, and, inArray, lt, lte, sql, gte } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requireActivePlan];

/** Status ML pós-pagamento (pagamento aprovado / pedido em preparação). */
const PAID_ORDER_STATUSES = ["paid", "confirmed"] as const;

/** Instante do pagamento validado: `date_closed` do ML; fallback para `date_created`. */
const orderPaidAt = sql`coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})`;

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

router.get("/dashboard/summary", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id } = req.query as Record<string, string>;
    const accountIds = await getUserAccountIds(req.user!.id, account_id);

    if (accountIds.length === 0) {
      res.json({
        salesToday: 0,
        salesMonth: 0,
        ordersToday: 0,
        ordersMonth: 0,
        pendingOrders: 0,
        unansweredQuestions: 0,
        criticalStockCount: 0,
        activeAccounts: 0,
      });
      return;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 1, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 1, 0);

    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    const [todaySalesRow, monthSalesRow, todayOrdersRow, monthOrdersRow, pendingOrdersRow, unansweredQRow, criticalStockRow] = await Promise.all([
      db
        .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          gte(orderPaidAt, todayStart),
          lte(orderPaidAt, todayEnd),
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
        )),
      db
        .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          gte(orderPaidAt, monthStart),
          lte(orderPaidAt, monthEnd),
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
        )),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          gte(orderPaidAt, todayStart),
          lte(orderPaidAt, todayEnd),
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
        )),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          gte(orderPaidAt, monthStart),
          lte(orderPaidAt, monthEnd),
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
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
      salesToday: Number(todaySalesRow[0]?.total ?? 0),
      salesMonth: Number(monthSalesRow[0]?.total ?? 0),
      ordersToday: todayOrdersRow[0]?.count ?? 0,
      ordersMonth: monthOrdersRow[0]?.count ?? 0,
      pendingOrders: pendingOrdersRow[0]?.count ?? 0,
      unansweredQuestions: unansweredQRow[0]?.count ?? 0,
      criticalStockCount: criticalStockRow[0]?.count ?? 0,
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
    const accountIds = await getUserAccountIds(req.user!.id, account_id);

    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const now = new Date();

    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    let startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 1, 0);

    if (period === "30d") {
      const monthStartChart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 1, 0);
      if (startDate < monthStartChart) startDate = monthStartChart;
    }

    if (accountIds.length === 0) {
      res.json({ period, data: [] });
      return;
    }

    const rows = await db
      .select({
        date: sql<string>`cast(${orderPaidAt} as date)`,
        revenue: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)`,
        orders: sql<number>`cast(count(*) as int)`,
      })
      .from(ordersTable)
      .where(and(
        inArray(ordersTable.accountId, accountIds),
        gte(orderPaidAt, startDate),
        lte(orderPaidAt, endDate),
        inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
      ))
      .groupBy(sql`cast(${orderPaidAt} as date)`)
      .orderBy(sql`cast(${orderPaidAt} as date) asc`);

    const dataMap = Object.fromEntries(rows.map((r) => [r.date, r]));
    const data = [];
    const iterStart = new Date(startDate);
    iterStart.setHours(0, 0, 0, 0);
    const iterEnd = new Date(endDate);
    iterEnd.setHours(0, 0, 0, 0);
    for (let d = new Date(iterStart); d <= iterEnd; d.setDate(d.getDate() + 1)) {
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
