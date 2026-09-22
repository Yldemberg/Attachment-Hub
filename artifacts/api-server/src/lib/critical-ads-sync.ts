import { and, eq, inArray, sql } from "drizzle-orm";
import { accountsTable, mlDiagnosticoCriticoTable, ordersTable } from "@workspace/db/schema";
import { getDb } from "./db";
import { getDiagnosticoDb } from "./diagnostico-db";
import { logger } from "./logger";
import {
  getMlEffectiveLogisticType,
  ml,
  type MlItem,
} from "./mercadolivre";
import { labelLogisticType } from "./sales-report-row-build";

const MAX_ITEMS_PER_ACCOUNT = 120;
const ITEM_BATCH = 20;
const PERFORMANCE_CONCURRENCY = 5;

const BAD_PERFORMANCE_LEVELS = new Set([
  "bad",
  "poor",
  "low",
  "basic",
  "unhealthy",
]);

type MlInfraction = {
  related_item_id?: string;
  reason?: string;
  remedy?: string;
};

type MlPerformanceRule = {
  status?: string;
  wordings?: { title?: string; label?: string };
};

type MlPerformanceVariable = {
  status?: string;
  title?: string;
  rules?: MlPerformanceRule[];
};

type MlPerformanceBucket = {
  variables?: MlPerformanceVariable[];
};

type MlItemPerformance = {
  level?: string;
  buckets?: MlPerformanceBucket[];
};

type ItemSnapshot = MlItem & {
  date_created?: string;
  seller_id?: number;
};

type ItemVerdict = "critical" | "clear" | "unknown";

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function pendingPerformance(perf: MlItemPerformance | null): { lines: string[]; pendingCount: number; level: string | null } {
  if (!perf) return { lines: [], pendingCount: 0, level: null };
  const lines: string[] = [];
  let pendingCount = 0;
  for (const bucket of perf.buckets ?? []) {
    for (const variable of bucket.variables ?? []) {
      if ((variable.status ?? "").toUpperCase() !== "PENDING") continue;
      pendingCount += 1;
      const ruleTexts = (variable.rules ?? [])
        .filter((rule) => (rule.status ?? "").toUpperCase() === "PENDING")
        .map((rule) => rule.wordings?.title || rule.wordings?.label)
        .filter((text): text is string => Boolean(text));
      if (ruleTexts.length > 0) lines.push(...ruleTexts);
      else if (variable.title) lines.push(variable.title);
    }
  }
  return { lines, pendingCount, level: perf.level ?? null };
}

function tipoEnvioLabel(item: MlItem): string | null {
  const raw = getMlEffectiveLogisticType(item);
  if (!raw) return null;
  const labels = raw
    .split(",")
    .map((part) => labelLogisticType(part.trim()) ?? part.trim())
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : null;
}

function daysSince(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "0";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  return String(Math.max(0, days));
}

async function listInfractionProblems(accountId: string, mlUserId: string): Promise<Map<string, string[]>> {
  const byItem = new Map<string, string[]>();
  const limit = 50;
  let offset = 0;
  while (offset < 300) {
    const page = await ml.get<{ infractions?: MlInfraction[] }>(
      accountId,
      `/moderations/infractions/${encodeURIComponent(mlUserId)}?limit=${limit}&offset=${offset}`,
    );
    const rows = page?.infractions ?? [];
    for (const infraction of rows) {
      const itemId = infraction.related_item_id;
      if (!itemId) continue;
      const text = [infraction.reason, infraction.remedy].filter(Boolean).join(" — ");
      if (!text) continue;
      const list = byItem.get(itemId) ?? [];
      list.push(text);
      byItem.set(itemId, list);
    }
    if (rows.length < limit) break;
    offset += limit;
  }
  return byItem;
}

async function listUnderReviewIds(accountId: string, mlUserId: string): Promise<string[]> {
  const ids: string[] = [];
  const limit = 50;
  let offset = 0;
  while (ids.length < MAX_ITEMS_PER_ACCOUNT) {
    const result = await ml.get<{ results?: string[] }>(
      accountId,
      `/users/${encodeURIComponent(mlUserId)}/items/search?status=under_review&limit=${limit}&offset=${offset}`,
    );
    const batch = result?.results ?? [];
    ids.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return ids;
}

async function listedDiagnosticIds(): Promise<string[]> {
  const diagDb = getDiagnosticoDb();
  const rows = await diagDb
    .select({ itemId: mlDiagnosticoCriticoTable.itemId })
    .from(mlDiagnosticoCriticoTable)
    .limit(400);
  return rows.map((row) => row.itemId);
}

async function safeMl<T>(label: string, accountId: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, accountId, label }, "critical ads partial ML fetch failed");
    return fallback;
  }
}

async function fetchItemSnapshots(accountId: string, itemIds: string[]): Promise<Map<string, ItemSnapshot | null>> {
  const out = new Map<string, ItemSnapshot | null>();
  for (let i = 0; i < itemIds.length; i += ITEM_BATCH) {
    const batch = itemIds.slice(i, i + ITEM_BATCH);
    const items = await ml.get<Array<{ code: number; body: ItemSnapshot }>>(
      accountId,
      `/items?ids=${batch.join(",")}`,
    );
    for (const entry of items ?? []) {
      const id = entry?.body?.id;
      if (!id) continue;
      if (entry.code === 200) out.set(id, entry.body);
      else if (entry.code === 404) out.set(id, null);
    }
  }
  return out;
}

async function fetchPerformance(accountId: string, itemId: string): Promise<MlItemPerformance | null> {
  try {
    return await ml.get<MlItemPerformance>(accountId, `/item/${encodeURIComponent(itemId)}/performance`);
  } catch (err) {
    logger.warn({ err, accountId, itemId }, "ML item performance failed");
    return null;
  }
}

async function lastSaleByItem(accountId: string, itemIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (itemIds.length === 0) return out;
  const appDb = getDb();
  const inList = sql.join(itemIds.map((id) => sql`${id}`), sql`, `);
  const result = (await appDb.execute(sql`
    SELECT elem->>'item_id' AS item_id, MAX(${ordersTable.dateCreated}) AS last_sale
    FROM ${ordersTable}
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(${ordersTable.itemsJson}) = 'array' THEN ${ordersTable.itemsJson}
        ELSE '[]'::jsonb
      END
    ) AS elem
    WHERE ${ordersTable.accountId} = ${accountId}
      AND elem->>'item_id' IN (${inList})
    GROUP BY 1
  `)) as { rows?: Array<{ item_id: string; last_sale: string | Date | null }> };

  for (const row of result.rows ?? []) {
    if (!row.item_id || !row.last_sale) continue;
    const date = row.last_sale instanceof Date ? row.last_sale : new Date(row.last_sale);
    if (!Number.isNaN(date.getTime())) out.set(row.item_id, date);
  }
  return out;
}

async function syncAccount(
  accountId: string,
  mlUserId: string,
  nomeLoja: string,
  alreadyListed: string[],
): Promise<void> {
  const [infractions, underReview] = await Promise.all([
    safeMl("infractions", accountId, () => listInfractionProblems(accountId, mlUserId), new Map<string, string[]>()),
    safeMl("under_review", accountId, () => listUnderReviewIds(accountId, mlUserId), [] as string[]),
  ]);

  const prioritized = unique([
    ...infractions.keys(),
    ...underReview,
    ...alreadyListed,
  ]).slice(0, MAX_ITEMS_PER_ACCOUNT);

  if (prioritized.length === 0) return;

  const snapshots = await fetchItemSnapshots(accountId, prioritized);
  const performances = await mapPool(prioritized, PERFORMANCE_CONCURRENCY, async (itemId) => ({
    itemId,
    performance: snapshots.get(itemId) ? await fetchPerformance(accountId, itemId) : null,
  }));
  const performanceById = new Map(performances.map((row) => [row.itemId, row.performance]));

  const verdicts = new Map<string, ItemVerdict>();
  const criticalIds: string[] = [];

  for (const itemId of prioritized) {
    const item = snapshots.get(itemId);
    if (item === null) {
      verdicts.set(itemId, "clear");
      continue;
    }
    if (!item) {
      verdicts.set(itemId, "unknown");
      continue;
    }

    const fromThisAccount = infractions.has(itemId) || underReview.includes(itemId);
    const ownsItem = item.seller_id != null
      ? String(item.seller_id) === mlUserId
      : fromThisAccount;
    if (!ownsItem) {
      verdicts.set(itemId, "unknown");
      continue;
    }

    const infractionLines = infractions.get(itemId) ?? [];
    const performance = performanceById.get(itemId) ?? null;
    const quality = pendingPerformance(performance);
    const level = (quality.level ?? "").toLowerCase();
    const underReviewStatus = item.status === "under_review";
    const isCritical =
      infractionLines.length > 0 ||
      underReviewStatus ||
      quality.pendingCount > 0 ||
      BAD_PERFORMANCE_LEVELS.has(level);

    if (isCritical) {
      verdicts.set(itemId, "critical");
      criticalIds.push(itemId);
      continue;
    }

    if (performance == null && infractionLines.length === 0 && !underReviewStatus) {
      verdicts.set(itemId, "unknown");
      continue;
    }

    verdicts.set(itemId, "clear");
  }

  const diagDb = getDiagnosticoDb();
  const previousRows = criticalIds.length
    ? await diagDb
        .select()
        .from(mlDiagnosticoCriticoTable)
        .where(inArray(mlDiagnosticoCriticoTable.itemId, criticalIds))
    : [];
  const previousById = new Map(previousRows.map((row) => [row.itemId, row]));
  const sales = await lastSaleByItem(accountId, criticalIds);
  const now = new Date();

  for (const itemId of criticalIds) {
    const item = snapshots.get(itemId);
    if (!item) continue;
    const infractionLines = infractions.get(itemId) ?? [];
    const quality = pendingPerformance(performanceById.get(itemId) ?? null);
    const problemas = unique([...infractionLines, ...quality.lines]).slice(0, 30);
    const lastSale = sales.get(itemId);
    const diasSemVenda = lastSale
      ? daysSince(lastSale)
      : item.sold_quantity === 0 && item.date_created
        ? daysSince(item.date_created)
        : previousById.get(itemId)?.diasSemVenda ?? null;

    await diagDb
      .insert(mlDiagnosticoCriticoTable)
      .values({
        itemId,
        nomeLoja,
        titulo: item.title,
        problemas,
        permalink: item.permalink,
        statusMl: item.status,
        tipoEnvio: tipoEnvioLabel(item),
        faltasRelevancia: String(quality.pendingCount),
        diasSemVenda,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mlDiagnosticoCriticoTable.itemId,
        set: {
          nomeLoja,
          titulo: item.title,
          problemas,
          permalink: item.permalink,
          statusMl: item.status,
          tipoEnvio: tipoEnvioLabel(item),
          faltasRelevancia: String(quality.pendingCount),
          diasSemVenda,
          updatedAt: now,
        },
      });
  }

  const clearIds = prioritized.filter((itemId) => verdicts.get(itemId) === "clear");
  if (clearIds.length > 0) {
    await diagDb
      .delete(mlDiagnosticoCriticoTable)
      .where(inArray(mlDiagnosticoCriticoTable.itemId, clearIds));
  }
}

export async function syncCriticalAdsFromMercadoLivre(userId: string): Promise<void> {
  const appDb = getDb();
  const accounts = await appDb
    .select()
    .from(accountsTable)
    .where(
      and(
        eq(accountsTable.userId, userId),
        eq(accountsTable.platform, "mercadolivre"),
        eq(accountsTable.isActive, true),
      ),
    );

  const connected = accounts.filter((account) => account.mlUserId);
  if (connected.length === 0) {
    throw new Error("Nenhuma conta do Mercado Livre conectada");
  }

  const alreadyListed = await listedDiagnosticIds();
  const failures: string[] = [];
  for (const account of connected) {
    try {
      await syncAccount(
        account.id,
        account.mlUserId!,
        account.mlNickname ?? account.mlEmail ?? account.mlUserId!,
        alreadyListed,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao consultar o Mercado Livre";
      failures.push(message);
      logger.error({ err, accountId: account.id }, "critical ads ML sync failed");
    }
  }

  if (failures.length === connected.length) {
    throw new Error(failures[0] ?? "Falha ao atualizar anúncios no Mercado Livre");
  }
}
