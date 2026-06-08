import type { BulkActivatePromotionItemResult } from "@workspace/api-client-react";

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

export function buildBulkActivateItemsFromPrices(
  entries: Array<{ itemId: string; suggestedDiscountedPrice?: number | null }>,
) {
  return entries.map((entry) => ({
    itemId: entry.itemId,
    dealPrice: entry.suggestedDiscountedPrice ?? undefined,
    useSuggested: entry.suggestedDiscountedPrice == null,
  }));
}
