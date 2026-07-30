import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { ordersTable, questionsTable, productsTable, accountsTable, inventorySkuFinancialsTable } from "@workspace/db/schema";
import { eq, and, inArray, lt, sql, desc } from "drizzle-orm";
import { getUserAccountIds } from "../lib/account-scope";
import {
  PAID_ORDER_STATUSES,
  ML_REPORT_TZ,
  orderPaidLocalDateSp,
  isPaidOrderTodaySp,
  isPaidOrderThisCalendarMonthSp,
  orderSortInstant,
} from "../lib/ml-order-report";
import { buildSalesReportCsv, buildSalesReportPdf, buildSalesReportXlsx } from "../lib/sales-report-export";
import type { SalesReportExportRow } from "../lib/sales-report-export";
import { buildSalesReportExportRow, type SalesReportDbDetailRow } from "../lib/sales-report-row-build";
import type { StoredMlOrderItemsJsonRow } from "../lib/ml-order-payload";
import { resolveOrderNetReceivedAmount } from "../lib/mercadopago";
import { fetchMlExtraCostsAggregated } from "../lib/ml-billing";

const router = Router();
const auth = [requireAuth, requireActivePlan];

function isIsoDateOnly(s: string | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Dias inclusivos entre duas datas só-em-YYYY-MM-DD (UTC date math). */
function inclusiveDaySpan(dateFrom: string, dateTo: string): number {
  const [yf, mf, df] = dateFrom.split("-").map(Number);
  const [yt, mt, dt] = dateTo.split("-").map(Number);
  const a = Date.UTC(yf, mf - 1, df);
  const b = Date.UTC(yt, mt - 1, dt);
  return Math.floor((b - a) / 86400000) + 1;
}

const MAX_REPORT_SPAN_DAYS = 366;

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

    const [todaySalesRow, monthSalesRow, todayOrdersRow, monthOrdersRow, pendingOrdersRow, unansweredQRow, criticalStockRow] =
      await Promise.all([
        db
          .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
          .from(ordersTable)
          .where(
            and(
              inArray(ordersTable.accountId, accountIds),
              isPaidOrderTodaySp,
              inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
            ),
          ),
        db
          .select({ total: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)` })
          .from(ordersTable)
          .where(
            and(
              inArray(ordersTable.accountId, accountIds),
              isPaidOrderThisCalendarMonthSp,
              inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
            ),
          ),
        db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(ordersTable)
          .where(
            and(
              inArray(ordersTable.accountId, accountIds),
              isPaidOrderTodaySp,
              inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
            ),
          ),
        db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(ordersTable)
          .where(
            and(
              inArray(ordersTable.accountId, accountIds),
              isPaidOrderThisCalendarMonthSp,
              inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
            ),
          ),
        db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(ordersTable)
          .where(and(inArray(ordersTable.accountId, accountIds), eq(ordersTable.status, "confirmed"))),
        db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(questionsTable)
          .where(and(inArray(questionsTable.accountId, accountIds), eq(questionsTable.status, "unanswered"))),
        db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(productsTable)
          .where(and(inArray(productsTable.accountId, accountIds), lt(productsTable.availableQuantity, 5))),
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

router.get("/dashboard/ml-extra-costs", ...auth, async (req, res) => {
  try {
    const { account_id, period_key } = req.query as Record<string, string>;
    const accountIds = await getUserAccountIds(req.user!.id, account_id);
    const data = await fetchMlExtraCostsAggregated(accountIds, period_key);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to get ML extra costs");
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
      .where(
        and(
          inArray(ordersTable.accountId, accountIds),
          sql`${orderPaidLocalDateSp} >= ${chartFromSp}`,
          sql`${orderPaidLocalDateSp} <= ${todaySpDate}`,
          inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
        ),
      )
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

router.get("/dashboard/sales-report", ...auth, async (req, res) => {
  try {
    const { account_id, date_from, date_to, format = "json" } = req.query as Record<string, string>;

    if (!isIsoDateOnly(date_from) || !isIsoDateOnly(date_to)) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "date_from e date_to são obrigatórios (YYYY-MM-DD)" },
      });
      return;
    }

    if (date_from > date_to) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "date_from não pode ser posterior a date_to" },
      });
      return;
    }

    const span = inclusiveDaySpan(date_from, date_to);
    if (span > MAX_REPORT_SPAN_DAYS) {
      res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: `Intervalo máximo: ${MAX_REPORT_SPAN_DAYS} dias`,
        },
      });
      return;
    }

    const fmt = format.toLowerCase();
    if (!["json", "csv", "xlsx", "pdf"].includes(fmt)) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "format deve ser json, csv, xlsx ou pdf" },
      });
      return;
    }

    const db = getDb();
    const accountIds = await getUserAccountIds(req.user!.id, account_id);

    const periodWhere = and(
      accountIds.length > 0 ? inArray(ordersTable.accountId, accountIds) : sql`false`,
      inArray(ordersTable.status, [...PAID_ORDER_STATUSES]),
      sql`${orderPaidLocalDateSp} >= ${sql.raw(`'${date_from}'`)}::date`,
      sql`${orderPaidLocalDateSp} <= ${sql.raw(`'${date_to}'`)}::date`,
    );

    const refYmd = sql<string>`to_char(${orderPaidLocalDateSp}, 'YYYY-MM-DD')`;

    const [summaryRow, detailRows] = await Promise.all([
      db
        .select({
          orderCount: sql<number>`cast(count(*) as int)`,
          revenue: sql<number>`coalesce(sum(cast(${ordersTable.totalAmount} as numeric)), 0)`,
        })
        .from(ordersTable)
        .where(periodWhere),
      accountIds.length === 0
        ? Promise.resolve([] as SalesReportDbDetailRow[])
        : db
            .select({
              referenceDate: refYmd,
              accountId: ordersTable.accountId,
              mlOrderId: ordersTable.mlOrderId,
              totalAmount: ordersTable.totalAmount,
              accountNickname: accountsTable.mlNickname,
              itemsJson: ordersTable.itemsJson,
              reportFinancials: ordersTable.reportFinancials,
            })
            .from(ordersTable)
            .innerJoin(accountsTable, eq(ordersTable.accountId, accountsTable.id))
            .where(periodWhere)
            .orderBy(desc(orderSortInstant)),
    ]);

    const summary = {
      orderCount: summaryRow[0]?.orderCount ?? 0,
      revenue: Number(summaryRow[0]?.revenue ?? 0),
    };

    const allSkus = new Set<string>();
    const itemKeys: Array<{ accountId: string; mlItemId: string }> = [];
    for (const r of detailRows) {
      const items: StoredMlOrderItemsJsonRow[] = Array.isArray(r.itemsJson)
        ? (r.itemsJson as StoredMlOrderItemsJsonRow[])
        : [];
      for (const it of items) {
        if (it.sku) allSkus.add(it.sku);
        if (it.item_id) itemKeys.push({ accountId: r.accountId, mlItemId: it.item_id });
      }
    }

    let finMap = new Map<string, { taxPercent: number | null; purchasePrice: number | null }>();
    if (allSkus.size > 0) {
      try {
        const skuList = [...allSkus];
        const finRows = await db
          .select()
          .from(inventorySkuFinancialsTable)
          .where(
            and(
              eq(inventorySkuFinancialsTable.userId, req.user!.id),
              inArray(inventorySkuFinancialsTable.sku, skuList),
            ),
          );
        finMap = new Map(
          finRows.map((row) => [
            row.sku,
            {
              taxPercent: row.taxPercent != null ? Number(row.taxPercent) : null,
              purchasePrice: row.purchasePrice != null ? Number(row.purchasePrice) : null,
            },
          ]),
        );
      } catch (err) {
        req.log.warn({ err }, "inventory_sku_financials indisponível no relatório de vendas");
      }
    }

    const listingTypeByItemId = new Map<string, string | null>();
    if (itemKeys.length > 0) {
      try {
        const uniqueItemIds = [...new Set(itemKeys.map((k) => k.mlItemId))];
        const uniqueAccountIds = [...new Set(itemKeys.map((k) => k.accountId))];
        const prodRows = await db
          .select({
            accountId: productsTable.accountId,
            mlItemId: productsTable.mlItemId,
            listingType: productsTable.listingType,
          })
          .from(productsTable)
          .where(
            and(
              inArray(productsTable.accountId, uniqueAccountIds),
              inArray(productsTable.mlItemId, uniqueItemIds),
            ),
          );
        for (const p of prodRows) {
          if (p.mlItemId) listingTypeByItemId.set(p.mlItemId, p.listingType);
        }
      } catch (err) {
        req.log.warn({ err }, "listing_type indisponível no relatório de vendas");
      }
    }

    const exportRows: SalesReportExportRow[] = await Promise.all(
      detailRows.map(async (r) => {
        const row = buildSalesReportExportRow(
          r as SalesReportDbDetailRow,
          finMap,
          listingTypeByItemId,
        );
        if (row.netReceivedAmount == null && r.accountId && r.mlOrderId != null) {
          row.netReceivedAmount = await resolveOrderNetReceivedAmount(r.accountId, r.mlOrderId);
        }
        if (row.netReceivedAmount != null) {
          row.profit =
            Math.round(
              (row.netReceivedAmount - row.taxTotal - row.productPurchaseTotal - (row.adsFee ?? 0)) *
                100,
            ) / 100;
        }
        return row;
      }),
    );

    const jsonRows = exportRows.map((e) => ({
      referenceDate: e.referenceDate,
      mlOrderId: e.mlOrderId ? Number(e.mlOrderId) : null,
      accountNickname: e.accountNickname,
      listingTypeLabel: e.listingTypeLabel,
      sku: e.sku,
      titleShort: e.titleShort,
      logisticLabel: e.logisticLabel,
      orderTotal: e.orderTotal,
      productPurchaseTotal: e.productPurchaseTotal,
      marketplaceFeesTotal: e.marketplaceFeesTotal,
      shippingTotal: e.shippingTotal,
      taxTotal: e.taxTotal,
      netReceivedAmount: e.netReceivedAmount,
      adsFee: e.adsFee,
      profit: e.profit,
    }));

    const periodPayload = { dateFrom: date_from, dateTo: date_to };

    if (fmt === "json") {
      res.json({
        period: periodPayload,
        summary,
        rows: jsonRows,
      });
      return;
    }

    const safeBase = `relatorio-vendas_${date_from}_${date_to}`;

    if (fmt === "csv") {
      const body = buildSalesReportCsv(exportRows, summary);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeBase}.csv"`);
      res.send(body);
      return;
    }

    if (fmt === "xlsx") {
      const buf = await buildSalesReportXlsx(date_from, date_to, exportRows, summary);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${safeBase}.xlsx"`);
      res.send(buf);
      return;
    }

    const pdfBuf = await buildSalesReportPdf(date_from, date_to, exportRows, summary);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeBase}.pdf"`);
    res.send(pdfBuf);
  } catch (err) {
    req.log.error({ err }, "Failed to build sales report");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
