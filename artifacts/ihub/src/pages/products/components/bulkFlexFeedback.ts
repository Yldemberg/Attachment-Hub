import type { BulkUpdateProductFlexResult } from "@workspace/api-client-react";

export function summarizeBulkFlexResults(results: BulkUpdateProductFlexResult[] | undefined) {
  const list = results ?? [];
  return {
    updated: list.filter((r) => r.ok && !r.skipped).length,
    skipped: list.filter((r) => r.skipped).length,
    failed: list.filter((r) => !r.ok && !r.skipped).length,
    firstError: list.find((r) => !r.ok && !r.skipped)?.error,
  };
}

export function bulkFlexToastContent(
  enabled: boolean,
  results: BulkUpdateProductFlexResult[] | undefined,
): {
  title: string;
  description?: string;
  variant: "default" | "destructive";
} {
  const { updated, failed, firstError } = summarizeBulkFlexResults(results);
  const verb = enabled ? "ativado" : "desativado";
  const verbPlural = enabled ? "ativados" : "desativados";

  if (failed === 0) {
    return {
      title: enabled ? "Flex ativado" : "Flex desativado",
      description: `${updated} anúncio(s) com Flex ${verbPlural}.`,
      variant: "default",
    };
  }

  if (updated === 0) {
    return {
      title: enabled ? "Nenhum Flex ativado" : "Nenhum Flex desativado",
      description: firstError ?? `${failed} anúncio(s) não puderam ter o Flex ${verbPlural}.`,
      variant: "destructive",
    };
  }

  return {
    title: enabled ? "Ativação Flex parcial" : "Desativação Flex parcial",
    description: `${updated} ${verb}(s), ${failed} com erro.${firstError ? ` Ex.: ${firstError}` : ""}`,
    variant: "destructive",
  };
}

export function bulkFlexErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const apiErr = err as { payload?: { error?: { message?: string } } };
    if (apiErr.payload?.error?.message) {
      return apiErr.payload.error.message;
    }
  }
  return "Não foi possível alterar o Flex dos anúncios selecionados.";
}
