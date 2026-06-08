import { activatePromotionItem } from "@workspace/api-client-react";
import type { BulkActivatePromotionItemResult } from "@workspace/api-client-react";
import {
  defaultStockValue,
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
  availableQuantity?: number | null;
  stockMin?: number | null;
  stockMax?: number | null;
};

export function buildBulkActivatePayloadItems(entries: BulkItemSource[], promotionType: string) {
  const config = getPromotionActivationConfig(promotionType);

  return entries.map((entry) => {
    const stockStr =
      config.needsStock || config.stockOptional
        ? defaultStockValue(
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
              startDate: null,
              endDate: null,
            },
            config,
          )
        : null;

    return {
      itemId: entry.itemId,
      dealPrice: entry.suggestedDiscountedPrice ?? undefined,
      stock: stockStr != null ? parseInt(stockStr, 10) : undefined,
    };
  });
}

export function bulkActivateErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const apiErr = err as { message?: string; data?: unknown };
    if (apiErr.data && typeof apiErr.data === "object" && apiErr.data !== null) {
      const data = apiErr.data as Record<string, unknown>;
      if (typeof data.error === "string" && data.error.trim()) return data.error;
      if (data.error && typeof data.error === "object" && "message" in data.error) {
        const nested = String((data.error as { message: string }).message);
        if (nested.trim()) return nested;
      }
    }
    if (apiErr.message?.trim()) return apiErr.message;
  }
  return "Não foi possível comunicar com o servidor. Tente novamente.";
}

/** Ativa um a um via endpoint individual (mesmo fluxo do botão Ativar). */
export async function activatePromotionItemsSequentially(params: {
  promotionId: string;
  accountId: string;
  promotionType: string;
  items: Array<{ itemId: string; dealPrice?: number; stock?: number }>;
  onProgress?: (done: number, total: number) => void;
}): Promise<BulkActivatePromotionItemResult[]> {
  const { promotionId, accountId, promotionType, items, onProgress } = params;
  const results: BulkActivatePromotionItemResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    try {
      await activatePromotionItem(promotionId, item.itemId, {
        accountId,
        promotionType,
        dealPrice: item.dealPrice,
        stock: item.stock,
      });
      results.push({ itemId: item.itemId, ok: true });
    } catch (err) {
      results.push({
        itemId: item.itemId,
        ok: false,
        error: bulkActivateErrorMessage(err),
      });
    }
    onProgress?.(i + 1, items.length);
  }

  return results;
}
