import type { PromotionItem, PromotionInboxEntry } from "@workspace/api-client-react";

export type PromotionItemFields = Pick<
  PromotionItem,
  | "originalPrice"
  | "maxOriginalPrice"
  | "minDiscountedPrice"
  | "maxDiscountedPrice"
  | "suggestedDiscountedPrice"
  | "stockMin"
  | "stockMax"
  | "availableQuantity"
  | "startDate"
  | "endDate"
  | "price"
  | "discountPercentage"
  | "status"
  | "netProceeds"
  | "feeSubsidyAmount"
  | "taxPercent"
  | "purchasePrice"
  | "offerId"
>;

export type PromotionActivationConfig = {
  needsPrice: boolean;
  needsStock: boolean;
  stockOptional: boolean;
  needsTopDealPrice: boolean;
  hasPriceSuggestion: boolean;
  confirmOnly: boolean;
};

const NO_PRICE_TYPES = new Set([
  "VOLUME",
  "MARKETPLACE_CAMPAIGN",
  "SMART",
  "PRICE_MATCHING",
  "PRE_NEGOTIATED",
  "SELLER_COUPON_CAMPAIGN",
]);

export function getPromotionActivationConfig(promotionType: string): PromotionActivationConfig {
  if (NO_PRICE_TYPES.has(promotionType)) {
    return {
      needsPrice: false,
      needsStock: false,
      stockOptional: false,
      needsTopDealPrice: false,
      hasPriceSuggestion: false,
      confirmOnly: true,
    };
  }

  if (promotionType === "LIGHTNING") {
    return {
      needsPrice: true,
      needsStock: true,
      stockOptional: false,
      needsTopDealPrice: false,
      hasPriceSuggestion: true,
      confirmOnly: false,
    };
  }

  if (promotionType === "DOD") {
    return {
      needsPrice: true,
      needsStock: true,
      stockOptional: true,
      needsTopDealPrice: false,
      hasPriceSuggestion: true,
      confirmOnly: false,
    };
  }

  if (promotionType === "UNHEALTHY_STOCK") {
    return {
      needsPrice: false,
      needsStock: true,
      stockOptional: false,
      needsTopDealPrice: false,
      hasPriceSuggestion: false,
      confirmOnly: false,
    };
  }

  if (promotionType === "DEAL") {
    return {
      needsPrice: true,
      needsStock: false,
      stockOptional: false,
      needsTopDealPrice: true,
      hasPriceSuggestion: false,
      confirmOnly: false,
    };
  }

  return {
    needsPrice: true,
    needsStock: false,
    stockOptional: false,
    needsTopDealPrice: false,
    hasPriceSuggestion: true,
    confirmOnly: false,
  };
}

/**
 * Faixa de preço promocional permitida pelo ML.
 * - min_discounted_price → piso (desconto máximo)
 * - max_discounted_price → teto credível (desconto mínimo)
 */
export function getPriceBounds(
  _promotionType: string,
  item: PromotionItemFields,
): { min: number | null; max: number | null } {
  const minDiscounted = item.minDiscountedPrice ?? null;
  const maxDiscounted = item.maxDiscountedPrice ?? null;
  const original = item.originalPrice ?? null;

  let min = minDiscounted;
  let max = maxDiscounted ?? original;

  if (min != null && max != null && min > max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    min = lo;
    max = hi;
  }

  return { min, max };
}

/** Ajusta deal_price para a faixa credível do ML (evita ERROR_CREDIBILITY_DISCOUNTED_PRICE). */
export function clampDealPriceToBounds(
  price: number,
  bounds: { min: number | null; max: number | null },
): number {
  let next = Math.round(price * 100) / 100;
  if (bounds.max != null && next > bounds.max) next = bounds.max;
  if (bounds.min != null && next < bounds.min) next = bounds.min;
  return Math.round(next * 100) / 100;
}

export function calcDiscountPercent(original: number, finalPrice: number): number {
  if (original <= 0) return 0;
  return Math.round(((original - finalPrice) / original) * 100);
}

export function calcFinalFromDiscount(original: number, discountPercent: number): number {
  return Math.round((original * (1 - discountPercent / 100)) * 100) / 100;
}

export function calcDiscountAmount(original: number, discountPercent: number): number {
  return Math.round((original * (discountPercent / 100)) * 100) / 100;
}

/** Preço promocional sugerido pelo ML (`suggested_discounted_price` na API v2). */
export function resolveSuggestedDealPrice(
  item: PromotionItemFields & { discountPercent?: number | null },
): number | null {
  if (item.suggestedDiscountedPrice != null && item.suggestedDiscountedPrice > 0) {
    return item.suggestedDiscountedPrice;
  }
  if (item.status === "candidate" && item.price != null && item.price > 0) {
    const maxDiscounted = item.maxDiscountedPrice;
    const original = item.originalPrice;
    const isCeilingPrice =
      maxDiscounted != null && Math.abs(item.price - maxDiscounted) < 0.02;
    const isNearOriginal = original != null && item.price >= original * 0.85;
    if (!isCeilingPrice && !isNearOriginal) {
      return item.price;
    }
    return null;
  }
  if (
    item.originalPrice != null &&
    item.discountPercentage != null &&
    item.discountPercentage > 0
  ) {
    return calcFinalFromDiscount(item.originalPrice, item.discountPercentage);
  }
  if (
    item.originalPrice != null &&
    item.discountPercent != null &&
    item.discountPercent > 0
  ) {
    return calcFinalFromDiscount(item.originalPrice, item.discountPercent);
  }
  return null;
}

export function resolveSuggestedDiscountPercent(
  item: PromotionItemFields & { discountPercent?: number | null },
  suggestedPrice: number | null,
): number | null {
  if (item.discountPercentage != null && item.discountPercentage > 0) {
    return Math.round(item.discountPercentage);
  }
  if (item.discountPercent != null && item.discountPercent > 0) {
    return item.discountPercent;
  }
  if (item.originalPrice != null && suggestedPrice != null) {
    return calcDiscountPercent(item.originalPrice, suggestedPrice);
  }
  return null;
}

export function formatPriceInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function mergeItemFields(
  base: PromotionInboxEntry | PromotionItem | null,
  fresh?: PromotionItem | null,
): PromotionItemFields & {
  itemId: string;
  title?: string | null;
  thumbnail?: string | null;
  sku?: string | null;
  discountPercent?: number | null;
} {
  const itemId =
    base && "itemId" in base ? base.itemId : (base as PromotionItem | null)?.itemId ?? "";
  const src = { ...base, ...fresh } as PromotionInboxEntry & PromotionItem;
  const inbox = base as PromotionInboxEntry | null;
  return {
    itemId,
    title: src.title,
    thumbnail: src.thumbnail,
    sku: src.sku,
    status: fresh?.status ?? src.status ?? inbox?.itemStatus ?? null,
    price: fresh?.price ?? src.price ?? null,
    discountPercentage: fresh?.discountPercentage ?? src.discountPercentage ?? null,
    discountPercent: inbox?.discountPercent ?? null,
    originalPrice: src.originalPrice ?? fresh?.originalPrice ?? null,
    maxOriginalPrice: fresh?.maxOriginalPrice ?? inbox?.maxOriginalPrice ?? null,
    minDiscountedPrice: src.minDiscountedPrice ?? fresh?.minDiscountedPrice ?? null,
    maxDiscountedPrice: src.maxDiscountedPrice ?? fresh?.maxDiscountedPrice ?? null,
    suggestedDiscountedPrice: fresh?.suggestedDiscountedPrice ?? src.suggestedDiscountedPrice ?? null,
    netProceeds: fresh?.netProceeds ?? src.netProceeds ?? null,
    feeSubsidyAmount: fresh?.feeSubsidyAmount ?? src.feeSubsidyAmount ?? null,
    taxPercent: fresh?.taxPercent ?? src.taxPercent ?? null,
    purchasePrice: fresh?.purchasePrice ?? src.purchasePrice ?? null,
    stockMin: fresh?.stockMin ?? inbox?.stockMin ?? null,
    stockMax: fresh?.stockMax ?? inbox?.stockMax ?? null,
    availableQuantity: src.availableQuantity ?? fresh?.availableQuantity ?? null,
    startDate: fresh?.startDate ?? inbox?.startDate ?? null,
    endDate: fresh?.endDate ?? inbox?.endDate ?? null,
    offerId: fresh?.offerId ?? src.offerId ?? inbox?.offerId ?? null,
  };
}

export function formatPromotionValidity(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (start && end) return `${fmt(start)} — ${fmt(end)}`;
  if (start) return `A partir de ${fmt(start)}`;
  return `Até ${fmt(end!)}`;
}

export function defaultStockValue(
  item: PromotionItemFields,
  config: PromotionActivationConfig,
  promotionType?: string,
): string {
  const total = item.availableQuantity ?? 0;
  let min = item.stockMin ?? 1;
  let max = item.stockMax ?? (total > 0 ? total : 1);

  if (config.needsStock || config.stockOptional) {
    // Oferta relâmpago: ML exige >5 e <11 → reservar 6–10.
    if (promotionType === "LIGHTNING") {
      if (min < 6) min = 6;
      if (item.stockMax == null) max = 10;
      if (total > 0) max = Math.min(max, total);
    } else if (total > 0) {
      max = Math.min(max, total);
    }

    const suggested = min > 0 ? min : 1;
    const upper = max >= min ? max : min;
    const clamped = total > 0 ? Math.min(upper, suggested) : suggested;
    return String(Math.max(min, clamped));
  }
  return total > 0 ? String(total) : "1";
}
