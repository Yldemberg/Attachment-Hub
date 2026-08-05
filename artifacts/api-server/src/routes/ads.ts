import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { accountsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { fetchAdsOverviewAggregated } from "../lib/ml-product-ads";

const router = Router();
const auth = [requireAuth, requireActivePlan];

async function getUserMlAccountIds(userId: string, filterAccountId?: string): Promise<string[]> {
  const db = getDb();
  const conditions = [eq(accountsTable.userId, userId), eq(accountsTable.isActive, true)];
  if (filterAccountId) conditions.push(eq(accountsTable.id, filterAccountId));

  const accounts = await db
    .select({
      id: accountsTable.id,
      platform: accountsTable.platform,
      mlUserId: accountsTable.mlUserId,
    })
    .from(accountsTable)
    .where(and(...conditions));

  return accounts
    .filter((a) => a.platform !== "amazon" && Boolean(a.mlUserId))
    .map((a) => a.id);
}

router.get("/ads/overview", ...auth, async (req, res) => {
  try {
    const { account_id, date_from, date_to } = req.query as Record<string, string>;
    const accountIds = await getUserMlAccountIds(req.user!.id, account_id);
    const data = await fetchAdsOverviewAggregated(accountIds, date_from, date_to);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to get ads overview");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
