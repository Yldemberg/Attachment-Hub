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

/** Price bounds for validation (sale price must fall within range when ML provides limits). */
export function getPriceBounds(
  promotionType: string,
  item: PromotionItemFields,
): { min: number | null; max: number | null } {
  if (promotionType === "LIGHTNING" || promotionType === "DOD") {
    return {
      min: item.maxOriginalPrice ?? item.minDiscountedPrice ?? null,
      max: item.minDiscountedPrice ?? item.maxDiscountedPrice ?? null,
    };
  }
  return {
    min: item.minDiscountedPrice ?? null,
    max: item.maxDiscountedPrice ?? null,
  };
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

export function mergeItemFields(
  base: PromotionInboxEntry | PromotionItem | null,
  fresh?: PromotionItem | null,
): PromotionItemFields & {
  itemId: string;
  title?: string | null;
  thumbnail?: string | null;
  sku?: string | null;
} {
  const itemId =
    base && "itemId" in base ? base.itemId : (base as PromotionItem | null)?.itemId ?? "";
  const src = { ...base, ...fresh } as PromotionInboxEntry & PromotionItem;
  return {
    itemId,
    title: src.title,
    thumbnail: src.thumbnail,
    sku: src.sku,
    originalPrice: src.originalPrice ?? fresh?.originalPrice ?? null,
    maxOriginalPrice: fresh?.maxOriginalPrice ?? (src as PromotionInboxEntry).maxOriginalPrice ?? null,
    minDiscountedPrice: src.minDiscountedPrice ?? fresh?.minDiscountedPrice ?? null,
    maxDiscountedPrice: src.maxDiscountedPrice ?? fresh?.maxDiscountedPrice ?? null,
    suggestedDiscountedPrice: src.suggestedDiscountedPrice ?? fresh?.suggestedDiscountedPrice ?? null,
    stockMin: fresh?.stockMin ?? (src as PromotionInboxEntry).stockMin ?? null,
    stockMax: fresh?.stockMax ?? (src as PromotionInboxEntry).stockMax ?? null,
    availableQuantity: src.availableQuantity ?? fresh?.availableQuantity ?? null,
    startDate: fresh?.startDate ?? (src as PromotionInboxEntry).startDate ?? null,
    endDate: fresh?.endDate ?? (src as PromotionInboxEntry).endDate ?? null,
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

export function defaultStockValue(item: PromotionItemFields, config: PromotionActivationConfig): string {
  const total = item.availableQuantity ?? 0;
  const max = item.stockMax ?? total;
  if (config.needsStock && !config.stockOptional) {
    return String(Math.min(total, max > 0 ? max : total));
  }
  if (config.stockOptional && max > 0) return String(Math.min(total, max));
  return total > 0 ? String(total) : "1";
}
