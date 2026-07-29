import { ml } from "./mercadolivre";
import { getDb } from "./db";
import { productsTable, inventorySkuFinancialsTable } from "@workspace/db/schema";
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

/** Anúncio ainda não ativado na campanha (elegível para participação). */
export function isPromotionItemCandidate(status: string | null | undefined): boolean {
  return status === "candidate";
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
  net_proceeds?: MlNetProceeds | number | null;
  offer_id?: string | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  boosted_offer?: boolean | null;
  discount_meli_boosted_percentage?: number | null;
  discount_meli_boost_amount?: number | null;
  total_price_for_boosted_offer?: number | null;
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
  net_proceeds?: MlNetProceeds | number | null;
  stock?: MlPromotionItemStock;
  start_date?: string | null;
  end_date?: string | null;
  ref_id?: string | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  boosted_offer?: boolean | null;
  discount_meli_boosted_percentage?: number | null;
  discount_meli_boost_amount?: number | null;
  total_price_for_boosted_offer?: number | null;
};

export function normalizeNetProceeds(
  value: MlNetProceeds | number | null | undefined,
): { amount: number; currency: string | null } | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return value > 0 || value === 0 ? { amount: value, currency: null } : null;
  }
  if (value.amount != null) {
    return { amount: value.amount, currency: value.currency ?? null };
  }
  return null;
}

/**
 * Subsídio de tarifas por venda.
 * 1) `discount_meli_boost_amount` quando boost ativo
 * 2) senão contribuição ML: original_price × meli_percentage / 100
 *    (co-funding SMART/PRICE_MATCHING/MARKETPLACE_CAMPAIGN)
 */
export function resolveFeeSubsidyAmount(
  item: Pick<
    MlPromotionItem,
    | "discount_meli_boost_amount"
    | "boosted_offer"
    | "meli_percentage"
    | "original_price"
  >,
): number | null {
  const boost = item.discount_meli_boost_amount;
  if (boost != null && boost > 0 && item.boosted_offer !== false) {
    return boost;
  }
  const meliPct = item.meli_percentage;
  const original = item.original_price;
  if (meliPct != null && meliPct > 0 && original != null && original > 0) {
    return Math.round(original * meliPct) / 100;
  }
  return null;
}

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
    meli_percentage: context.meli_percentage ?? item.meli_percentage,
    seller_percentage: context.seller_percentage ?? item.seller_percentage,
    boosted_offer: context.boosted_offer ?? item.boosted_offer,
    discount_meli_boosted_percentage:
      context.discount_meli_boosted_percentage ?? item.discount_meli_boosted_percentage,
    discount_meli_boost_amount:
      context.discount_meli_boost_amount ?? item.discount_meli_boost_amount,
    total_price_for_boosted_offer:
      context.total_price_for_boosted_offer ?? item.total_price_for_boosted_offer,
  };
}

export function parsePromotionStockBounds(stock?: MlPromotionItemStock): {
  stockMin: number | null;
  stockMax: number | null;
} {
  if (stock == null) return { stockMin: null, stockMax: null };
  // Número isolado = teto (não piso). Antes tratávamos como min=1 e o lote enviava stock:1.
  if (typeof stock === "number") return { stockMin: null, stockMax: stock };
  return {
    stockMin: stock.min ?? null,
    stockMax: stock.max ?? null,
  };
}

/** Tipos que exigem estoque reservado na ativação. */
export const PROMOTION_TYPES_REQUIRING_STOCK = new Set(["LIGHTNING", "UNHEALTHY_STOCK"]);

/**
 * Calcula o estoque a reservar na ativação.
 * Oferta relâmpago (ML): em geral maior que 5 e menor que 11 → 6–10.
 * Regra de negócio: com availableQuantity > 5, tenta ativar com valor válido na faixa.
 */
export function resolveActivationStock(params: {
  promotionType: string;
  availableQuantity?: number | null;
  stockMin?: number | null;
  stockMax?: number | null;
  requestedStock?: number | null;
}): { stock: number } | { error: string } {
  const { promotionType, availableQuantity, requestedStock } = params;
  const hasAvailable = availableQuantity != null;
  const available = availableQuantity ?? 0;

  if (promotionType === "LIGHTNING") {
    if (hasAvailable && available <= 5) {
      return {
        error:
          "É necessário ter mais de 5 unidades em estoque para ativar a Oferta relâmpago.",
      };
    }

    // Faixa ML típica (>5 e <11). Se a API mandar min≤5 (piso exclusivo/errado), sobe para 6.
    let min = params.stockMin;
    let max = params.stockMax;
    if (min == null || min < 6) min = 6;
    if (max == null || max < min) max = 10;
    if (hasAvailable) max = Math.min(max, available);

    if (hasAvailable && max < min) {
      return {
        error: `Estoque insuficiente: a Oferta relâmpago exige entre ${min} e ${params.stockMax ?? 10} unidades (disponível: ${available}).`,
      };
    }

    let stock = requestedStock ?? min;
    if (stock < min || stock > max) stock = min;
    stock = Math.min(Math.max(stock, min), max);
    return { stock };
  }

  if (!PROMOTION_TYPES_REQUIRING_STOCK.has(promotionType) && promotionType !== "DOD") {
    if (requestedStock != null && requestedStock >= 1) return { stock: requestedStock };
    return { error: "Quantidade de estoque não informada" };
  }

  const min = params.stockMin ?? 1;
  let max = params.stockMax ?? (hasAvailable && available > 0 ? available : min);
  if (hasAvailable && available > 0) max = Math.min(max, available);

  if (hasAvailable && available > 0 && available < min) {
    return {
      error: `Estoque insuficiente: necessário no mínimo ${min} unidade(s) (disponível: ${available}).`,
    };
  }

  let stock = requestedStock ?? min;
  if (stock < min || stock > max) stock = min;
  stock = Math.min(Math.max(stock, min), max);
  if (stock < 1) return { error: "Quantidade de estoque não informada" };
  return { stock };
}

async function loadItemStockContext(
  accountId: string,
  itemId: string,
  promotionId: string,
  promotionType: string,
): Promise<{
  stockMin: number | null;
  stockMax: number | null;
  availableQuantity: number | null;
  suggestedPrice: number | null;
  offerId?: string;
}> {
  let stockMin: number | null = null;
  let stockMax: number | null = null;
  let suggestedPrice: number | null = null;
  let offerId: string | undefined;

  try {
    const [items, contexts] = await Promise.all([
      listPromotionItems(accountId, promotionId, promotionType, {
        itemId,
        bypassCache: true,
      }),
      fetchMlItemPromotions(accountId, itemId),
    ]);
    const fromList = items.find((x) => x.id === itemId);
    const ctx = findPromotionItemContext(contexts, promotionId, promotionType);
    const merged = fromList ? mergePromotionItemWithContext(fromList, ctx) : null;
    if (merged) {
      const bounds = parsePromotionStockBounds(merged.stock);
      stockMin = bounds.stockMin;
      stockMax = bounds.stockMax;
      suggestedPrice = resolveMlSuggestedPrice(merged);
      offerId = resolveOfferIdFromMlItem(merged);
    } else if (ctx) {
      const bounds = parsePromotionStockBounds(ctx.stock);
      stockMin = bounds.stockMin;
      stockMax = bounds.stockMax;
      offerId = ctx.ref_id?.trim() || undefined;
    }
  } catch {
    // enriquecimento opcional
  }

  let availableQuantity: number | null = null;
  try {
    const enriched = await enrichItemsWithProducts(accountId, [{ id: itemId, status: "candidate" }]);
    availableQuantity = enriched[0]?.availableQuantity ?? null;
  } catch {
    // opcional
  }

  return { stockMin, stockMax, availableQuantity, suggestedPrice, offerId };
}

export type EnrichedPromotionItem = MlPromotionItem & {
  productId?: string | null;
  title?: string | null;
  sku?: string | null;
  thumbnail?: string | null;
  permalink?: string | null;
  availableQuantity?: number | null;
  mlCategoryId?: string | null;
  listingType?: string | null;
  /** Inventário geral / Custos (relatórios) — por SKU do usuário */
  taxPercent?: number | null;
  purchasePrice?: number | null;
};

export type SkuFinancials = {
  taxPercent: number | null;
  purchasePrice: number | null;
};

/** Imposto (%) e preço de compra salvos em Inventário Geral / Custos (relatórios). */
export async function loadInventorySkuFinancialsMap(
  userId: string,
  skus: string[],
): Promise<Map<string, SkuFinancials>> {
  const unique = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const map = new Map<string, SkuFinancials>();
  if (unique.length === 0) return map;

  try {
    const db = getDb();
    const rows = await db
      .select({
        sku: inventorySkuFinancialsTable.sku,
        taxPercent: inventorySkuFinancialsTable.taxPercent,
        purchasePrice: inventorySkuFinancialsTable.purchasePrice,
      })
      .from(inventorySkuFinancialsTable)
      .where(
        and(
          eq(inventorySkuFinancialsTable.userId, userId),
          inArray(inventorySkuFinancialsTable.sku, unique),
        ),
      );

    for (const row of rows) {
      map.set(row.sku, {
        taxPercent: row.taxPercent != null ? Number(row.taxPercent) : null,
        purchasePrice: row.purchasePrice != null ? Number(row.purchasePrice) : null,
      });
    }
  } catch {
    // migração ausente ou tabela indisponível — não quebra promoções
  }

  return map;
}

export async function attachInventorySkuFinancials<T extends { sku?: string | null }>(
  userId: string,
  rows: T[],
): Promise<(T & SkuFinancials)[]> {
  const map = await loadInventorySkuFinancialsMap(
    userId,
    rows.map((r) => r.sku ?? "").filter(Boolean),
  );
  return rows.map((row) => {
    const fin = row.sku ? map.get(row.sku) : undefined;
    return {
      ...row,
      taxPercent: fin?.taxPercent ?? null,
      purchasePrice: fin?.purchasePrice ?? null,
    };
  });
}


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
  netProceeds?: { amount: number; currency?: string | null } | null;
  feeSubsidyAmount?: number | null;
  taxPercent?: number | null;
  purchasePrice?: number | null;
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

function translateMlStockMessage(message: string): string | null {
  const stockGreaterLess = message.match(
    /Stock must be greater than (\d+) and less than (\d+)/i,
  );
  if (stockGreaterLess) {
    return `O estoque reservado deve ser maior que ${stockGreaterLess[1]} e menor que ${stockGreaterLess[2]}.`;
  }
  const stockBetween = message.match(/Stock must be between (\d+) and (\d+)/i);
  if (stockBetween) {
    return `O estoque reservado deve estar entre ${stockBetween[1]} e ${stockBetween[2]}.`;
  }
  const stockMinOnly = message.match(/Stock must be greater than (\d+)/i);
  if (stockMinOnly) {
    return `O estoque reservado deve ser maior que ${stockMinOnly[1]}.`;
  }
  const stockMaxOnly = message.match(/Stock must be less than (\d+)/i);
  if (stockMaxOnly) {
    return `O estoque reservado deve ser menor que ${stockMaxOnly[1]}.`;
  }
  return null;
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
      const stockPt = translateMlStockMessage(parsed.message);
      if (stockPt) return stockPt;
      return parsed.message;
    }
  } catch {
    // not JSON
  }
  const stockFromRaw = translateMlStockMessage(msg) ?? translateMlStockMessage(mlBody);
  if (stockFromRaw) return stockFromRaw;
  if (msg.includes("ERROR_CREDIBILITY_DISCOUNTED_PRICE") || /discounted price is not credible/i.test(msg)) {
    return "O preço com desconto não é considerado credível pelo Mercado Livre. Use o preço sugerido ou um valor dentro da faixa permitida (desconto mínimo/máximo da campanha) e tente novamente.";
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
      mlCategoryId: productsTable.mlCategoryId,
      listingType: productsTable.listingType,
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
      mlCategoryId: p?.mlCategoryId ?? null,
      listingType: p?.listingType ?? null,
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
            if (!isPromotionItemCandidate(item.status)) continue;
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
              netProceeds: normalizeNetProceeds(item.net_proceeds),
              feeSubsidyAmount: resolveFeeSubsidyAmount(item),
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

/** Estima "você recebe" via tarifa de listagem ML quando a API de promoções não envia net_proceeds. */
export async function estimateNetProceedsFromListingPrice(
  accountId: string,
  params: {
    price: number;
    categoryId?: string | null;
    listingType?: string | null;
    feeSubsidyAmount?: number | null;
    siteId?: string;
  },
): Promise<number | null> {
  const { price, categoryId, listingType, feeSubsidyAmount, siteId = "MLB" } = params;
  if (!categoryId || !(price > 0)) return null;

  try {
    const qs = new URLSearchParams({
      price: String(price),
      category_id: categoryId,
    });
    if (listingType) qs.set("listing_type_id", listingType);

    const res = await ml.get<
      { sale_fee_amount?: number } | Array<{ sale_fee_amount?: number }>
    >(accountId, `/sites/${siteId}/listing_prices?${qs.toString()}`);

    const row = Array.isArray(res) ? res[0] : res;
    const fee = row?.sale_fee_amount;
    if (fee == null || !Number.isFinite(fee)) return null;

    const subsidy = feeSubsidyAmount != null && feeSubsidyAmount > 0 ? feeSubsidyAmount : 0;
    return Math.round((price - fee + subsidy) * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Enriquece entradas da página atual com GET /seller-promotions/items/{id}
 * (net_proceeds e campos de boost costumam vir só nesse endpoint para candidatos).
 */
export async function enrichInboxEntriesWithItemContext(
  entries: InboxEntry[],
  options?: { chunkSize?: number },
): Promise<InboxEntry[]> {
  if (entries.length === 0) return entries;
  const chunkSize = options?.chunkSize ?? 5;
  const result = [...entries];

  const byAccountItems = new Map<string, string[]>();
  for (const e of result) {
    const list = byAccountItems.get(e.accountId) ?? [];
    list.push(e.itemId);
    byAccountItems.set(e.accountId, list);
  }
  const productMeta = new Map<
    string,
    { mlCategoryId: string | null; listingType: string | null }
  >();
  try {
    const db = getDb();
    for (const [accountId, itemIds] of byAccountItems) {
      const unique = [...new Set(itemIds)];
      const prods = await db
        .select({
          mlItemId: productsTable.mlItemId,
          mlCategoryId: productsTable.mlCategoryId,
          listingType: productsTable.listingType,
        })
        .from(productsTable)
        .where(
          and(eq(productsTable.accountId, accountId), inArray(productsTable.mlItemId, unique)),
        );
      for (const p of prods) {
        productMeta.set(`${accountId}:${p.mlItemId}`, {
          mlCategoryId: p.mlCategoryId,
          listingType: p.listingType,
        });
      }
    }
  } catch {
    // meta opcional
  }

  for (let i = 0; i < result.length; i += chunkSize) {
    const chunk = result.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (entry, idx) => {
        let next: InboxEntry = { ...entry };

        const needsNet = next.netProceeds?.amount == null;
        const needsSubsidy = next.feeSubsidyAmount == null || next.feeSubsidyAmount <= 0;
        if (needsNet || needsSubsidy || !next.offerId) {
          try {
            const contexts = await fetchMlItemPromotions(entry.accountId, entry.itemId);
            const ctx = findPromotionItemContext(contexts, entry.promotionId, entry.promotionType);
            if (ctx) {
              const merged = mergePromotionItemWithContext(
                {
                  id: entry.itemId,
                  status: entry.itemStatus,
                  original_price: entry.originalPrice,
                  suggested_discounted_price: entry.suggestedDiscountedPrice,
                  offer_id: entry.offerId,
                  net_proceeds: entry.netProceeds
                    ? { amount: entry.netProceeds.amount, currency: entry.netProceeds.currency }
                    : null,
                },
                ctx,
              );

              next = {
                ...next,
                netProceeds: normalizeNetProceeds(merged.net_proceeds) ?? next.netProceeds ?? null,
                feeSubsidyAmount:
                  resolveFeeSubsidyAmount(merged) ?? next.feeSubsidyAmount ?? null,
                offerId: resolveOfferIdFromMlItem(merged) ?? next.offerId ?? null,
                originalPrice: merged.original_price ?? next.originalPrice,
                suggestedDiscountedPrice:
                  resolveMlSuggestedPrice(merged) ?? next.suggestedDiscountedPrice,
              };
            }
          } catch {
            // enriquecimento opcional
          }
        }

        if (next.netProceeds?.amount == null) {
          const meta = productMeta.get(`${entry.accountId}:${entry.itemId}`);
          const price = next.suggestedDiscountedPrice;
          if (price != null && meta?.mlCategoryId) {
            const estimated = await estimateNetProceedsFromListingPrice(entry.accountId, {
              price,
              categoryId: meta.mlCategoryId,
              listingType: meta.listingType,
              feeSubsidyAmount: next.feeSubsidyAmount,
            });
            if (estimated != null) {
              next = {
                ...next,
                netProceeds: { amount: estimated, currency: "BRL" },
              };
            }
          }
        }

        result[i + idx] = next;
      }),
    );
  }

  return result;
}

/** Enriquece itens da página com contexto por anúncio (net_proceeds / boost / %). */
export async function enrichPromotionItemsWithItemContext(
  accountId: string,
  promotionId: string,
  promotionType: string,
  items: EnrichedPromotionItem[],
  options?: { chunkSize?: number },
): Promise<EnrichedPromotionItem[]> {
  if (items.length === 0) return items;
  const chunkSize = options?.chunkSize ?? 5;
  const result = [...items];

  for (let i = 0; i < result.length; i += chunkSize) {
    const chunk = result.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (item, idx) => {
        let next: EnrichedPromotionItem = { ...item };
        const net = normalizeNetProceeds(next.net_proceeds);
        const subsidy = resolveFeeSubsidyAmount(next);
        if (!(net && subsidy != null && subsidy > 0 && resolveOfferIdFromMlItem(next))) {
          try {
            const contexts = await fetchMlItemPromotions(accountId, item.id);
            const ctx = findPromotionItemContext(contexts, promotionId, promotionType);
            if (ctx) {
              next = { ...next, ...mergePromotionItemWithContext(next, ctx) };
            }
          } catch {
            // enriquecimento opcional
          }
        }

        if (normalizeNetProceeds(next.net_proceeds) == null) {
          const price =
            resolveMlSuggestedPrice(next) ??
            (next.price != null && next.price > 0 ? next.price : null);
          const feeSubsidy = resolveFeeSubsidyAmount(next);
          if (price != null && next.mlCategoryId) {
            const estimated = await estimateNetProceedsFromListingPrice(accountId, {
              price,
              categoryId: next.mlCategoryId,
              listingType: next.listingType,
              feeSubsidyAmount: feeSubsidy,
            });
            if (estimated != null) {
              next = {
                ...next,
                net_proceeds: { amount: estimated, currency: "BRL" },
              };
            }
          }
        }

        result[i + idx] = next;
      }),
    );
  }

  return result;
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
  const noPriceTypes = new Set([
    "VOLUME",
    "MARKETPLACE_CAMPAIGN",
    "SMART",
    "PRICE_MATCHING",
    "PRE_NEGOTIATED",
    "SELLER_COUPON_CAMPAIGN",
  ]);
  const needsStockResolution =
    PROMOTION_TYPES_REQUIRING_STOCK.has(body.promotionType) || body.promotionType === "DOD";

  let offerId = body.offerId;
  let dealPrice = noPriceTypes.has(body.promotionType) ? undefined : body.dealPrice;
  let stock = body.stock;

  // Evita round-trips extras ao ML quando já temos offer_id e preço (e estoque não é necessário).
  const needsMlContext =
    needsStockResolution ||
    !offerId ||
    (dealPrice == null && !noPriceTypes.has(body.promotionType));

  if (needsMlContext) {
    const ctx = await loadItemStockContext(
      accountId,
      itemId,
      body.promotionId,
      body.promotionType,
    );
    if (!offerId) offerId = ctx.offerId;
    if (dealPrice == null && ctx.suggestedPrice != null && !noPriceTypes.has(body.promotionType)) {
      dealPrice = ctx.suggestedPrice;
    }

    if (PROMOTION_TYPES_REQUIRING_STOCK.has(body.promotionType)) {
      const resolved = resolveActivationStock({
        promotionType: body.promotionType,
        availableQuantity: ctx.availableQuantity,
        stockMin: ctx.stockMin,
        stockMax: ctx.stockMax,
        requestedStock: stock,
      });
      if ("error" in resolved) {
        throw new Error(resolved.error);
      }
      stock = resolved.stock;
    } else if (body.promotionType === "DOD" && stock == null) {
      const resolved = resolveActivationStock({
        promotionType: body.promotionType,
        availableQuantity: ctx.availableQuantity,
        stockMin: ctx.stockMin,
        stockMax: ctx.stockMax,
        requestedStock: stock,
      });
      if ("stock" in resolved) stock = resolved.stock;
    }
  }

  if (!offerId) {
    offerId = await resolvePromotionOfferId(accountId, itemId, body.promotionId, body.promotionType);
  }

  if (PROMOTION_TYPES_REQUIRING_OFFER_ID.has(body.promotionType) && !offerId) {
    throw new Error("OFFER_ID_REQUIRED");
  }

  const payload: Record<string, unknown> = {
    promotion_id: body.promotionId,
    promotion_type: body.promotionType,
  };
  if (offerId) payload.offer_id = offerId;
  if (dealPrice != null && !noPriceTypes.has(body.promotionType)) {
    payload.deal_price = dealPrice;
  }
  if (body.topDealPrice != null) payload.top_deal_price = body.topDealPrice;
  if (stock != null) payload.stock = stock;

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
                const enriched = await enrichItemsWithProducts(accountId, [pi]);
                const availableQuantity = enriched[0]?.availableQuantity ?? null;
                const resolved = resolveActivationStock({
                  promotionType,
                  availableQuantity,
                  stockMin: bounds.stockMin,
                  stockMax: bounds.stockMax,
                  requestedStock: stock,
                });
                if ("error" in resolved) {
                  results.push({ itemId: item.itemId, ok: false, error: resolved.error });
                  return;
                }
                stock = resolved.stock;
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
