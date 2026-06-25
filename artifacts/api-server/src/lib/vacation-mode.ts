import { eq, and, inArray, sql } from "drizzle-orm";
import { productsTable, profilesTable, accountsTable } from "@workspace/db/schema";
import { getDb } from "./db";
import { getUserAccountIds } from "./account-scope";
import {
  crossDockingSqlCondition,
  crossDockingReactivatableSqlCondition,
  setProductListingStatus,
} from "./cross-docking-listings";

const CHUNK_SIZE = 3;

export type VacationModeError = {
  productId: string;
  mlItemId: string;
  message: string;
};

export type VacationModeState = {
  enabled: boolean;
  activeCrossDockingCount: number;
  /** Cross-docking pausados com estoque — elegíveis para reativação. */
  pausedCrossDockingCount: number;
};

export type VacationModeResult = VacationModeState & {
  paused?: number;
  activated?: number;
  /** Pausados sem estoque, ignorados na reativação. */
  skipped?: number;
  failed: number;
  errors: VacationModeError[];
};

async function countCrossDockingActive(accountIds: string[]): Promise<number> {
  const db = getDb();
  if (accountIds.length === 0) return 0;

  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(productsTable)
    .where(
      and(
        inArray(productsTable.accountId, accountIds),
        eq(productsTable.status, "active"),
        crossDockingSqlCondition(),
      ),
    );

  return row?.count ?? 0;
}

async function countReactivatablePausedCrossDocking(accountIds: string[]): Promise<number> {
  const db = getDb();
  if (accountIds.length === 0) return 0;

  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(productsTable)
    .where(
      and(inArray(productsTable.accountId, accountIds), crossDockingReactivatableSqlCondition()),
    );

  return row?.count ?? 0;
}

async function countSkippedPausedCrossDocking(accountIds: string[]): Promise<number> {
  const db = getDb();
  if (accountIds.length === 0) return 0;

  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(productsTable)
    .where(
      and(
        inArray(productsTable.accountId, accountIds),
        eq(productsTable.status, "paused"),
        crossDockingSqlCondition(),
        sql`${productsTable.availableQuantity} <= 0`,
      ),
    );

  return row?.count ?? 0;
}

export async function getVacationModeState(userId: string): Promise<VacationModeState> {
  const db = getDb();
  const accountIds = await getUserAccountIds(userId);

  const [profile] = await db
    .select({ vacationModeEnabled: profilesTable.vacationModeEnabled })
    .from(profilesTable)
    .where(eq(profilesTable.id, userId));

  const [activeCrossDockingCount, pausedCrossDockingCount] = await Promise.all([
    countCrossDockingActive(accountIds),
    countReactivatablePausedCrossDocking(accountIds),
  ]);

  return {
    enabled: profile?.vacationModeEnabled ?? false,
    activeCrossDockingCount,
    pausedCrossDockingCount,
  };
}

async function bulkPauseActiveCrossDocking(
  userId: string,
): Promise<{ succeeded: number; failed: number; errors: VacationModeError[] }> {
  const db = getDb();
  const accountIds = await getUserAccountIds(userId);
  if (accountIds.length === 0) {
    return { succeeded: 0, failed: 0, errors: [] };
  }

  const products = await db
    .select({
      id: productsTable.id,
      accountId: productsTable.accountId,
      mlItemId: productsTable.mlItemId,
    })
    .from(productsTable)
    .where(
      and(
        inArray(productsTable.accountId, accountIds),
        eq(productsTable.status, "active"),
        crossDockingSqlCondition(),
      ),
    );

  return bulkSetStatus(products, "paused");
}

async function bulkReactivatePausedCrossDocking(
  userId: string,
): Promise<{ succeeded: number; failed: number; errors: VacationModeError[]; skipped: number }> {
  const accountIds = await getUserAccountIds(userId);
  const skipped = await countSkippedPausedCrossDocking(accountIds);

  if (accountIds.length === 0) {
    return { succeeded: 0, failed: 0, errors: [], skipped: 0 };
  }

  const db = getDb();
  const products = await db
    .select({
      id: productsTable.id,
      accountId: productsTable.accountId,
      mlItemId: productsTable.mlItemId,
    })
    .from(productsTable)
    .where(and(inArray(productsTable.accountId, accountIds), crossDockingReactivatableSqlCondition()));

  const result = await bulkSetStatus(products, "active");
  return { ...result, skipped };
}

async function bulkSetStatus(
  products: Array<{ id: string; accountId: string; mlItemId: string }>,
  targetStatus: "active" | "paused",
): Promise<{ succeeded: number; failed: number; errors: VacationModeError[] }> {
  const errors: VacationModeError[] = [];
  let succeeded = 0;

  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (product) => {
        try {
          await setProductListingStatus(product, targetStatus);
          succeeded++;
        } catch (err) {
          errors.push({
            productId: product.id,
            mlItemId: product.mlItemId,
            message: err instanceof Error ? err.message : "Erro desconhecido",
          });
        }
      }),
    );
  }

  return { succeeded, failed: errors.length, errors };
}

export async function setVacationMode(userId: string, enabled: boolean): Promise<VacationModeResult> {
  const db = getDb();

  if (enabled) {
    await db
      .update(profilesTable)
      .set({ vacationModeEnabled: true, updatedAt: new Date() })
      .where(eq(profilesTable.id, userId));

    const { succeeded, failed, errors } = await bulkPauseActiveCrossDocking(userId);
    const state = await getVacationModeState(userId);

    return {
      ...state,
      paused: succeeded,
      failed,
      errors,
    };
  }

  await db
    .update(profilesTable)
    .set({ vacationModeEnabled: false, updatedAt: new Date() })
    .where(eq(profilesTable.id, userId));

  const { succeeded, failed, errors, skipped } = await bulkReactivatePausedCrossDocking(userId);
  const state = await getVacationModeState(userId);

  return {
    ...state,
    enabled: false,
    activated: succeeded,
    skipped,
    failed,
    errors,
  };
}

export async function isVacationModeEnabled(userId: string): Promise<boolean> {
  const db = getDb();
  const [profile] = await db
    .select({ vacationModeEnabled: profilesTable.vacationModeEnabled })
    .from(profilesTable)
    .where(eq(profilesTable.id, userId));
  return profile?.vacationModeEnabled ?? false;
}

export async function isVacationModeEnabledForAccount(accountId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ vacationModeEnabled: profilesTable.vacationModeEnabled })
    .from(accountsTable)
    .innerJoin(profilesTable, eq(accountsTable.userId, profilesTable.id))
    .where(eq(accountsTable.id, accountId));
  return row?.vacationModeEnabled ?? false;
}
