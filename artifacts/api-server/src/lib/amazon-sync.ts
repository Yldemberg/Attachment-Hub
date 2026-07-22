import { getDb } from "./db";
import { accountsTable, notificationsTable, productsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  resolveAmazonSellerId,
  searchListingsItems,
} from "./amazon";
import { upsertProductFromAmazonListing } from "./amazon-listings";
import { logger } from "./logger";

export async function syncAmazonAccount(accountId: string, userId: string): Promise<void> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(
      and(
        eq(accountsTable.id, accountId),
        eq(accountsTable.userId, userId),
        eq(accountsTable.platform, "amazon"),
      ),
    );

  if (!account) {
    throw new Error("Amazon account not found");
  }

  const sellerId = resolveAmazonSellerId(account);
  const marketplaceId =
    account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  logger.info({ accountId, sellerId, marketplaceId }, "Starting Amazon account sync");

  let nextToken: string | undefined;
  let synced = 0;
  const seenSkus = new Set<string>();

  do {
    const page = await searchListingsItems(accountId, sellerId, marketplaceId, nextToken);
    for (const item of page.items ?? []) {
      if (!item.sku) continue;
      seenSkus.add(item.sku);
      await upsertProductFromAmazonListing(accountId, item);
      synced += 1;
    }
    nextToken = page.pagination?.nextToken;
  } while (nextToken);

  // Soft: leave products not returned (Amazon search can paginate incompletely); do not delete.

  await db
    .update(accountsTable)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(accountsTable.id, accountId));

  await db.insert(notificationsTable).values({
    userId,
    accountId,
    type: "sync_complete",
    title: "Sincronização Amazon concluída",
    message: `Conta ${account.amazonStoreName ?? "Amazon"}: ${synced} anúncio(s) sincronizado(s).`,
    isRead: false,
    resourceType: "account",
    resourceId: accountId,
  });

  logger.info({ accountId, synced, uniqueSkus: seenSkus.size }, "Amazon account sync complete");
}
