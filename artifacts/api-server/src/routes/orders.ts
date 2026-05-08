import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { getUserAccountIds } from "../lib/account-scope";
import { ordersTable, accountsTable } from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requireActivePlan];

/** Alinhado ao Dashboard: dia civil no Brasil sobre data de pagamento/fechamento ML. */
const ML_REPORT_TZ = "America/Sao_Paulo";

function isIsoDateOnly(s: string | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const orderReferenceLocalDateSp = sql`
  CAST(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})) AS date)
`;

const orderSortInstant = sql`coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})`;

/** Alinhado às pilulas de envio na UI (`shipmentFulfillmentBadges`). */
const orderShipStNorm = sql`lower(trim(coalesce(${ordersTable.shippingStatus}, '')))`;
const orderShipSsNorm = sql`lower(trim(coalesce(${ordersTable.shippingSubstatus}, '')))`;

function shipmentPhaseWhere(phase: string) {
  if (phase === "in_transit") {
    return sql`${orderShipStNorm} = 'shipped'`;
  }
  if (phase === "label_issued") {
    return sql`(
      (${orderShipSsNorm} = 'printed' OR ${orderShipStNorm} = 'ready_to_ship')
      AND ${orderShipSsNorm} <> 'ready_to_print'
      AND ${orderShipStNorm} <> 'shipped'
    )`;
  }
  return null;
}

router.get("/orders", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id, status, shipment_phase, date_from, date_to, page = "1", limit = "20" } = req.query as Record<
      string,
      string
    >;
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
    const phaseSql = shipment_phase ? shipmentPhaseWhere(shipment_phase.trim()) : null;
    if (phaseSql) conditions.push(phaseSql);
    if (isIsoDateOnly(date_from)) {
      conditions.push(sql`${orderReferenceLocalDateSp} >= ${sql.raw(`'${date_from}'`)}::date`);
    }
    if (isIsoDateOnly(date_to)) {
      conditions.push(sql`${orderReferenceLocalDateSp} <= ${sql.raw(`'${date_to}'`)}::date`);
    }

    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(ordersTable).where(where),
      db.select().from(ordersTable).where(where)
        .orderBy(sql`${orderSortInstant} desc nulls last`)
        .limit(limitNum).offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    const accounts = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(inArray(accountsTable.id, accountIds));
    const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

    res.json({
      data: rows.map((o) => ({
        ...o,
        mlOrderId: o.mlOrderId !== null ? Number(o.mlOrderId) : null,
        totalAmount: o.totalAmount !== null ? Number(o.totalAmount) : null,
        buyerId: o.buyerId !== null ? Number(o.buyerId) : null,
        shippingId: o.shippingId !== null ? Number(o.shippingId) : null,
        account: accountMap[o.accountId] ?? null,
      })),
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

    const [account] = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(eq(accountsTable.id, order.accountId));

    res.json({
      ...order,
      mlOrderId: order.mlOrderId !== null ? Number(order.mlOrderId) : null,
      totalAmount: order.totalAmount !== null ? Number(order.totalAmount) : null,
      buyerId: order.buyerId !== null ? Number(order.buyerId) : null,
      shippingId: order.shippingId !== null ? Number(order.shippingId) : null,
      account: account ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get order");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
