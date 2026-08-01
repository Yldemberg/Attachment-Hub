import { getDb } from "./db";
import {
  productsTable,
  fullStockSnapshotTable,
  fullSettingsTable,
  type FullSettings,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  computeFullSkuMetrics,
  computeFullOverviewKpis,
  type FullSkuStatus,
} from "./full-engine";
import { sumFullSalesBySku } from "./full-sync";

export type FullOverviewItem = {
  sku: string;
  title: string;
  thumbnail: string | null;
  mlItemId: string | null;
  productId: string | null;
  permalink: string | null;
  stockFull: number;
  notAvailable: number;
  unitsSoldPeriod: number;
  salesPerDay: number;
  coverageDays: number | null;
  suggestedQty: number;
  sendBy: string | null;
  status: FullSkuStatus;
  lastSyncedAt: string | null;
};

export type FullOverviewResult = {
  accountId: string;
  settings: {
    coverageTargetDays: number;
    leadTimeDays: number;
    salesPeriodDays: number;
    stuckMultiplier: number;
    whatsappPhone: string | null;
    alertsEnabled: boolean;
    alertRuptura: boolean;
    alertCritico: boolean;
    alertParado: boolean;
    alertCooldownHours: number;
  };
  kpis: ReturnType<typeof computeFullOverviewKpis>;
  items: FullOverviewItem[];
};

const DEFAULT_SETTINGS = {
  coverageTargetDays: 30,
  leadTimeDays: 5,
  salesPeriodDays: 30,
  stuckMultiplier: 2,
  whatsappPhone: null as string | null,
  alertsEnabled: false,
  alertRuptura: true,
  alertCritico: true,
  alertParado: true,
  alertCooldownHours: 24,
};

function settingsFromRow(row: FullSettings | null | undefined) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    coverageTargetDays: row.coverageTargetDays,
    leadTimeDays: row.leadTimeDays,
    salesPeriodDays: row.salesPeriodDays,
    stuckMultiplier: row.stuckMultiplier,
    whatsappPhone: row.whatsappPhone,
    alertsEnabled: row.alertsEnabled,
    alertRuptura: row.alertRuptura,
    alertCritico: row.alertCritico,
    alertParado: row.alertParado,
    alertCooldownHours: row.alertCooldownHours,
  };
}

export async function getOrCreateFullSettings(
  userId: string,
  accountId: string,
): Promise<FullSettings> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(fullSettingsTable)
    .where(and(eq(fullSettingsTable.userId, userId), eq(fullSettingsTable.accountId, accountId)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(fullSettingsTable)
    .values({ userId, accountId })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [again] = await db
    .select()
    .from(fullSettingsTable)
    .where(and(eq(fullSettingsTable.userId, userId), eq(fullSettingsTable.accountId, accountId)))
    .limit(1);
  return again!;
}

/** Garante que a conta pertence ao usuário. */
export async function assertUserOwnsAccount(
  userId: string,
  accountId: string,
): Promise<boolean> {
  const { getUserAccountIds } = await import("./account-scope");
  const ids = await getUserAccountIds(userId, accountId);
  return ids.includes(accountId);
}

export async function buildFullOverviewForAccount(opts: {
  userId: string;
  accountId: string;
  settingsOverride?: FullSettings | null;
  /** Sobrescreve salesPeriodDays sem persistir. */
  periodDaysOverride?: number;
  statusFilter?: FullSkuStatus | "all";
  search?: string;
}): Promise<FullOverviewResult> {
  const db = getDb();
  const settingsRow =
    opts.settingsOverride ?? (await getOrCreateFullSettings(opts.userId, opts.accountId));
  const settings = settingsFromRow(settingsRow);
  if (opts.periodDaysOverride && [7, 15, 30, 60].includes(opts.periodDaysOverride)) {
    settings.salesPeriodDays = opts.periodDaysOverride;
  }

  const fullProducts = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.accountId, opts.accountId),
        eq(productsTable.isFull, true),
        sql`(nullif(trim(coalesce(${productsTable.sku}, '')), '') is not null)`,
      ),
    );

  const snapshots = await db
    .select()
    .from(fullStockSnapshotTable)
    .where(eq(fullStockSnapshotTable.accountId, opts.accountId));

  type Agg = {
    sku: string;
    stockFull: number;
    notAvailable: number;
    title: string;
    thumbnail: string | null;
    mlItemId: string | null;
    productId: string | null;
    permalink: string | null;
    lastSyncedAt: Date | null;
    hasSnapshot: boolean;
  };

  const bySku = new Map<string, Agg>();

  for (const snap of snapshots) {
    const sku = snap.sku.trim();
    if (!sku) continue;
    const prev = bySku.get(sku);
    if (!prev) {
      bySku.set(sku, {
        sku,
        stockFull: snap.availableQuantity,
        notAvailable: snap.notAvailableQuantity,
        title: "",
        thumbnail: null,
        mlItemId: snap.mlItemId,
        productId: snap.productId,
        permalink: null,
        lastSyncedAt: snap.syncedAt,
        hasSnapshot: true,
      });
    } else {
      prev.stockFull += snap.availableQuantity;
      prev.notAvailable += snap.notAvailableQuantity;
      prev.hasSnapshot = true;
      if (snap.syncedAt && (!prev.lastSyncedAt || snap.syncedAt > prev.lastSyncedAt)) {
        prev.lastSyncedAt = snap.syncedAt;
      }
    }
  }

  for (const p of fullProducts) {
    const sku = (p.sku ?? "").trim();
    if (!sku) continue;
    const prev = bySku.get(sku);
    if (!prev) {
      bySku.set(sku, {
        sku,
        stockFull: p.availableQuantity ?? 0,
        notAvailable: 0,
        title: p.title ?? sku,
        thumbnail: p.thumbnail,
        mlItemId: p.mlItemId,
        productId: p.id,
        permalink: p.permalink,
        lastSyncedAt: p.lastSyncedAt,
        hasSnapshot: false,
      });
    } else {
      if (!prev.title) prev.title = p.title ?? sku;
      if (!prev.thumbnail) prev.thumbnail = p.thumbnail;
      if (!prev.permalink) prev.permalink = p.permalink;
      if (!prev.productId) prev.productId = p.id;
      if (!prev.mlItemId) prev.mlItemId = p.mlItemId;
      if (!prev.hasSnapshot) {
        prev.stockFull = Math.max(prev.stockFull, p.availableQuantity ?? 0);
      }
    }
  }

  const salesMap = await sumFullSalesBySku([opts.accountId], settings.salesPeriodDays);
  const engineParams = {
    coverageTargetDays: settings.coverageTargetDays,
    leadTimeDays: settings.leadTimeDays,
    salesPeriodDays: settings.salesPeriodDays,
    stuckMultiplier: settings.stuckMultiplier,
    inTransit: 0,
  };

  let items: FullOverviewItem[] = [];
  for (const agg of bySku.values()) {
    const unitsSoldPeriod = salesMap.get(agg.sku) ?? 0;
    const metrics = computeFullSkuMetrics(
      { stockFull: agg.stockFull, unitsSoldPeriod },
      engineParams,
    );
    items.push({
      sku: agg.sku,
      title: agg.title || agg.sku,
      thumbnail: agg.thumbnail,
      mlItemId: agg.mlItemId,
      productId: agg.productId,
      permalink: agg.permalink,
      stockFull: agg.stockFull,
      notAvailable: agg.notAvailable,
      unitsSoldPeriod,
      salesPerDay: metrics.salesPerDay,
      coverageDays: metrics.coverageDays,
      suggestedQty: metrics.suggestedQty,
      sendBy: metrics.sendBy,
      status: metrics.status,
      lastSyncedAt: agg.lastSyncedAt ? agg.lastSyncedAt.toISOString() : null,
    });
  }

  const search = opts.search?.trim().toLowerCase();
  if (search) {
    items = items.filter(
      (it) =>
        it.sku.toLowerCase().includes(search) ||
        it.title.toLowerCase().includes(search) ||
        (it.mlItemId?.toLowerCase().includes(search) ?? false),
    );
  }

  const statusFilter = opts.statusFilter ?? "all";
  if (statusFilter !== "all") {
    items = items.filter((it) => it.status === statusFilter);
  }

  const statusOrder: Record<FullSkuStatus, number> = {
    ruptura: 0,
    critico: 1,
    parado: 2,
    saudavel: 3,
  };
  items.sort((a, b) => {
    const d = statusOrder[a.status] - statusOrder[b.status];
    if (d !== 0) return d;
    return (b.suggestedQty || 0) - (a.suggestedQty || 0);
  });

  const kpis = computeFullOverviewKpis(items);

  return {
    accountId: opts.accountId,
    settings,
    kpis,
    items,
  };
}

export async function updateFullSettings(
  userId: string,
  accountId: string,
  patch: Partial<{
    coverageTargetDays: number;
    leadTimeDays: number;
    salesPeriodDays: number;
    stuckMultiplier: number;
    whatsappPhone: string | null;
    alertsEnabled: boolean;
    alertRuptura: boolean;
    alertCritico: boolean;
    alertParado: boolean;
    alertCooldownHours: number;
  }>,
): Promise<FullSettings> {
  await getOrCreateFullSettings(userId, accountId);
  const db = getDb();
  const [updated] = await db
    .update(fullSettingsTable)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(fullSettingsTable.userId, userId), eq(fullSettingsTable.accountId, accountId)))
    .returning();
  return updated!;
}
