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
import {
  predictCategory,
  getCategoryAttributes,
  uploadPicture,
  createMlItem,
  updateMlItem,
  closeMlItem,
  upsertProductFromMlItem,
  getMlListingDetail,
  duplicateMlListing,
  MlListingError,
  type CreateMlListingInput,
  type UpdateMlListingInput,
} from "../lib/ml-listings";
import {
  createAmazonListing,
  patchAmazonListingQuantity,
  updateAmazonListing,
  AmazonListingError,
  type CreateAmazonListingInput,
} from "../lib/amazon-listings";
import { upsertSkuMandateQuantity } from "../lib/sku-mandate";
import {
  bulkChangeProductListingStatus,
  changeProductListingStatus,
  ProductListingStatusError,
} from "../lib/product-listing-status";
import {
  startListingPrepareJob,
  getListingPrepareJobForUser,
  publishDraftOnMercadoLivre,
  buildListingPreparedCallbackUrl,
} from "../lib/listing-prepare-jobs";
import { N8nListingError, type N8nListingDraft } from "../lib/n8n-listings";

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
        if (!p.mlItemId) {
          return { row: p, mlAmount, mlRegularAmount };
        }
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
        if (!p.mlItemId) {
          return { row: p, mlAmount, mlRegularAmount, liveCatalogListing, videoId };
        }
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

async function assertUserOwnsAccount(userId: string, accountId: string): Promise<boolean> {
  const ids = await getUserAccountIds(userId, accountId);
  return ids.length > 0;
}

function handleMlListingRouteError(
  err: unknown,
  res: import("express").Response,
  log: { error: (obj: Record<string, unknown>, msg: string) => void },
  context: string,
): void {
  if (err instanceof MlListingError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof AmazonListingError) {
    const status =
      err.code === "NOT_FOUND" ? 404 : err.code === "VALIDATION_ERROR" || err.code === "BAD_REQUEST" ? 400 : 502;
    res.status(status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof N8nListingError) {
    res.status(err.statusCode).json({ error: { code: "N8N_ERROR", message: err.message } });
    return;
  }
  log.error({ err }, context);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}

async function formatProductResponse(product: ProductRow) {
  const db = getDb();
  const [account] = await db
    .select({
      id: accountsTable.id,
      platform: accountsTable.platform,
      mlNickname: accountsTable.mlNickname,
      mlUserId: accountsTable.mlUserId,
      amazonStoreName: accountsTable.amazonStoreName,
      amazonSellerId: accountsTable.amazonSellerId,
    })
    .from(accountsTable)
    .where(eq(accountsTable.id, product.accountId));

  return {
    ...product,
    price: product.price !== null ? Number(product.price) : null,
    originalPrice: product.originalPrice !== null ? Number(product.originalPrice) : null,
    amount: product.amount !== null ? Number(product.amount) : null,
    regularAmount: product.regularAmount !== null ? Number(product.regularAmount) : null,
    account: account ?? null,
  };
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
    } else if (filterKey === "cross") {
      conditions.push(
        and(
          eq(productsTable.isFull, false),
          or(
            eq(productsTable.logisticType, "cross_docking"),
            sql`${productsTable.logisticType} LIKE ${"%cross_docking%"}`,
            eq(productsTable.logisticType, "xd_drop_off"),
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

router.get("/products/categories/predict", ...auth, async (req, res) => {
  try {
    const { account_id, title } = req.query as Record<string, string>;
    if (!account_id || !title?.trim()) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe account_id e title" } });
      return;
    }
    if (!(await assertUserOwnsAccount(req.user!.id, account_id))) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Conta inválida" } });
      return;
    }
    const data = await predictCategory(account_id, title);
    res.json({ data });
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to predict category");
  }
});

router.get("/products/categories/:categoryId/attributes", ...auth, async (req, res) => {
  try {
    const { account_id } = req.query as Record<string, string>;
    const categoryId = req.params.categoryId as string;
    if (!account_id) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe account_id" } });
      return;
    }
    if (!(await assertUserOwnsAccount(req.user!.id, account_id))) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Conta inválida" } });
      return;
    }
    const data = await getCategoryAttributes(account_id, categoryId);
    res.json({ data });
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to get category attributes");
  }
});

router.post("/products/pictures", ...auth, async (req, res) => {
  try {
    const { accountId, imageBase64, mimeType } = req.body as {
      accountId?: string;
      imageBase64?: string;
      mimeType?: string;
    };
    if (!accountId || !imageBase64) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe accountId e imageBase64" } });
      return;
    }
    if (!(await assertUserOwnsAccount(req.user!.id, accountId))) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Conta inválida" } });
      return;
    }
    const result = await uploadPicture(accountId, imageBase64, mimeType ?? "image/jpeg");
    res.json(result);
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to upload picture");
  }
});

router.post("/products/prepare-from-link", ...auth, async (req, res) => {
  try {
    const { accountId, productUrl } = req.body as { accountId?: string; productUrl?: string };
    if (!accountId || !productUrl) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe accountId e productUrl" } });
      return;
    }
    if (!(await assertUserOwnsAccount(req.user!.id, accountId))) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Conta inválida" } });
      return;
    }

    const callbackUrl = buildListingPreparedCallbackUrl(req);
    const result = await startListingPrepareJob({
      accountId,
      productUrl,
      userId: req.user!.id,
      callbackUrl,
    });
    res.status(202).json(result);
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to start listing prepare job");
  }
});

router.get("/products/prepare-jobs/:jobId", ...auth, async (req, res) => {
  try {
    const job = await getListingPrepareJobForUser(req.params.jobId as string, req.user!.id);
    if (!job) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Job não encontrado" } });
      return;
    }
    res.json(job);
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to get listing prepare job");
  }
});

router.post("/products/publish-draft", ...auth, async (req, res) => {
  try {
    const { accountId, draft } = req.body as { accountId?: string; draft?: unknown };
    if (!accountId || !draft || typeof draft !== "object") {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe accountId e draft" } });
      return;
    }
    if (!(await assertUserOwnsAccount(req.user!.id, accountId))) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Conta inválida" } });
      return;
    }

    const { productId } = await publishDraftOnMercadoLivre(accountId, draft as N8nListingDraft);

    const db = getDb();
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
    if (!product) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      return;
    }

    res.status(201).json(await formatProductResponse(product));
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to publish listing draft");
  }
});

router.post("/products", ...auth, async (req, res) => {
  try {
    const body = req.body as CreateMlListingInput &
      CreateAmazonListingInput & {
        accountId?: string;
        platform?: string;
        sellerSku?: string;
        productType?: string;
      };
    const accountId = body.accountId;
    if (!accountId) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe accountId" } });
      return;
    }
    if (!(await assertUserOwnsAccount(req.user!.id, accountId))) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Conta inválida" } });
      return;
    }

    const db = getDb();
    const [account] = await db
      .select({ platform: accountsTable.platform })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId));

    if (account?.platform === "amazon") {
      const amazonInput: CreateAmazonListingInput = {
        sellerSku: body.sellerSku || body.title?.slice(0, 40) || "",
        productType: body.productType || "",
        title: body.title,
        price: body.price,
        availableQuantity: body.availableQuantity,
        condition: (body as { condition?: string }).condition,
        externalProductId: (body as { externalProductId?: string }).externalProductId,
        externalProductIdType: (body as { externalProductIdType?: string }).externalProductIdType,
        imageUrls: Array.isArray(body.pictures)
          ? body.pictures.map((p: string | { source?: string }) =>
              typeof p === "string" ? p : p.source ?? "",
            ).filter(Boolean)
          : (body as { imageUrls?: string[] }).imageUrls,
        brand: (body as { brand?: string }).brand,
        description: body.description,
        attributes: (body as { amazonAttributes?: Record<string, unknown> }).amazonAttributes,
      };
      const { productId } = await createAmazonListing(accountId, amazonInput);
      const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
      if (!product) {
        res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
        return;
      }
      res.status(201).json(await formatProductResponse(product));
      return;
    }

    const input: CreateMlListingInput = {
      title: body.title,
      familyName: body.familyName,
      categoryId: body.categoryId,
      price: body.price,
      availableQuantity: body.availableQuantity,
      condition: body.condition,
      listingTypeId: body.listingTypeId,
      pictures: body.pictures ?? [],
      attributes: body.attributes ?? [],
      description: body.description,
      variations: body.variations,
    };

    const created = await createMlItem(accountId, input);
    const productId = await upsertProductFromMlItem(accountId, created);

    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
    if (!product) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      return;
    }

    res.status(201).json(await formatProductResponse(product));
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to create product");
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

router.post("/products/:id/duplicate", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const { targetAccountId } = req.body as { targetAccountId?: string };
    if (!targetAccountId) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe targetAccountId" } });
      return;
    }
    if (!(await assertUserOwnsAccount(req.user!.id, targetAccountId))) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Conta de destino inválida" } });
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

    if (!product.mlItemId) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Duplicação disponível apenas para anúncios Mercado Livre" },
      });
      return;
    }

    const { productId: newProductId } = await duplicateMlListing(
      product.accountId,
      product.mlItemId,
      targetAccountId,
    );

    const [created] = await db.select().from(productsTable).where(eq(productsTable.id, newProductId));
    if (!created) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      return;
    }

    res.status(201).json({
      product: await formatProductResponse(created),
      sourceProductId: product.id,
      sourceMlItemId: product.mlItemId,
    });
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to duplicate product");
  }
});

router.get("/products/:id/listing-detail", ...auth, async (req, res) => {
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

    if (!product.mlItemId) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Detalhe de listing ML indisponível para produtos Amazon" },
      });
      return;
    }

    const detail = await getMlListingDetail(product.accountId, product.mlItemId);
    const conditionAttr = detail.attributes.find((a) => a.id === "ITEM_CONDITION");
    res.json({
      product: await formatProductResponse(product),
      description: detail.description,
      pictures: detail.pictures,
      attributes: detail.attributes,
      listingTypeId: detail.item.listing_type_id ?? null,
      condition: conditionAttr?.value_name?.toLowerCase().includes("usado") ? "used" : "new",
      categoryId: detail.item.category_id ?? product.mlCategoryId,
    });
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to get listing detail");
  }
});

router.put("/products/:id", ...auth, async (req, res) => {
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

    if (product.status === "closed") {
      res.status(400).json({
        error: { code: "CLOSED_LISTING", message: "Não é possível editar anúncios encerrados" },
      });
      return;
    }

    const [account] = await db
      .select({ platform: accountsTable.platform })
      .from(accountsTable)
      .where(eq(accountsTable.id, product.accountId));

    if (account?.platform === "amazon") {
      const sellerSku = product.amazonSku || product.sku;
      if (!sellerSku) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "Produto Amazon sem SKU" } });
        return;
      }
      const body = req.body as { price?: number; availableQuantity?: number };
      await updateAmazonListing(product.accountId, sellerSku, {
        price: body.price,
        availableQuantity: body.availableQuantity,
        productType: product.amazonProductType,
      });
      const [refreshed] = await db.select().from(productsTable).where(eq(productsTable.id, product.id));
      if (!refreshed) {
        res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
        return;
      }
      res.json(await formatProductResponse(refreshed));
      return;
    }

    if (!product.mlItemId) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Produto sem mlItemId" } });
      return;
    }

    const body = req.body as UpdateMlListingInput;
    const input: UpdateMlListingInput = {
      title: body.title,
      familyName: body.familyName,
      price: body.price,
      availableQuantity: body.availableQuantity,
      pictures: body.pictures,
      attributes: body.attributes,
      description: body.description,
    };

    const updated = await updateMlItem(product.accountId, product.mlItemId, input, {
      isFull: product.isFull,
      soldQuantity: product.soldQuantity,
    });
    await upsertProductFromMlItem(product.accountId, updated);

    const [refreshed] = await db.select().from(productsTable).where(eq(productsTable.id, product.id));
    if (!refreshed) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      return;
    }

    res.json(await formatProductResponse(refreshed));
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to update product");
  }
});

router.delete("/products/:id", ...auth, async (req, res) => {
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

    if (product.status === "closed") {
      res.status(400).json({
        error: { code: "ALREADY_CLOSED", message: "Este anúncio já está encerrado" },
      });
      return;
    }

    if (!product.mlItemId) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Encerrar anúncio via API disponível apenas para Mercado Livre nesta fase" },
      });
      return;
    }

    const closed = await closeMlItem(product.accountId, product.mlItemId);
    await upsertProductFromMlItem(product.accountId, closed);

    res.json({ success: true, productId: product.id, status: "closed" as const });
  } catch (err) {
    handleMlListingRouteError(err, res, req.log, "Failed to close product");
  }
});

router.post("/products/bulk-status", ...auth, async (req, res) => {
  try {
    const { status, product_ids } = req.body as {
      status?: string;
      product_ids?: unknown;
    };

    if (status !== "active" && status !== "paused") {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Informe status active ou paused" },
      });
      return;
    }

    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Informe ao menos um product_id" },
      });
      return;
    }

    if (product_ids.length > 500) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Máximo de 500 anúncios por requisição" },
      });
      return;
    }

    const ids = product_ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "product_ids inválidos" },
      });
      return;
    }

    const result = await bulkChangeProductListingStatus(req.user!.id, ids, status);
    res.json({ success: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk update product listing status");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.patch("/products/:id/status", ...auth, async (req, res) => {
  try {
    const { status } = req.body as { status?: string };

    if (status !== "active" && status !== "paused") {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Informe status active ou paused" },
      });
      return;
    }

    const result = await changeProductListingStatus(req.user!.id, req.params.id as string, status);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ProductListingStatusError) {
      if (err.code === "NOT_FOUND") {
        res.status(404).json({ error: { code: "NOT_FOUND", message: err.message } });
        return;
      }
      if (err.code === "INVALID_STATUS") {
        res.status(400).json({ error: { code: "INVALID_STATUS", message: err.message } });
        return;
      }
      if (err.code === "ML_API_ERROR") {
        res.status(502).json({ error: { code: "ML_API_ERROR", message: err.message } });
        return;
      }
    }
    req.log.error({ err }, "Failed to update product listing status");
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

    const [account] = await db
      .select({ platform: accountsTable.platform })
      .from(accountsTable)
      .where(eq(accountsTable.id, product.accountId));

    if (account?.platform === "amazon") {
      const sellerSku = product.amazonSku || product.sku;
      if (!sellerSku) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "Produto Amazon sem SKU" } });
        return;
      }
      const after = await patchAmazonListingQuantity(
        product.accountId,
        sellerSku,
        quantity,
        product.amazonProductType,
      );
      const qty = after.fulfillmentAvailability?.find((f) => f.quantity != null)?.quantity ?? quantity;
      await db
        .update(productsTable)
        .set({ availableQuantity: qty, updatedAt: new Date() })
        .where(eq(productsTable.id, product.id));
      res.json({ success: true, productId: product.id, quantity: qty });
      return;
    }

    if (product.isFull) {
      res.status(400).json({ error: { code: "FULL_ITEM", message: "Estoque FULL é gerenciado pelo armazém do Mercado Livre" } });
      return;
    }

    if (!product.mlItemId) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Produto sem mlItemId" } });
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
    if (err instanceof AmazonListingError) {
      const status =
        err.code === "NOT_FOUND" ? 404 : err.code === "VALIDATION_ERROR" || err.code === "BAD_REQUEST" ? 400 : 502;
      res.status(status).json({ error: { code: err.code, message: err.message } });
      return;
    }
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

    const results: Array<{ productId: string; mlItemId: string | null; success: boolean; reason: string | null }> = [];
    let updated = 0, skipped = 0, failed = 0;

    for (const product of products) {
      const [account] = await db
        .select({ platform: accountsTable.platform })
        .from(accountsTable)
        .where(eq(accountsTable.id, product.accountId));

      if (account?.platform === "amazon") {
        const sellerSku = product.amazonSku || product.sku || (req.params.sku as string);
        try {
          const after = await patchAmazonListingQuantity(
            product.accountId,
            sellerSku,
            quantity,
            product.amazonProductType,
          );
          const qty = after.fulfillmentAvailability?.find((f) => f.quantity != null)?.quantity ?? quantity;
          await db
            .update(productsTable)
            .set({ availableQuantity: qty, updatedAt: new Date() })
            .where(eq(productsTable.id, product.id));
          updated++;
          results.push({ productId: product.id, mlItemId: product.mlItemId, success: true, reason: null });
        } catch (err) {
          failed++;
          results.push({
            productId: product.id,
            mlItemId: product.mlItemId,
            success: false,
            reason: (err as Error).message,
          });
        }
        continue;
      }

      if (product.isFull) {
        skipped++;
        results.push({ productId: product.id, mlItemId: product.mlItemId, success: false, reason: "FULL (Fulfillment) — stock managed by ML warehouse" });
        continue;
      }

      if (!product.mlItemId) {
        failed++;
        results.push({ productId: product.id, mlItemId: null, success: false, reason: "missing mlItemId" });
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
