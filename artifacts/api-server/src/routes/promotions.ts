import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { accountsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  listSellerPromotions,
  resolvePromotionDetail,
  listPromotionItems,
  fetchMlItemPromotions,
  mergePromotionItemWithContext,
  enrichItemsWithProducts,
  aggregateInboxForAccount,
  buildPromotionSummary,
  activatePromotionItem,
  updatePromotionItem,
  deletePromotionItem,
  bulkActivatePromotionItems,
  mapMlPromotionError,
  parsePromotionStockBounds,
  resolveMlSuggestedPrice,
  resolveFeeSubsidyAmount,
  normalizeNetProceeds,
  resolveOfferIdFromMlItem,
  findPromotionItemContext,
  matchesPromotionStatusFilter,
  isPromotionItemCandidate,
  enrichInboxEntriesWithItemContext,
  enrichPromotionItemsWithItemContext,
  attachInventorySkuFinancials,
  PROMOTION_TYPE_LABELS,
  type MlPromotion,
  type EnrichedPromotionItem,
} from "../lib/ml-promotions";

const router = Router();
const auth = [requireAuth, requireActivePlan];

async function getUserAccounts(
  userId: string,
  filterAccountId?: string,
): Promise<Array<{ id: string; mlUserId: string; mlNickname: string | null }>> {
  const db = getDb();
  const conditions = [
    eq(accountsTable.userId, userId),
    eq(accountsTable.isActive, true),
  ];
  if (filterAccountId) conditions.push(eq(accountsTable.id, filterAccountId));

  const accounts = await db
    .select({
      id: accountsTable.id,
      mlUserId: accountsTable.mlUserId,
      mlNickname: accountsTable.mlNickname,
    })
    .from(accountsTable)
    .where(and(...conditions));

  return accounts
    .filter((a): a is { id: string; mlUserId: string; mlNickname: string | null } => !!a.mlUserId)
    .map((a) => ({ id: a.id, mlUserId: a.mlUserId, mlNickname: a.mlNickname }));
}

function mapPromotion(
  promo: MlPromotion,
  accountId: string,
  accountNickname: string | null,
  candidateCount?: number,
) {
  return {
    id: promo.id,
    type: promo.type,
    typeLabel: PROMOTION_TYPE_LABELS[promo.type] ?? promo.type,
    status: promo.status,
    startDate: promo.start_date ?? null,
    finishDate: promo.finish_date ?? null,
    deadlineDate: promo.deadline_date ?? null,
    name: promo.name ?? null,
    subType: promo.sub_type ?? null,
    benefits: promo.benefits
      ? {
          type: promo.benefits.type ?? null,
          meliPercent: promo.benefits.meli_percent ?? null,
          sellerPercent: promo.benefits.seller_percent ?? null,
          name: promo.benefits.name ?? null,
          buyQuantity: promo.benefits.buy_quantity ?? null,
          payQuantity: promo.benefits.pay_quantity ?? null,
          itemDiscountPercent: promo.benefits.item_discount_percent ?? null,
        }
      : null,
    accountId,
    accountNickname,
    candidateCount: candidateCount ?? null,
  };
}

function mapPromotionItem(item: EnrichedPromotionItem) {
  const stockBounds = parsePromotionStockBounds(item.stock);
  const suggestedDiscountedPrice = resolveMlSuggestedPrice(item);
  return {
    itemId: item.id,
    status: item.status,
    price: item.price ?? null,
    originalPrice: item.original_price ?? null,
    maxOriginalPrice: item.max_original_price ?? null,
    minDiscountedPrice: item.min_discounted_price ?? null,
    maxDiscountedPrice: item.max_discounted_price ?? null,
    suggestedDiscountedPrice,
    topDealPrice: item.top_deal_price ?? null,
    discountPercentage: item.discount_percentage ?? null,
    startDate: item.start_date ?? null,
    endDate: item.end_date ?? null,
    stockMin: stockBounds.stockMin,
    stockMax: stockBounds.stockMax,
    netProceeds: normalizeNetProceeds(item.net_proceeds),
    feeSubsidyAmount: resolveFeeSubsidyAmount(item),
    taxPercent: item.taxPercent ?? null,
    purchasePrice: item.purchasePrice ?? null,
    productId: item.productId ?? null,
    title: item.title ?? null,
    sku: item.sku ?? null,
    thumbnail: item.thumbnail ?? null,
    permalink: item.permalink ?? null,
    availableQuantity: item.availableQuantity ?? null,
    offerId: item.offer_id ?? null,
  };
}

function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  return {
    data: items.slice(offset, offset + limit),
    pagination: { page, limit, total, totalPages },
  };
}

function matchesSearch(text: string | null | undefined, search: string): boolean {
  if (!search.trim()) return true;
  return (text ?? "").toLowerCase().includes(search.trim().toLowerCase());
}

router.get("/promotions/summary", ...auth, async (req, res) => {
  try {
    const { account_id, refresh } = req.query as Record<string, string>;
    const accounts = await getUserAccounts(req.user!.id, account_id);
    const summary = await buildPromotionSummary(accounts, {
      bypassCache: refresh === "true",
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: mapMlPromotionError(err) });
  }
});

router.get("/promotions/inbox", ...auth, async (req, res) => {
  try {
    const {
      account_id,
      search = "",
      promotion_id,
      promotion_type,
      page = "1",
      limit = "20",
      refresh,
    } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const accounts = await getUserAccounts(req.user!.id, account_id);
    let inbox = (
      await Promise.all(
        accounts.map((acc) =>
          aggregateInboxForAccount(acc.id, acc.mlUserId, acc.mlNickname, {
            bypassCache: refresh === "true",
          }),
        ),
      )
    ).flat();

    if (promotion_id) {
      inbox = inbox.filter((e) => e.promotionId === promotion_id);
    }
    if (promotion_type) {
      inbox = inbox.filter((e) => e.promotionType === promotion_type);
    }
    if (search.trim()) {
      inbox = inbox.filter(
        (e) =>
          matchesSearch(e.sku, search) ||
          matchesSearch(e.itemId, search) ||
          matchesSearch(e.title, search),
      );
    }

    inbox = inbox.filter((e) => isPromotionItemCandidate(e.itemStatus));

    inbox.sort((a, b) => {
      const da = a.deadlineDate ? new Date(a.deadlineDate).getTime() : Infinity;
      const db = b.deadlineDate ? new Date(b.deadlineDate).getTime() : Infinity;
      return da - db;
    });

    const mapped = inbox.map((e) => ({
      ...e,
      promotionTypeLabel: PROMOTION_TYPE_LABELS[e.promotionType] ?? e.promotionType,
    }));

    const pageResult = paginate(mapped, pageNum, limitNum);
    const enrichedPage = await enrichInboxEntriesWithItemContext(pageResult.data);
    const withFinancials = await attachInventorySkuFinancials(req.user!.id, enrichedPage);
    res.json({
      data: withFinancials.map((e) => ({
        ...e,
        promotionTypeLabel:
          ("promotionTypeLabel" in e && e.promotionTypeLabel) ||
          PROMOTION_TYPE_LABELS[e.promotionType] ||
          e.promotionType,
      })),
      pagination: pageResult.pagination,
    });
  } catch (err) {
    res.status(500).json({ error: mapMlPromotionError(err) });
  }
});

router.get("/promotions", ...auth, async (req, res) => {
  try {
    const {
      account_id,
      promotion_type,
      status,
      page = "1",
      limit = "20",
      refresh,
    } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const accounts = await getUserAccounts(req.user!.id, account_id);
    const all: ReturnType<typeof mapPromotion>[] = [];

    for (const acc of accounts) {
      try {
        const promos = await listSellerPromotions(acc.id, acc.mlUserId, {
          bypassCache: refresh === "true",
        });
        for (const promo of promos) {
          if (promotion_type && promo.type !== promotion_type) continue;
          if (!matchesPromotionStatusFilter(promo, status)) continue;

          let candidateCount: number | undefined;
          if (promo.status === "started" || promo.status === "pending") {
            try {
              const items = await listPromotionItems(acc.id, promo.id, promo.type, {
                status: "candidate",
                bypassCache: refresh === "true",
              });
              candidateCount = items.length;
            } catch {
              candidateCount = undefined;
            }
          }

          all.push(mapPromotion(promo, acc.id, acc.mlNickname, candidateCount));
        }
      } catch {
        // skip account
      }
    }

    all.sort((a, b) => {
      const da = a.deadlineDate ? new Date(a.deadlineDate).getTime() : Infinity;
      const db = b.deadlineDate ? new Date(b.deadlineDate).getTime() : Infinity;
      return da - db;
    });

    res.json(paginate(all, pageNum, limitNum));
  } catch (err) {
    res.status(500).json({ error: mapMlPromotionError(err) });
  }
});

function paramString(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

router.get("/promotions/:promotionId", ...auth, async (req, res) => {
  try {
    const promotionId = paramString(req.params.promotionId);
    const { account_id, promotion_type } = req.query as Record<string, string>;
    if (!account_id || !promotion_type) {
      res.status(400).json({ error: "account_id e promotion_type são obrigatórios" });
      return;
    }

    const accounts = await getUserAccounts(req.user!.id, account_id);
    const acc = accounts.find((a) => a.id === account_id);
    if (!acc) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    const promo = await resolvePromotionDetail(
      acc.id,
      acc.mlUserId,
      promotionId,
      promotion_type,
      { bypassCache: req.query.refresh === "true" },
    );
    if (!promo) {
      res.status(404).json({ error: "Campanha não encontrada" });
      return;
    }
    res.json(mapPromotion(promo, acc.id, acc.mlNickname));
  } catch (err) {
    res.status(500).json({ error: mapMlPromotionError(err) });
  }
});

router.get("/promotions/:promotionId/items", ...auth, async (req, res) => {
  try {
    const promotionId = paramString(req.params.promotionId);
    const {
      account_id,
      promotion_type,
      status,
      item_id,
      search = "",
      page = "1",
      limit = "50",
      refresh,
    } = req.query as Record<string, string>;

    if (!account_id || !promotion_type) {
      res.status(400).json({ error: "account_id e promotion_type são obrigatórios" });
      return;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

    const accounts = await getUserAccounts(req.user!.id, account_id);
    const acc = accounts.find((a) => a.id === account_id);
    if (!acc) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    const items = await listPromotionItems(acc.id, promotionId, promotion_type, {
      status,
      itemId: item_id,
      bypassCache: refresh === "true",
    });

    const promo = await resolvePromotionDetail(
      acc.id,
      acc.mlUserId,
      promotionId,
      promotion_type,
      { bypassCache: refresh === "true" },
    );

    let enriched = await enrichItemsWithProducts(acc.id, items);
    const missingOfferId = enriched.filter((row) => !resolveOfferIdFromMlItem(row));
    if (missingOfferId.length > 0) {
      const chunkSize = 5;
      for (let i = 0; i < missingOfferId.length; i += chunkSize) {
        const chunk = missingOfferId.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (row) => {
            try {
              const contexts = await fetchMlItemPromotions(acc.id, row.id);
              const ctx = findPromotionItemContext(contexts, promotionId, promotion_type);
              if (!ctx) return;
              const merged = mergePromotionItemWithContext(row, ctx);
              row.offer_id = merged.offer_id;
            } catch {
              // enriquecimento opcional
            }
          }),
        );
      }
    }
    if (search.trim()) {
      enriched = enriched.filter(
        (e) =>
          matchesSearch(e.title, search) ||
          matchesSearch(e.sku, search) ||
          matchesSearch(e.id, search),
      );
    }

    if (status === "candidate") {
      enriched = enriched.filter((e) => isPromotionItemCandidate(e.status));
    }

    const pageResult = paginate(enriched, pageNum, limitNum);
    pageResult.data = await enrichPromotionItemsWithItemContext(
      acc.id,
      promotionId,
      promotion_type,
      pageResult.data,
      { mlUserId: acc.mlUserId },
    );
    const mapped = await attachInventorySkuFinancials(
      req.user!.id,
      pageResult.data.map(mapPromotionItem),
    );

    res.json({
      data: mapped,
      pagination: pageResult.pagination,
      ...(promo ? { promotion: mapPromotion(promo, acc.id, acc.mlNickname) } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: mapMlPromotionError(err) });
  }
});

router.post("/promotions/:promotionId/items/bulk", ...auth, async (req, res) => {
  try {
    const promotionId = paramString(req.params.promotionId);
    const { accountId, promotionType, items } = req.body as {
      accountId: string;
      promotionType: string;
      items: Array<{ itemId: string; dealPrice?: number; topDealPrice?: number; useSuggested?: boolean; stock?: number; offerId?: string }>;
    };

    if (!accountId || !promotionType || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "accountId, promotionType e items são obrigatórios" });
      return;
    }

    const accounts = await getUserAccounts(req.user!.id, accountId);
    if (!accounts.some((a) => a.id === accountId)) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    const results = await bulkActivatePromotionItems(accountId, promotionId, promotionType, items);
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: mapMlPromotionError(err) });
  }
});

router.post("/promotions/:promotionId/items/:itemId", ...auth, async (req, res) => {
  try {
    const promotionId = paramString(req.params.promotionId);
    const itemId = paramString(req.params.itemId);
    const { accountId, promotionType, dealPrice, topDealPrice, stock, offerId } = req.body as {
      accountId: string;
      promotionType: string;
      dealPrice?: number;
      topDealPrice?: number;
      stock?: number;
      offerId?: string;
    };

    if (!accountId || !promotionType) {
      res.status(400).json({ error: "accountId e promotionType são obrigatórios" });
      return;
    }

    const accounts = await getUserAccounts(req.user!.id, accountId);
    if (!accounts.some((a) => a.id === accountId)) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    const result = await activatePromotionItem(accountId, itemId, {
      promotionId,
      promotionType,
      dealPrice,
      topDealPrice,
      stock,
      offerId,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: mapMlPromotionError(err) });
  }
});

router.put("/promotions/:promotionId/items/:itemId", ...auth, async (req, res) => {
  try {
    const promotionId = paramString(req.params.promotionId);
    const itemId = paramString(req.params.itemId);
    const { accountId, promotionType, dealPrice, topDealPrice, stock } = req.body as {
      accountId: string;
      promotionType: string;
      dealPrice?: number;
      topDealPrice?: number;
      stock?: number;
    };

    if (!accountId || !promotionType) {
      res.status(400).json({ error: "accountId e promotionType são obrigatórios" });
      return;
    }

    const accounts = await getUserAccounts(req.user!.id, accountId);
    if (!accounts.some((a) => a.id === accountId)) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    const result = await updatePromotionItem(accountId, itemId, {
      promotionId,
      promotionType,
      dealPrice,
      topDealPrice,
      stock,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: mapMlPromotionError(err) });
  }
});

router.delete("/promotions/:promotionId/items/:itemId", ...auth, async (req, res) => {
  try {
    const promotionId = paramString(req.params.promotionId);
    const itemId = paramString(req.params.itemId);
    const { account_id, promotion_type } = req.query as Record<string, string>;

    if (!account_id || !promotion_type) {
      res.status(400).json({ error: "account_id e promotion_type são obrigatórios" });
      return;
    }

    const accounts = await getUserAccounts(req.user!.id, account_id);
    if (!accounts.some((a) => a.id === account_id)) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    const result = await deletePromotionItem(account_id, itemId, promotionId, promotion_type);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: mapMlPromotionError(err) });
  }
});

export default router;
