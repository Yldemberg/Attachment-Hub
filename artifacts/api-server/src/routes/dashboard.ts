import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { ordersTable, questionsTable, productsTable, accountsTable } from "@workspace/db/schema";
import { eq, and, inArray, lt, sql } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requireActivePlan];

/** Status ML pós-pagamento (pagamento aprovado / pedido em preparação). */
const PAID_ORDER_STATUSES = ["paid", "confirmed"] as const;

/**
 * Fuso usado no painel do Mercado Livre para vendedores no Brasil.
 * Contagens por "dia" no Dashboard seguem o calendário deste fuso — não o TZ do servidor (muitas vezes UTC).
 */
const ML_REPORT_TZ = "America/Sao_Paulo";

/** Data civil (DATE) em ML_REPORT_TZ no instante do pagamento: fecha ML ou criação do pedido. */
const orderPaidLocalDateSp = sql`
  CAST(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})) AS date)
`;

/** Pedido pago cuja data de referência cai no mesmo dia civil que "agora" no Brasil. */
const isPaidOrderTodaySp = sql`
  ${orderPaidLocalDateSp} = CAST(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, now()) AS date)
`;

/** Pedido pago no mês civil atual em ML_REPORT_TZ. */
const isPaidOrderThisCalendarMonthSp = sql`
  to_char(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})), 'YYYY-MM')
  = to_char(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, now()), 'YYYY-MM')
`;

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

    const [todaySalesRow, monthSalesRow, todayOrdersRow, monthOrdersRow, pendingOrdersRow, unansweredQRow, criticalStockRow] = await Promise.all([
      db
        .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          isPaidOrderTodaySp,
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
        )),
      db
        .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          isPaidOrderThisCalendarMonthSp,
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
        )),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          isPaidOrderTodaySp,
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
        )),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(ordersTable)
        .where(and(
          inArray(ordersTable.accountId, accountIds),
          isPaidOrderThisCalendarMonthSp,
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

    if (accountIds.length === 0) {
      res.json({ period, data: [] });
      return;
    }

    const todaySpDate = sql`CAST(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, now()) AS date)`;
    const chartFromSp =
      period === "30d"
        ? sql`GREATEST((${todaySpDate}) - ${days - 1}, date_trunc('month', (${todaySpDate}))::date)`
        : sql`(${todaySpDate}) - ${days - 1}`;

    const paidYmdSp = sql<string>`
      to_char(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})), 'YYYY-MM-DD')
    `;

    const rows = await db
      .select({
        date: paidYmdSp,
        revenue: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)`,
        orders: sql<number>`cast(count(*) as int)`,
      })
      .from(ordersTable)
      .where(and(
        inArray(ordersTable.accountId, accountIds),
        sql`${orderPaidLocalDateSp} >= ${chartFromSp}`,
        sql`${orderPaidLocalDateSp} <= ${todaySpDate}`,
        inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
      ))
      .groupBy(paidYmdSp)
      .orderBy(paidYmdSp);

    const dataMap = Object.fromEntries(rows.map((r) => [r.date, r]));

    const daySpanQuery =
      period === "30d"
        ? `
        SELECT to_char(gs::date, 'YYYY-MM-DD') AS date
        FROM generate_series(
          GREATEST(
            CAST(timezone('America/Sao_Paulo', now()) AS date) - ${days - 1},
            date_trunc('month', CAST(timezone('America/Sao_Paulo', now()) AS date))::date
          ),
          CAST(timezone('America/Sao_Paulo', now()) AS date),
          interval '1 day'
        ) AS gs
      `
        : `
        SELECT to_char(gs::date, 'YYYY-MM-DD') AS date
        FROM generate_series(
          CAST(timezone('America/Sao_Paulo', now()) AS date) - ${days - 1},
          CAST(timezone('America/Sao_Paulo', now()) AS date),
          interval '1 day'
        ) AS gs
      `;

    const spanResult = await db.execute<{ date: string }>(sql.raw(daySpanQuery.trim()));
    const dateKeys = spanResult.rows;

    const data = dateKeys.map((row) => ({
      date: row.date,
      revenue: Number(dataMap[row.date]?.revenue ?? 0),
      orders: dataMap[row.date]?.orders ?? 0,
    }));

    res.json({ period, data });
  } catch (err) {
    req.log.error({ err }, "Failed to get sales chart");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
