import { activatePromotionItem } from "@workspace/api-client-react";
import type { BulkActivatePromotionItemResult } from "@workspace/api-client-react";
import {
  clampDealPriceToBounds,
  defaultStockValue,
  getPriceBounds,
  getPromotionActivationConfig,
} from "./promotionActivationConfig";

export function summarizeBulkActivateResults(results: BulkActivatePromotionItemResult[] | undefined) {
  const list = results ?? [];
  return {
    ok: list.filter((r) => r.ok).length,
    fail: list.filter((r) => !r.ok).length,
    firstError: list.find((r) => !r.ok)?.error,
  };
}

export function bulkActivateToastContent(results: BulkActivatePromotionItemResult[] | undefined): {
  title: string;
  description?: string;
  variant: "default" | "destructive";
} {
  const { ok, fail, firstError } = summarizeBulkActivateResults(results);

  if (fail === 0) {
    return {
      title: "Ativação concluída",
      description: `${ok} anúncio(s) ativado(s) com sucesso.`,
      variant: "default",
    };
  }

  if (ok === 0) {
    return {
      title: "Nenhum anúncio foi ativado",
      description: firstError ?? `${fail} anúncio(s) não puderam ser ativados.`,
      variant: "destructive",
    };
  }

  return {
    title: "Ativação parcial",
    description: `${ok} ativado(s), ${fail} com erro.${firstError ? ` Ex.: ${firstError}` : ""}`,
    variant: "destructive",
  };
}

type BulkItemSource = {
  itemId: string;
  suggestedDiscountedPrice?: number | null;
  originalPrice?: number | null;
  minDiscountedPrice?: number | null;
  maxDiscountedPrice?: number | null;
  availableQuantity?: number | null;
  stockMin?: number | null;
  stockMax?: number | null;
  offerId?: string | null;
};

export type BulkActivatePreparedItem = {
  itemId: string;
  dealPrice?: number;
  stock?: number;
  offerId?: string;
  /** Falha local — não chamar o ML */
  validationError?: string;
};

function stockRangeLabel(stockMin: number | null | undefined, stockMax: number | null | undefined): string {
  const min = stockMin ?? 1;
  if (stockMax != null) return `entre ${min} e ${stockMax}`;
  return `no mínimo ${min}`;
}

function validateBulkStock(
  entry: BulkItemSource,
  stock: number,
  needsStock: boolean,
  promotionType: string,
): string | undefined {
  if (!needsStock) return undefined;

  const { stockMin, stockMax, availableQuantity } = entry;
  const total = availableQuantity ?? 0;
  const hasAvailable = availableQuantity != null;

  if (promotionType === "LIGHTNING") {
    if (hasAvailable && total <= 5) {
      return "É necessário ter mais de 5 unidades em estoque para ativar a Oferta relâmpago.";
    }
    const min = stockMin != null && stockMin >= 6 ? stockMin : 6;
    const maxCap = stockMax != null ? stockMax : 10;
    if (hasAvailable && total < min) {
      return `Estoque insuficiente: a promoção exige ${stockRangeLabel(min, maxCap)} unidades (disponível: ${total}).`;
    }
    if (stock < min) {
      return `Estoque reservado inválido: mínimo de ${min} unidade(s) para esta promoção.`;
    }
    if (stock > maxCap) {
      return `Estoque reservado inválido: máximo de ${maxCap} unidade(s) para esta promoção.`;
    }
    if (hasAvailable && stock > total) {
      return `Estoque insuficiente: disponível ${total}, necessário ${stock}.`;
    }
    return undefined;
  }

  if (stockMin != null && total < stockMin) {
    return `Estoque insuficiente: a promoção exige ${stockRangeLabel(stockMin, stockMax)} unidades (disponível: ${total}).`;
  }

  if (stockMin != null && stock < stockMin) {
    return `Estoque reservado inválido: mínimo de ${stockMin} unidade(s) para esta promoção.`;
  }

  if (stockMax != null && stock > stockMax) {
    return `Estoque reservado inválido: máximo de ${stockMax} unidade(s) para esta promoção.`;
  }

  if (total > 0 && stock > total) {
    return `Estoque insuficiente: disponível ${total}, necessário ${stock}.`;
  }

  if (stock < 1) {
    return "Informe a quantidade de estoque a reservar (mínimo 1).";
  }

  return undefined;
}

/** Traduz mensagens conhecidas do ML (estoque, offer_id, credibilidade, etc.). */
export function translateMlPromotionMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;

  if (trimmed.includes("Offer id is required") || trimmed === "OFFER_ID_REQUIRED") {
    return "Esta campanha exige o identificador da oferta. Atualize a página e tente novamente.";
  }

  if (
    trimmed.includes("ERROR_CREDIBILITY_DISCOUNTED_PRICE") ||
    /discounted price is not credible/i.test(trimmed)
  ) {
    return "O preço com desconto não é considerado credível pelo Mercado Livre. Use o preço sugerido ou um valor dentro da faixa permitida (desconto mínimo/máximo da campanha) e tente novamente.";
  }

  const stockGreaterLess = trimmed.match(
    /Stock must be greater than (\d+) and less than (\d+)/i,
  );
  if (stockGreaterLess) {
    const greater = stockGreaterLess[1];
    const less = stockGreaterLess[2];
    return `O estoque reservado deve ser maior que ${greater} e menor que ${less}.`;
  }

  const stockBetween = trimmed.match(/Stock must be between (\d+) and (\d+)/i);
  if (stockBetween) {
    return `O estoque reservado deve estar entre ${stockBetween[1]} e ${stockBetween[2]}.`;
  }

  const stockMinOnly = trimmed.match(/Stock must be greater than (\d+)/i);
  if (stockMinOnly) {
    return `O estoque reservado deve ser maior que ${stockMinOnly[1]}.`;
  }

  const stockMaxOnly = trimmed.match(/Stock must be less than (\d+)/i);
  if (stockMaxOnly) {
    return `O estoque reservado deve ser menor que ${stockMaxOnly[1]}.`;
  }

  return trimmed;
}

export function buildBulkActivatePayloadItems(
  entries: BulkItemSource[],
  promotionType: string,
): BulkActivatePreparedItem[] {
  const config = getPromotionActivationConfig(promotionType);

  return entries.map((entry) => {
    const base: BulkActivatePreparedItem = {
      itemId: entry.itemId,
      offerId: entry.offerId ?? undefined,
    };

    // Campanhas confirm-only (SMART, etc.): não enviar deal_price — o ML rejeita preço fora da oferta.
    if (config.needsPrice) {
      let dealPrice = entry.suggestedDiscountedPrice ?? undefined;
      if (dealPrice != null) {
        const bounds = getPriceBounds(promotionType, {
          originalPrice: entry.originalPrice ?? null,
          maxOriginalPrice: null,
          minDiscountedPrice: entry.minDiscountedPrice ?? null,
          maxDiscountedPrice: entry.maxDiscountedPrice ?? null,
          suggestedDiscountedPrice: entry.suggestedDiscountedPrice ?? null,
          stockMin: entry.stockMin ?? null,
          stockMax: entry.stockMax ?? null,
          availableQuantity: entry.availableQuantity ?? null,
          startDate: null,
          endDate: null,
          price: null,
          discountPercentage: null,
          status: "candidate",
          netProceeds: null,
          feeSubsidyAmount: null,
          taxPercent: null,
          purchasePrice: null,
          offerId: entry.offerId ?? null,
        });
        dealPrice = clampDealPriceToBounds(dealPrice, bounds);
      }
      base.dealPrice = dealPrice;
      if (dealPrice == null) {
        base.validationError = "Preço promocional não disponível para este anúncio.";
      }
    }

    if (!(config.needsStock || config.stockOptional)) {
      return base;
    }

    const stockStr = defaultStockValue(
      {
        availableQuantity: entry.availableQuantity,
        stockMin: entry.stockMin,
        stockMax: entry.stockMax,
        originalPrice: null,
        maxOriginalPrice: null,
        minDiscountedPrice: null,
        maxDiscountedPrice: null,
        suggestedDiscountedPrice: entry.suggestedDiscountedPrice,
        price: null,
        discountPercentage: null,
        status: "candidate",
        netProceeds: null,
        feeSubsidyAmount: null,
        taxPercent: null,
        purchasePrice: null,
        startDate: null,
        endDate: null,
      },
      config,
      promotionType,
    );
    const stock = parseInt(stockStr, 10);

    if (Number.isNaN(stock)) {
      return {
        ...base,
        validationError:
          base.validationError ??
          (config.needsStock
            ? "Não foi possível definir o estoque reservado para esta promoção."
            : undefined),
      };
    }

    const validationError = validateBulkStock(entry, stock, config.needsStock, promotionType);
    if (validationError) {
      return { ...base, stock, validationError };
    }

    return { ...base, stock };
  });
}

export function bulkActivateErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const apiErr = err as { message?: string; data?: unknown; status?: number };
    const data = apiErr.data;
    if (data && typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      if (typeof record.error === "string" && record.error.trim()) {
        return translateMlPromotionMessage(record.error);
      }
      if (typeof record.message === "string" && record.message.trim()) {
        return translateMlPromotionMessage(record.message);
      }
    }
    const raw = apiErr.message ?? "";
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(raw.slice(jsonStart)) as { message?: string };
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          return translateMlPromotionMessage(parsed.message);
        }
      } catch {
        // ignore
      }
    }
    if (raw.trim()) {
      return translateMlPromotionMessage(raw.replace(/^HTTP \d+ [^:]+:\s*/, ""));
    }
  }
  return "Não foi possível comunicar com o servidor. Tente novamente.";
}

const ACTIVATE_CONCURRENCY = 3;

/** Ativa em paralelo (chunks) via endpoint individual — reduz o tempo total vs 1 a 1. */
export async function activatePromotionItemsSequentially(params: {
  promotionId: string;
  accountId: string;
  promotionType: string;
  items: BulkActivatePreparedItem[];
  onProgress?: (done: number, total: number) => void;
}): Promise<BulkActivatePromotionItemResult[]> {
  const { promotionId, accountId, promotionType, items, onProgress } = params;
  const results: BulkActivatePromotionItemResult[] = new Array(items.length);
  let doneCount = 0;

  for (let i = 0; i < items.length; i += ACTIVATE_CONCURRENCY) {
    const chunk = items.slice(i, i + ACTIVATE_CONCURRENCY);
    await Promise.all(
      chunk.map(async (item, idxInChunk) => {
        const index = i + idxInChunk;

        if (item.validationError) {
          results[index] = {
            itemId: item.itemId,
            ok: false,
            error: item.validationError,
          };
        } else {
          try {
            await activatePromotionItem(promotionId, item.itemId, {
              accountId,
              promotionType,
              dealPrice: item.dealPrice,
              stock: item.stock,
              offerId: item.offerId,
            });
            results[index] = { itemId: item.itemId, ok: true };
          } catch (err) {
            results[index] = {
              itemId: item.itemId,
              ok: false,
              error: bulkActivateErrorMessage(err),
            };
          }
        }

        doneCount += 1;
        onProgress?.(doneCount, items.length);
      }),
    );
  }

  return results;
}
