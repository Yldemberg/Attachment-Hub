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
  offerId?: string | null;
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
      offerId: entry.offerId ?? undefined,
    };
  });
}

export function bulkActivateErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const apiErr = err as { message?: string; data?: unknown; status?: number };
    const data = apiErr.data;
    if (data && typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      if (typeof record.error === "string" && record.error.trim()) {
        if (record.error.includes("Offer id is required") || record.error === "OFFER_ID_REQUIRED") {
          return "Esta campanha exige o identificador da oferta. Atualize a página e tente novamente.";
        }
        return record.error;
      }
      if (typeof record.message === "string" && record.message.trim()) {
        if (record.message === "Offer id is required") {
          return "Esta campanha exige o identificador da oferta. Atualize a página e tente novamente.";
        }
        return record.message;
      }
    }
    const raw = apiErr.message ?? "";
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(raw.slice(jsonStart)) as { message?: string };
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          if (parsed.message === "Offer id is required") {
            return "Esta campanha exige o identificador da oferta. Atualize a página e tente novamente.";
          }
          return parsed.message;
        }
      } catch {
        // ignore
      }
    }
    if (raw.includes("Offer id is required")) {
      return "Esta campanha exige o identificador da oferta. Atualize a página e tente novamente.";
    }
    if (raw.trim()) return raw.replace(/^HTTP \d+ [^:]+:\s*/, "");
  }
  return "Não foi possível comunicar com o servidor. Tente novamente.";
}

/** Ativa um a um via endpoint individual (mesmo fluxo do botão Ativar). */
export async function activatePromotionItemsSequentially(params: {
  promotionId: string;
  accountId: string;
  promotionType: string;
  items: Array<{ itemId: string; dealPrice?: number; stock?: number; offerId?: string }>;
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
        offerId: item.offerId,
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
