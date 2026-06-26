import type { BulkUpdateProductListingStatusResult } from "@workspace/api-client-react";

export function summarizeBulkListingStatusResults(
  results: BulkUpdateProductListingStatusResult[] | undefined,
) {
  const list = results ?? [];
  return {
    updated: list.filter((r) => r.ok && !r.skipped).length,
    skipped: list.filter((r) => r.skipped).length,
    failed: list.filter((r) => !r.ok && !r.skipped).length,
    firstError: list.find((r) => !r.ok && !r.skipped)?.error,
  };
}

export function bulkListingStatusToastContent(
  action: "pause" | "activate",
  results: BulkUpdateProductListingStatusResult[] | undefined,
): {
  title: string;
  description?: string;
  variant: "default" | "destructive";
} {
  const { updated, failed, firstError } = summarizeBulkListingStatusResults(results);
  const verb = action === "pause" ? "pausado" : "ativado";
  const verbPlural = action === "pause" ? "pausados" : "ativados";

  if (failed === 0) {
    return {
      title: action === "pause" ? "Anúncios pausados" : "Anúncios ativados",
      description: `${updated} anúncio(s) ${verbPlural} com sucesso.`,
      variant: "default",
    };
  }

  if (updated === 0) {
    return {
      title: action === "pause" ? "Nenhum anúncio pausado" : "Nenhum anúncio ativado",
      description: firstError ?? `${failed} anúncio(s) não puderam ser ${verbPlural}.`,
      variant: "destructive",
    };
  }

  return {
    title: action === "pause" ? "Pausa parcial" : "Ativação parcial",
    description: `${updated} ${verb}(s), ${failed} com erro.${firstError ? ` Ex.: ${firstError}` : ""}`,
    variant: "destructive",
  };
}

export function bulkListingStatusErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const apiErr = err as { payload?: { error?: { message?: string } } };
    if (apiErr.payload?.error?.message) {
      return apiErr.payload.error.message;
    }
  }
  return "Não foi possível alterar o status dos anúncios selecionados.";
}
