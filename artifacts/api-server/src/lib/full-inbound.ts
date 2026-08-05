import { getDb } from "./db";
import {
  fullInboundShipmentTable,
  fullInboundShipmentItemTable,
  type FullInboundShipment,
  type FullInboundShipmentItem,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const OPEN_STATUSES = ["planned", "in_transit"] as const;

export type FullInboundItemInput = {
  productId?: string | null;
  mlItemId?: string | null;
  sku: string;
  quantity: number;
};

export type FullInboundShipmentWithItems = FullInboundShipment & {
  items: FullInboundShipmentItem[];
};

export type OpenInboundAgg = {
  qty: number;
  /** Próxima data de agendamento (YYYY-MM-DD) entre inbounds abertos. */
  nextScheduledDate: string | null;
};

function trimSku(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function ymdFromDate(d: Date | string): string {
  if (typeof d === "string") {
    // drizzle date often returns 'YYYY-MM-DD'
    return d.slice(0, 10);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseScheduledDate(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return t;
}

/**
 * Soma quantityRemaining de inbounds abertos por SKU e por mlItemId.
 */
export async function getOpenInboundAggByAccount(accountId: string): Promise<{
  bySku: Map<string, OpenInboundAgg>;
  byMlItemId: Map<string, OpenInboundAgg>;
}> {
  const db = getDb();
  const rows = await db
    .select({
      sku: fullInboundShipmentItemTable.sku,
      mlItemId: fullInboundShipmentItemTable.mlItemId,
      quantityRemaining: fullInboundShipmentItemTable.quantityRemaining,
      scheduledDate: fullInboundShipmentTable.scheduledDate,
    })
    .from(fullInboundShipmentItemTable)
    .innerJoin(
      fullInboundShipmentTable,
      eq(fullInboundShipmentItemTable.shipmentId, fullInboundShipmentTable.id),
    )
    .where(
      and(
        eq(fullInboundShipmentTable.accountId, accountId),
        inArray(fullInboundShipmentTable.status, [...OPEN_STATUSES]),
        sql`${fullInboundShipmentItemTable.quantityRemaining} > 0`,
      ),
    );

  const bySku = new Map<string, OpenInboundAgg>();
  const byMlItemId = new Map<string, OpenInboundAgg>();

  const bump = (map: Map<string, OpenInboundAgg>, key: string, qty: number, scheduled: string) => {
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { qty, nextScheduledDate: scheduled });
      return;
    }
    prev.qty += qty;
    if (!prev.nextScheduledDate || scheduled < prev.nextScheduledDate) {
      prev.nextScheduledDate = scheduled;
    }
  };

  for (const row of rows) {
    const qty = Math.max(0, Number(row.quantityRemaining) || 0);
    if (qty <= 0) continue;
    const scheduled = ymdFromDate(row.scheduledDate as string | Date);
    const sku = trimSku(row.sku);
    if (sku) bump(bySku, sku, qty, scheduled);
    const mlItemId = trimSku(row.mlItemId);
    if (mlItemId) bump(byMlItemId, mlItemId, qty, scheduled);
  }

  return { bySku, byMlItemId };
}

export async function createFullInboundShipment(opts: {
  userId: string;
  accountId: string;
  scheduledDate: string;
  notes?: string | null;
  items: FullInboundItemInput[];
}): Promise<FullInboundShipmentWithItems> {
  const scheduled = parseScheduledDate(opts.scheduledDate);
  if (!scheduled) {
    throw new Error("INVALID_SCHEDULED_DATE");
  }

  const cleaned: FullInboundItemInput[] = [];
  for (const it of opts.items) {
    const sku = trimSku(it.sku);
    const qty = Math.round(Number(it.quantity));
    if (!sku || !Number.isFinite(qty) || qty < 1) continue;
    cleaned.push({
      productId: it.productId?.trim() || null,
      mlItemId: it.mlItemId?.trim() || null,
      sku,
      quantity: qty,
    });
  }
  if (cleaned.length === 0) {
    throw new Error("NO_ITEMS");
  }

  const db = getDb();
  const notes = opts.notes?.trim() ? opts.notes.trim().slice(0, 500) : null;

  const [shipment] = await db
    .insert(fullInboundShipmentTable)
    .values({
      userId: opts.userId,
      accountId: opts.accountId,
      scheduledDate: scheduled,
      status: "planned",
      notes,
    })
    .returning();

  if (!shipment) throw new Error("CREATE_FAILED");

  const itemRows = await db
    .insert(fullInboundShipmentItemTable)
    .values(
      cleaned.map((it) => ({
        shipmentId: shipment.id,
        productId: it.productId || null,
        mlItemId: it.mlItemId || null,
        sku: it.sku,
        quantity: it.quantity,
        quantityRemaining: it.quantity,
      })),
    )
    .returning();

  return { ...shipment, items: itemRows };
}

export async function listFullInboundShipments(opts: {
  userId: string;
  accountId: string;
  limit?: number;
}): Promise<FullInboundShipmentWithItems[]> {
  const db = getDb();
  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));

  const shipments = await db
    .select()
    .from(fullInboundShipmentTable)
    .where(
      and(
        eq(fullInboundShipmentTable.userId, opts.userId),
        eq(fullInboundShipmentTable.accountId, opts.accountId),
      ),
    )
    .orderBy(desc(fullInboundShipmentTable.createdAt))
    .limit(limit);

  if (shipments.length === 0) return [];

  const ids = shipments.map((s) => s.id);
  const items = await db
    .select()
    .from(fullInboundShipmentItemTable)
    .where(inArray(fullInboundShipmentItemTable.shipmentId, ids));

  const byShipment = new Map<string, FullInboundShipmentItem[]>();
  for (const it of items) {
    const list = byShipment.get(it.shipmentId) ?? [];
    list.push(it);
    byShipment.set(it.shipmentId, list);
  }

  return shipments.map((s) => ({
    ...s,
    items: byShipment.get(s.id) ?? [],
  }));
}

async function getOwnedShipment(
  userId: string,
  shipmentId: string,
): Promise<FullInboundShipment | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(fullInboundShipmentTable)
    .where(
      and(eq(fullInboundShipmentTable.id, shipmentId), eq(fullInboundShipmentTable.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

export async function receiveFullInboundShipment(
  userId: string,
  shipmentId: string,
): Promise<FullInboundShipmentWithItems | null> {
  const existing = await getOwnedShipment(userId, shipmentId);
  if (!existing) return null;
  if (existing.status === "received" || existing.status === "cancelled") {
    const items = await listItems(shipmentId);
    return { ...existing, items };
  }

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(fullInboundShipmentTable)
    .set({ status: "received", updatedAt: now })
    .where(eq(fullInboundShipmentTable.id, shipmentId))
    .returning();

  await db
    .update(fullInboundShipmentItemTable)
    .set({ quantityRemaining: 0, updatedAt: now })
    .where(eq(fullInboundShipmentItemTable.shipmentId, shipmentId));

  const items = await listItems(shipmentId);
  return { ...(updated ?? existing), items };
}

export async function cancelFullInboundShipment(
  userId: string,
  shipmentId: string,
): Promise<FullInboundShipmentWithItems | null> {
  const existing = await getOwnedShipment(userId, shipmentId);
  if (!existing) return null;
  if (existing.status === "cancelled" || existing.status === "received") {
    const items = await listItems(shipmentId);
    return { ...existing, items };
  }

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(fullInboundShipmentTable)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(fullInboundShipmentTable.id, shipmentId))
    .returning();

  await db
    .update(fullInboundShipmentItemTable)
    .set({ quantityRemaining: 0, updatedAt: now })
    .where(eq(fullInboundShipmentItemTable.shipmentId, shipmentId));

  const items = await listItems(shipmentId);
  return { ...(updated ?? existing), items };
}

async function listItems(shipmentId: string): Promise<FullInboundShipmentItem[]> {
  const db = getDb();
  return db
    .select()
    .from(fullInboundShipmentItemTable)
    .where(eq(fullInboundShipmentItemTable.shipmentId, shipmentId));
}

export function serializeInboundShipment(s: FullInboundShipmentWithItems) {
  return {
    id: s.id,
    accountId: s.accountId,
    scheduledDate: ymdFromDate(s.scheduledDate as string | Date),
    status: s.status,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    items: s.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      mlItemId: it.mlItemId,
      sku: it.sku,
      quantity: it.quantity,
      quantityRemaining: it.quantityRemaining,
    })),
  };
}
