import { ml } from "./mercadolivre";
import { getDb } from "./db";
import { productsTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const CACHE_TTL_MS = 3 * 60 * 1000;

type CacheEntry<T> = { data: T; expiresAt: number };
const promotionsListCache = new Map<string, CacheEntry<MlPromotion[]>>();
const promotionItemsCache = new Map<string, CacheEntry<MlPromotionItem[]>>();

export const PROMOTION_TYPES = [
  "DEAL",
  "MARKETPLACE_CAMPAIGN",
  "VOLUME",
  "LIGHTNING",
  "DOD",
  "SELLER_CAMPAIGN",
  "PRICE_DISCOUNT",
  "PRE_NEGOTIATED",
  "SMART",
  "PRICE_MATCHING",
  "UNHEALTHY_STOCK",
  "SELLER_COUPON_CAMPAIGN",
] as const;

export const PROMOTION_TYPE_LABELS: Record<string, string> = {
  DEAL: "Campanha tradicional",
  MARKETPLACE_CAMPAIGN: "Co-fondeada ML",
  VOLUME: "Desconto por volume",
  LIGHTNING: "Oferta relâmpago",
  DOD: "Oferta do dia",
  SELLER_CAMPAIGN: "Campanha própria",
  PRICE_DISCOUNT: "Desconto individual",
  PRE_NEGOTIATED: "Pré-acordado",
  SMART: "Campanha automática",
  PRICE_MATCHING: "Preço competitivo",
  UNHEALTHY_STOCK: "Liquidação Full",
  SELLER_COUPON_CAMPAIGN: "Cupom do vendedor",
};

export type MlPromotionBenefits = {
  type?: string;
  meli_percent?: number;
  seller_percent?: number;
  name?: string;
  buy_quantity?: number;
  pay_quantity?: number;
  item_discount_percent?: number;
};

export type MlPromotion = {
  id: string;
  type: string;
  status: string;
  start_date?: string | null;
  finish_date?: string | null;
  deadline_date?: string | null;
  name?: string | null;
  benefits?: MlPromotionBenefits | null;
  sub_type?: string | null;
};

/** Campanha aberta para participação (equivalente ao hub do ML). */
export function isPromotionCurrentlyOpen(promo: MlPromotion): boolean {
  if (promo.status === "finished") return false;
  if (promo.status !== "started" && promo.status !== "pending") return false;

  const now = Date.now();
  if (promo.finish_date) {
    const end = new Date(promo.finish_date).getTime();
    if (!Number.isNaN(end) && end < now) return false;
  }
  if (promo.deadline_date) {
    const deadline = new Date(promo.deadline_date).getTime();
    if (!Number.isNaN(deadline) && deadline < now) return false;
  }
  return true;
}

export function matchesPromotionStatusFilter(promo: MlPromotion, status?: string): boolean {
  if (!status || status === "active") return isPromotionCurrentlyOpen(promo);
  if (status === "all") return true;
  return promo.status === status;
}

export type MlPromotionItemStock =
  | number
  | {
      min?: number | null;
      max?: number | null;
      remaining_stock?: number | null;
    }
  | null;

export type MlNetProceeds = {
  amount?: number | null;
  currency?: string | null;
};

export type MlPromotionItem = {
  id: string;
  status: string;
  price?: number | null;
  original_price?: number | null;
  max_original_price?: number | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  top_deal_price?: number | null;
  discount_percentage?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  sub_type?: string | null;
  currency?: string | null;
  stock?: MlPromotionItemStock;
  net_proceeds?: MlNetProceeds | null;
  offer_id?: string | null;
};

/** Contexto de promoção retornado por GET /seller-promotions/items/{itemId}. */
export type MlItemPromotionContext = {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  price?: number | null;
  original_price?: number | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  net_proceeds?: MlNetProceeds | null;
  stock?: MlPromotionItemStock;
  start_date?: string | null;
  end_date?: string | null;
  ref_id?: string | null;
};

/**
 * Preço sugerido pelo ML para candidatos.
 * A API v2 usa `suggested_discounted_price`; `price` costuma ser 0 ou o teto (`max_discounted_price`).
 */
export function resolveMlSuggestedPrice(
  item: Pick<
    MlPromotionItem,
    | "status"
    | "price"
    | "suggested_discounted_price"
    | "max_discounted_price"
    | "original_price"
  >,
): number | null {
  if (item.suggested_discounted_price != null && item.suggested_discounted_price > 0) {
    return item.suggested_discounted_price;
  }
  if (item.status === "candidate" && item.price != null && item.price > 0) {
    const maxDiscounted = item.max_discounted_price;
    const original = item.original_price;
    const isCeilingPrice =
      maxDiscounted != null && Math.abs(item.price - maxDiscounted) < 0.02;
    const isNearOriginal = original != null && item.price >= original * 0.85;
    if (!isCeilingPrice && !isNearOriginal) {
      return item.price;
    }
    return null;
  }
  if (item.status !== "candidate" && item.price != null && item.price > 0) {
    return item.price;
  }
  return null;
}

export async function fetchMlItemPromotions(
  accountId: string,
  itemId: string,
): Promise<MlItemPromotionContext[]> {
  const path = `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
  const res = await ml.get<MlItemPromotionContext[] | { results?: MlItemPromotionContext[] }>(
    accountId,
    path,
  );
  if (Array.isArray(res)) return res;
  return res.results ?? [];
}

export function mergePromotionItemWithContext(
  item: MlPromotionItem,
  context: MlItemPromotionContext | undefined,
): MlPromotionItem {
  if (!context) return item;

  return {
    ...item,
    suggested_discounted_price:
      context.suggested_discounted_price ?? item.suggested_discounted_price,
    min_discounted_price: context.min_discounted_price ?? item.min_discounted_price,
    max_discounted_price: context.max_discounted_price ?? item.max_discounted_price,
    original_price: context.original_price ?? item.original_price,
    stock: context.stock ?? item.stock,
    net_proceeds: context.net_proceeds ?? item.net_proceeds,
    start_date: context.start_date ?? item.start_date,
    end_date: context.end_date ?? item.end_date,
    price: item.price ?? context.price,
    offer_id: item.offer_id ?? context.ref_id ?? null,
  };
}

export function parsePromotionStockBounds(stock?: MlPromotionItemStock): {
  stockMin: number | null;
  stockMax: number | null;
} {
  if (stock == null) return { stockMin: null, stockMax: null };
  if (typeof stock === "number") return { stockMin: 1, stockMax: stock };
  return {
    stockMin: stock.min ?? null,
    stockMax: stock.max ?? null,
  };
}

export type EnrichedPromotionItem = MlPromotionItem & {
  productId?: string | null;
  title?: string | null;
  sku?: string | null;
  thumbnail?: string | null;
  permalink?: string | null;
  availableQuantity?: number | null;
};

export type InboxEntry = {
  itemId: string;
  promotionId: string;
  promotionType: string;
  promotionName?: string | null;
  promotionStatus?: string | null;
  deadlineDate?: string | null;
  itemStatus: string;
  accountId: string;
  accountNickname?: string | null;
  originalPrice?: number | null;
  suggestedDiscountedPrice?: number | null;
  minDiscountedPrice?: number | null;
  maxDiscountedPrice?: number | null;
  maxOriginalPrice?: number | null;
  stockMin?: number | null;
  stockMax?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  title?: string | null;
  sku?: string | null;
  thumbnail?: string | null;
  permalink?: string | null;
  availableQuantity?: number | null;
  discountPercent?: number | null;
  offerId?: string | null;
};

export type PromotionSummary = {
  totalCampaigns: number;
  activeCampaigns: number;
  candidateItems: number;
  expiringToday: number;
  accounts: Array<{
    accountId: string;
    nickname: string | null;
    campaigns: number;
    candidates: number;
  }>;
};

export type ActivatePromotionItemBody = {
  promotionId: string;
  promotionType: string;
  dealPrice?: number;
  topDealPrice?: number;
  stock?: number;
  offerId?: string;
};

export const PROMOTION_TYPES_REQUIRING_OFFER_ID = new Set([
  "SMART",
  "PRE_NEGOTIATED",
  "PRICE_MATCHING",
  "UNHEALTHY_STOCK",
  "BANK",
]);

export function resolveOfferIdFromMlItem(item: Pick<MlPromotionItem, "offer_id">): string | undefined {
  const id = item.offer_id?.trim();
  return id ? id : undefined;
}

export function findPromotionItemContext(
  contexts: MlItemPromotionContext[],
  promotionId: string,
  promotionType: string,
): MlItemPromotionContext | undefined {
  const sameType = contexts.filter((c) => c.type === promotionType);
  if (sameType.length === 0) return undefined;
  return (
    sameType.find((c) => c.id === promotionId) ??
    sameType.find((c) => c.id == null || c.id === "") ??
    sameType[0]
  );
}

export async function resolvePromotionOfferId(
  accountId: string,
  itemId: string,
  promotionId: string,
  promotionType: string,
  seed?: MlPromotionItem | null,
): Promise<string | undefined> {
  if (seed) {
    const fromSeed = resolveOfferIdFromMlItem(seed);
    if (fromSeed) return fromSeed;
  }

  try {
    const [items, contexts] = await Promise.all([
      listPromotionItems(accountId, promotionId, promotionType, {
        itemId,
        bypassCache: true,
      }),
      fetchMlItemPromotions(accountId, itemId),
    ]);
    const ctx = findPromotionItemContext(contexts, promotionId, promotionType);
    const fromList = items.find((x) => x.id === itemId);
    if (fromList) {
      const merged = mergePromotionItemWithContext(fromList, ctx);
      const fromMerged = resolveOfferIdFromMlItem(merged);
      if (fromMerged) return fromMerged;
    }
    const refId = ctx?.ref_id?.trim();
    if (refId) return refId;
  } catch {
    // optional
  }

  return undefined;
}

export function invalidatePromotionsCache(accountId?: string): void {
  if (!accountId) {
    promotionsListCache.clear();
    promotionItemsCache.clear();
    return;
  }
  for (const key of [...promotionsListCache.keys()]) {
    if (key.startsWith(`${accountId}:`)) promotionsListCache.delete(key);
  }
  for (const key of [...promotionItemsCache.keys()]) {
    if (key.startsWith(`${accountId}:`)) promotionItemsCache.delete(key);
  }
}

export function mapMlPromotionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "OFFER_ID_REQUIRED" || msg.includes("Offer id is required")) {
    return "Esta campanha exige o identificador da oferta. Atualize a página e tente novamente.";
  }
  const mlBody = msg.replace(/^ML API \d+: /, "");
  try {
    const parsed = JSON.parse(mlBody) as { message?: string };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      if (parsed.message === "Offer id is required") {
        return "Esta campanha exige o identificador da oferta. Atualize a página e tente novamente.";
      }
      return parsed.message;
    }
  } catch {
    // not JSON
  }
  if (msg.includes("ERROR_CREDIBILITY_DISCOUNTED_PRICE")) {
    return "O preço com desconto não é considerado credível pelo Mercado Livre.";
  }
  if (msg.includes("403")) {
    return "Acesso negado. Verifique reputação verde e permissões da conta.";
  }
  if (msg.includes("429")) {
    return "Limite de requisições do Mercado Livre. Tente novamente em instantes.";
  }
  return msg.replace(/^ML API \d+: /, "");
}

function calcDiscountPercent(
  original: number | null | undefined,
  discounted: number | null | undefined,
): number | null {
  if (original == null || discounted == null || original <= 0 || discounted >= original) {
    return null;
  }
  return Math.round(((original - discounted) / original) * 100);
}

export async function listSellerPromotions(
  accountId: string,
  mlUserId: string,
  options?: { bypassCache?: boolean },
): Promise<MlPromotion[]> {
  const cacheKey = `${accountId}:list`;
  if (!options?.bypassCache) {
    const cached = promotionsListCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;
  }

  const path = `/seller-promotions/users/${encodeURIComponent(mlUserId)}?app_version=v2`;
  const res = await ml.get<{ results?: MlPromotion[] }>(accountId, path);
  const data = res.results ?? [];

  promotionsListCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function getPromotionDetail(
  accountId: string,
  promotionId: string,
  promotionType: string,
): Promise<MlPromotion> {
  const path =
    `/seller-promotions/promotions/${encodeURIComponent(promotionId)}` +
    `?promotion_type=${encodeURIComponent(promotionType)}&app_version=v2`;
  return ml.get<MlPromotion>(accountId, path);
}

/** Detalhe da campanha; se GET /promotions/{id} falhar, usa a lista do vendedor (ex.: LIGHTNING). */
export async function resolvePromotionDetail(
  accountId: string,
  mlUserId: string,
  promotionId: string,
  promotionType: string,
  options?: { bypassCache?: boolean },
): Promise<MlPromotion | null> {
  try {
    return await getPromotionDetail(accountId, promotionId, promotionType);
  } catch {
    const promos = await listSellerPromotions(accountId, mlUserId, options);
    return promos.find((p) => p.id === promotionId && p.type === promotionType) ?? null;
  }
}

export async function listPromotionItems(
  accountId: string,
  promotionId: string,
  promotionType: string,
  filters?: {
    status?: string;
    statusItem?: string;
    itemId?: string;
    limit?: number;
    bypassCache?: boolean;
  },
): Promise<MlPromotionItem[]> {
  const status = filters?.status ?? "";
  const cacheKey = `${accountId}:items:${promotionId}:${promotionType}:${status}:${filters?.itemId ?? ""}`;
  if (!filters?.bypassCache) {
    const cached = promotionItemsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;
  }

  const params = new URLSearchParams({
    promotion_type: promotionType,
    app_version: "v2",
  });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.statusItem) params.set("status_item", filters.statusItem);
  if (filters?.itemId) params.set("item_id", filters.itemId);
  if (filters?.limit) params.set("limit", String(filters.limit));

  const path =
    `/seller-promotions/promotions/${encodeURIComponent(promotionId)}/items?${params.toString()}`;
  const res = await ml.get<{ results?: MlPromotionItem[] }>(accountId, path);
  const data = res.results ?? [];

  promotionItemsCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function enrichItemsWithProducts(
  accountId: string,
  items: MlPromotionItem[],
): Promise<EnrichedPromotionItem[]> {
  if (items.length === 0) return [];

  const db = getDb();
  const itemIds = items.map((i) => i.id);
  const prods = await db
    .select({
      id: productsTable.id,
      mlItemId: productsTable.mlItemId,
      title: productsTable.title,
      sku: productsTable.sku,
      thumbnail: productsTable.thumbnail,
      permalink: productsTable.permalink,
      availableQuantity: productsTable.availableQuantity,
    })
    .from(productsTable)
    .where(and(eq(productsTable.accountId, accountId), inArray(productsTable.mlItemId, itemIds)));

  const byItemId = Object.fromEntries(prods.map((p) => [p.mlItemId, p]));

  return items.map((item) => {
    const p = byItemId[item.id];
    return {
      ...item,
      productId: p?.id ?? null,
      title: p?.title ?? null,
      sku: p?.sku ?? null,
      thumbnail: p?.thumbnail ?? null,
      permalink: p?.permalink ?? null,
      availableQuantity: p?.availableQuantity ?? null,
    };
  });
}

export async function aggregateInboxForAccount(
  accountId: string,
  mlUserId: string,
  accountNickname: string | null,
  options?: { bypassCache?: boolean },
): Promise<InboxEntry[]> {
  const promotions = await listSellerPromotions(accountId, mlUserId, options);
  const activeOrPending = promotions.filter(isPromotionCurrentlyOpen);

  const inbox: InboxEntry[] = [];
  const chunkSize = 3;

  for (let i = 0; i < activeOrPending.length; i += chunkSize) {
    const chunk = activeOrPending.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (promo) => {
        try {
          const items = await listPromotionItems(accountId, promo.id, promo.type, {
            status: "candidate",
            bypassCache: options?.bypassCache,
          });
          const enriched = await enrichItemsWithProducts(accountId, items);
          for (const item of enriched) {
            const suggested = resolveMlSuggestedPrice(item);
            const original = item.original_price;
            const stockBounds = parsePromotionStockBounds(item.stock);
            inbox.push({
              itemId: item.id,
              promotionId: promo.id,
              promotionType: promo.type,
              promotionName: promo.name,
              promotionStatus: promo.status,
              deadlineDate: promo.deadline_date ?? promo.finish_date,
              itemStatus: item.status,
              accountId,
              accountNickname,
              originalPrice: original,
              suggestedDiscountedPrice: suggested,
              minDiscountedPrice: item.min_discounted_price,
              maxDiscountedPrice: item.max_discounted_price,
              maxOriginalPrice: item.max_original_price,
              stockMin: stockBounds.stockMin,
              stockMax: stockBounds.stockMax,
              startDate: item.start_date ?? promo.start_date,
              endDate: item.end_date ?? promo.finish_date,
              title: item.title,
              sku: item.sku,
              thumbnail: item.thumbnail,
              permalink: item.permalink,
              availableQuantity: item.availableQuantity,
              discountPercent: calcDiscountPercent(original, suggested),
              offerId: resolveOfferIdFromMlItem(item) ?? null,
            });
          }
        } catch {
          // skip campaign on ML error
        }
      }),
    );
  }

  return inbox;
}

export async function buildPromotionSummary(
  accounts: Array<{ id: string; mlUserId: string; mlNickname: string | null }>,
  options?: { bypassCache?: boolean },
): Promise<PromotionSummary> {
  let totalCampaigns = 0;
  let activeCampaigns = 0;
  let candidateItems = 0;
  let expiringToday = 0;
  const accountStats: PromotionSummary["accounts"] = [];

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  for (const acc of accounts) {
    try {
      const promos = await listSellerPromotions(acc.id, acc.mlUserId, options);
      totalCampaigns += promos.length;
      const active = promos.filter(isPromotionCurrentlyOpen);
      activeCampaigns += active.length;

      let accCandidates = 0;
      for (const p of active) {
        if (p.deadline_date) {
          const dl = new Date(p.deadline_date);
          if (dl >= todayStart && dl <= todayEnd) expiringToday++;
        }
        try {
          const items = await listPromotionItems(acc.id, p.id, p.type, {
            status: "candidate",
            bypassCache: options?.bypassCache,
          });
          accCandidates += items.length;
        } catch {
          // skip
        }
      }
      candidateItems += accCandidates;
      accountStats.push({
        accountId: acc.id,
        nickname: acc.mlNickname,
        campaigns: promos.length,
        candidates: accCandidates,
      });
    } catch {
      accountStats.push({
        accountId: acc.id,
        nickname: acc.mlNickname,
        campaigns: 0,
        candidates: 0,
      });
    }
  }

  return { totalCampaigns, activeCampaigns, candidateItems, expiringToday, accounts: accountStats };
}

export async function activatePromotionItem(
  accountId: string,
  itemId: string,
  body: ActivatePromotionItemBody,
): Promise<unknown> {
  const offerId =
    body.offerId ??
    (await resolvePromotionOfferId(accountId, itemId, body.promotionId, body.promotionType));

  if (PROMOTION_TYPES_REQUIRING_OFFER_ID.has(body.promotionType) && !offerId) {
    throw new Error("OFFER_ID_REQUIRED");
  }

  const payload: Record<string, unknown> = {
    promotion_id: body.promotionId,
    promotion_type: body.promotionType,
  };
  if (offerId) payload.offer_id = offerId;
  if (body.dealPrice != null) payload.deal_price = body.dealPrice;
  if (body.topDealPrice != null) payload.top_deal_price = body.topDealPrice;
  if (body.stock != null) payload.stock = body.stock;

  const path = `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
  const result = await ml.post(accountId, path, payload);
  invalidatePromotionsCache(accountId);
  return result;
}

export async function updatePromotionItem(
  accountId: string,
  itemId: string,
  body: ActivatePromotionItemBody,
): Promise<unknown> {
  const payload: Record<string, unknown> = {
    promotion_id: body.promotionId,
    promotion_type: body.promotionType,
  };
  if (body.dealPrice != null) payload.deal_price = body.dealPrice;
  if (body.topDealPrice != null) payload.top_deal_price = body.topDealPrice;
  if (body.stock != null) payload.stock = body.stock;

  const path = `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
  const result = await ml.put(accountId, path, payload);
  invalidatePromotionsCache(accountId);
  return result;
}

export async function deletePromotionItem(
  accountId: string,
  itemId: string,
  promotionId: string,
  promotionType: string,
): Promise<unknown> {
  const params = new URLSearchParams({
    promotion_type: promotionType,
    promotion_id: promotionId,
    app_version: "v2",
  });
  const path = `/seller-promotions/items/${encodeURIComponent(itemId)}?${params.toString()}`;
  const result = await ml.delete(accountId, path);
  invalidatePromotionsCache(accountId);
  return result;
}

export async function bulkActivatePromotionItems(
  accountId: string,
  promotionId: string,
  promotionType: string,
  items: Array<{ itemId: string; dealPrice?: number; topDealPrice?: number; useSuggested?: boolean; stock?: number; offerId?: string }>,
): Promise<Array<{ itemId: string; ok: boolean; error?: string }>> {
  const results: Array<{ itemId: string; ok: boolean; error?: string }> = [];
  const chunkSize = 3;
  const noPriceTypes = new Set([
    "VOLUME",
    "MARKETPLACE_CAMPAIGN",
    "SMART",
    "PRICE_MATCHING",
    "PRE_NEGOTIATED",
    "SELLER_COUPON_CAMPAIGN",
  ]);
  const stockRequiredTypes = new Set(["LIGHTNING", "UNHEALTHY_STOCK"]);

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (item) => {
        try {
          let dealPrice = item.dealPrice;
          let stock = item.stock;

          const needsSuggestedPrice = item.useSuggested && dealPrice == null;
          const needsStock = stock == null && stockRequiredTypes.has(promotionType);

            if (needsSuggestedPrice || needsStock) {
            const promoItems = await listPromotionItems(accountId, promotionId, promotionType, {
              itemId: item.itemId,
              bypassCache: true,
            });
            let pi = promoItems.find((x) => x.id === item.itemId);
            if (pi) {
              try {
                const contexts = await fetchMlItemPromotions(accountId, item.itemId);
                const ctx = findPromotionItemContext(contexts, promotionId, promotionType);
                pi = mergePromotionItemWithContext(pi, ctx);
              } catch {
                // enriquecimento opcional
              }

              if (needsSuggestedPrice) {
                dealPrice = resolveMlSuggestedPrice(pi) ?? undefined;
              }
              if (needsStock) {
                const bounds = parsePromotionStockBounds(pi.stock);
                stock = bounds.stockMin ?? 1;
              }
            }
          }

          const offerId =
            item.offerId ??
            (await resolvePromotionOfferId(
              accountId,
              item.itemId,
              promotionId,
              promotionType,
            ));

          if (dealPrice == null && !noPriceTypes.has(promotionType)) {
            results.push({
              itemId: item.itemId,
              ok: false,
              error: "Preço promocional não disponível para este anúncio",
            });
            return;
          }

          if (stockRequiredTypes.has(promotionType) && (stock == null || stock < 1)) {
            results.push({
              itemId: item.itemId,
              ok: false,
              error: "Quantidade de estoque não informada",
            });
            return;
          }

          await activatePromotionItem(accountId, item.itemId, {
            promotionId,
            promotionType,
            dealPrice,
            topDealPrice: item.topDealPrice,
            stock,
            offerId,
          });
          results.push({ itemId: item.itemId, ok: true });
        } catch (err) {
          results.push({ itemId: item.itemId, ok: false, error: mapMlPromotionError(err) });
        }
      }),
    );
  }

  return results;
}

export type MlPromotionCandidate = {
  id: string;
  item_id: string;
  promotion_id: string;
  type: string;
  status: { id: string };
};

export type MlPromotionOffer = {
  id: string;
  item_id: string;
  promotion_id: string;
  type: string;
  status: { id: string };
};

export async function fetchPromotionCandidate(
  accountId: string,
  candidateId: string,
): Promise<MlPromotionCandidate> {
  return ml.get<MlPromotionCandidate>(
    accountId,
    `/seller-promotions/candidates/${encodeURIComponent(candidateId)}?app_version=v2`,
  );
}

export async function fetchPromotionOffer(
  accountId: string,
  offerId: string,
): Promise<MlPromotionOffer> {
  return ml.get<MlPromotionOffer>(
    accountId,
    `/seller-promotions/offers/${encodeURIComponent(offerId)}?app_version=v2`,
  );
}
