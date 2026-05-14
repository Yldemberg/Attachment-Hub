import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { productsTable, accountsTable } from "@workspace/db/schema";
import { eq, and, or, inArray, lt, sql, gt, isNotNull, asc } from "drizzle-orm";
import {
  fetchMlItemPrices,
  ml,
  putMlItemStockForSellerSku,
  resolveProductPricesFromMlPricesApi,
  MlItem,
} from "../lib/mercadolivre";
import { upsertSkuMandateQuantity } from "../lib/sku-mandate";

const router = Router();
const auth = [requireAuth, requireActivePlan];

type ProductRow = typeof productsTable.$inferSelect;

/** Live GET /items/{id}/prices for the product list UI only (chunked to reduce ML rate limits). */
async function enrichRowsWithMlItemPrices(
  rows: ProductRow[],
  log: { warn: (obj: Record<string, unknown>, msg: string) => void },
): Promise<Array<{ row: ProductRow; mlAmount: number | null; mlRegularAmount: number | null }>> {
  const chunkSize = 5;
  const out: Array<{ row: ProductRow; mlAmount: number | null; mlRegularAmount: number | null }> = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const part = await Promise.all(
      chunk.map(async (p) => {
        let mlAmount: number | null = null;
        let mlRegularAmount: number | null = null;
        try {
          const data = await fetchMlItemPrices(p.accountId, p.mlItemId);
          const r = resolveProductPricesFromMlPricesApi(data);
          if (r) {
            mlAmount = Number(r.amount);
            mlRegularAmount = r.regularAmount != null ? Number(r.regularAmount) : null;
          }
        } catch (err) {
          log.warn({ err, mlItemId: p.mlItemId }, "GET /items/.../prices failed for product list");
        }
        return { row: p, mlAmount, mlRegularAmount };
      }),
    );
    out.push(...part);
  }
  return out;
}

/** Live GET /items/{id} for catalog_listing + video_id enrichment (chunked, one-by-one, lazy DB update). */
async function enrichRowsWithCatalogListing(
  enriched: Array<{ row: ProductRow; mlAmount: number | null; mlRegularAmount: number | null }>,
  log: { warn: (obj: Record<string, unknown>, msg: string) => void },
): Promise<
  Array<{
    row: ProductRow;
    mlAmount: number | null;
    mlRegularAmount: number | null;
    liveCatalogListing: boolean;
    videoId: string | null;
  }>
> {
  const chunkSize = 5;
  const db = getDb();
  const out: Array<{
    row: ProductRow;
    mlAmount: number | null;
    mlRegularAmount: number | null;
    liveCatalogListing: boolean;
    videoId: string | null;
  }> = [];

  for (let i = 0; i < enriched.length; i += chunkSize) {
    const chunk = enriched.slice(i, i + chunkSize);
    const part = await Promise.all(
      chunk.map(async ({ row: p, mlAmount, mlRegularAmount }) => {
        let liveCatalogListing = p.catalogListing;
        let videoId: string | null = null;
        try {
          const item = await ml.get<MlItem>(p.accountId, `/items/${encodeURIComponent(p.mlItemId)}`);
          const apiValue = item.catalog_listing === true;
          liveCatalogListing = apiValue;
          const vid = item.video_id;
          if (vid != null && String(vid).length > 0) {
            videoId = String(vid);
          }
          if (apiValue !== p.catalogListing) {
            db.update(productsTable)
              .set({ catalogListing: apiValue, updatedAt: new Date() })
              .where(eq(productsTable.id, p.id))
              .then(() => {})
              .catch((err: unknown) => {
                log.warn({ err, mlItemId: p.mlItemId }, "lazy catalog_listing DB update failed");
              });
          }
        } catch (err) {
          log.warn({ err, mlItemId: p.mlItemId }, "GET /items/{id} failed for catalog_listing enrichment");
        }
        return { row: p, mlAmount, mlRegularAmount, liveCatalogListing, videoId };
      }),
    );
    out.push(...part);
  }
  return out;
}

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

/** Escape `%`, `_` and `\` for use in ILIKE … ESCAPE '\\' (PostgreSQL). */
function escapeIlikePattern(token: string): string {
  return token.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function isPickerMode(raw: string | string[] | undefined): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "1" || v === "true" || v === "yes";
}

router.get("/products", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const q = req.query as Record<string, string | string[] | undefined>;
    const first = (v: string | string[] | undefined): string | undefined =>
      v == null ? undefined : Array.isArray(v) ? v[0] : v;
    const account_id = first(q.account_id);
    const listing_filter = first(q.listing_filter);
    const status = first(q.status);
    const search = first(q.search);
    const page = first(q.page) ?? "1";
    const limit = first(q.limit) ?? "20";
    const picker = isPickerMode(q.picker);
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = picker
      ? Math.min(5000, Math.max(1, parseInt(String(limit), 10) || 5000))
      : Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const accountIds = await getUserAccountIds(req.user!.id, account_id);
    if (accountIds.length === 0) {
      res.json({ data: [], pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 } });
      return;
    }

    const conditions = [inArray(productsTable.accountId, accountIds)];

    const filterKey = listing_filter || status;
    if (filterKey === "active" || filterKey === "paused" || filterKey === "closed" || filterKey === "under_review") {
      conditions.push(eq(productsTable.status, filterKey));
    } else if (filterKey === "flex") {
      conditions.push(or(eq(productsTable.logisticType, "self_service"), eq(productsTable.isFlex, true))!);
    } else if (filterKey === "full") {
      conditions.push(or(eq(productsTable.logisticType, "fulfillment"), eq(productsTable.isFull, true))!);
    } else if (filterKey === "catalog") {
      conditions.push(eq(productsTable.catalogListing, true));
    } else if (filterKey === "promo") {
      conditions.push(
        or(
          and(
            isNotNull(productsTable.regularAmount),
            isNotNull(productsTable.amount),
            gt(productsTable.regularAmount, productsTable.amount),
          )!,
          and(
            isNotNull(productsTable.originalPrice),
            isNotNull(productsTable.price),
            gt(productsTable.originalPrice, productsTable.price),
          )!,
        )!,
      );
    }

    if (!picker && search && String(search).trim()) {
      const tokens = String(search)
        .trim()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      for (const token of tokens) {
        const pat = `%${escapeIlikePattern(token)}%`;
        conditions.push(
          sql`(
            coalesce(${productsTable.title}, '') ILIKE ${pat} ESCAPE '\\'
            OR coalesce(${productsTable.sku}, '') ILIKE ${pat} ESCAPE '\\'
            OR ${productsTable.mlItemId} ILIKE ${pat} ESCAPE '\\'
            OR coalesce(${productsTable.variationsJson}::text, '') ILIKE ${pat} ESCAPE '\\'
          )`,
        );
      }
    }

    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(productsTable).where(where),
      db
        .select()
        .from(productsTable)
        .where(where)
        .orderBy(asc(productsTable.sku), asc(productsTable.mlItemId))
        .limit(limitNum)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    const accounts = await db
      .select({ id: accountsTable.id, mlNickname: accountsTable.mlNickname, mlUserId: accountsTable.mlUserId })
      .from(accountsTable)
      .where(inArray(accountsTable.id, accountIds));
    const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

    if (picker) {
      res.json({
        data: rows.map((p) => ({
          ...p,
          price: p.price !== null ? Number(p.price) : null,
          originalPrice: p.originalPrice !== null ? Number(p.originalPrice) : null,
          amount: p.amount !== null ? Number(p.amount) : null,
          regularAmount: p.regularAmount !== null ? Number(p.regularAmount) : null,
          catalogListing: p.catalogListing,
          videoId: null,
          account: accountMap[p.accountId] ?? null,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      });
      return;
    }

    const priceEnriched = await enrichRowsWithMlItemPrices(rows, req.log);
    const enriched = await enrichRowsWithCatalogListing(priceEnriched, req.log);

    res.json({
      data: enriched.map(({ row: p, mlAmount, mlRegularAmount, liveCatalogListing, videoId }) => ({
        ...p,
        price: p.price !== null ? Number(p.price) : null,
        originalPrice: p.originalPrice !== null ? Number(p.originalPrice) : null,
        amount: mlAmount,
        regularAmount: mlRegularAmount,
        catalogListing: liveCatalogListing,
        videoId,
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

router.patch("/products/:id/status", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { status } = req.body as { status?: string };

    if (status !== "active" && status !== "paused") {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Informe status active ou paused" },
      });
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

    if (product.status !== "active" && product.status !== "paused") {
      res.status(400).json({
        error: {
          code: "INVALID_STATUS",
          message: "Só é possível ativar ou pausar anúncios ativos ou pausados",
        },
      });
      return;
    }

    await ml.put(product.accountId, `/items/${encodeURIComponent(product.mlItemId)}`, { status });

    await db
      .update(productsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(productsTable.id, product.id));

    res.json({ success: true, productId: product.id, status });
  } catch (err) {
    req.log.error({ err }, "Failed to update product listing status");
    const msg = err instanceof Error ? err.message : "Internal server error";
    if (msg.startsWith("ML API")) {
      res.status(502).json({ error: { code: "ML_API_ERROR", message: msg } });
      return;
    }
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

    if (product.sku) {
      await putMlItemStockForSellerSku(product.accountId, product.mlItemId, product.sku, quantity);
    } else {
      await ml.put(product.accountId, `/items/${encodeURIComponent(product.mlItemId)}`, { available_quantity: quantity });
    }
    const after = await ml.get<MlItem>(product.accountId, `/items/${encodeURIComponent(product.mlItemId)}`);
    await db
      .update(productsTable)
      .set({ availableQuantity: after.available_quantity })
      .where(eq(productsTable.id, product.id));

    if (product.sku) {
      await upsertSkuMandateQuantity(req.user!.id, product.sku, quantity);
    }

    res.json({ success: true, productId: product.id, quantity: after.available_quantity });
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
        await putMlItemStockForSellerSku(product.accountId, product.mlItemId, req.params.sku as string, quantity);
        const after = await ml.get<MlItem>(product.accountId, `/items/${encodeURIComponent(product.mlItemId)}`);
        await db
          .update(productsTable)
          .set({ availableQuantity: after.available_quantity })
          .where(eq(productsTable.id, product.id));
        updated++;
        results.push({ productId: product.id, mlItemId: product.mlItemId, success: true, reason: null });
      } catch (err) {
        failed++;
        results.push({ productId: product.id, mlItemId: product.mlItemId, success: false, reason: (err as Error).message });
      }
    }

    if (updated > 0) {
      await upsertSkuMandateQuantity(req.user!.id, req.params.sku as string, quantity);
    }

    res.json({ sku: req.params.sku, updated, skipped, failed, results });
  } catch (err) {
    req.log.error({ err }, "Failed to update stock");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
