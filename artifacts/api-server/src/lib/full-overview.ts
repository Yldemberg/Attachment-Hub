import { getDb } from "./db";
import {
  productsTable,
  fullStockSnapshotTable,
  fullSettingsTable,
  type FullSettings,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  computeFullSkuMetrics,
  computeFullOverviewKpis,
  type FullSkuStatus,
} from "./full-engine";
import { FULL_RECOMMENDED_SETTINGS } from "./full-recommended-settings";
import { sumFullSalesMaps } from "./full-sync";

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
  daysWithoutSales: number | null;
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
    alertQuestions: boolean;
    alertCooldownHours: number;
  };
  kpis: ReturnType<typeof computeFullOverviewKpis>;
  items: FullOverviewItem[];
  /** Total de anúncios Full da conta (antes de filtros de status/busca). */
  totalFullListings: number;
};

const DEFAULT_SETTINGS = {
  coverageTargetDays: FULL_RECOMMENDED_SETTINGS.coverageTargetDays,
  leadTimeDays: FULL_RECOMMENDED_SETTINGS.leadTimeDays,
  salesPeriodDays: FULL_RECOMMENDED_SETTINGS.salesPeriodDays,
  stuckMultiplier: FULL_RECOMMENDED_SETTINGS.stuckMultiplier,
  whatsappPhone: null as string | null,
  alertsEnabled: false,
  alertRuptura: FULL_RECOMMENDED_SETTINGS.alertRuptura,
  alertCritico: FULL_RECOMMENDED_SETTINGS.alertCritico,
  alertParado: FULL_RECOMMENDED_SETTINGS.alertParado,
  alertQuestions: FULL_RECOMMENDED_SETTINGS.alertQuestions,
  alertCooldownHours: FULL_RECOMMENDED_SETTINGS.alertCooldownHours,
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
    alertQuestions: row.alertQuestions,
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
    .values({
      userId,
      accountId,
      coverageTargetDays: FULL_RECOMMENDED_SETTINGS.coverageTargetDays,
      leadTimeDays: FULL_RECOMMENDED_SETTINGS.leadTimeDays,
      salesPeriodDays: FULL_RECOMMENDED_SETTINGS.salesPeriodDays,
      stuckMultiplier: FULL_RECOMMENDED_SETTINGS.stuckMultiplier,
      alertRuptura: FULL_RECOMMENDED_SETTINGS.alertRuptura,
      alertCritico: FULL_RECOMMENDED_SETTINGS.alertCritico,
      alertParado: FULL_RECOMMENDED_SETTINGS.alertParado,
      alertQuestions: FULL_RECOMMENDED_SETTINGS.alertQuestions,
      alertCooldownHours: FULL_RECOMMENDED_SETTINGS.alertCooldownHours,
    })
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

  // Todos os anúncios Full da conta (com ou sem SKU).
  const fullProducts = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.accountId, opts.accountId),
        eq(productsTable.isFull, true),
      ),
    );

  const snapshots = await db
    .select()
    .from(fullStockSnapshotTable)
    .where(eq(fullStockSnapshotTable.accountId, opts.accountId));

  type SnapAgg = { available: number; notAvailable: number; syncedAt: Date | null };
  const snapByProductId = new Map<string, SnapAgg>();
  const snapByMlItemId = new Map<string, SnapAgg>();
  const snapBySku = new Map<string, SnapAgg>();

  const mergeSnap = (map: Map<string, SnapAgg>, key: string, available: number, notAvailable: number, syncedAt: Date) => {
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { available, notAvailable, syncedAt });
      return;
    }
    prev.available += available;
    prev.notAvailable += notAvailable;
    if (!prev.syncedAt || syncedAt > prev.syncedAt) prev.syncedAt = syncedAt;
  };

  for (const snap of snapshots) {
    if (snap.productId) {
      mergeSnap(snapByProductId, snap.productId, snap.availableQuantity, snap.notAvailableQuantity, snap.syncedAt);
    }
    if (snap.mlItemId) {
      mergeSnap(snapByMlItemId, snap.mlItemId, snap.availableQuantity, snap.notAvailableQuantity, snap.syncedAt);
    }
    const sku = snap.sku.trim();
    if (sku) {
      mergeSnap(snapBySku, sku, snap.availableQuantity, snap.notAvailableQuantity, snap.syncedAt);
    }
  }

  const {
    bySku: salesBySku,
    byItemId: salesByItemId,
    lastSaleAtBySku,
    lastSaleAtByItemId,
  } = await sumFullSalesMaps(
    [opts.accountId],
    settings.salesPeriodDays,
  );

  const engineParams = {
    coverageTargetDays: settings.coverageTargetDays,
    leadTimeDays: settings.leadTimeDays,
    salesPeriodDays: settings.salesPeriodDays,
    stuckMultiplier: settings.stuckMultiplier,
    inTransit: 0,
  };

  const nowMs = Date.now();
  const MS_PER_DAY = 86_400_000;

  let items: FullOverviewItem[] = [];

  for (const p of fullProducts) {
    const sku = (p.sku ?? "").trim();
    const displaySku = sku || p.mlItemId || p.id;
    const snap =
      (p.id ? snapByProductId.get(p.id) : undefined) ??
      (p.mlItemId ? snapByMlItemId.get(p.mlItemId) : undefined) ??
      (sku ? snapBySku.get(sku) : undefined);

    const stockFull = snap ? snap.available : (p.availableQuantity ?? 0);
    const notAvailable = snap ? snap.notAvailable : 0;
    const lastSyncedAt = snap?.syncedAt ?? p.lastSyncedAt;

    let unitsSoldPeriod = 0;
    if (sku) unitsSoldPeriod = salesBySku.get(sku) ?? 0;
    if (unitsSoldPeriod === 0 && p.mlItemId) {
      unitsSoldPeriod = salesByItemId.get(p.mlItemId) ?? 0;
    }

    let lastSaleAt: Date | undefined;
    if (sku) lastSaleAt = lastSaleAtBySku.get(sku);
    if (!lastSaleAt && p.mlItemId) lastSaleAt = lastSaleAtByItemId.get(p.mlItemId);
    const daysWithoutSales =
      lastSaleAt != null
        ? Math.max(0, Math.floor((nowMs - lastSaleAt.getTime()) / MS_PER_DAY))
        : null;

    const metrics = computeFullSkuMetrics(
      { stockFull, unitsSoldPeriod },
      engineParams,
    );

    items.push({
      sku: displaySku,
      title: p.title ?? displaySku,
      thumbnail: p.thumbnail,
      mlItemId: p.mlItemId,
      productId: p.id,
      permalink: p.permalink,
      stockFull,
      notAvailable,
      unitsSoldPeriod,
      salesPerDay: metrics.salesPerDay,
      daysWithoutSales,
      coverageDays: metrics.coverageDays,
      suggestedQty: metrics.suggestedQty,
      sendBy: metrics.sendBy,
      status: metrics.status,
      lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    });
  }

  const totalFullListings = items.length;

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
    totalFullListings,
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
    alertQuestions: boolean;
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
