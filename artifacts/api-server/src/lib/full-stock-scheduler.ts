import { eq } from "drizzle-orm";
import { productsTable } from "@workspace/db/schema";
import { getDb } from "./db";
import { syncFullStockForAccount } from "./full-sync";
import { logger } from "./logger";

export type FullStockSyncJobResult = {
  accounts: number;
  synced: number;
  failed: number;
  skipped: number;
};

/**
 * Varre contas com anúncios Full e atualiza full_stock_snapshot sequencialmente.
 */
export async function runFullStockSyncJob(): Promise<FullStockSyncJobResult> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ accountId: productsTable.accountId })
    .from(productsTable)
    .where(eq(productsTable.isFull, true));

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let accounts = 0;

  for (const row of rows) {
    accounts += 1;
    try {
      const result = await syncFullStockForAccount(row.accountId);
      synced += result.synced;
      failed += result.failed;
      skipped += result.skipped;
    } catch (err) {
      failed += 1;
      logger.error({ err, accountId: row.accountId }, "Full stock sync job account failed");
    }
  }

  return { accounts, synced, failed, skipped };
}

let stockSyncInterval: ReturnType<typeof setInterval> | null = null;

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export function startFullStockSyncScheduler(): void {
  if (stockSyncInterval) return;
  const raw = process.env.FULL_STOCK_SYNC_INTERVAL_MS?.trim();
  const intervalMs = raw ? Number(raw) : DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    logger.warn({ intervalMs }, "Invalid FULL_STOCK_SYNC_INTERVAL_MS — scheduler not started");
    return;
  }

  const tick = async () => {
    try {
      const result = await runFullStockSyncJob();
      if (result.accounts > 0) {
        logger.info(result, "Full stock sync job completed");
      }
    } catch (err) {
      logger.error({ err }, "Full stock sync job failed");
    }
  };

  // Primeira execução após 3 min (deixar o server aquecer; após alertas)
  setTimeout(() => {
    void tick();
  }, 180_000).unref();

  stockSyncInterval = setInterval(() => {
    void tick();
  }, intervalMs);
  stockSyncInterval.unref();

  logger.info({ intervalMs }, "Full stock sync scheduler started");
}
