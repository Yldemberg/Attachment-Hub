import { eq, and, inArray, sql } from "drizzle-orm";
import {
  productsTable,
  profilesTable,
  accountsTable,
  vacationModePausesTable,
} from "@workspace/db/schema";
import { getDb } from "./db";
import { getUserAccountIds } from "./account-scope";
import {
  crossDockingSqlCondition,
  isReactivatableListing,
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
  /** Pausados pelo Modo Férias (snapshot) elegíveis para reativação. */
  pausedCrossDockingCount: number;
};

export type VacationModeResult = VacationModeState & {
  paused?: number;
  activated?: number;
  /** Snapshot ignorado na reativação (sem estoque ou não mais pausados). */
  skipped?: number;
  failed: number;
  errors: VacationModeError[];
};

type SnapshotProductRow = {
  id: string;
  accountId: string;
  mlItemId: string;
  status: string | null;
  availableQuantity: number | null;
  variationsJson: unknown;
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

async function loadSnapshotProducts(userId: string): Promise<SnapshotProductRow[]> {
  const db = getDb();
  return db
    .select({
      id: productsTable.id,
      accountId: productsTable.accountId,
      mlItemId: productsTable.mlItemId,
      status: productsTable.status,
      availableQuantity: productsTable.availableQuantity,
      variationsJson: productsTable.variationsJson,
    })
    .from(vacationModePausesTable)
    .innerJoin(productsTable, eq(vacationModePausesTable.productId, productsTable.id))
    .where(eq(vacationModePausesTable.userId, userId));
}

async function countReactivatableSnapshot(userId: string): Promise<number> {
  const rows = await loadSnapshotProducts(userId);
  return rows.filter(isReactivatableListing).length;
}

export async function clearVacationModePauses(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(vacationModePausesTable).where(eq(vacationModePausesTable.userId, userId));
}

export async function recordVacationModePause(userId: string, productId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(vacationModePausesTable)
    .values({ userId, productId })
    .onConflictDoNothing({
      target: [vacationModePausesTable.userId, vacationModePausesTable.productId],
    });
}

async function removeVacationModePause(userId: string, productId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(vacationModePausesTable)
    .where(
      and(
        eq(vacationModePausesTable.userId, userId),
        eq(vacationModePausesTable.productId, productId),
      ),
    );
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
    countReactivatableSnapshot(userId),
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

  await clearVacationModePauses(userId);

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

  const errors: VacationModeError[] = [];
  let succeeded = 0;

  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (product) => {
        try {
          await setProductListingStatus(product, "paused");
          await recordVacationModePause(userId, product.id);
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

async function bulkReactivateSnapshot(
  userId: string,
): Promise<{ succeeded: number; failed: number; errors: VacationModeError[]; skipped: number }> {
  const snapshotRows = await loadSnapshotProducts(userId);
  const toActivate = snapshotRows.filter(isReactivatableListing);
  const skipped = snapshotRows.length - toActivate.length;

  const errors: VacationModeError[] = [];
  let succeeded = 0;

  for (let i = 0; i < toActivate.length; i += CHUNK_SIZE) {
    const chunk = toActivate.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (product) => {
        try {
          await setProductListingStatus(product, "active");
          await removeVacationModePause(userId, product.id);
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

  await clearVacationModePauses(userId);

  return { succeeded, failed: errors.length, errors, skipped };
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

  const { succeeded, failed, errors, skipped } = await bulkReactivateSnapshot(userId);
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

export async function getUserIdForAccount(accountId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ userId: accountsTable.userId })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  return row?.userId ?? null;
}
