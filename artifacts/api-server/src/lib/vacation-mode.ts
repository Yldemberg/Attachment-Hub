import { eq, and, inArray } from "drizzle-orm";
import {
  productsTable,
  profilesTable,
  accountsTable,
  vacationModePausesTable,
} from "@workspace/db/schema";
import { getDb } from "./db";
import { getUserAccountIds } from "./account-scope";
import { isCrossDockingListing } from "./cross-docking-listings";
import { changeProductListingStatus } from "./product-listing-status";

export type VacationModeError = {
  productId: string;
  mlItemId: string;
  message: string;
};

export type VacationModeState = {
  enabled: boolean;
  activeCrossDockingCount: number;
  /** Pausados pelo Modo Férias (snapshot) ainda pausados — elegíveis para reativação. */
  pausedCrossDockingCount: number;
};

export type VacationModeResult = VacationModeState & {
  paused?: number;
  activated?: number;
  skipped?: number;
  failed: number;
  errors: VacationModeError[];
};

type SnapshotProductRow = {
  id: string;
  mlItemId: string;
  status: string | null;
};

async function loadActiveCrossDocking(accountIds: string[]) {
  if (accountIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(productsTable)
    .where(
      and(inArray(productsTable.accountId, accountIds), eq(productsTable.status, "active")),
    );

  return rows.filter(isCrossDockingListing);
}

async function loadSnapshotProducts(userId: string): Promise<SnapshotProductRow[]> {
  const db = getDb();
  return db
    .select({
      id: productsTable.id,
      mlItemId: productsTable.mlItemId,
      status: productsTable.status,
    })
    .from(vacationModePausesTable)
    .innerJoin(productsTable, eq(vacationModePausesTable.productId, productsTable.id))
    .where(eq(vacationModePausesTable.userId, userId));
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

export async function getVacationModeState(userId: string): Promise<VacationModeState> {
  const db = getDb();
  const accountIds = await getUserAccountIds(userId);

  const [profile] = await db
    .select({ vacationModeEnabled: profilesTable.vacationModeEnabled })
    .from(profilesTable)
    .where(eq(profilesTable.id, userId));

  const [activeProducts, snapshotRows] = await Promise.all([
    loadActiveCrossDocking(accountIds),
    loadSnapshotProducts(userId),
  ]);

  return {
    enabled: profile?.vacationModeEnabled ?? false,
    activeCrossDockingCount: activeProducts.length,
    pausedCrossDockingCount: snapshotRows.filter((p) => p.status === "paused").length,
  };
}

async function bulkPauseActiveCrossDocking(
  userId: string,
): Promise<{ succeeded: number; failed: number; errors: VacationModeError[] }> {
  const accountIds = await getUserAccountIds(userId);
  if (accountIds.length === 0) {
    return { succeeded: 0, failed: 0, errors: [] };
  }

  await clearVacationModePauses(userId);

  const products = await loadActiveCrossDocking(accountIds);
  const errors: VacationModeError[] = [];
  let succeeded = 0;

  for (const product of products) {
    try {
      await changeProductListingStatus(userId, product.id, "paused");
      await recordVacationModePause(userId, product.id);
      succeeded++;
    } catch (err) {
      errors.push({
        productId: product.id,
        mlItemId: product.mlItemId,
        message: err instanceof Error ? err.message : "Erro desconhecido",
      });
    }
  }

  return { succeeded, failed: errors.length, errors };
}

async function bulkReactivateSnapshot(
  userId: string,
): Promise<{ succeeded: number; failed: number; errors: VacationModeError[]; skipped: number }> {
  const snapshotRows = await loadSnapshotProducts(userId);
  const toActivate = snapshotRows.filter((p) => p.status === "paused");
  const skipped = snapshotRows.length - toActivate.length;

  const errors: VacationModeError[] = [];
  let succeeded = 0;

  for (const product of toActivate) {
    try {
      await changeProductListingStatus(userId, product.id, "active");
      succeeded++;
    } catch (err) {
      errors.push({
        productId: product.id,
        mlItemId: product.mlItemId,
        message: err instanceof Error ? err.message : "Erro desconhecido",
      });
    }
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
