import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { productsTable, accountsTable } from "@workspace/db/schema";
import { eq, and, or, inArray, lt, ilike, sql } from "drizzle-orm";
import { ml } from "../lib/mercadolivre";

const router = Router();
const auth = [requireAuth, requireActivePlan];

async function getUserAccountIds(userId: string, filterAccountId?: string): Promise<string[]> {
  const db = getDb();
  const conditions = [eq(accountsTable.userId, userId), eq(accountsTable.isActive, true)];
  if (filterAccountId) conditions.push(eq(accountsTable.id, filterAccountId));
  const accounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(...conditions));
  return accounts.map((a) => a.id);
}

router.get("/products", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id, status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const accountIds = await getUserAccountIds(req.user!.id, account_id);
    if (accountIds.length === 0) {
      res.json({ data: [], pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 } });
      return;
    }

    const conditions = [inArray(productsTable.accountId, accountIds)];
    if (status) conditions.push(eq(productsTable.status, status));
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(productsTable.title, pattern),
          ilike(productsTable.sku, pattern),
          sql`coalesce(${productsTable.variationsJson}::text, '') ilike ${pattern}`,
        )!,
      );
    }

    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(productsTable).where(where),
      db.select().from(productsTable).where(where).limit(limitNum).offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    const accounts = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(inArray(accountsTable.id, accountIds));
    const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

    res.json({
      data: rows.map((p) => ({
        ...p,
        price: p.price !== null ? Number(p.price) : null,
        originalPrice: p.originalPrice !== null ? Number(p.originalPrice) : null,
        account: accountMap[p.accountId] ?? null,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list products");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/products/low-stock", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { account_id, threshold = "5" } = req.query as Record<string, string>;
    const thresholdNum = parseInt(threshold);

    const accountIds = await getUserAccountIds(req.user!.id, account_id);
    if (accountIds.length === 0) {
      res.json({ data: [] });
      return;
    }

    const rows = await db
      .select()
      .from(productsTable)
      .where(and(inArray(productsTable.accountId, accountIds), lt(productsTable.availableQuantity, thresholdNum)));

    const accounts = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(inArray(accountsTable.id, accountIds));
    const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

    res.json({
      data: rows.map((p) => ({
        ...p,
        price: p.price !== null ? Number(p.price) : null,
        originalPrice: p.originalPrice !== null ? Number(p.originalPrice) : null,
        account: accountMap[p.accountId] ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get low stock products");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.get("/products/:id", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }

    const [product] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, req.params.id as string), inArray(productsTable.accountId, accountIds)));

    if (!product) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }

    const [account] = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(eq(accountsTable.id, product.accountId));

    res.json({
      ...product,
      price: product.price !== null ? Number(product.price) : null,
      originalPrice: product.originalPrice !== null ? Number(product.originalPrice) : null,
      account: account ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get product");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.patch("/products/:id/stock", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { quantity } = req.body as { quantity: number };

    if (typeof quantity !== "number" || quantity < 0) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid quantity" } });
      return;
    }

    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }

    const [product] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, req.params.id as string), inArray(productsTable.accountId, accountIds)));

    if (!product) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }

    if (product.isFull) {
      res.status(400).json({ error: { code: "FULL_ITEM", message: "Estoque FULL é gerenciado pelo armazém do Mercado Livre" } });
      return;
    }

    await ml.put(product.accountId, `/items/${product.mlItemId}`, { available_quantity: quantity });
    await db
      .update(productsTable)
      .set({ availableQuantity: quantity })
      .where(eq(productsTable.id, product.id));

    res.json({ success: true, productId: product.id, quantity });
  } catch (err) {
    req.log.error({ err }, "Failed to update single product stock");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.patch("/products/sku/:sku/stock", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { quantity } = req.body as { quantity: number };
    const { account_id } = req.query as Record<string, string>;

    if (typeof quantity !== "number" || quantity < 0) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid quantity" } });
      return;
    }

    const accountIds = await getUserAccountIds(req.user!.id, account_id);
    if (accountIds.length === 0) {
      res.json({ sku: req.params.sku, updated: 0, skipped: 0, failed: 0, results: [] });
      return;
    }

    const products = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.sku, req.params.sku as string), inArray(productsTable.accountId, accountIds)));

    const results: Array<{ productId: string; mlItemId: string; success: boolean; reason: string | null }> = [];
    let updated = 0, skipped = 0, failed = 0;

    for (const product of products) {
      if (product.isFull) {
        skipped++;
        results.push({ productId: product.id, mlItemId: product.mlItemId, success: false, reason: "FULL (Fulfillment) — stock managed by ML warehouse" });
        continue;
      }

      try {
        await ml.put(product.accountId, `/items/${product.mlItemId}`, { available_quantity: quantity });
        await db
          .update(productsTable)
          .set({ availableQuantity: quantity })
          .where(eq(productsTable.id, product.id));
        updated++;
        results.push({ productId: product.id, mlItemId: product.mlItemId, success: true, reason: null });
      } catch (err) {
        failed++;
        results.push({ productId: product.id, mlItemId: product.mlItemId, success: false, reason: (err as Error).message });
      }
    }

    res.json({ sku: req.params.sku, updated, skipped, failed, results });
  } catch (err) {
    req.log.error({ err }, "Failed to update stock");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
