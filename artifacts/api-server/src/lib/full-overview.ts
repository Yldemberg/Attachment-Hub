import { getDb } from "./db";
import {
  productsTable,
  fullStockSnapshotTable,
  fullSettingsTable,
  type FullSettings,
} from "@workspace/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import {
  computeFullSkuMetrics,
  computeFullOverviewKpis,
  type FullSkuStatus,
} from "./full-engine";
import { FULL_RECOMMENDED_SETTINGS } from "./full-recommended-settings";
import { sumFullSalesMaps } from "./full-sync";
import { getOpenInboundAggByAccount } from "./full-inbound";

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
  /** Unidades em envios Full abertos (planned/in_transit). */
  inTransitQty: number;
  /** Próxima data de agendamento de inbound aberto (YYYY-MM-DD). */
  inboundScheduledDate: string | null;
  /**
   * Quantidade de anúncios Full que compartilham este SKU/estoque
   * (ex.: clássico + catálogo). Sempre >= 1.
   */
  listingCount: number;
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
  /**
   * Total de itens na lista (1 por SKU/estoque compartilhado) antes de filtros.
   * Anúncios clássico+catálogo do mesmo SKU contam como 1.
   */
  totalFullListings: number;
};

type ProductRow = typeof productsTable.$inferSelect;

/**
 * Um card por estoque: agrupa anúncios Full com o mesmo SKU (clássico + catálogo).
 * Sem SKU, cada anúncio permanece isolado.
 */
function fullOverviewGroupKey(p: ProductRow): string {
  const sku = (p.sku ?? "").trim();
  if (sku) return `sku:${sku}`;
  if (p.mlItemId) return `item:${p.mlItemId}`;
  return `id:${p.id}`;
}

/** Prefere catálogo (Buy Box), depois mais vendidos / ativos. */
function pickFullRepresentative(list: ProductRow[]): ProductRow {
  return list
    .slice()
    .sort((a, b) => {
      if (a.catalogListing !== b.catalogListing) return a.catalogListing ? -1 : 1;
      if (a.soldQuantity !== b.soldQuantity) return b.soldQuantity - a.soldQuantity;
      const aActive = a.status === "active" ? 1 : 0;
      const bActive = b.status === "active" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return String(a.id).localeCompare(String(b.id));
    })[0]!;
}

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

  // Anúncios Full: is_full OU logistic_type com fulfillment (legado com flag errada no sync).
  const fullProducts = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.accountId, opts.accountId),
        or(
          eq(productsTable.isFull, true),
          sql`${productsTable.logisticType} ILIKE '%fulfillment%'`,
        )!,
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

  const { bySku: inboundBySku, byMlItemId: inboundByMlItemId } =
    await getOpenInboundAggByAccount(opts.accountId);

  const nowMs = Date.now();
  const MS_PER_DAY = 86_400_000;

  const groups = new Map<string, ProductRow[]>();
  for (const p of fullProducts) {
    const key = fullOverviewGroupKey(p);
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  let items: FullOverviewItem[] = [];

  for (const members of groups.values()) {
    const p = pickFullRepresentative(members);
    const sku = (p.sku ?? "").trim();
    const displaySku = sku || p.mlItemId || p.id;
    const listingCount = members.length;

    let snap: SnapAgg | undefined;
    if (sku) {
      snap = snapBySku.get(sku);
    }
    if (!snap) {
      // Estoque compartilhado: evita somar o mesmo CD em vários anúncios — usa o maior snapshot.
      for (const m of members) {
        const mSnap =
          snapByProductId.get(m.id) ??
          (m.mlItemId ? snapByMlItemId.get(m.mlItemId) : undefined);
        if (!mSnap) continue;
        if (!snap || mSnap.available > snap.available) snap = mSnap;
      }
    }

    const fallbackStock = members.reduce(
      (max, m) => Math.max(max, m.availableQuantity ?? 0),
      0,
    );
    const stockFull = snap ? snap.available : fallbackStock;
    const notAvailable = snap ? snap.notAvailable : 0;
    const lastSyncedAt =
      snap?.syncedAt ??
      members.reduce<Date | null>((best, m) => {
        if (!m.lastSyncedAt) return best;
        if (!best || m.lastSyncedAt > best) return m.lastSyncedAt;
        return best;
      }, null);

    let unitsSoldPeriod = 0;
    if (sku) unitsSoldPeriod = salesBySku.get(sku) ?? 0;
    if (unitsSoldPeriod === 0) {
      for (const m of members) {
        if (m.mlItemId) unitsSoldPeriod += salesByItemId.get(m.mlItemId) ?? 0;
      }
    }

    let lastSaleAt: Date | undefined;
    if (sku) lastSaleAt = lastSaleAtBySku.get(sku);
    for (const m of members) {
      if (!m.mlItemId) continue;
      const at = lastSaleAtByItemId.get(m.mlItemId);
      if (at && (!lastSaleAt || at > lastSaleAt)) lastSaleAt = at;
    }
    const daysWithoutSales =
      lastSaleAt != null
        ? Math.max(0, Math.floor((nowMs - lastSaleAt.getTime()) / MS_PER_DAY))
        : null;

    const inboundAgg =
      (sku ? inboundBySku.get(sku) : undefined) ??
      (p.mlItemId ? inboundByMlItemId.get(p.mlItemId) : undefined) ??
      inboundBySku.get(displaySku);
    const inTransitQty = inboundAgg?.qty ?? 0;
    const inboundScheduledDate = inboundAgg?.nextScheduledDate ?? null;

    const metrics = computeFullSkuMetrics(
      { stockFull, unitsSoldPeriod },
      {
        coverageTargetDays: settings.coverageTargetDays,
        leadTimeDays: settings.leadTimeDays,
        salesPeriodDays: settings.salesPeriodDays,
        stuckMultiplier: settings.stuckMultiplier,
        inTransit: inTransitQty,
      },
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
      inTransitQty,
      inboundScheduledDate,
      listingCount,
    });
  }

  const totalFullListings = items.length;

  const search = opts.search?.trim().toLowerCase();
  if (search) {
    items = items.filter((it) => {
      if (it.sku.toLowerCase().includes(search)) return true;
      if (it.title.toLowerCase().includes(search)) return true;
      if (it.mlItemId?.toLowerCase().includes(search)) return true;
      // Busca também MLB dos anúncios agrupados (clássico oculto, etc.).
      const key = it.sku.trim()
        ? `sku:${it.sku.trim()}`
        : it.mlItemId
          ? `item:${it.mlItemId}`
          : it.productId
            ? `id:${it.productId}`
            : null;
      if (!key) return false;
      const members = groups.get(key);
      if (!members) return false;
      return members.some(
        (m) =>
          (m.title ?? "").toLowerCase().includes(search) ||
          (m.mlItemId?.toLowerCase().includes(search) ?? false) ||
          ((m.sku ?? "").toLowerCase().includes(search)),
      );
    });
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
